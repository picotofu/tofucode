# Slack Bot Integration

## Overview

Build a Slack bot into tofucode that listens to configured channels, DMs, and mentions —
responding as the user's identity using Claude, and optionally creating Notion tickets or
triggering tofucode work sessions.

## Decisions

- **Baked into tofucode** — follows the same pattern as `server/discord/`, lives in `server/slack/`
- **Direct API calls** — does NOT use Slack MCP for automated/bot work; MCP is reserved for interactive session use only
- **Posts as user identity** — uses `xoxp-` user token; messages appear as the user in Slack (confirmed working)
- **Socket Mode** — real-time event listening via persistent WebSocket (same model as Discord Gateway)
- **Responder scope** — acknowledgement, quick answers, ticket creation; NOT a deep problem solver
- **Approval flow** — TBD (see open questions)

## Architecture

```
server/
├── discord/          # existing Discord bot (reference implementation)
├── slack/            # new — self-contained Slack bot
│   ├── index.js      # Socket Mode connection, event router
│   ├── handlers/     # message.js, mention.js, dm.js
│   ├── responder.js  # Claude-powered response drafting
│   └── lib/          # Slack-specific API helpers (direct fetch, no MCP)
├── lib/              # shared — sessions, tasks, MCP, Notion (allowed imports)
└── index.js          # boots web UI + Discord + Slack
```

### Allowed Imports (same rules as Discord bot)

- ✅ `server/config.js` — path/slug utils, config values
- ✅ `server/lib/tasks.js` — task tracking
- ✅ `server/lib/sessions.js` — session listing, history loading
- ✅ `server/lib/session-titles.js` — session title management
- ✅ `server/lib/mcp.js` — MCP server loading
- ✅ `server/lib/logger.js` — logging
- ✅ `server/lib/projects.js` — project listing
- ✅ `@anthropic-ai/claude-agent-sdk` — direct SDK usage
- ❌ `server/lib/ws.js` — WebSocket-specific (web UI only)
- ❌ `server/lib/auth.js` — web UI auth (bot uses xoxp- token)
- ❌ `server/events/*` — web UI event handlers

## Slack Setup

### App Configuration

- **App type**: Slack App with Socket Mode enabled
- **Token type**: `xoxp-` User OAuth Token (posts as user identity, not bot identity)
- **Scopes needed**: `channels:history`, `channels:read`, `chat:write`, `groups:history`,
  `groups:read`, `im:history`, `im:write`, `mpim:history`, `mpim:write`, `users:read`

### Private Channel Access

- Private channels are NOT discoverable via `list_channels`
- User must `/invite @<bot-name>` in the channel first
- Then provide channel ID manually to be stored in config

## Direct API (curl) — Verified Working

Sending messages directly via Slack Web API using `xoxp-` token:

```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer <xoxp-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "<channel-id>",
    "text": "Hello from curl! Testing direct API call as my identity 👋"
  }'
```

**Result:** Message appears in Slack **as the user's identity** (name + avatar) ✅

## Responder Context / Knowledge

The Claude responder is given layered context:

### Static (loaded at boot)
- User's global `CLAUDE.md` — tone, identity, team structure, API path conventions, domain context
- System prompt defining user identity, communication style, role
- Team/channel context (known channels, subteam IDs, org knowledge)

### Dynamic (per event)
- The Slack message + thread history (fetched via API)
- Channel metadata — which channel, sender, team
- Notion page content — if message references a ticket/project
- Active session context — optionally injected from relevant JSONL

### CLAUDE.md as Classifier Context

The global `CLAUDE.md` is injected into the classifier system prompt to provide:
- API path conventions (context derived from repo name, full `/api/{context}/v1/` format)
- Known service contexts (`user`, `anime`, `social`, `recommendation`, `content`)
- Subteam IDs for @mentions in responses
- Infrastructure knowledge (GCP projects, environments, staging vs production hosts)

This allows the classifier to reason about which service a message refers to without
needing to hardcode org-specific knowledge in the codebase.

## Event Flow

```
Slack Event (mention / DM / watched channel message)
  │
  ├─ Fetch thread context + channel info
  ├─ Build prompt: identity + CLAUDE.md + message context
  ├─ Claude classifies + drafts response
  │
  ├─ [Acknowledge/Quick Answer] → post reply via direct API (as user)
  ├─ [Needs Ticket] → create Notion ticket → post link in thread
  │                   → link Slack thread URL in ticket
  │                   → add TLDR of what is needed
  │                   → on new thread replies → edit ticket with summarized update
  └─ [Needs Work]   → determine repository with confidence check (see below)
                      → if confident → update ticket to In Progress → start tofucode session
                      → if not confident → update ticket with question + findings → wait for user
                      → on PR creation → link PR in ticket
                      → JSONL written to ~/.claude/projects/<slug>/
                      → naturally visible in tofucode web UI
```

## Task Management Rules

These rules govern how the bot handles ticket creation and implementation work triggered from Slack.

### Ticket Creation

- **Always link the Slack thread** in the Notion ticket (permalink to the conversation)
- **Always include a TLDR** — short summary of what is needed, derived from the message/thread
- **On new thread replies** — edit the existing ticket to include the new info in summarized form; do not create duplicate tickets
- Ticket body format: TLDR first, then Slack thread link, then any additional context

### Repository Identification

Primary repositories the bot may work in:

| Folder | Service context |
|---|---|
| `anime-service` | `anime` |
| `user-service` | `user` |
| `social-service` | `social` |
| `recommendation-service` | `recommendation` |
| `content-service` | `content` |
| `dashboard/admin-panel-revamp` | dashboard frontend |
| `dashboard/admin-service` | dashboard backend |
| `pg-migration-pipeline` | database migrations |

**To determine the correct repository:**

1. If a full API URL is provided (e.g. `https://staging.animeoshi.com/api/user/v1/...`), extract the `{context}` segment → maps to `{context}-service`
2. If a bare route is provided (e.g. `/profile/crests`), search for the route in each service's controller files
3. If a ticket or feature description is provided, infer from domain knowledge (CLAUDE.md context)

**Confidence rule:**
- Only start implementation work if **100% confident** in the target repository
- If ambiguous (e.g. could be `user-service` or `social-service`), do NOT start work — instead update the ticket with the question and any relevant findings, and wait for the user to clarify and initiate manually

### Implementation Work Flow

When the bot starts a work session from a Slack message:

1. **Update ticket to In Progress** before starting the session
2. **Keep the ticket updated** throughout — summarize implementation decisions and progress
3. **On PR creation** — link the PR URL in the ticket
4. Work sessions run via tofucode SDK; results are visible in the tofucode web UI naturally

## Session Visibility (Auto-pickup Work)

When the bot triggers a tofucode session:
- SDK `query()` writes to JSONL at `~/.claude/projects/<project-slug>/`
- Tofucode web UI already watches/lists these JSONL files
- Session appears **naturally** in the tofucode UI — no extra wiring needed
- User can monitor, intervene, or continue the session at any point

## Open Questions / TBD

- **Approval flow**: Always-approve (draft shown in tofucode UI or Slack DM) vs. auto-respond vs. hybrid per-channel?
  - Leaning toward: **Slack DM for approval** — bot DMs user with draft + approve/reject, stays in Slack, no context switching
  - Auto-respond opt-in per channel for low-stakes responses
- **Rate limiting / cooldown**: Prevent runaway responses if bot gets into a loop
- **Thread reply detection**: How to detect new replies to a thread that already has a ticket — need to match thread_ts to existing Notion ticket

## User Persona (Classifier Identity)

The classifier uses an identity and system prompt configured via the Slack settings UI
(`Settings → Slack → Identity` and `Classifier → System Prompt Override`).

The identity fields (name, role, tone) and optional system prompt override are stored in
`~/.tofucode/slack-config.json` and are fully user-configurable — no hardcoded persona
in the codebase.

The global `~/.claude/CLAUDE.md` is always injected alongside the configured identity,
providing org-specific context (API conventions, service map, infrastructure) without
baking it into tofucode itself.

## Status

- [x] Direct API call verified (curl → posts as user identity)
- [x] Architecture decided (baked into tofucode, `server/slack/`)
- [x] Socket Mode setup
- [x] Implementation complete (`server/slack/` — bot, config, api, classifier, executor, sessions, formatter, events)
- [x] Settings UI — Slack tab in SettingsModal (tokens, watched channels, identity, classifier, actions)
- [x] Notion integration moved to dedicated Notion tab (raw API, no MCP)
- [x] Backend WS events — `slack:get_config`, `slack:save_config`, `slack:test`, `slack:restart`
- [x] Two-pass classifier — Haiku first, Sonnet escalated on low confidence or needsContext
- [x] Slack thread permalink linked in Notion tickets
- [x] Thread reply → ticket update (`notion-tickets.json` mapping, edit instead of create)
- [x] Confidence gate — low-confidence work falls back to ticket + wait for clarification
- [x] Ticket set to In Progress before starting work session
- [x] PR link → ticket update (scans session output for GitHub PR URLs)
- [ ] Live testing (pending App Token `xapp-`)

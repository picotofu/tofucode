# FEATURE: Discord Bot Integration (BYOB)

## Requirements

- Add Discord as an alternative interface to Claude Code alongside the existing web UI
- Users bring their own Discord bot (BYOB) - they create and configure their bot
- Bot runs on user's VM alongside tofucode server process
- Channel-to-project mapping: each Discord channel maps to a tofucode project folder
- Thread-to-session mapping: each thread in a channel maps to a Claude Code session
- Streaming responses with edit-in-place (GitHub Copilot style)
- Slash commands for setup and management

## Context

**Current Architecture:**
- tofucode is a web UI for Claude Code using Express + WebSocket + Claude Agent SDK
- Sessions are stored as JSONL files in `~/.claude/projects/{projectSlug}/{sessionId}.jsonl`
- The web UI uses WebSocket event handlers in `server/events/` that call the SDK's `query()` function
- Task tracking via `server/lib/tasks.js` (session-keyed, not transport-specific)

**Discord Integration Approach:**
- Discord bot is a parallel consumer of the Claude Agent SDK
- Does NOT go through WebSocket layer - calls `query()` directly
- Discord code is fully isolated in `server/discord/` folder
- Reuses shared utilities: `config.js`, `tasks.js`, `sessions.js`, `session-titles.js`, `mcp.js`, `logger.js`
- Does NOT use: `ws.js` (WebSocket-specific), `auth.js` (Discord has own auth), `events/*` (Web UI event handlers)

**Why BYOB?**
- Full user control (their bot, their server, their API key)
- No trust or security concerns (all runs locally on user's VM)
- Natural isolation (each user's bot is separate)
- Simpler to implement securely than hosted service

## Scope

**In Scope (Phase 1 - MVP):**
- Discord bot startup/shutdown lifecycle integrated with tofucode server
- Channel-to-project mapping via `/setup` slash command
- Thread-to-session mapping (automatic on first message)
- Message handler for threads (executes prompts via SDK)
- Parent channel handler (redirects users to create threads)
- Basic message formatting (2000-char chunking, code-block awareness)
- Tool use display (compact one-liners)
- Result summaries (duration, cost)
- Task cancellation via `/cancel` command
- Session listing via `/session` command
- Session resume via `/resume` command (manual sync MVP - create Discord thread for existing session)
- CLI flag: `--discord` to enable bot
- Environment variables: `DISCORD_ENABLED`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
- Reusable sync utilities (`server/discord/lib/sync.js`) for thread/message creation (Phase 2-ready)

**Out of Scope (Phase 2 - Web UI → Adapter Sync):**
- Internal event bus (`server/lib/event-bus.js`) for transport-agnostic event publishing
  - `prompt.js` emits session/message events to the bus
  - Adapters (Discord, future Telegram, etc.) subscribe independently
  - Core code never imports adapter code — one-way dependency only
- Web UI session creation → auto-create Discord thread in mapped channel
- Web UI messages → mirror to corresponding Discord thread
- Adapter interface: standardized subscribe/publish contract for new adapters

**Out of Scope (Phase 3+):**
- Rich embeds for tool outputs
- Auto-thread creation from parent channel messages
- Discord permission role → tofucode mode mapping (admin → bypass, etc.)
- Interactive buttons (approve/reject in plan mode)
- Image/file attachments for tool results
- Voice channel integration
- Multi-guild support with per-guild configs
- Telegram bot adapter
- Slack bot adapter

## Plan

### Architecture

```
Discord User → Discord Message → messageCreate.js → executor.js → query() → Claude API
                                                          ↓
                                               Yields structured events
                                                          ↓
                                           formatter.js → Discord message
```

**Key Components:**

1. **`server/discord/bot.js`** - Client lifecycle (startup/shutdown)
2. **`server/discord/config.js`** - Discord config + channel/session mapping persistence
3. **`server/discord/lib/executor.js`** - Async generator wrapping SDK `query()` (the core adapter)
4. **`server/discord/lib/formatter.js`** - Transforms Claude responses to Discord messages
5. **`server/discord/lib/sessions.js`** - Thread ↔ session mapping layer
6. **`server/discord/events/messageCreate.js`** - Message routing (thread vs parent channel)
7. **`server/discord/events/interactionCreate.js`** - Slash command dispatcher
8. **`server/discord/events/ready.js`** - Bot ready, slash command registration
9. **`server/discord/commands/setup.js`** - `/setup` command for channel mapping
10. **`server/discord/commands/session.js`** - `/session` command to list sessions
11. **`server/discord/commands/cancel.js`** - `/cancel` command to abort running task
12. **`server/discord/commands/resume.js`** - `/resume` command to create thread from existing session (manual sync MVP)
13. **`server/discord/lib/sync.js`** - Reusable thread/message sync utilities (used by `/resume` and future Phase 2 event bus)

### Mapping Strategy

**Channel → Project:**
- User creates Discord channel manually (e.g., `#my-app`)
- User runs `/setup project:/absolute/path/to/project` in the channel
- Bot saves mapping to `~/.tofucode/discord-channels.json`:
  ```json
  {
    "channelId": {
      "projectPath": "/home/user/projects/my-app",
      "projectSlug": "-home-user-projects-my-app",
      "guildId": "123456789",
      "configuredBy": "userId",
      "configuredAt": "2026-02-16T10:30:00Z"
    }
  }
  ```

**Thread → Session:**
- User creates thread in mapped channel (or sends first message)
- Bot looks up parent channel → project mapping
- Bot looks up thread → session mapping (or creates new entry)
- Bot calls SDK `query()` with `resume: sessionId` (if existing) or `null` (new session)
- SDK returns `session_id` in init message, bot saves to `~/.tofucode/discord-sessions.json`:
  ```json
  {
    "threadId": {
      "sessionId": "uuid-from-sdk",
      "channelId": "parent-channel-id",
      "projectSlug": "-home-user-projects-my-app",
      "userId": "discord-user-id",
      "createdAt": "2026-02-16T10:30:00Z",
      "threadName": "Fix auth bug"
    }
  }
  ```

### Streaming Pattern

1. User sends message in thread
2. Bot replies with `:hourglass: Thinking...` placeholder message
3. Bot calls `executePrompt()` which yields events:
   - `session_init` → save/update thread-session mapping
   - `text` → accumulate text, edit placeholder every 1.5s (rate-limit safe)
   - `tool_use` → append formatted tool line (compact format)
   - `tool_result` → only show errors (non-errors are verbose)
   - `result` → final edit with summary (checkmark, duration, cost)
   - `error` → edit placeholder with error message
4. If response exceeds 2000 chars, chunk with code-block awareness
5. First chunk edits placeholder, remaining chunks sent as new messages

### Error Handling

- **Discord API errors**: Wrap all Discord calls with try-catch, log and continue gracefully
- **Concurrent prompts**: Per-thread lock to prevent double execution
- **Invalid paths**: `/setup` validates path exists and is within `ROOT_PATH` if set
- **Missing mappings**: Friendly error messages guide users to run `/setup`
- **Rate limits**: Discord.js auto-queues, but we manually rate-limit edits to 1 per 1.5s

### Integration Points

**Minimal changes to existing code (4 files):**

1. **`server/index.js`** (~10 lines):
   - In `onServerReady()`: conditionally import and start Discord bot
   - In `gracefulShutdown()`: conditionally stop Discord bot

2. **`bin/cli.js`** (~10 lines):
   - Add `--discord` flag parsing
   - Pass `DISCORD_ENABLED=true` to env
   - Update help text

3. **`.env.example`** (~10 lines):
   - Add Discord configuration section

4. **`CLAUDE.md`** (new section):
   - Discord Bot guidelines (isolation rules, allowed imports)

### File Structure

```
server/discord/
├── bot.js                      # Discord.js client lifecycle
├── config.js                   # Config + mapping persistence
├── events/
│   ├── ready.js                # Bot ready + command registration
│   ├── messageCreate.js        # Message routing
│   └── interactionCreate.js   # Slash command dispatcher
├── commands/
│   ├── setup.js                # /setup - channel-project mapping
│   ├── session.js              # /session - list sessions
│   └── cancel.js               # /cancel - abort task
└── lib/
    ├── executor.js             # SDK query() wrapper (async generator)
    ├── formatter.js            # Message formatting
    └── sessions.js             # Thread-session mapping
```

### Implementation Sequence

1. Install discord.js dependency
2. Create config layer (persistence to `~/.tofucode/`)
3. Create formatter (chunking, code-block awareness)
4. Create executor (core adapter, mirrors `events/prompt.js` logic)
5. Create sessions mapper (thread ↔ session)
6. Create message handler (thread vs parent channel routing)
7. Create slash commands (setup, session, cancel)
8. Create command dispatcher
9. Create ready handler (command registration)
10. Create bot lifecycle (startup/shutdown)
11. Integrate with server/index.js (conditional startup)
12. Add CLI flag (bin/cli.js)
13. Update .env.example
14. Update CLAUDE.md
15. Lint and test

### User Workflow

**Setup (one-time):**
1. User creates Discord bot at https://discord.com/developers/applications
2. User invites bot to their Discord server (OAuth URL with permissions)
3. User configures tofucode: `DISCORD_ENABLED=true DISCORD_BOT_TOKEN=xxx`
4. User starts tofucode: `npx tofucode --discord`

**Daily usage:**
1. User creates channel in Discord (e.g., `#backend`)
2. User runs `/setup project:/home/user/backend` in the channel
3. User creates thread: "Fix authentication bug"
4. User sends message in thread: "help me fix the login issue"
5. Bot responds with Claude Code output (streaming, edit-in-place)
6. User continues conversation in same thread (session persists)
7. User creates new thread for new topic = new session

**Example Server Structure:**
```
📁 My Projects Category
├─ #backend (→ /home/user/backend)
│  ├─ 🧵 Fix auth bug
│  ├─ 🧵 Add API endpoint
│  └─ 🧵 Refactor database
├─ #frontend (→ /home/user/frontend)
│  └─ 🧵 Update login UI
└─ #docs (→ /home/user/docs)
   └─ 🧵 Write API docs
```

## Testing

**Manual Testing Checklist:**

1. **Bot startup:**
   - `DISCORD_ENABLED=true DISCORD_BOT_TOKEN=xxx npm run dev`
   - Bot appears online in Discord
   - Slash commands register (check with `/`)

2. **Channel setup:**
   - Run `/setup project:/valid/path` in a channel
   - Verify `~/.tofucode/discord-channels.json` created
   - Bot confirms with project path and slug

3. **Thread creation and prompting:**
   - Create thread in mapped channel
   - Send message in thread
   - Verify `:hourglass: Thinking...` appears and gets edited
   - Verify response contains Claude output
   - Verify `~/.tofucode/discord-sessions.json` populated
   - Verify JSONL session file created in `~/.claude/projects/{slug}/`

4. **Parent channel behavior:**
   - Send message in parent channel (not thread)
   - Verify bot replies with "Please create a thread" message

5. **Session continuity:**
   - Send second message in same thread
   - Verify session resumes (check `resume` in logs)
   - Verify conversation history is maintained

6. **Task cancellation:**
   - Start long-running prompt
   - Run `/cancel` while running
   - Verify task aborts and status updates

7. **Long responses:**
   - Trigger response >2000 chars
   - Verify correct chunking without breaking code blocks

8. **Error handling:**
   - Test with invalid project path in `/setup`
   - Test sending message in unmapped channel
   - Test `/cancel` in thread with no running task
   - Verify friendly error messages

9. **Graceful shutdown:**
   - Stop server (Ctrl+C)
   - Verify Discord bot logs "Stopping Discord bot..."
   - Verify bot goes offline in Discord

## Status

**Phase 1 (MVP):** Implemented, testing in progress

**Next Steps:**
1. Complete manual testing with real Discord bot
2. Fix any issues found during testing
3. Phase 2: Event bus for Web UI → adapter sync (Discord, Telegram, etc.)

## Dependencies

- `discord.js` ^14.16.0 (requires Node >= 18, already satisfied)

## Related

- Original exploration: `docs/todo/DISCORD_BOT_INTEGRATION.md` (to be deleted after feature doc is created)
- Web UI prompt handler: `server/events/prompt.js` (pattern reference for executor.js)
- Session management: `server/lib/sessions.js`, `server/lib/session-titles.js` (reused)
- Task tracking: `server/lib/tasks.js` (reused)

# tofucode v1.4 Plan

## SDK Upgrade

Both packages have significant pending upgrades:

| Package | Current | Latest |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `0.2.45` | `0.2.104` |
| `@anthropic-ai/sdk` | `0.78.0` | `0.88.0` |

Upgrade both as part of 1.4 work. No breaking changes identified.

---

## Features

### 1. SDK Session Management (replace JSONL reader)

The SDK now exposes first-class session management functions that replace the current manual JSONL parsing in `server/lib/sessions.js`.

**SDK API:**
```typescript
import { listSessions, getSessionInfo, getSessionMessages, getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';

// List all sessions for a project dir
listSessions({ dir?: string }): Promise<SDKSessionInfo[]>

// Metadata for a single session (faster than full list)
getSessionInfo(sessionId, { dir? }): Promise<SDKSessionInfo | undefined>

// Full message history for a session
getSessionMessages(sessionId, {
  dir?,
  limit?,
  offset?,
  includeSystemMessages?: boolean  // default false
}): Promise<SessionMessage[]>

// Messages from a specific subagent within a session
getSubagentMessages(sessionId, agentId, { dir?, limit?, offset? }): Promise<SessionMessage[]>

type SDKSessionInfo = {
  sessionId: string
  summary: string          // custom title or auto-generated
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  // ...cwd, etc.
}

type SessionMessage = {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: null
}
```

**Scope:** Replace `server/lib/sessions.js` JSONL reader with SDK calls. Also use `getSessionInfo` in `server/lib/session-titles.js` for faster individual session lookups.

---

### 2. Session Forking

Fork/branch any existing session from a specific message. The fork creates a new resumable session, preserving history up to a given message UUID.

**SDK API:**
```typescript
import { forkSession } from '@anthropic-ai/claude-agent-sdk';

forkSession(sessionId, {
  upToMessageId?: string,  // fork from this point; omit = full copy
  title?: string           // custom title; default = original + " (fork)"
}): Promise<{ sessionId: string }>
```

**UI:** Add a fork button in the chat history view — each user message gets a branch icon on hover. Clicking it calls a new WS event `fork_session`, which uses `forkSession()` and then navigates to the new session.

---

### 3. Effort Level

Control Claude's reasoning depth per session. Maps to thinking budget under the hood.

**SDK API:**
```typescript
// In query() options:
effort?: 'low' | 'medium' | 'high' | 'max'

type EffortLevel = 'low' | 'medium' | 'high' | 'max'
// - low: minimal thinking
// - medium: moderate thinking
// - high: deep reasoning (current default)
// - max: maximum effort (select models only)
```

Model support info also exposed:
```typescript
type ModelInfo = {
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[]
  supportsAdaptiveThinking?: boolean
}
```

**UI:** Add effort selector in the model/settings toolbar (alongside the existing model picker). Only show when the selected model supports it. Persist per-project in settings.

---

### 4. Skills

Skills are slash commands (`/skill-name`) that can be pre-loaded into a session. The SDK exposes available skills via `Query.supportedCommands()`.

**SDK API:**
```typescript
// In query() options (per-session skill preloading):
// skills is on AgentDefinition — for agent-scoped preloading
skills?: string[]  // array of skill names to preload

// Via Query object at runtime:
query.supportedCommands(): Promise<SlashCommand[]>

type SlashCommand = {
  name: string         // skill name (without leading slash)
  description: string
  hint?: string        // arg hint e.g. "<file>"
}

// Skills live at:
// ~/.claude/skills/<skill-name>/   (user-scoped)
// .claude/skills/<skill-name>/     (project-scoped)
```

**UI:** Surface available skills in the chat UI — show a `/` command palette that appears when typing `/` in the prompt input. Fetch via `query.supportedCommands()` at session start and cache.

---

### 5. `/buddy`

An April Fools 2025 easter egg in Claude Code v2.1.89 — a tamagotchi-style coding companion that watches you code and reacts to test failures, errors, and git diffs.

**Status: removed.** The entire implementation was stripped from v2.1.101 (current). Running `/buddy` today returns `"Unknown skill: buddy"`.

**What it was:**
- Command type `local-jsx` — renders a React/Ink JSX component directly inside the CLI's terminal UI layer, not through the SDK message stream
- 18 species (duck, cat, dragon, axolotl, capybara, chonk, etc.) with ASCII art, rarity tiers (common → legendary), 5 stats, 1% shiny chance
- Creature appearance seeded from `accountUuid + "friend-2026-401"` — deterministic per user, recomputed each run
- Name + personality generated via Claude API call (`querySource: "buddy_companion"`); persisted in `~/.claude/settings.json`
- Live reactions via `POST /api/organizations/{orgUuid}/claude_code/buddy_react` — cloud-side API, fires on errors/test-fails/large diffs/pet command; requires firstParty OAuth (Claude.ai subscription)

**Why it wouldn't work in tofucode regardless:**
- `local-jsx` commands set `shouldQuery: false` and dispatch to a JSX factory inside the CLI binary's Ink renderer — no messages flow through the SDK streaming interface
- The companion widget is a terminal footer element; tofucode's WebSocket bridge never sees it
- `buddy_react` endpoint requires firstParty OAuth, not API key auth

**Verdict:** Not viable for tofucode. Drop from 1.4 scope.

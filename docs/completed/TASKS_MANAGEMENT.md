# Tasks Management Feature

## What We Have: Notion Integration

### Overview

The Notion integration is built as a **TaskProvider** adapter pattern — an extensible interface
designed to support future providers (Jira, Linear, GitHub Issues, etc.) without touching the
calling code.

---

### Architecture

```
server/lib/task-providers/
├── notion.js          # Notion REST API client (no npm deps, uses built-in fetch())
├── notion-config.js   # Config management (~/.tofucode/notion-config.json)
├── types.js           # JSDoc type definitions for the TaskProvider interface
└── index.js           # Provider registry (getTaskProvider, resolveActiveProvider)

server/events/notion.js          # WebSocket handlers for Settings UI
src/components/SettingsModal.vue # Notion tab in Settings
```

---

### TaskProvider Interface (`server/lib/task-providers/types.js`)

```js
TaskProvider {
  name: string                              // "notion"
  testConnection()  → ConnectionTestResult  // Test API key validity
  analyseDatabase(url)  → AnalyseResult     // Fetch DB schema → FieldDefinition[]
  createTicket(params)  → TicketResult      // Create page; returns { url, pageId }
  updateTicket(params)  → TicketResult      // Append text and/or update properties
  buildStatusProperty(field, value)  → Object  // Build provider-specific status object
}
```

Params:
- `CreateTicketParams`: `{ title, body, databaseUrl, fieldMappings? }`
- `UpdateTicketParams`: `{ pageId, appendText?, properties? }`

---

### Config Schema (`~/.tofucode/notion-config.json`)

```json
{
  "enabled": true,
  "token": "secret_xxx",
  "ticketDatabaseUrl": "https://www.notion.so/...",
  "fieldMappings": [
    { "field": "Status", "type": "status", "purpose": "Set to In Progress" }
  ]
}
```

- Token is resolved from config or `NOTION_TOKEN` env var fallback
- Frontend never sees the full token — only masked (`****last4`)

---

### WebSocket Events (Settings UI)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `notion:get_config` | client → server | Fetch masked config |
| `notion:save_config` | client → server | Persist config updates |
| `notion:test` | client → server | Test API connectivity |
| `notion:analyse` | client → server | Detect database schema → field suggestions |

---

### Notion API Client (`server/lib/task-providers/notion.js`)

Key capabilities:
- `createPage(dbId, properties, children)` — Create ticket with properties + body blocks
- `updatePage(pageId, properties)` — Patch properties (e.g. status)
- `appendBlockChildren(pageId, children)` — Append text to existing page
- `analyseProperties(schema)` — Maps database schema → `FieldDefinition[]`, skips auto-managed fields
- `buildRichText(text)` — Converts plain text with URLs to Notion rich_text with link objects
- `buildBodyChildren(text)` — Splits long body text into paragraph blocks (2000-char limit)

---

## Feature Ideas / Potential Next Steps

> To be discussed and planned — not yet scoped

- **Web UI: Task creation panel** — create Notion tickets directly from tofucode
- **Session → ticket linking** — auto-associate a running session with a Notion ticket
- **Ticket status sidebar** — show linked ticket status/context alongside active session
- **Notion database view** — browse tickets in the Notion DB from within tofucode UI
- **Multiple providers** — flesh out the provider registry to support Jira, Linear, etc.
- **PR → ticket update from web** — trigger ticket update when user creates a PR via the web UI

---

## Status: Completed

- [x] TaskProvider interface defined (`types.js`)
- [x] Notion API client implemented (`notion.js`)
- [x] Config management (`notion-config.js`)
- [x] Provider registry (`index.js`) — extensible for future providers
- [x] WebSocket handlers for Settings UI (`server/events/notion.js`)
- [x] Settings UI — Notion tab with token, database URL, field mappings, test + analyse
- [x] Tasks sidebar tab — list, filter (assignee + status + search), create, task detail view (TaskView)
- [x] AssigneeDropdown shared component — teleported popover, fuzzy search, used in filter/create/TaskView
- [x] Workspace users merged with DB assignees; email field for self-identification
- [x] Task grouping — by assignee, by status, or both (assignee outer → status inner)
- [x] Group ordering — status by Notion group categories (To-do → In Progress → Done); assignee me-first → alpha → Unassigned last
- [x] Status group headers as coloured pills in all grouping modes

# Session Titles Implementation

## Overview

Custom session titles (session renaming) are stored in a separate `.session-titles.json` file per project, rather than using Claude Code's native `customTitle` field in `sessions-index.json`.

## Why Not Use Native `customTitle`?

Claude Code CLI supports session renaming via the `/rename` command, which sets the `customTitle` field in `sessions-index.json`. However, the **Claude Agent SDK does not preserve this field** when updating session entries.

### The Problem

1. The SDK updates `sessions-index.json` after each conversation turn
2. Updates include: `messageCount`, `modified` timestamp, `fileMtime`, etc.
3. When updating an entry, the SDK **overwrites the entire entry object**
4. Any custom fields (like `customTitle`) are lost

### Example

```json
// Before conversation turn
{
  "sessionId": "abc-123",
  "messageCount": 10,
  "customTitle": "My Custom Title",  // ← Set by us
  "modified": "2026-02-07T10:00:00Z"
}

// After conversation turn (SDK update)
{
  "sessionId": "abc-123",
  "messageCount": 11,                // ← SDK updated
  "modified": "2026-02-07T10:05:00Z", // ← SDK updated
  // customTitle is gone! ← SDK doesn't preserve it
}
```

## Our Solution: `.session-titles.json`

We store custom titles in a separate file that the SDK never touches:

```
~/.claude/projects/{project-slug}/
├── sessions-index.json          ← SDK manages this
├── .session-titles.json         ← We manage this (SDK-safe)
├── abc-123.jsonl
└── def-456.jsonl
```

### File Format

```json
{
  "abc-123": "My Custom Title",
  "def-456": "Another Session Title"
}
```

Simple key-value map: `sessionId` → `title`

## Implementation

### Storage (`server/lib/session-titles.js`)

- `loadTitles(projectSlug)` - Load all titles for a project
- `getTitle(projectSlug, sessionId)` - Get single title
- `setTitle(projectSlug, sessionId, title)` - Set/update title
- `deleteTitle(projectSlug, sessionId)` - Remove title

### API Events

- `set_session_title` - Client sets/updates a session title
- `get_session_title` - Client retrieves a session title
- `session_title` - Response with title data
- `session_title_updated` - Broadcast when title changes

### Integration Points

All session list endpoints load titles from `.session-titles.json`:

1. **`get-sessions.js`** → `getSessionsList()` → loads titles via `loadTitles()`
2. **`get-recent-sessions.js`** → loads titles via `loadTitles()`
3. **`get-session-title.js`** → loads title via `getTitle()`

All three read from the same source, ensuring consistency.

## Future Considerations

If the Claude Agent SDK is updated to preserve `customTitle` during session updates, we could:

1. Migrate existing titles from `.session-titles.json` to `sessions-index.json`
2. Update code to read from native `customTitle` field
3. Remove `.session-titles.json` storage

Until then, the separate file approach is the only reliable solution.

## Testing the Issue

To verify the SDK still doesn't preserve `customTitle`:

1. Manually add `customTitle` to a session entry in `sessions-index.json`
2. Send a message in that session
3. Check if `customTitle` is still present after SDK updates the entry

If it's gone, the SDK still has this limitation.

## Related Files

- `server/lib/session-titles.js` - Title storage implementation
- `server/events/get-session-title.js` - Get title event handler
- `server/events/set-session-title.js` - Set title event handler
- `server/lib/sessions.js` - `getSessionsList()` integration
- `server/events/get-recent-sessions.js` - Recent sessions integration

## SDK Version History

- **v0.2.17** (Feb 2026) - Confirmed: SDK overwrites `customTitle`
- **v0.2.37** (Feb 2026) - Confirmed: SDK still overwrites `customTitle`

Tested by manually setting `customTitle` in sessions-index.json and observing it disappear after a conversation turn.

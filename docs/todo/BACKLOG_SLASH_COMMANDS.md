# BACKLOG: Slash Commands

**Status**: Backlogged - Limited value in web UI context

**Rationale**: Most slash command functionality is better served by dedicated UI elements (buttons, dropdowns, modals) in a web interface. CLI slash commands solve a different problem (quick access without leaving text input) that doesn't apply as strongly in a graphical UI.

## Overview

Native Claude Code CLI has 53+ built-in slash commands that provide quick access to various features without interrupting the conversation flow. This document evaluates which commands could potentially be implemented in tofucode if needed in the future.

## Available Commands in Native CLI

### Conversation Management (8 commands)
- `/clear` - Clear conversation history
- `/compact` - Clear history but keep summary
- `/exit` - Exit the REPL
- `/fork [name]` - Fork conversation
- `/rename <name>` - Rename conversation
- `/resume` - Resume a conversation
- `/tag <tag-name>` - Toggle searchable tag
- `/btw <question>` - Quick side question

### Context & Files (4 commands)
- `/add-dir <path>` - Add working directory
- `/context` - Show context usage
- `/files` - List files in context
- `/memory` - Edit Claude memory files

### Session Information (6 commands)
- `/cost` - Show session cost and duration
- `/session` - Show remote session URL/QR
- `/status` - Show Claude Code status
- `/usage` - Show plan usage limits
- `/stats` - Show usage statistics
- `/tasks` - List background tasks

### Configuration (15 commands)
- `/agents` - Manage agent configurations
- `/color <color>` - Set prompt bar color
- `/config` - Open config panel
- `/hooks` - Manage hooks
- `/keybindings` - Edit keybindings
- `/mcp` - Manage MCP servers
- `/model [model]` - Set AI model
- `/output-style` - Set output style
- `/permissions` - Manage tool permissions
- `/plugin` - Manage plugins
- `/privacy-settings` - View/update privacy
- `/theme` - Change theme
- `/vim` - Toggle Vim mode
- `/extra-usage` - Configure extra usage
- `/rate-limit-options` - Rate limit options

### Development & Code Review (7 commands)
- `/doctor` - Diagnose installation
- `/init` - Initialize CLAUDE.md
- `/plan [open]` - Enable plan mode
- `/pr-comments` - Get PR comments
- `/review` - Review PR
- `/security-review` - Security review
- `/todos` - List todo items

### Integrations (4 commands)
- `/ide [open]` - Manage IDE integrations
- `/install-github-app` - Setup GitHub Actions
- `/install-slack-app` - Install Slack app
- `/remote-env` - Configure remote environment

### Help & Discovery (4 commands)
- `/discover` - Explore features
- `/export [filename]` - Export conversation
- `/help` - Show help
- `/skills` - List available skills

### Account & Subscription (3 commands)
- `/feedback [report]` - Submit feedback
- `/logout` - Sign out
- `/upgrade` - Upgrade to Max

### Special Features (2 commands)
- `/mobile` - QR code for mobile app
- `/stickers` - Order stickers

---

## Implementation Recommendation

### Priority 1: Essential Commands (Implement First)

#### Conversation Management
- **`/clear`** - Clear messages and start fresh
  - Implementation: WebSocket event to clear client messages array
  - UI: Show confirmation dialog before clearing

- **`/rename <name>`** - Rename session
  - Implementation: Already implemented via session title feature
  - UI: Could add slash command as alternative to title edit button

- **`/fork [name]`** - Fork conversation at current point
  - Implementation: WebSocket event to create new session with history up to this point
  - UI: Show success message with link to forked session

- **`/compact`** - Compact with summary
  - Implementation: WebSocket event that triggers compaction on server
  - UI: Show "Compacting..." indicator, then success message

#### Context & Session Info
- **`/context`** - Show context usage
  - Implementation: WebSocket event to get token counts
  - UI: Display in modal or info panel

- **`/files`** - List files in context
  - Implementation: WebSocket event to get file list from server
  - UI: Display in modal with file tree

- **`/cost`** - Show session cost
  - Implementation: Track token usage and calculate cost
  - UI: Display in modal or sidebar

- **`/tasks`** - List background tasks
  - Implementation: Query processManager for running tasks
  - UI: Display in modal with task status

#### Development
- **`/plan`** - Enter plan mode
  - Implementation: Set permission mode to 'plan'
  - UI: Already implemented via permission mode dropdown

- **`/todos`** - Show todo list
  - Implementation: Parse TodoWrite tool outputs from messages
  - UI: Display in modal or sidebar panel

### Priority 2: Useful Commands (Implement Later)

- **`/status`** - Show system status
- **`/model [model]`** - Switch AI model
- **`/permissions`** - Manage permissions
- **`/export`** - Export conversation
- **`/help`** - Show available commands

### Skip: Not Applicable for Web UI

#### Configuration (Better via Web UI)
- `/config` - Use Settings page instead
- `/theme` - Use Theme selector instead
- `/color` - Use Permission mode colors instead
- `/keybindings` - Browser keyboard shortcuts
- `/vim` - Not applicable in web textarea
- `/output-style` - Single style in web UI
- `/privacy-settings` - Could be Settings page
- `/agents` - Could be Settings page
- `/hooks` - Advanced feature, skip for now

#### MCP Management
- `/mcp` - Planned separate feature for MCP UI management

#### Integrations & Account
- `/ide` - Not applicable (web-only)
- `/install-github-app` - External to web UI
- `/install-slack-app` - External to web UI
- `/remote-env` - Not applicable (runs on local server)
- `/mobile` - External to web UI
- `/logout` - Use Logout button instead
- `/upgrade` - External to web UI
- `/feedback` - Could link to feedback form
- `/stickers` - Marketing feature

#### Session Management (Redundant)
- `/exit` - Just close the browser tab
- `/resume` - Use session picker instead
- `/session` - Not applicable (already in browser)

#### Miscellaneous
- `/btw` - Could be implemented but low priority
- `/add-dir` - Project selection handles this
- `/memory` - Advanced feature, skip for now
- `/discover` - Not applicable (different UX)
- `/doctor` - Server-side diagnostic, skip
- `/init` - File creation better via Write tool
- `/pr-comments` - Use `gh` CLI integration instead
- `/review` - Use `gh` CLI integration instead
- `/security-review` - Advanced workflow
- `/usage` - Account feature, skip
- `/stats` - Account feature, skip
- `/extra-usage` - Billing feature, skip
- `/rate-limit-options` - Billing feature, skip
- `/tag` - Session organization, skip for now
- `/plugin` - Plugin system not planned
- `/skills` - Plugin system not planned

---

## Implementation Approach

### 1. Command Parser
```javascript
// src/utils/slashCommands.js
export function parseSlashCommand(input) {
  if (!input.startsWith('/')) return null;

  const match = input.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!match) return null;

  const [, command, args] = match;
  return { command, args: args?.trim() || '' };
}

export const SLASH_COMMANDS = {
  clear: {
    description: 'Clear conversation history',
    handler: 'handleClear',
    requiresConfirmation: true
  },
  rename: {
    description: 'Rename the current session',
    handler: 'handleRename',
    args: '<name>'
  },
  fork: {
    description: 'Fork conversation at current point',
    handler: 'handleFork',
    args: '[name]'
  },
  // ... more commands
};
```

### 2. WebSocket Events
```javascript
// server/events/slash-command.js
export function handler(ws, message, context) {
  const { command, args } = message;

  switch (command) {
    case 'clear':
      // Clear session messages
      send(ws, { type: 'messages_cleared' });
      break;

    case 'fork':
      // Create new session with history
      const newSessionId = await forkSession(context, args);
      send(ws, { type: 'session_forked', sessionId: newSessionId });
      break;

    // ... handle other commands
  }
}
```

### 3. UI Integration

**Option A: Autocomplete Dropdown**
- Show `/` commands in autocomplete as user types
- Arrow keys to navigate, Enter to select
- Similar to Discord, Slack command UX

**Option B: Command Palette**
- Keyboard shortcut (Cmd/Ctrl+K) opens command palette
- Fuzzy search through available commands
- Similar to VS Code command palette

**Option C: Simple Submit Handler**
- Detect `/` commands on submit
- Show confirmation modal if needed
- Execute command via WebSocket

**Recommendation**: Start with **Option C** (simple), then add **Option A** (autocomplete) for better UX.

### 4. Help System
```javascript
// Show available commands
function showHelp() {
  const commands = Object.entries(SLASH_COMMANDS)
    .map(([cmd, info]) => `/${cmd} ${info.args || ''} - ${info.description}`)
    .join('\n');

  return {
    type: 'info',
    title: 'Available Commands',
    content: commands
  };
}
```

---

## UI/UX Considerations

### Command Discovery
- Add `/help` command to list all commands
- Show command hints in placeholder: "Type a message or /help for commands"
- Add "Commands" section in Help modal

### Confirmation Dialogs
- Commands like `/clear` should show confirmation
- Commands like `/exit` can execute immediately
- Allow "Don't ask again" checkbox for destructive actions

### Visual Feedback
- Show command execution in chat (e.g., "Session renamed to 'Bug Fix'")
- Use system message style (gray, italic)
- Show loading states for async commands

### Error Handling
- Invalid commands: "Unknown command. Type /help to see available commands"
- Missing arguments: "Usage: /rename <name>"
- Server errors: Show error message in chat

---

## Implementation Phases

### Phase 1: Core Infrastructure
1. Command parser utility
2. WebSocket slash-command event
3. Basic command handlers (clear, rename, fork)
4. Simple submit-time detection

### Phase 2: Essential Commands
1. `/context` - Show token usage
2. `/files` - List files in context
3. `/cost` - Show session cost
4. `/tasks` - List background tasks
5. `/compact` - Compact with summary

### Phase 3: UX Improvements
1. Autocomplete dropdown for commands
2. Help modal with command list
3. Confirmation dialogs
4. Better visual feedback

### Phase 4: Advanced Commands
1. `/todos` - Show todo items
2. `/status` - System status
3. `/model` - Switch model
4. `/export` - Export conversation

---

## Technical Notes

### Command Execution Flow
```
User types /command args
  ↓
Submit handler detects /
  ↓
parseSlashCommand() extracts command + args
  ↓
Validate command exists
  ↓
Show confirmation if needed
  ↓
Send WebSocket message { type: 'slash_command', command, args }
  ↓
Server handles command
  ↓
Server sends response
  ↓
UI updates (show message, redirect, etc.)
```

### State Management
- Commands don't need to be stored in messages array
- Show execution result as system message
- Some commands (rename, fork) update session state

### Server-Side Handling
- Most commands can be handled in single event handler
- Some commands may need to call existing functions (forkSession, etc.)
- Keep command logic simple - complex features should have dedicated events

---

## Open Questions

1. **Should slash commands be stored in message history?**
   - **Recommendation**: No, only store execution results (e.g., "Session renamed")
   - Keeps history clean and focused on actual conversation

2. **Should we support command aliases?**
   - **Recommendation**: Maybe later (e.g., `/c` for `/clear`, `/r` for `/rename`)
   - Adds complexity but improves UX for power users

3. **Should commands work in all modes (chat, edit, terminal)?**
   - **Recommendation**: Yes, but some commands only make sense in chat mode
   - Show "Command not available in this mode" error if needed

4. **Should we add custom commands?**
   - **Recommendation**: Not initially, but could allow user-defined commands in settings
   - Advanced feature for power users

---

## Success Criteria

- [ ] Users can discover available commands via `/help`
- [ ] Essential commands work reliably (clear, rename, fork, context, files)
- [ ] Command execution provides clear feedback
- [ ] Invalid commands show helpful error messages
- [ ] Commands feel natural and don't interrupt workflow
- [ ] Documentation explains all available commands

---

## Future Enhancements

1. **Command History**: Arrow up to see previously used commands
2. **Command Chaining**: `/clear && /fork new-branch`
3. **Command Templates**: `/rename [project]-[date]` with variable substitution
4. **Keyboard Shortcuts**: Map common commands to keyboard shortcuts
5. **Command Macros**: Record sequences of commands for replay

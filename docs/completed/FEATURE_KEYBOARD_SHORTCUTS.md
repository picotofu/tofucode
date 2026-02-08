# FEATURE_KEYBOARD_SHORTCUTS

## Requirements

- Implement minimal, focused keyboard shortcuts for mode switching and essential terminal operations
- Support both Windows/Linux (Ctrl) and macOS (Cmd) modifiers
- Follow standard terminal input behavior for terminal mode
- Auto-focus input when switching modes for seamless workflow

## Context

**Current State:**
- Existing shortcuts:
  - `Ctrl/Cmd+Enter` - Submit chat message (TinyMDE editor)
  - `Ctrl/Cmd+L` - Scroll to bottom / Clear terminal output
  - `Ctrl/Cmd+K` - Open command palette / session selector ✅ (already implemented)
  - `Escape` - Blur input field

**User Experience Goals:**
- Quick mode switching without mouse (Ctrl+1/2/3)
- Auto-focus input when switching modes for immediate typing
- Standard terminal shortcuts when in terminal mode (Ctrl+C, Ctrl+U, etc.)
- Minimal, focused shortcut set - avoid overwhelming users with too many keybindings

## Scope

### Global Shortcuts (All Modes)

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl/Cmd+K` | Open session selector | ✅ Already implemented |
| `Ctrl/Cmd+1` | Switch to Chat mode | Auto-focus chat input |
| `Ctrl/Cmd+2` | Switch to Terminal mode | Auto-focus terminal input |
| `Ctrl/Cmd+3` | Switch to Files mode | Auto-focus search input |
| `Ctrl/Cmd+↑` | Navigate to previous turn | Chat mode only |
| `Ctrl/Cmd+↓` | Navigate to next turn | Chat mode only |
| `Escape` | Close modals / Blur input | Extend existing behavior |

### Terminal Mode Input Shortcuts

When terminal input is focused, follow standard terminal/shell shortcuts:

| Shortcut | Action | Standard Behavior |
|----------|--------|-------------------|
| `Ctrl+C` | Clear current input | Cancel/clear line (don't send SIGINT) |
| `Ctrl+U` | Clear from cursor to start | Delete text before cursor |
| `Ctrl+K` | Clear from cursor to end | Delete text after cursor |
| `Ctrl+A` | Move cursor to start | Jump to beginning of line |
| `Ctrl+E` | Move cursor to end | Jump to end of line |

**Note:** Terminal history navigation (↑/↓) already exists

## Implementation Plan

### 1. Extend Global Keyboard Handler in ChatView

**File:** `src/views/ChatView.vue`

Extend existing `handleKeydown()` function:

```javascript
function handleKeydown(e) {
  // Escape: Close modals / Blur input
  if (e.key === 'Escape') {
    // Close any open modals first
    if (fileModals.value.createFile || fileModals.value.createFolder ||
        fileModals.value.rename || fileModals.value.delete) {
      // Modal close logic
      return;
    }
    // Blur active input
    document.activeElement?.blur();
    return;
  }

  // Mode switching: Ctrl/Cmd+1/2/3
  if (e.ctrlKey || e.metaKey) {
    if (e.key === '1') {
      e.preventDefault();
      currentMode.value = 'chat';
      nextTick(() => {
        const editable = editorEl.value?.querySelector('[contenteditable]');
        editable?.focus();
      });
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      currentMode.value = 'terminal';
      nextTick(() => terminalInputRef.value?.focus());
      return;
    }
    if (e.key === '3') {
      e.preventDefault();
      currentMode.value = 'files';
      nextTick(() => {
        // Focus search input in files mode
        const searchInput = document.querySelector('.files-filter-input');
        searchInput?.focus();
      });
      return;
    }
  }

  // Existing shortcuts (Ctrl+L for scroll to bottom)
  // ...
}
```

### 2. Implement Terminal Input Shortcuts

**File:** `src/views/ChatView.vue`

Add new handler for terminal input field:

```javascript
function handleTerminalKeydown(e) {
  // Only apply these shortcuts when terminal input is focused
  if (e.target !== terminalInputRef.value) return;

  const input = terminalInputRef.value;
  const cursorPos = input.selectionStart;
  const value = input.value;

  if (e.ctrlKey) {
    switch (e.key) {
      case 'c': {
        // Clear current input
        e.preventDefault();
        terminalInput.value = '';
        break;
      }
      case 'u': {
        // Clear from cursor to start
        e.preventDefault();
        terminalInput.value = value.substring(cursorPos);
        nextTick(() => {
          input.selectionStart = 0;
          input.selectionEnd = 0;
        });
        break;
      }
      case 'k': {
        // Clear from cursor to end
        e.preventDefault();
        terminalInput.value = value.substring(0, cursorPos);
        break;
      }
      case 'a': {
        // Move cursor to start
        e.preventDefault();
        input.selectionStart = 0;
        input.selectionEnd = 0;
        break;
      }
      case 'e': {
        // Move cursor to end
        e.preventDefault();
        input.selectionStart = value.length;
        input.selectionEnd = value.length;
        break;
      }
    }
  }
}
```

Attach to terminal input:

```vue
<input
  ref="terminalInputRef"
  v-model="terminalInput"
  type="text"
  class="terminal-input"
  @keydown="handleTerminalKeydown"
  @keydown.up="navigateTerminalHistory(-1)"
  @keydown.down="navigateTerminalHistory(1)"
/>
```

### 3. Testing Plan

**Manual Testing:**
- Test mode switching (Ctrl+1/2/3) from each mode
- Verify input auto-focus after mode switch
- Test terminal shortcuts (Ctrl+C/U/K/A/E) with various cursor positions
- Test Escape key in different contexts (modals, inputs)
- Test on both macOS (Cmd) and Windows/Linux (Ctrl)

**Edge Cases:**
- Mode switching while modal is open (should close modal first)
- Terminal shortcuts when not focused on terminal input (should not trigger)
- Ctrl+K in terminal mode (should clear to end, not open session selector)

## Issues

### Potential Conflicts

1. **Ctrl+K Conflict in Terminal Mode:**
   - Global `Ctrl+K` opens session selector (App.vue)
   - Terminal `Ctrl+K` should clear to end of line
   - **Solution:** Terminal input handler should call `e.stopPropagation()` to prevent event bubbling
   - Check if terminal input is focused before allowing global handler

2. **Browser Default Shortcuts:**
   - `Ctrl+1/2/3` may switch browser tabs in some browsers
   - **Solution:** Always call `e.preventDefault()` on these shortcuts

3. **Modal State Management:**
   - Mode switching shortcuts should not trigger when modals are open
   - **Solution:** Check modal state first in handler, prioritize closing modals

4. **Input Focus Edge Cases:**
   - Auto-focus after mode switch may conflict with existing focus logic
   - **Solution:** Use `nextTick()` to ensure DOM updates complete before focusing

### Technical Considerations

1. **Cross-platform Modifier Keys:**
   - Check both `e.ctrlKey` (Windows/Linux) and `e.metaKey` (macOS)
   - Pattern: `if (e.ctrlKey || e.metaKey) { ... }`

2. **Terminal Input Event Priority:**
   - Terminal shortcuts should only apply when terminal input is focused
   - Use dedicated `handleTerminalKeydown` attached to input element
   - Global shortcuts remain active via document listener

3. **Escape Key Priority:**
   - Close modals first (highest priority)
   - Blur input second (fallback)
   - Check modal state before blurring

## Summary

### Final Keyboard Shortcuts

**Global (All Modes):**
- `Ctrl/Cmd+K` - Open session selector ✅ (already implemented)
- `Ctrl/Cmd+1` - Switch to Chat mode + auto-focus
- `Ctrl/Cmd+2` - Switch to Terminal mode + auto-focus
- `Ctrl/Cmd+3` - Switch to Files mode + auto-focus
- `Ctrl/Cmd+↑` - Navigate to previous conversation turn (chat mode)
- `Ctrl/Cmd+↓` - Navigate to next conversation turn (chat mode)
- `Escape` - Close modals / Blur input

**Terminal Mode (Input Focused):**
- `Ctrl+C` - Clear current input line
- `Ctrl+U` - Clear from cursor to start of line
- `Ctrl+K` - Clear from cursor to end of line
- `Ctrl+A` - Move cursor to start of line
- `Ctrl+E` - Move cursor to end of line
- `↑` / `↓` - Navigate command history ✅ (already exists)

**Existing Shortcuts (Keep):**
- `Ctrl/Cmd+Enter` - Submit chat message ✅
- `Ctrl/Cmd+L` - Scroll to bottom (chat) / Clear terminal output ✅

## Notes

- Minimal, focused approach - only essential shortcuts
- Follow standard terminal conventions for terminal mode
- Auto-focus input after mode switching for seamless workflow
- Terminal shortcuts isolated to terminal input (won't conflict with global shortcuts)
- Cross-platform support (Ctrl on Windows/Linux, Cmd on macOS)

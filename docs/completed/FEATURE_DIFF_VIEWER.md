# Feature: Diff Viewer

**Status:** ✅ Completed
**Date:** 2026-02-06

## Overview

Implemented diff viewing capabilities in two areas:
1. **Edit Tool Diff**: Collapsible inline diff viewer for Edit operations in chat history
2. **Git Diff Modal**: Full-screen modal showing all git changes with file navigation

## Implementation Details

### Files Created

| File | Purpose |
|------|---------|
| `src/components/DiffViewer.vue` | Reusable line-by-line diff display component |
| `src/components/GitDiffModal.vue` | Full-screen modal for viewing git changes |
| `server/events/get-git-diff.js` | Server-side handler for fetching git diff data |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/MessageItem.vue` | Added diff expansion for Edit tool operations |
| `src/views/ChatView.vue` | Added git diff modal integration, close on session change |
| `src/composables/useWebSocket.js` | Added `sendAndWait()` for async request/response |
| `server/events/index.js` | Registered `get_git_diff` handler |
| `package.json` | Added `diff` npm package |

### Dependencies

- **`diff` npm package**: Used for accurate line-by-line comparison in DiffViewer

## Features

### 1. Edit Tool Diff in Chat History

- Collapsible "Show diff" toggle below Edit tool operations
- Line-by-line diff with:
  - Green background for added lines (+)
  - Red background for removed lines (-)
  - Dual line numbers (old/new)
  - File stats (additions/deletions count)
- Uses npm `diff` package's `diffLines()` algorithm

### 2. Git Diff Modal

- Click git branch indicator in toolbar to open (when changes exist)
- Left sidebar: File list with status badges (A/M/D/R/?)
- Right panel: Unified diff view for selected file
- Features:
  - Auto-selects first file on open
  - File stats (additions/deletions per file)
  - Proper diff syntax highlighting
  - Handles untracked files (shows entire content as added)
  - Handles renamed files (extracts new path)
  - Closes automatically on session change

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Untracked files (?) | Reads file content, formats as unified diff with all lines added |
| Renamed files (R) | Extracts new path from "old -> new" format |
| Deleted files (D) | Git diff HEAD shows removed content |
| Binary files | Shows "Binary file or unable to read" message |
| Empty files | Shows single unchanged empty line |
| Session change while modal open | Modal auto-closes to prevent stale data |
| WebSocket disconnected | Error message displayed |
| Request timeout | 30-second timeout with error message |

## Technical Details

### User Experience

**Edit Tool Diff:**
- When Claude performs an Edit operation, the tool display shows the file path and a preview
- Click "Show diff" to expand a collapsible diff viewer
- Diff shows line-by-line changes with dual line numbers (old/new)
- Unchanged lines shown for context
- Smooth expand/collapse animation

**Git Diff Modal:**
- When git changes are present, the toolbar shows the branch name with file changes count (e.g., `+2 -1`)
- Click the branch indicator to open the Git Diff Modal
- Modal displays:
  - Left sidebar: List of all changed files with status badges (A/M/D/R/?)
  - Right panel: Unified diff view for selected file
  - File stats showing additions/deletions per file
  - Responsive layout with scrollable panels

### Implementation Notes

**Edit Tool Diff:**
- Uses npm `diff` package's `diffLines()` for accurate line-by-line comparison
- DiffViewer component renders structured diff data with proper syntax styling
- Monospace font for code readability

**Git Diff Modal:**
- Server-side handler runs `git status --porcelain` and `git diff HEAD` to fetch changes
- WebSocket message `get_git_diff` requests diff data, receives `git_diff` response
- Modal automatically selects first file on open
- Parses unified diff format for proper display with:
  - Header lines (blue background)
  - Hunk headers (@@ markers)
  - Added lines (green)
  - Removed lines (red)
  - Context lines

### Code Quality

- All code passes Biome checks (linting + formatting)
- Import statements properly ordered
- No console warnings or errors
- Follows existing codebase patterns and conventions

## Testing

### Testing Checklist

- [x] Edit tool diff shows correctly for small/large changes
- [x] Edit tool diff toggle expands/collapses properly
- [x] Git diff modal opens when clicking branch indicator
- [x] Git diff modal shows all changed files with correct status
- [x] File selection updates diff panel
- [x] Modal closes on click outside or X button
- [x] Modal closes on session change
- [x] Untracked files show content as added
- [x] Error handling for non-git directories

### Recommended Tests

1. **Edit Tool Diff:**
   - Test with small edits (single line changes)
   - Test with large edits (multiple line changes)
   - Test with special characters and code syntax
   - Verify expand/collapse functionality

2. **Git Diff Modal:**
   - Test with added files
   - Test with modified files
   - Test with deleted files
   - Test with many changed files (>10)
   - Test with large diffs (>100 lines)
   - Test in non-git directories (should handle gracefully)
   - Test clicking outside modal to close
   - Test file selection and navigation

3. **Edge Cases:**
   - Very long file paths
   - Binary files (git will show "Binary files differ")
   - Empty files
   - Files with only whitespace changes

## Future Enhancements

Potential improvements for later:
- Side-by-side diff view toggle
- Copy diff to clipboard button
- Syntax highlighting for code within diffs
- Refresh button to reload git status
- Staged vs unstaged file separation
- Line numbers in unified diff
- Diff statistics graph
- Filter files by status (A/M/D/R/?)
- Search within diff content

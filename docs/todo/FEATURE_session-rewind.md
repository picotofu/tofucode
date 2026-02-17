# FEATURE: Session Rewind

## Overview

Implement a "rewind" feature that allows users to roll back a session to a previous turn/state, similar to Claude Code CLI's rewind functionality. This would let users undo mistakes, explore alternative approaches, or recover from unwanted changes without starting a new session.

## Requirements

### Core Functionality
- Rewind session to any previous turn (user message + assistant responses)
- Continue conversation from rewound state
- Preserve full history for potential "redo" functionality
- Show clear visual indication of rewound state

### User Experience
- UI button/action to trigger rewind (e.g., "Rewind to here" on turn navigation)
- Confirmation modal before rewinding (to prevent accidental loss)
- Visual indicator showing current session is in rewound state
- Option to view "future" turns that were rewound past
- Ability to "fast forward" back to original state if desired

### Data Integrity
- Don't destructively modify original JSONL file
- Keep rewound turns accessible for reference
- Support multiple rewind operations (rewind, continue, rewind again)

## Context

### Claude Code CLI Implementation
The CLI's `/rewind` command:
- Takes a turn number as argument (e.g., `/rewind 5`)
- Truncates the conversation history at that point
- Continues from there as if later turns never happened
- Likely modifies the JSONL file or creates a branch

### Current Session Format
Sessions stored as JSONL in `~/.claude/projects/{project-slug}/`:
```jsonl
{"type":"system","message":{"role":"system","content":"..."}}
{"type":"user","message":{"role":"user","content":"..."}}
{"type":"assistant","message":{"role":"assistant","content":"..."}}
{"type":"tool_use","message":{"role":"assistant","content":"..."}}
```

Session metadata in `sessions-index.json`:
```json
{
  "entries": [
    {
      "sessionId": "uuid",
      "created": "ISO-8601",
      "modified": "ISO-8601",
      "messageCount": 10,
      "firstPrompt": "Initial message..."
    }
  ]
}
```

## Technical Approaches

### Option 1: Branch-Based (Recommended)

**Concept**: Create a new session branch when rewinding, preserving original history.

**Implementation**:
```
Original session: abc123.jsonl (turns 1-10)
Rewind to turn 5: abc123.jsonl (unchanged)
New branch:       abc123-rewind-001.jsonl (turns 1-5, then continues)
```

**Pros**:
- Non-destructive (original session intact)
- Can have multiple rewind branches
- Easy to switch between original and rewound states
- Fits existing session model (new sessionId)

**Cons**:
- Creates more session files
- Need UI to manage/view branches
- Session list could get cluttered

**Details**:
- Create new sessionId with suffix: `{originalId}-rewind-{timestamp}`
- Copy turns 1-N from original to new branch
- Link metadata: store `parentSessionId` and `rewindFromTurn` in session metadata
- UI shows branch relationship (tree view or parent link)
- Can "merge" branch back by making it the primary session

### Option 2: In-Place with Backup

**Concept**: Modify session JSONL in place, store rewound turns separately.

**Implementation**:
```
Original:  abc123.jsonl (turns 1-10)
Rewind:    abc123.jsonl (turns 1-5)
Stashed:   abc123-stash.jsonl (turns 6-10)
```

**Pros**:
- Session continues with same ID
- Cleaner session list
- "Redo" by appending stashed turns

**Cons**:
- More complex file management
- Risk of data loss if stash is deleted
- Multiple rewound sections harder to track

**Details**:
- Move turns N+1 onwards to `.{sessionId}-stash.jsonl`
- Update `sessions-index.json` message count
- Store stash metadata: `{ stashId, fromTurn, toTurn, created }`
- UI button to "restore stashed turns"

### Option 3: Virtual Rewind (Session Scoped)

**Concept**: Don't modify files, just track rewind state in memory/session storage.

**Implementation**:
```
Original:  abc123.jsonl (all turns)
Rewind state: { sessionId, truncateAt: 5 }
Rendering: Show turns 1-5, hide 6-10
New messages: Append to end (turn 11+)
```

**Pros**:
- Zero file modification risk
- Fast to implement
- Easy to undo rewind

**Cons**:
- Doesn't work across page reloads (need to store state)
- SDK won't know about rewind (might cause issues)
- Turn numbering gets confusing (turn 11 after rewinding to 5)

**Details**:
- Store rewind state in localStorage or session metadata JSON
- Filter messages in frontend before rendering
- When sending new message, SDK sees full history (may cause issues)
- Need to reconcile turn numbers in UI

## Recommended Approach: Option 1 (Branch-Based)

### Why Branch-Based?
1. **Safety**: Original session never modified
2. **Flexibility**: Multiple rewind points, easy experimentation
3. **Clarity**: Each branch is a complete, valid session
4. **Compatibility**: Works with existing Claude SDK without modification
5. **Discoverability**: Branches visible in session list with clear relationship

### Implementation Plan

#### Phase 1: Backend Support
1. **New WebSocket Event**: `rewind_session`
   ```json
   {
     "event": "rewind_session",
     "sessionId": "abc-123",
     "rewindToTurn": 5
   }
   ```

2. **Server Handler** (`server/events/rewind-session.js`):
   - Validate session exists and turn number is valid
   - Generate new sessionId: `{original}-rewind-{timestamp}`
   - Read original JSONL, copy turns 1-N to new session
   - Create new entry in `sessions-index.json`
   - Store metadata: `parentSessionId`, `rewindFromTurn`, `rewindedAt`
   - Emit `session_created` with new session info
   - Auto-switch client to new session

3. **Session Metadata Extension**:
   ```json
   {
     "sessionId": "abc-123-rewind-1708000000",
     "parentSessionId": "abc-123",
     "rewindFromTurn": 5,
     "rewindedAt": "2026-02-17T12:00:00Z",
     "created": "...",
     "modified": "...",
     "messageCount": 5
   }
   ```

#### Phase 2: Frontend UI

1. **Rewind Button on Turn Navigation**:
   - Add "Rewind to here" option in turn counter dropdown
   - Or: Right-click on turn → "Rewind to this turn"
   - Or: Button in turn navigation when hovering over specific turn

2. **Confirmation Modal**:
   ```
   Rewind session to turn 5?

   This will create a new session branch starting from turn 5.
   Your current session will remain unchanged.

   [Cancel] [Create Branch]
   ```

3. **Branch Indicator**:
   - Show branch relationship in session header
   - "Rewound from turn 5 of [Parent Session Title]"
   - Link to view parent session
   - Badge/icon indicating branch status

4. **Session List Enhancement**:
   - Group branches under parent session (tree view)
   - Show "3 branches" indicator on parent
   - Expandable to show all branches
   - Branch naming: "Branch from turn 5" or editable custom name

#### Phase 3: Advanced Features (Optional)

1. **Branch Merging**:
   - Make a branch the "canonical" session
   - Rename parent session to archive
   - Useful if rewound branch becomes the primary work

2. **Branch Comparison**:
   - Side-by-side diff view of two branches
   - Highlight where they diverged
   - Show different outcomes

3. **Multi-Level Rewind**:
   - Rewind from a branch creates sub-branch
   - Tree structure: Original → Branch1 → Branch1.1
   - Breadcrumb navigation through branch history

4. **Stash Integration**:
   - Option to "stash" rewound turns for later reference
   - "Future turns" view showing what was rewound past
   - Useful for comparing approaches

## Edge Cases & Considerations

### 1. Rewind During Active Session
- **Issue**: User has ongoing task when they rewind
- **Solution**: Cancel active task first, or prevent rewind during execution
- **UI**: Disable rewind button when task is running

### 2. Session Compaction
- **Issue**: Rewinding to a turn that was compacted (summary)
- **Solution**: Only allow rewind to turns after last compaction
- **UI**: Disable rewind for compacted turns, show message

### 3. File References
- **Issue**: Rewound session references files that don't exist yet (created in future turns)
- **Solution**: File system state is independent; warn user about potential issues
- **UI**: Show warning if rewind target has file tool uses

### 4. Terminal State
- **Issue**: Terminal processes from future turns don't exist in rewound state
- **Solution**: Terminal state is session-scoped; rewind creates fresh terminal context
- **UI**: Clear terminal history when switching to rewound session

### 5. Branch Cleanup
- **Issue**: Many branches could clutter session list
- **Solution**: Add "Delete branch" option, confirm before deleting
- **UI**: Batch operations to clean up old branches

### 6. Session Title Inheritance
- **Issue**: Branch starts with same title as parent
- **Solution**: Auto-suffix with " (Branch)" or let user edit
- **UI**: Prompt for branch name during creation (optional)

## Implementation Complexity

### Backend: Medium
- New event handler: ~100-150 LOC
- JSONL reading/copying: Existing utilities
- Metadata management: ~50 LOC
- Testing: Need to verify file operations

### Frontend: Medium-High
- Rewind UI components: ~200 LOC
- Confirmation modal: ~100 LOC
- Session list tree view: ~300 LOC (if implementing grouping)
- Branch indicator: ~50 LOC

### Testing Requirements
- Unit tests for JSONL copying
- Integration tests for session creation
- E2E tests for rewind flow
- Edge case testing (compaction, active tasks, etc.)

**Estimated Development Time**: 2-3 days for core feature (Option 1)

## Alternatives to Consider

### Checkpoint System
Instead of full rewind, allow users to create "checkpoints":
- Mark specific turns as checkpoints
- Rewind only to checkpoints (not arbitrary turns)
- Simpler UI (list of named checkpoints)
- Less flexible but easier to understand

### Undo Last Turn
Simplified rewind that only undoes the most recent turn:
- Much simpler to implement
- Covers most common use case (undo mistake)
- Can be extended to multi-turn undo later
- Good MVP before full rewind

## Open Questions

1. **Branch Naming**: Auto-generate or prompt user for name?
2. **Branch Visibility**: Show in main session list or separate "Branches" section?
3. **Keyboard Shortcut**: Should there be a hotkey for rewind? (e.g., Cmd+Shift+Z)
4. **Auto-Cleanup**: Should old branches be auto-archived after X days?
5. **SDK Compatibility**: Does Claude SDK have any built-in rewind support we should leverage?

## Security Considerations

- **File Access**: Ensure user can only rewind their own sessions
- **Path Validation**: Validate sessionId format to prevent path traversal
- **Disk Usage**: Monitor branch proliferation, set reasonable limits
- **Concurrent Access**: Handle case where session is modified during rewind operation

## User Documentation Needs

- How to rewind a session
- Understanding branches vs original sessions
- When to use rewind (and when to start fresh)
- How to clean up old branches
- Keyboard shortcuts for rewind actions

## Success Metrics

- % of sessions that use rewind feature
- Average number of branches per session
- User feedback on intuitiveness
- Error rate during rewind operations
- Impact on session management clarity

## Conclusion

**Recommendation**: Implement Option 1 (Branch-Based) as the core rewind mechanism.

**Rationale**:
- Safest approach (non-destructive)
- Most flexible for future enhancements
- Aligns with session-based architecture
- Minimal risk to existing functionality

**MVP Scope**:
1. Create session branch from any turn
2. Confirmation modal with clear explanation
3. Branch indicator in session header
4. Basic branch listing in sessions sidebar
5. "Rewind to here" button in turn navigation

**Future Enhancements**:
- Tree view for complex branch structures
- Branch comparison and diffing
- Checkpoint system for quick bookmarking
- Branch merging and renaming
- Stash system for viewing rewound turns

This feature would significantly enhance the user experience for iterative development and experimentation, providing a safety net for exploring different approaches without fear of losing progress.

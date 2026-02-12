# ENHANCEMENT: JSONL Streaming Optimization

**Status**: ✅ **COMPLETED** (Phase 1 + Phase 2 + Turn-Based Pagination implemented - 2026-02-12)

## Final Implementation Summary (2026-02-12)

### Turn-Based Pagination (Final Enhancement)
- Replaced entry-count pagination with **conversation turn-based loading**
- Initial load: Last **3 complete turns** (user → assistant exchanges)
- Pagination: Load **5 turns** per click
- Turn counter shows total turns efficiently calculated during streaming
- Up arrow at top of chat loads previous turns automatically

### Key Benefits Achieved
- ✅ Memory-efficient circular buffer (500 entry limit)
- ✅ Smart turn detection (finds user messages with text content)
- ✅ Total turn count with zero extra memory cost
- ✅ Predictable pagination (always complete conversations)
- ✅ Enhanced keyboard navigation (up arrow loads more)

---

## Original Enhancement Plan

## Context

Currently, conversation history loading uses Node.js streaming APIs (`createReadStream` + `readline.createInterface`) to read JSONL files line-by-line, but still accumulates all entries in memory before processing. This defeats the primary advantage of JSONL format for large conversation histories.

### Current Behavior

**Message History Loading** (`server/lib/sessions.js` lines 249-311):
```javascript
const allEntries = [];
rl.on('line', (line) => {
  const entry = JSON.parse(line);
  allEntries.push(entry);  // ❌ Stores everything in memory
});
```

- ✅ Reads file using streaming (good)
- ❌ Stores all entries in `allEntries` array (defeats streaming purpose)
- ✅ Only parses entries after last summary (optimization exists)
- **Result**: For 500-message history, all 500 entries are loaded into memory

**Session List Loading** (`server/lib/sessions.js` lines 60-114):
```javascript
const content = readFileSync(jsonlPath, 'utf-8');  // ❌ Loads entire file
const lines = content.split('\n').filter((line) => line.trim());
```

- ❌ Uses `readFileSync` to load entire file into memory
- Only needed for unindexed sessions (newly created)
- Only uses first line, but loads everything

## Issues

### Memory Usage
- Large conversation histories (hundreds of messages) load entirely into memory
- Multiple concurrent session loads can spike memory usage
- Unnecessary for sessions with summary markers (only need recent messages)

### I/O Efficiency
- Session list scanning reads full JSONL files just to get first line
- No caching of metadata (first prompt, message count)

## Requirements

### Must Have
1. Reduce memory footprint for large conversation histories
2. Maintain current functionality (summary-based loading, full history option)
3. Preserve message order and parsing logic

### Should Have
1. Optimize session list scanning to avoid full file reads
2. Cache session metadata (first prompt, message count) in index
3. Support pagination/windowing for very large histories

### Nice to Have
1. Reverse streaming (read from end backwards)
2. Configurable message window size
3. Lazy loading of tool results

## Scope

### In Scope
- Optimize `loadSessionHistory()` to avoid storing all entries in memory
- Optimize session list scanning to avoid `readFileSync` on JSONL files
- Implement two-pass streaming efficiently

### Out of Scope
- Changing JSONL file format
- Modifying Claude SDK's JSONL writing behavior
- Client-side pagination (separate enhancement)

## Proposed Solutions

### Option 1: Two-Pass Streaming (Minimal Change)
**Pros**:
- Small code change
- Maintains current logic flow
- Still needs to read entire file once

**Cons**:
- Two separate read operations
- Doesn't reduce memory for files without summaries

**Implementation**:
```javascript
// First pass: Find last summary index
let lastSummaryIndex = -1;
let lineIndex = 0;
const rl1 = createInterface({ input: createReadStream(jsonlPath) });
rl1.on('line', (line) => {
  const entry = JSON.parse(line);
  if (entry.type === 'summary') lastSummaryIndex = lineIndex;
  lineIndex++;
});

// Second pass: Only read from summary onward
const startIndex = lastSummaryIndex >= 0 ? lastSummaryIndex : 0;
const rl2 = createInterface({ input: createReadStream(jsonlPath) });
// Skip to startIndex, then accumulate
```

### Option 2: Single-Pass with Circular Buffer (Optimal)
**Pros**:
- Single file read
- Bounded memory usage
- Works without summaries

**Cons**:
- More complex logic
- Needs to handle "full history" mode differently

**Implementation**:
```javascript
// Keep only last N entries or entries after last summary
const buffer = [];
const maxBufferSize = 1000; // Configurable

rl.on('line', (line) => {
  const entry = JSON.parse(line);

  if (entry.type === 'summary') {
    // Found summary - clear buffer, start fresh
    buffer.length = 0;
    lastSummaryIndex = lineIndex;
  }

  buffer.push(entry);

  // If no summary yet, maintain sliding window
  if (lastSummaryIndex === -1 && buffer.length > maxBufferSize) {
    buffer.shift();
  }

  lineIndex++;
});
```

### Option 3: Reverse Streaming (Advanced)
**Pros**:
- Can stop early when enough messages loaded
- Natural for "recent messages" use case

**Cons**:
- Complex to implement (requires file seeking)
- Needs newline index or line length tracking
- May not work with all stream types

## Session List Optimization

### Current Issue
Unindexed sessions use `readFileSync` to read entire JSONL just for first line.

### Solution
Update `sessions-index.json` more aggressively:
- Watch for new JSONL files
- Immediately index first line + metadata
- Never fall back to full file read

**Alternative**: Use `readline` stream for unindexed sessions:
```javascript
// Read only first line via streaming
const rl = createInterface({ input: createReadStream(jsonlPath) });
let firstLine = null;
rl.on('line', (line) => {
  if (!firstLine) {
    firstLine = line;
    rl.close(); // Stop reading after first line
  }
});
```

## Recommended Approach

**Phase 1** (Quick Win):
1. Fix session list scanning - use streaming with early termination for first line
2. Never use `readFileSync` on JSONL files

**Phase 2** (Memory Optimization):
1. Implement Option 2 (Single-Pass with Circular Buffer)
2. Make buffer size configurable via env var (default: 1000 entries)
3. For `fullHistory: true` mode, use current approach (acceptable trade-off)

**Phase 3** (Future Enhancement):
1. Add client-side pagination
2. Implement reverse streaming if needed
3. Add caching layer for frequently accessed sessions

## Testing Considerations

1. **Large files**: Test with JSONL files containing 1000+ messages
2. **Memory profiling**: Measure memory usage before/after
3. **Edge cases**:
   - Empty JSONL files
   - Files with no summaries
   - Files with multiple summaries
   - Malformed JSON lines
4. **Performance**: Compare load times for various file sizes

## Related Files

- `server/lib/sessions.js` - Main implementation
- `server/events/get-recent-sessions.js` - Session list event
- `server/lib/session-titles.js` - Title management

## Implementation Summary

### Phase 1 (✅ Completed - 2026-02-12)
**Commit**: `3590e97` - "Optimize JSONL session list scanning (Phase 1)"

- Replaced `readFileSync` with streaming `readline` for unindexed sessions
- Made `getSessionsList()` async
- Reduced memory usage during session list loading
- No longer loads entire JSONL files just to read first line

**Files changed**:
- `server/lib/sessions.js` - Converted to streaming approach
- `server/events/get-sessions.js` - Made handler async
- `server/events/select-project.js` - Made handler async

### Phase 2 (✅ Completed - 2026-02-12)
**Commit**: `b5fed9b` - "Implement JSONL streaming optimization Phase 2 - Pagination"

**Backend**:
- Circular buffer in `loadSessionHistory()` (max 500 entries by default, configurable)
- Pagination support via `offset` and `limit` parameters
- New `load_older_messages` WebSocket event for progressive loading
- Clears buffer on summary markers (only keeps relevant context)

**Frontend**:
- Initial load: Last 50 messages (configurable via `limit` param)
- "Load older messages" button loads previous 50 incrementally
- Loading state with spinner animation
- Tracks `offset`, `totalEntries`, `hasOlderMessages` for pagination

**Impact for 44MB session (7,675 messages)**:
- Memory: ~93% reduction (500 entries max vs all 7,675)
- Network: ~99% reduction (50 messages initially vs all 7,675)
- User can load more by clicking button

**Files changed**:
- `server/lib/sessions.js` - Circular buffer + pagination
- `server/events/select-session.js` - Pass pagination params
- `server/events/load-older-messages.js` - New event handler
- `server/events/index.js` - Register new event
- `src/composables/useWebSocket.js` - Pagination state + `loadOlderMessages()`
- `src/components/ChatMessages.vue` - "Load older" button UI
- `src/views/ChatView.vue` - Wire up pagination event

### Configuration

Environment variables (optional):
```bash
# Default pagination limit (messages per page)
DEFAULT_MESSAGE_LIMIT=50

# Max buffer size for circular buffer
MAX_BUFFER_SIZE=500
```

Currently hardcoded with sensible defaults:
- `limit`: 50 messages (initial load)
- `maxBufferSize`: 500 entries (memory limit)
- Load increment: 50 messages per button click

## References

- JSONL format specification: https://jsonlines.org/
- Node.js readline: https://nodejs.org/api/readline.html
- Node.js streams: https://nodejs.org/api/stream.html

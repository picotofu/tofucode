# Fix: Projects List JSONL Scan

**Date:** 2026-02-17
**Status:** ✅ Completed

## Problem

Projects with empty or missing `sessions-index.json` entries were not appearing in the projects list, even when they had actual session `.jsonl` files. This caused projects to "disappear" after renames, migrations, or when the index became stale.

**Example:** The `tofucode` project had 7 `.jsonl` session files but `sessions-index.json` showed `entries: []`, causing it to be filtered out.

## Root Cause

The `getProjectsList()` function in `server/lib/projects.js` only counted sessions from `sessions-index.json`:

```javascript
sessionCount = data.entries?.length || 0;
if (sessionCount > 0) {
  // Include project
}
```

If the index was empty, the project was excluded even if session files existed.

## Solution

Modified `getProjectsList()` to scan the directory for `.jsonl` files when the index is empty/missing:

1. **First try index (fast path)** - Check `sessions-index.json` for entries
2. **Fallback to scan (recovery path)** - If no entries found, scan directory for `.jsonl` files
3. **Validate session IDs** - Use UUID regex to ensure files are valid sessions

```javascript
// If no sessions found in index, scan directory for .jsonl files
if (sessionCount === 0 && existsSync(sessionsDir)) {
  const files = readdirSync(sessionsDir);
  for (const file of files) {
    if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
      const sessionId = file.replace('.jsonl', '');
      // Validate UUID format
      if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)) {
        sessionCount++;
        // Track mtime for sorting
      }
    }
  }
}
```

## Performance Impact

**Benchmark results (100 iterations):**

| Version | Average | Median | P95 | Impact |
|---------|---------|--------|-----|--------|
| OLD (index-only) | 1.37ms | 1.28ms | 2.13ms | - |
| NEW (index + scan) | 1.69ms | 1.61ms | 2.09ms | **+0.32ms** |

**Analysis:**
- Absolute impact: +0.32ms (negligible, <5ms threshold)
- Relative impact: +23.7%
- **Verdict:** NEGLIGIBLE - acceptable for correctness gain

**Test environment:**
- 21 project directories
- 230 JSONL session files
- 301.81 MB total session data

## Correctness Impact

**Projects recovered:**
- OLD version: 10 projects found
- NEW version: 19 projects found
- **Recovered: 9 projects** (including tofucode!)

**Recovered projects:**
1. `-home-ts-projects-tofucode` (7 sessions)
2. `-home-ts-deluge-downloads` (1 session)
3. `-home-ts-projects-daycare-idle` (2 sessions)
4. `-home-ts-downloads` (1 session)
5. `-home-ts-pg-migration` (1 session)
6. `-home-ts-projects-claude-web` (1 session)
7. `-home-ts-projects-anime-service-aob-109` (1 session)
8. `-home-ts-projects-anime-service-aob-98` (2 sessions)
9. `-home-ts-projects-recommendation-service` (1 session)

No projects were lost in the new version.

## Trade-offs

**Pros:**
- ✅ Recovers previously hidden projects
- ✅ Resilient to stale/corrupted index files
- ✅ Consistent with `getSessionsList()` behavior (already scans for unindexed sessions)
- ✅ Negligible performance impact (<0.5ms)

**Cons:**
- Slightly slower for projects with empty indexes (extra directory scan)
- Adds ~50 lines of code

**Decision:** Accepted - correctness gain far outweighs minimal performance cost.

## Files Changed

- `server/lib/projects.js` - Added `.jsonl` scanning logic
- `CHANGELOG.md` - Documented fix

## Testing

**Manual verification:**
```bash
$ node -e "import { getProjectsList } from './server/lib/projects.js'; ..."
Total projects found: 19
✓ tofucode project found!
  Name: tofucode
  Path: /home/ts/projects/tofucode
  Sessions: 7
```

**Live testing:**
1. Start server
2. Open projects list
3. Verify tofucode project appears with correct path
4. Navigate to sessions view
5. Verify project path displays correctly in header

## Related Issues

This fix also benefits:
- Projects after rename/migration where index wasn't rebuilt
- Projects created outside the SDK (manual `.jsonl` creation)
- Recovery from corrupted index files
- Debug/development scenarios with stale indexes

## Future Improvements

Consider:
1. Auto-rebuild index when discrepancy detected
2. Add CLI command to rebuild all indexes
3. Log warning when fallback scan is triggered (indicates stale index)

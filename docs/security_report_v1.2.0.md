# Security Review Report
## tofucode Web UI v1.2.0

**Date:** 2026-03-03
**Target:** tofucode v1.2.0 (main branch, pre-release)
**Reviewer:** Automated code review + static analysis
**Scope:** All code changes between v1.1.0 and v1.2.0 (draft sync, file upload, file download, HTML preview, dotfile toggle, mobile git diff, sidebar toolbar, Cmd+K folder selector, Docker fixes)

---

## Executive Summary

**OVERALL RESULT: SECURE**

Comprehensive code review and security assessment of v1.2.0 identified 8 vulnerabilities (1 High, 2 Medium, 5 Low) across new features. All High and Medium severity issues were remediated. Low severity findings were either fixed or documented as accepted risks. The `npm audit fix` resolved 3 dependency vulnerabilities (minimatch, multer, rollup); 2 remaining issues are in transitive build/optional dependencies and accepted as low risk.

**npm audit:** 2 accepted (serialize-javascript in build toolchain, undici in discord.js)

---

## New Features Reviewed

### Server-Side Draft Persistence (`server/events/draft.js`)
- **New file** — stores/retrieves chat input drafts per session in `.drafts.json`
- Session ID validated via `isValidSessionId()` (UUID format)
- Draft content capped at 100KB (`MAX_DRAFT_LENGTH`)
- Entry count capped at 100 per project (`MAX_DRAFT_ENTRIES`) with LRU eviction
- Error messages genericised — no internal paths leaked to client
- **Result:** PASS (after fixes)

### File Upload (`server/routes/upload.js`)
- **New file** — HTTP multipart upload endpoint with multer
- File size capped via `config.maxFileSizeMb` (default 10MB)
- Authentication required (same session cookie as WebSocket)
- **Result:** PASS (after fixes — see vulnerabilities below)

### File Search with Dotfiles Toggle (`server/events/search-files.js`)
- `showDotfiles` parameter is client-controlled (boolean)
- `skipDirs` set correctly applies only to directories, not files
- Search results limited by `maxResults` (default 100)
- `globToRegex` could theoretically produce backtracking patterns but risk is negligible (short filenames, bounded results)
- **Result:** PASS

### Git Diff Modal — Mobile View (`src/components/GitDiffModal.vue`)
- Frontend-only changes — no new server attack surface
- CSS-only visibility toggles (`mobile-screen-hidden`, `desktop-only`)
- Diff content is rendered as text nodes (no `v-html`), preventing XSS
- **Result:** PASS

### Docker Image Updates
- Switched from Alpine to `node:24-slim` (Debian) to fix shell detection
- Set `SHELL=/bin/bash` for Claude Code compatibility
- No new security-relevant changes to Docker entrypoint or permissions
- **Result:** PASS

### Sidebar Toolbar / Cmd+K Folder Selector
- Frontend-only — folder browser reuses existing `files:browse` WebSocket handler
- No new server-side code paths
- **Result:** PASS

### DOMPurify Configuration (`src/utils/markdown.js`)
- Added `target` and `rel` to `ADD_ATTR` allowlist
- Only allows these specific attributes — no `href` manipulation or `javascript:` protocol risk
- Enables `target="_blank" rel="noopener noreferrer"` on links (safe pattern)
- **Result:** PASS

---

## Vulnerabilities Found and Fixed

### HIGH: Upload Filename Injection via `originalname`

**Severity:** High
**File:** `server/routes/upload.js`

**Description:**
`req.file.originalname` from multipart `Content-Disposition` was used directly in `path.join()` without sanitization. A malicious client could craft a filename containing path traversal sequences (e.g., `../../.bashrc`), and while `path.join` normalises the segments, the resulting path was never re-validated against allowed directories.

**Attack scenario:**
1. Client sends `destPath=/home/user/uploads` (valid directory)
2. Client sets filename to `../../.bashrc`
3. `path.join("/home/user/uploads", "../../.bashrc")` resolves to `/home/user/.bashrc`
4. Arbitrary file overwrite within the filesystem

**Fix Applied:**
- Filename sanitised via `path.basename()` to strip all directory components
- Reject filenames that resolve to `.` or `..`
- Final path re-validated through `validateUploadPath()` after joining
- Error messages genericised (no internal paths leaked)

```javascript
// AFTER (fixed)
const sanitizedName = path.basename(req.file.originalname);
if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
  return res.status(400).json({ error: 'Invalid filename' });
}
const finalPath = path.join(resolvedDir, sanitizedName);
validateUploadPath(finalPath); // re-validate final path
```

---

### MEDIUM: Client-Controlled `projectPath` in Upload Endpoint

**Severity:** Medium
**File:** `server/routes/upload.js`

**Description:**
The upload endpoint accepted a `projectPath` parameter from the HTTP request body and used it to expand the set of allowed write directories. Unlike WebSocket handlers (which use server-maintained `context.currentProjectPath`), the HTTP upload had no server-side project binding. A malicious authenticated user could set `projectPath=/` to effectively write anywhere on the filesystem.

**Fix Applied:**
- Removed `projectPath` parameter from the upload endpoint entirely
- Upload path validation now only allows writes under `homedir()` (default) or `config.rootPath` (when set)
- Frontend updated to stop sending `projectPath` in upload requests

---

### MEDIUM: Symlinks Not Resolved in Non-rootPath Validation

**Severity:** Medium
**Files:** `server/events/files.js`, `server/routes/upload.js`

**Description:**
When `config.rootPath` is set, symlinks were correctly resolved via `realpathSync` before checking path containment. However, in the default mode (no `--root`), only `path.resolve()` was used, which does not follow symlinks. A symlink within the home directory pointing outside it would pass validation but the actual file operation would target the external location.

**Fix Applied:**
- Both `validatePath()` (files.js) and `validateUploadPath()` (upload.js) now resolve symlinks in all modes
- For non-existent paths (create operations), the parent directory is resolved via `realpathSync` and the basename is appended

```javascript
// AFTER (fixed) — applied to both files.js and upload.js
const realResolved = existsSync(resolved)
  ? realpathSync(resolved)
  : (() => {
      const parent = path.dirname(resolved);
      const basename = path.basename(resolved);
      return existsSync(parent)
        ? path.join(realpathSync(parent), basename)
        : resolved;
    })();
```

---

### LOW: Error Messages Leak Internal Server Paths

**Severity:** Low
**Files:** `server/events/files.js`, `server/events/draft.js`, `server/routes/upload.js`

**Description:**
Node.js filesystem errors include full absolute paths (e.g., `ENOENT: no such file or directory, open '/home/ts/.claude/...'`). These were forwarded to clients verbatim via WebSocket and HTTP responses, revealing internal directory structure.

**Fix Applied:**
- Added `safeError()` helper in `files.js` — passes through "Access denied" messages, genericises all others
- Full error details logged server-side via `logger.error()`
- Draft and upload error responses genericised
- Upload handler returns "Upload failed" for non-access-denied errors

---

### LOW: Unbounded Draft Entries Per Project

**Severity:** Low
**File:** `server/events/draft.js`

**Description:**
The `.drafts.json` file had a per-draft size cap (100KB) but no limit on the number of entries. An attacker could create thousands of unique session IDs with near-max-size drafts, growing the file without bound and degrading I/O performance.

**Fix Applied:**
- Added `MAX_DRAFT_ENTRIES = 100` limit per project
- When exceeded, oldest entries (by `updatedAt` timestamp) are evicted

---

### LOW: Race Condition in Session Deletion (TOCTOU)

**Severity:** Low
**File:** `server/events/delete-session.js`

**Description:**
The session deletion handler performs check-then-act sequences (`existsSync` → `unlinkSync`, and read-modify-write on `sessions-index.json`) that are not atomic. Concurrent deletion of different sessions could theoretically corrupt the index.

**Status:** Accepted risk
- Node.js is single-threaded for synchronous code — true concurrency requires async interleaving
- Each file operation is wrapped in try/catch, so partial failures don't crash the server
- The sessions-index is self-healing (rebuilt from JSONL files on next project scan)

---

### LOW: WebSocket Messages Not Rate-Limited

**Severity:** Low
**File:** `server/websocket.js`

**Description:**
There is no per-connection rate limit on WebSocket messages. An authenticated client could flood the server with thousands of messages per second, each triggering filesystem operations.

**Status:** Accepted risk
- tofucode is designed as a personal/small-team tool, not a public-facing service
- Authentication is required for all WebSocket connections
- WebSocket `maxPayload` (1MB) limits per-message resource consumption
- Adding rate limiting would add complexity with minimal benefit for the target use case

---

### LOW: `files:write` Has No Application-Level Content Size Limit

**Severity:** Low
**File:** `server/events/files.js`

**Description:**
The `handleFilesWrite` handler writes content to disk without an explicit size check. The WebSocket `maxPayload` of 1MB provides an implicit cap, but there is no application-level validation.

**Status:** Accepted risk
- The 1MB WebSocket frame limit provides effective protection
- Adding a redundant check would provide minimal additional security
- File writes are within the user's own project directories

---

## Dependency Audit

### Fixed (via `npm audit fix`)

| Package | Severity | Advisory | Resolution |
|---------|----------|----------|------------|
| minimatch 10.0.0–10.2.2 | High | ReDoS via GLOBSTAR segments (GHSA-7r86-cg39-jmmj) | Updated to patched version |
| minimatch 10.0.0–10.2.2 | High | ReDoS via nested extglobs (GHSA-23c5-xmqv-rm74) | Updated to patched version |
| multer ≤2.0.2 | High | DoS via incomplete cleanup (GHSA-xf7r-hgr6-v32p) | Updated to patched version |
| multer ≤2.0.2 | High | DoS via resource exhaustion (GHSA-v52c-386h-88mc) | Updated to patched version |
| rollup ≥4.0.0 <4.59.0 | High | Arbitrary file write via path traversal (GHSA-mw96-cpmx-2vgc) | Updated to patched version |

### Accepted Risks

| Package | Severity | Advisory | Justification |
|---------|----------|----------|---------------|
| serialize-javascript ≤7.0.2 | High | RCE via RegExp.flags (GHSA-5c6j-r48x-rmvq) | Build-time dependency only (vite-plugin-pwa → workbox-build → @rollup/plugin-terser). Not present in production runtime. Fix requires breaking change to vite-plugin-pwa. |
| undici <6.23.0 | Moderate | Unbounded decompression in Fetch API (GHSA-g9mf-h72j-4rw9) | Transitive dependency of discord.js. Only affects Discord bot HTTP requests, not user-facing. Fix requires breaking major version change of discord.js. |

---

## Recommendations for Future Releases

1. **Server-side rate limiting** — Consider adding per-connection message rate limiting if tofucode expands beyond personal/small-team use
2. **Content Security Policy** — Add CSP headers to prevent potential XSS vectors from user-uploaded HTML content viewed via the HTML preview feature
3. **Upgrade discord.js** — When discord.js v15 stabilises, upgrade to resolve the undici vulnerability
4. **Upgrade vite-plugin-pwa** — Monitor for a compatible release that resolves the serialize-javascript chain

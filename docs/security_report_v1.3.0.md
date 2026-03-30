# Security Report — tofucode v1.3.0

**Date:** 2026-03-30
**Scope:** Full security audit of all code since v1.2.1 — Notes feature (Obsidian-like vault), Task Management (Notion integration), file browser enhancements, Discord bot, WebSocket/HTTP endpoints, PWA, and dependency audit.

---

## Summary

| Category | Count |
|---|---|
| Critical | 0 |
| High (accepted risk) | 2 |
| Medium | 6 |
| Low | 14 |
| Info | 12 |

All Critical and High issues are either fixed or formally accepted with documented rationale.

---

## Dependency Vulnerabilities (npm audit)

### Fixed (via `npm audit fix`)

| Package | Severity | Advisory | Fix |
|---|---|---|---|
| `brace-expansion` | Moderate | ReDoS in `< 1.1.12` | Updated to `1.1.12` |
| `path-to-regexp` | Moderate | ReDoS in `< 0.1.12` | Updated to `0.1.12` |
| `picomatch` | Moderate | ReDoS in `< 4.0.2` | Updated to `4.0.2` |

### Accepted Risk

#### serialize-javascript — RCE (High) — ACCEPTED RISK
- **Advisory:** [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) — RCE via `RegExp.flags` and `Date.prototype.toISOString()`
- **Severity:** High (CVSSv3)
- **Dependency chain:** `vite-plugin-pwa → workbox-build → @rollup/plugin-terser → serialize-javascript`
- **Exposure analysis:** Build toolchain only (`devDependencies`). `serialize-javascript` runs during `npm run build` to generate service worker code from developer-controlled configuration. No user-controlled input is ever serialised. No runtime exposure.
- **Fix available:** Requires breaking change to `vite-plugin-pwa`
- **Status:** ⚠️ Accepted — build-time only, no runtime exposure (carried forward from v1.2.1)

#### undici — Multiple CVEs (High) — ACCEPTED RISK
- **Advisory:** 5 CVEs including WebSocket UTF-8 validation bypass, unbounded decompression, fetch redirect headers leak
- **Severity:** High (aggregate)
- **Dependency chain:** `discord.js → @discordjs/rest → @discordjs/ws → undici`
- **Exposure analysis:** `undici` is used exclusively by the Discord bot's HTTP client communicating with Discord's official API servers. The vulnerabilities require a malicious HTTP/WebSocket server, which would mean Discord's own infrastructure is compromised — outside our threat model. The Discord bot is opt-in (`DISCORD_ENABLED=true`) and disabled by default.
- **Fix available:** Requires major version downgrade of `discord.js` (breaking change)
- **Status:** ⚠️ Accepted — Discord bot only, trusted upstream, opt-in feature (carried forward from v1.2.1)

---

## Code Security Review — New Features

### A. Notes Feature (Obsidian-like Vault)

#### A-1. No Server-Side Validation of `notesBasePath` Setting — MEDIUM
- **Files:** `server/events/update-settings.js`, `server/lib/settings.js`
- **Finding:** The `update_settings` handler persists arbitrary settings without validation. `notesBasePath` could be set to any path (e.g., `~/.ssh`, `~/.tofucode`). While file operations go through `validatePath()` which restricts to `homedir()` or `--root`, a hijacked session could configure the vault to browse sensitive directories within the home folder.
- **Impact:** An authenticated user can read/edit any file under `$HOME` via the Notes interface, regardless of the configured vault path.
- **Recommendation:** Validate that `notesBasePath` and `notesIncludePaths` point to existing directories and warn if they overlap with known sensitive locations.

#### A-2. HTML Render Iframe with `allow-same-origin` Sandbox Escape — MEDIUM
- **File:** `src/components/FileEditor.vue` (line 644-649)
- **Finding:** The HTML preview iframe uses `sandbox="allow-scripts allow-same-origin"`. When both flags are combined, the sandboxed iframe can remove its own sandbox attribute and gain full access to the parent page's origin. A malicious `.html` file in the vault could execute JavaScript with full same-origin access to the tofucode application.
- **Impact:** XSS via crafted `.html` file when render toggle is enabled.
- **Recommendation:** Remove `allow-same-origin` from the sandbox, or use a `blob:` URL / separate origin for rendering.

#### A-3. No Server-Side Vault Scoping for Notes File Operations — LOW
- **Files:** `server/events/files.js`, `src/views/NotesView.vue`
- **Finding:** `notesBasePath` is purely a client-side UI hint. The server-side `validatePath()` allows access to the entire `homedir()` tree. Notes can read/write any file under `$HOME`.
- **Impact:** By design — bounded by server `validatePath()`. Users may expect vault-scoping that does not exist.
- **Recommendation:** Accepted risk. Document that vault scoping is advisory only.

#### A-4. `__abs` Route Prefix Allows Arbitrary Path Access — LOW
- **Files:** `src/views/NotesView.vue`, `src/components/NotesPanel.vue`
- **Finding:** The `__abs/` URL prefix converts to absolute paths on the client side (e.g., `/notes/__abs/etc/passwd` → `/etc/passwd`). Server-side `validatePath()` catches out-of-bounds paths, so this is bounded.
- **Recommendation:** Add client-side validation that `__abs` paths belong to configured `notesIncludePaths`.

#### A-5. New Note Filename and Rename Lack Client-Side Sanitization — LOW
- **Files:** `src/components/NotesPanel.vue`
- **Finding:** Filenames for new notes and renames are only trimmed. No client-side rejection of `../`, `/`, or control characters. Server-side `validatePath()` catches traversal attempts.
- **Recommendation:** Add client-side validation for defense-in-depth and better UX error messages.

#### A-6. `validatePath` Symlink Handling Gap for Non-Existent Paths — LOW
- **File:** `server/events/files.js` (lines 34-42)
- **Finding:** When neither the target nor its parent directory exists, `validatePath` falls back to the unresolved path. The `path.relative()` check still catches escapes, and creating paths where both target and parent don't exist is an unlikely operation.
- **Impact:** Very low — requires filesystem write access to exploit (which defeats the purpose of the guard).

#### A-7. Debug `console.log` in Production Code — INFO
- **File:** `src/composables/useFilesManager.js`
- **Finding:** Debug logging exposes server filesystem paths to the browser console.
- **Recommendation:** Remove or gate behind a debug flag.

#### A-8. TinyMDE Markdown Not Sanitized — INFO (Not Exploitable)
- **File:** `src/components/FileEditor.vue`
- **Finding:** TinyMDE displays raw markdown source, not rendered HTML. Inline HTML tags are displayed as text, not interpreted as DOM elements. No XSS risk.

---

### B. Task Management (Notion Integration)

#### B-1. Config File Stored with World-Readable Permissions — MEDIUM
- **File:** `server/lib/task-providers/notion-config.js` (line 87)
- **Observed:** `~/.tofucode/notion-config.json` has permissions `-rw-r--r--` (644)
- **Finding:** `writeFileSync` without `mode` option results in world-readable file containing the plaintext Notion integration token (`secret_xxx`). On shared systems, any local user can read the token.
- **Recommendation:** Add `{ mode: 0o600 }` to `writeFileSync` call.

#### B-2. No Validation of `field`/`fieldType` Against Configured Mappings — MEDIUM
- **File:** `server/events/tasks.js` (line 224-226)
- **Finding:** The `field` and `fieldType` values from WebSocket messages are passed directly to `buildPropertyValue()` without validation against the configured `fieldMappings`. A client could specify any arbitrary Notion property name and control how values are formatted. `buildPropertyValue` returns `null` for unknown types, and Notion rejects writes to non-existent properties, limiting the impact.
- **Recommendation:** Validate `field` exists in configured `fieldMappings` and `fieldType` matches the mapping's type.

#### B-3. Raw Notion API Errors Sent to Client — MEDIUM
- **File:** `server/events/tasks.js` (lines 106, 145, 186, 236, 270, 302, 338, 377, 411)
- **Finding:** All catch blocks send `err.message` directly to the client. `NotionAPIError` includes API paths (revealing database IDs), HTTP status codes, and error codes.
- **Recommendation:** Map Notion errors to user-friendly messages. Log full errors server-side.

#### B-4. No Server-Side Length Limits — LOW
- **Files:** `server/events/tasks.js`
- **Finding:** No server-side length validation for:
  - Title (client has `maxlength="200"`, server truncates at 2000 — the Notion API limit)
  - Comment content (no limit; Notion's rich_text limit is 2000 chars per element)
  - Body text in `replaceTicketBody` (no limit; triggers many API calls for large bodies)
- **Recommendation:** Add server-side length caps for defense-in-depth.

#### B-5. No `pageId` Format Validation — LOW
- **File:** `server/events/tasks.js`
- **Finding:** `pageId` is only checked for presence, not UUID format. Arbitrary strings are passed to Notion API URLs. Notion rejects invalid IDs, but format validation is defense-in-depth.
- **Recommendation:** Validate `pageId` matches `/^[a-f0-9-]{32,36}$/i`.

#### B-6. `replaceTicketBody` is Non-Atomic — LOW
- **File:** `server/lib/task-providers/notion.js` (lines 1220-1249)
- **Finding:** Deletes all existing blocks then recreates. If operation fails partway, the page body is empty with no undo.
- **Recommendation:** Accepted risk — document the behavior.

#### B-7. Token Masking and Round-Trip Protection — INFO (No Issue)
- `getMaskedNotionConfig()` properly masks tokens; `handleSaveConfig` rejects masked tokens on round-trip.

#### B-8. No Injection Risk in Notion API Calls — INFO (No Issue)
- All user input is placed into JSON-structured Notion property objects via `fetch()` + `JSON.stringify()`. Database URL extraction uses strict hex regex.

---

### C. File Browser & Path Traversal

#### C-1. `validateSearchPath` Missing Symlink Resolution in Non-rootPath Mode — LOW
- **File:** `server/events/search-files.js` (lines 268-311)
- **Finding:** Unlike `validatePath` in `files.js`, `validateSearchPath` only resolves symlinks when `config.rootPath` is set. In non-rootPath mode, a symlink within `homedir()` pointing outside could be used as a search root. Only file/folder names are disclosed (not content).
- **Recommendation:** Add `realpathSync` to the non-rootPath branch for consistency.

#### C-2. `git_clone` Missing Symlink Resolution for Target Directory — LOW
- **File:** `server/events/git-clone.js` (lines 100-112)
- **Finding:** Target directory validation uses `path.resolve()` without `realpathSync()`. A symlink within `rootPath` pointing outside could be used as a clone target.
- **Recommendation:** Add `realpathSync` resolution for `trimmedTargetDir`.

#### C-3. TOCTOU Race in Validate-Then-Operate Pattern — LOW
- **Files:** `server/events/files.js`, `server/routes/upload.js`
- **Finding:** Between `validatePath()` (which resolves symlinks) and the actual file operation, a symlink could theoretically be swapped. Requires concurrent filesystem write access, making it impractical.
- **Recommendation:** Accepted risk — fundamental limitation of userspace path checking. Docker isolation recommended for high-security deployments.

#### C-4. Terminal CWD Validation No Symlink Resolution — LOW
- **File:** `server/events/terminal.js` (lines 75-86)
- **Finding:** CWD validation uses `path.resolve()` without `realpathSync()`. Documented as best-effort (comment on line 88).
- **Recommendation:** Accepted risk — terminal commands can already access any file via absolute paths.

#### C-5. `resolve(relativePath).startsWith('..')` is Dead Code — INFO
- **Files:** `server/lib/folders.js`, `server/events/get-recent-sessions.js`, `server/lib/projects.js`
- **Finding:** `path.resolve()` on a relative path always produces an absolute path which never starts with `..`. The check is always false.
- **Recommendation:** Remove for code clarity.

#### C-6. `browse_folder` No `homedir()` Bounding in Non-rootPath Mode — INFO
- **File:** `server/lib/folders.js`
- **Finding:** Without `--root`, `browseFolderContents()` can browse any directory. The newer `files:browse` handler restricts to `homedir()`. Inconsistency is by design (Projects view needs broader access for manually configured projects).
- **Recommendation:** Document the inconsistency.

#### C-7. Client-Side Root Guard is Advisory Only — INFO (Correct Design)
- **File:** `src/composables/useFilesManager.js`
- **Finding:** Client-side `filesRootPath` is a UX boundary, not a security boundary. Server-side `validatePath()` is authoritative.

---

### D. WebSocket & HTTP Endpoints

#### D-1. No Rate Limiting on Login Endpoint — MEDIUM
- **File:** `server/index.js` (lines 245-273)
- **Finding:** `/api/auth/login` has no rate limiting or account lockout. Unlimited brute-force attempts against the password are possible.
- **Recommendation:** Add rate limiting (e.g., 5 attempts/minute per IP with exponential backoff).

#### D-2. No Rate Limiting on WebSocket Messages — MEDIUM
- **File:** `server/websocket.js`
- **Finding:** No per-client rate limiting on WebSocket messages. Rapid `terminal:exec`, `files:search`, or `prompt` messages could exhaust server resources or Notion API rate limits. The per-session message queue cap of 50 (`MAX_QUEUE_SIZE`) provides some protection.
- **Recommendation:** Implement per-client sliding window rate limiter. Consider per-handler limits for expensive operations.

#### D-3. Error Information Leakage Across Multiple Handlers — LOW
- **Files:** Multiple (see table below)
- **Finding:** Raw `err.message` is sent to clients without sanitization in many handlers. Well-handled exceptions: `files:*` (uses `safeError()`), WebSocket router (generic message), upload route (sanitizes).

| Handler | File | Lines |
|---|---|---|
| `prompt` | `server/events/prompt.js` | 305-307, 313 |
| `files:search` | `server/events/search-files.js` | 364 |
| `git_clone` | `server/events/git-clone.js` | 216 |
| `select_session` | `server/events/select-session.js` | 111 |
| `load_older_messages` | `server/events/load-older-messages.js` | 68 |
| `get_git_diff` | `server/events/get-git-diff.js` | 156 |
| `tasks:*` (all handlers) | `server/events/tasks.js` | 106,145,186,236,270,302,338,377,411 |
| `notion:*` | `server/events/notion.js` | 36,75,111,168 |
| `auth/setup` | `server/index.js` | 237 |

- **Recommendation:** Create a shared error sanitizer and apply across all handlers.

#### D-4. No CSP Header — LOW
- **File:** `server/index.js` (lines 161-168)
- **Finding:** Baseline security headers are set (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) but `Content-Security-Policy` is missing. Would help prevent XSS in the served frontend.
- **Recommendation:** Add CSP header. Consider HSTS for HTTPS deployments.

#### D-5. `terminal:kill` Signal Not Validated — LOW
- **File:** `server/events/terminal.js` (lines 157-211)
- **Finding:** The `signal` parameter is passed directly to `process.kill()` without validation against a whitelist. Node.js validates internally but explicit validation is better defense-in-depth.
- **Recommendation:** Validate against `['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']`.

#### D-6. `update_settings` Accepts Arbitrary Keys — LOW
- **File:** `server/events/update-settings.js`
- **Finding:** No validation of settings object shape. Arbitrary JSON keys can be written to `~/.tofucode/settings.json`.
- **Recommendation:** Validate against expected schema with known keys.

#### D-7. `set_session_title` Has No Length Limit — LOW
- **File:** `server/events/set-session-title.js`
- **Finding:** No length validation on title string. Vue's `{{ }}` interpolation auto-escapes HTML (no XSS), but unbounded titles could cause UI issues.
- **Recommendation:** Add length limit (e.g., 200 characters).

#### D-8. `/api/sw-reset` Unauthenticated — INFO (By Design)
- **File:** `server/index.js` (lines 317-333)
- **Finding:** Serves static HTML that clears service workers and caches. Intentionally unauthenticated — needed to bust stale SW that prevents loading the login page. No server state is read or modified. `Cache-Control: no-store` is set correctly.

#### D-9. `/api/health` Version Disclosure — INFO
- **File:** `server/index.js` (lines 187-193)
- **Finding:** Unauthenticated health check exposes application version. Standard practice; aids targeted attacks if publicly exposed.

#### D-10. WebSocket Upgrade Handler — INFO (Well Protected)
- Origin validation prevents CSWSH, session cookie auth enforced, 1MB `maxPayload` limit.

#### D-11. Session ID Validation — INFO (Well Protected)
- All handlers validate session IDs against strict UUID regex. Prevents path traversal via crafted session IDs.

---

### E. Discord Bot

#### E-1. Root Path Validation — INFO (Well Protected)
- **Files:** `server/discord/commands/setup.js` (line 56), `server/discord/lib/executor.js` (line 50)
- **Finding:** Both `setup.js` and `executor.js` validate project paths against `config.rootPath` using `path.resolve()` + `path.relative()` + `startsWith('..')`. Consistent with web UI validation.

#### E-2. Concurrent Task Guard — INFO (Well Protected)
- **File:** `server/discord/lib/executor.js` (lines 66-76)
- **Finding:** Prevents double-prompting on the same session. `threadLocks` Map in `messageCreate.js` provides per-thread serialization.

#### E-3. Error Message Sanitization — INFO (Well Protected)
- **File:** `server/discord/lib/executor.js` (lines 330-353)
- **Finding:** `mapApiError()` maps raw API errors to user-friendly text for all known error patterns. Unknown errors are prefixed with `Error:` but still include raw message — consistent with other handlers.

#### E-4. Bot Token Only From Environment — INFO (No Issue)
- `DISCORD_BOT_TOKEN` is read exclusively from `process.env`. Channel/session mapping files (`discord-channels.json`, `discord-sessions.json`) contain no sensitive tokens.

---

### F. Miscellaneous

#### F-1. `~/.tofucode/.auth.json` Permissions — LOW
- **Observed:** `-rw-r--r--` (644)
- **Finding:** Authentication data file is world-readable. Contains session hashes and password hash.
- **Recommendation:** Write with `{ mode: 0o600 }`.

#### F-2. `slack-config.json` Residual File — INFO
- **Finding:** `~/.tofucode/slack-config.json` still exists on disk from the removed Slack integration. The code no longer reads or writes this file. No runtime impact.
- **Recommendation:** Document for users to clean up manually if desired.

#### F-3. `ALLOW_SOURCE_UPGRADE` Log Residual — INFO
- **File:** `server/lib/restart.js` (line 141)
- **Finding:** Still logs the `ALLOW_SOURCE_UPGRADE` environment variable value. Harmless — reads from `process.env` and the feature is functional.

#### F-4. Brotli Pre-Compression Serving — INFO (No Issue)
- **File:** `server/index.js` (line 349)
- **Finding:** `express-static-gzip` serves `.br` and `.gz` files from the build directory. Static files only, behind authentication. No security concern.

---

## Previously Reported Issues — Status

| Issue | Version | Status |
|---|---|---|
| DOMPurify XSS (Moderate) | v1.2.1 | ✅ Fixed — updated to 3.3.2 |
| Multer DoS (High) | v1.2.1 | ✅ Fixed — updated to 2.1.1 |
| serialize-javascript RCE (High) | v1.2.1 | ⚠️ Accepted — build-time only |
| undici resource exhaustion (Moderate) | v1.2.1 | ⚠️ Accepted — escalated to High aggregate (5 CVEs) |
| `validatePath` symlink resolution | v1.2.0 | ✅ Fix remains in place |
| CSWSH origin validation | v1.2.0 | ✅ Fix remains in place |
| Source map blocking | v1.2.0 | ✅ Fix remains in place |

---

## Positive Security Observations

1. **`validatePath()` is robust** — resolves symlinks via `realpathSync()`, handles non-existent paths via parent fallback, enforces `homedir()` or `--root` boundaries
2. **WebSocket authentication enforced** — Origin validation + session cookie on upgrade, 1MB payload limit
3. **Session ID format validation** — strict UUID regex across all handlers prevents path traversal
4. **DOMPurify sanitization** — `renderMarkdown()` in `src/utils/markdown.js` sanitizes HTML; `javascript:` protocol blocked in links
5. **File upload double-validation** — both `destPath` and `finalPath` validated; filename sanitized with `path.basename()`
6. **MCP config comprehensive validation** — name, scope, shell injection, URL protocol, env var names, OAuth credential isolation
7. **Git clone shell injection protection** — URL quoting via `JSON.stringify()`, unsafe chars regex, SSH key path validation
8. **Draft persistence bounded** — 100KB max draft size, 100 entries max per project with LRU eviction
9. **`slugToPath` DoS protection** — `MAX_SLUG_PARTS = 30`, `MAX_SPAN_SIZE = 8` prevent exponential recursion
10. **Notion token masking** — `getMaskedNotionConfig()` masks all but last 4 chars; round-trip protection prevents overwrite with masked value

---

## Conclusion

No Critical vulnerabilities found. Two High-severity dependency issues carried forward as accepted risk (build-time only `serialize-javascript` and opt-in Discord-only `undici`). Six Medium findings identified — the most impactful are the login rate limiting gap (D-1), the iframe sandbox escape in HTML preview (A-2), and the Notion config file permissions (B-1). The codebase demonstrates strong security practices in path validation, WebSocket authentication, and input sanitization across most handlers. Error message leakage is the most widespread pattern to address. The application is approved for v1.3.0 release with the documented accepted risks.

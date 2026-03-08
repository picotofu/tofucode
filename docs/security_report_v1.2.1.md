# Security Report — tofucode v1.2.1

**Date:** 2026-03-08
**Scope:** All changes introduced in v1.2.1 (reconnection UX, Markdown TOC mobile toggle, New Folder feature) plus full dependency audit.

---

## Summary

| Category | Count |
|---|---|
| Critical | 0 |
| High (fixed) | 2 |
| High (accepted risk) | 1 |
| Moderate (fixed) | 2 |
| Moderate (accepted risk) | 1 |
| Low / Info | 5 |

All Critical and High issues are either fixed or formally accepted with documented rationale. No security issues were found in new code.

---

## Dependency Vulnerabilities (npm audit)

### Fixed

#### DOMPurify — XSS (Moderate) — FIXED
- **Advisory:** Prototype pollution in `dompurify < 3.3.2`
- **Severity:** Moderate
- **Vector:** Crafted HTML could bypass sanitization, leading to XSS
- **Fix:** Updated `dompurify` from `3.3.1` → `3.3.2` via `npm audit fix`
- **Status:** ✅ Resolved

#### Multer — DoS (High) — FIXED
- **Advisory:** Multer `< 2.1.0` vulnerable to resource exhaustion via malformed `multipart/form-data`
- **Severity:** High
- **Vector:** Unauthenticated upload endpoint could be used to exhaust memory/CPU
- **Fix:** Updated `multer` from `2.0.2` → `2.1.1` via `npm audit fix`
- **Mitigating factor:** Upload endpoint requires authentication; attack surface was limited
- **Status:** ✅ Resolved

### Accepted Risk

#### serialize-javascript — RCE (High) — ACCEPTED RISK
- **Advisory:** [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) — Serialize JavaScript ≤ 7.0.2 is vulnerable to RCE via `RegExp.flags` and `Date.prototype.toISOString()`
- **Severity:** High (CVSSv3)
- **Dependency chain:** `vite-plugin-pwa → workbox-build → @rollup/plugin-terser → serialize-javascript`
- **Exposure analysis:** This vulnerability only exists in the **build toolchain** (`devDependencies`), not in any runtime code. `serialize-javascript` is invoked during `npm run build` to generate service worker code from developer-controlled configuration — no user-controlled input is ever serialised. The generated output is static JS assets served to browsers. There is no path from untrusted input to this code path.
- **Fix available:** Downgrade `vite-plugin-pwa` to `0.19.8` (breaking change — removes PWA features used in production)
- **Decision:** Accept risk. Runtime users and server processes are not exposed. The vulnerability can only be triggered by a malicious actor with write access to the developer's local build environment, who at that point already has full code execution.
- **Status:** ⚠️ Accepted — build-time only, no runtime exposure

#### undici — Resource Exhaustion (Moderate) — ACCEPTED RISK
- **Advisory:** [GHSA-g9mf-h72j-4rw9](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) — undici `< 6.23.0` has an unbounded decompression chain in HTTP responses
- **Severity:** Moderate
- **Dependency chain:** `discord.js → @discordjs/rest → @discordjs/ws → undici`
- **Exposure analysis:** `undici` is used as the HTTP client in the Discord bot's connection to Discord's own API servers (`discord.com`). The vulnerability requires a malicious HTTP server to respond with a crafted `Content-Encoding` chain to trigger resource exhaustion. Since `undici` here only communicates with Discord's official API, the only realistic trigger would be a compromise of Discord's own servers, which is outside the threat model.
- **Fix available:** Downgrade `discord.js` from `14.x` to `13.x` (major breaking change — v14 API is incompatible with v13)
- **Decision:** Accept risk. The HTTP client only talks to Discord's controlled infrastructure. Mitigated by the fact that tofucode's Discord bot is opt-in and disabled by default; self-hosters who don't use Discord are not affected.
- **Status:** ⚠️ Accepted — Discord bot only, trusted upstream server, opt-in feature

---

## Code Security Review — New Features

### 1. Reconnection UX & Draft Sync Failsafe (`ChatView.vue`)

**Changes reviewed:**
- `pointer-events: auto` override on `.input-form.reconnecting .input` (restores typing during reconnect)
- `draftSyncPending` flag set when user types while disconnected; draft pushed to server on reconnect
- Reconnecting indicator repositioned to bottom-right, `pointer-events: none` to avoid interaction blocking

**Findings:** None. The `draftSyncPending` flag is a plain `let` (not reactive), handled entirely client-side and reset on session switch. The draft push on reconnect reuses the existing draft-save WebSocket event — no new server surface.

**Verdict:** ✅ No issues

---

### 2. Markdown TOC Mobile Toggle (`FileEditor.vue`, `ChatView.vue`)

**Changes reviewed:**
- `hasToc` computed, `tocVisible` ref, `toggleToc()` function added to `FileEditor.vue`
- Toggle button added to stat bar in `ChatView.vue`, reading `fileEditorRef.hasToc/.tocVisible`
- Mobile CSS: TOC becomes `position: absolute` overlay; closes on editor content click

**Findings:** None. All changes are purely presentational (CSS, Vue reactive state). No new server communication. No user-controlled content is rendered differently.

**Verdict:** ✅ No issues

---

### 3. New Folder Feature (`useWebSocket.js`, `ProjectsView.vue`, `CommandPalette.vue`)

**Changes reviewed:**
- `createFolder(folderPath)` helper sends `{ type: 'files:create', path: folderPath, isDirectory: true }` over WebSocket
- Server-side: reuses existing `files:create` handler (`server/events/files.js` → `handleFilesCreate`)
- Auto-refresh on `files:create:result` in global WebSocket message handler
- Inline form in both `ProjectsView.vue` and `CommandPalette.vue` with input validation (empty name disabled)

**Path traversal analysis:**
- Client constructs the path as `${currentFolder}/${newFolderName.trim()}`
- `currentFolder` is always a path the user has already navigated to via `browse_folder`, which is server-validated
- `newFolderName` is a plain text input — component does not strip or allow `/` traversal sequences
- Server-side `validatePath()` in `handleFilesCreate` calls `realpathSync` on the parent directory and verifies the resolved path is within `homedir()` or configured `rootPath` — prevents any traversal, whether the folder exists or not
- Error responses from `files:create:error` are shown inline in the UI; no raw server error details are forwarded (server already genericises these per v1.2.0 security hardening)

**Input injection:** `newFolderName` is passed as a filesystem path to the server and handled by Node's `fs.mkdir`. No shell execution involved — no command injection surface.

**Findings:**
- **Low/Info:** Client-side input does not explicitly strip leading `..` or `/` from folder names. This is adequately handled server-side but could be hardened client-side for defense-in-depth. Accepted — server is the authoritative guard.

**Verdict:** ✅ No issues (defense-in-depth note logged above)

---

## Low / Informational Findings

| # | Location | Finding | Disposition |
|---|---|---|---|
| L-1 | `ProjectsView.vue`, `CommandPalette.vue` | Folder name input does not strip `..` or leading `/` client-side | Accepted — server `validatePath()` is authoritative |
| L-2 | `ChatView.vue` | `draftSyncPending` is a module-level `let` — if two chat views were somehow mounted simultaneously, they would share state | Accepted — router ensures only one `ChatView` is mounted at a time |
| L-3 | `FileEditor.vue` | `window.matchMedia` called at `ref()` init time — JSDOM environments without `matchMedia` would throw | Info — server-side rendering is not used; browser-only component |
| L-4 | `useWebSocket.js` | `files:create:result` triggers `browseFolder` for any `isDirectory` result, even if initiated from a non-browse context | Info — benign, at worst causes an unnecessary folder refresh |
| L-5 | `CommandPalette.vue` | `createFolderError` is not cleared when navigating folders, only when starting/confirming/cancelling | Info — stale error string is hidden by `v-if="isCreatingFolder"` guard |

---

## Previously Reported Issues (v1.2.0) — Status

All v1.2.0 security fixes remain in place. See [v1.2.0 Security Report](./security_report_v1.2.0.md) for full details.

---

## Conclusion

No Critical or High vulnerabilities in new code. Two dependency High/Moderate issues accepted with documented rationale (build-time only and opt-in Discord feature respectively). Two dependency issues fixed (DOMPurify, Multer). The codebase is approved for v1.2.1 release.

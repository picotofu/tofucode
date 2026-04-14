# Security Report — tofucode v1.4.0

**Date:** 2026-04-14
**Scope:** Security audit of all code since v1.3.0 — Kanban board view with drag-and-drop, task delete (Notion archive), board footer filters (search, assignee, label), add new labels from task view, pill-based label/status selection, column ordering settings, and dependency audit.

---

## Summary

| Category | Count |
|---|---|
| Critical | 0 |
| High (accepted risk) | 2 |
| Medium | 3 |
| Low | 5 |
| Info | 6 |

All Critical and High issues are either fixed or formally accepted with documented rationale.

---

## Dependency Vulnerabilities (npm audit)

### Fixed (via `npm audit fix`)

| Package | Severity | Advisory | Fix |
|---|---|---|---|
| `lodash` | High | Prototype pollution | Updated to safe version |
| `undici` | High | Multiple CVEs (fetch redirect leak, UTF-8 bypass) | Updated to safe version |
| `vite` | High | Server-side request forgery | Updated to safe version |

### Accepted Risk

#### serialize-javascript — RCE + DoS (High) — ACCEPTED RISK
- **Advisories:** [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) (RCE via `RegExp.flags`), [GHSA-qj8w-gfj5-8c6v](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v) (CPU exhaustion DoS)
- **Severity:** High (CVSSv3)
- **Dependency chain:** `vite-plugin-pwa → workbox-build → @rollup/plugin-terser → serialize-javascript <=7.0.4`
- **Exposure analysis:** Build toolchain only (`devDependencies`). `serialize-javascript` runs during `npm run build` to generate service worker code from developer-controlled configuration. No user-controlled input is ever serialised. No runtime exposure.
- **Fix available:** Requires breaking change — `npm audit fix --force` would downgrade `vite-plugin-pwa` to `0.19.8`
- **Status:** ⚠️ Accepted — build-time only, no runtime exposure (carried forward from v1.3.0)

#### undici (Discord.js) — Multiple CVEs (High) — ACCEPTED RISK
- **Severity:** High (aggregate)
- **Dependency chain:** `discord.js → @discordjs/rest → @discordjs/ws → undici`
- **Exposure analysis:** `undici` is used exclusively by the Discord bot's HTTP client communicating with Discord's official API servers. The vulnerabilities require a malicious HTTP/WebSocket server, which would mean Discord's own infrastructure is compromised — outside our threat model. The Discord bot is opt-in (`DISCORD_ENABLED=true`) and disabled by default.
- **Status:** ⚠️ Accepted — Discord bot only, trusted upstream, opt-in feature (carried forward from v1.3.0)

---

## Code Security Review — New Features

### A. Task Delete (Notion Archive)

#### A-1. Delete Handler Input Validation — MEDIUM (Carried Forward)
- **File:** `server/events/tasks.js` (`handleDeleteTask`)
- **Finding:** `pageId` is checked for truthiness only — no UUID format validation. The value flows into `api.call('PATCH', \`/pages/${pageId}\`, { archived: true })`. An authenticated client could send arbitrary strings as `pageId`, which are interpolated into the Notion API URL path. Notion rejects non-UUID values, but server-side format validation is defense-in-depth.
- **Impact:** Low — Notion API rejects malformed IDs. No filesystem or local resource access.
- **Recommendation:** Validate `pageId` matches `/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i` at the handler level. This applies to all task handlers that accept `pageId` (carried forward from v1.3.0 finding B-5).

#### A-2. Delete Has No Rate Limiting — LOW
- **File:** `server/events/tasks.js` (`handleDeleteTask`)
- **Finding:** No per-client rate limit on `tasks:delete`. A malicious authenticated client could rapidly send delete messages to archive many Notion pages. Notion's own rate limits (~3 req/s) provide partial mitigation.
- **Impact:** Notion API quota exhaustion, bulk page archival.
- **Recommendation:** Consider per-client cooldown for destructive operations (e.g., max 10 deletes/minute).

#### A-3. Delete Error Messages Expose Notion API Details — LOW (Carried Forward)
- **File:** `server/events/tasks.js` (line 539)
- **Finding:** `err.message` sent directly to client. `NotionAPIError` includes API path and status code, exposing Notion database IDs. Carried forward from v1.3.0 finding B-3.
- **Recommendation:** Sanitize error messages before sending to client.

---

### B. Kanban Board View

#### B-1. Board Task List Bypasses Assignee Filter (By Design) — INFO
- **File:** `server/events/tasks.js` (`handleListBoardTasks`)
- **Finding:** When `filterByAssignee` is `'__all__'` or empty, the board fetches up to 100 tasks without assignee filtering. This is by design — the board view shows all team tasks for visibility. The data fetched is limited to task metadata (title, status, labels, assignee, ticket ID).
- **Impact:** None — all data is already accessible via the Notion workspace.

#### B-2. Optimistic UI Update on Drag-Drop — INFO
- **File:** `src/views/BoardView.vue`
- **Finding:** When a task is dragged to a new column, the status is updated locally before server confirmation. If the server update fails, the card reverts to its original position. Error handling is implemented correctly — the original status is restored on failure.
- **Impact:** No security concern. Brief UI inconsistency on failure, which self-corrects.

#### B-3. Context Menu XSS — INFO (No Issue)
- **File:** `src/views/BoardView.vue`
- **Finding:** The context menu is rendered via Vue template with `{{ }}` interpolation. No `v-html` is used. Task titles and labels are HTML-escaped by Vue. The context menu is Teleported to `<body>` for z-index correctness, but this does not change the escaping behavior.
- **Impact:** No XSS risk.

#### B-4. Board Search is Client-Side Only — INFO (No Issue)
- **File:** `src/views/BoardView.vue`
- **Finding:** The fuzzy search in the board footer filters the in-memory task list. No search query is sent to the server. No injection vector.

---

### C. Add Label from Task View

#### C-1. No Input Length Limit on New Label Name — MEDIUM
- **File:** `server/events/tasks.js` (`handleAddOption`, line 459-466)
- **Finding:** `optionName` is trimmed but has no length limit. Notion multi_select option names have a 100-character limit enforced by their API, but the server builds and sends the request before Notion rejects it. This also applies to the Notion database schema update call (`updateDatabase`), which sends the option name to the `PATCH /databases/{id}` endpoint.
- **Impact:** Resource waste on oversized API calls. Notion API provides the ultimate enforcement.
- **Recommendation:** Cap `optionName` to 100 characters at the handler level.

#### C-2. addSelectOption Properly Restricts Field Types — INFO (No Issue)
- **File:** `server/lib/task-providers/notion.js` (`addSelectOption`)
- **Finding:** The method validates that `fieldType` is `select` or `multi_select` before making the API call. Attempting to use this for `status` or other field types returns an error without calling the API.

---

### D. Board Footer Filters & Settings

#### D-1. getComments URL Parameter Injection — MEDIUM (Carried Forward)
- **File:** `server/lib/task-providers/notion.js` (line 1204)
- **Finding:** `pageId` is interpolated directly into a query string: `` `/comments?block_id=${pageId}` ``. A crafted `pageId` with `&` could inject additional query parameters. Notion would likely reject the malformed request, but this is a defense-in-depth gap. Carried forward from v1.3.0.
- **Recommendation:** Use `URLSearchParams` for query string construction.

#### D-2. boardColumnOrder Config Passthrough — INFO (No Issue)
- **File:** `server/events/notion.js` (`handleSaveConfig`)
- **Finding:** `boardColumnOrder` is passed through from the incoming config with `?? existing.boardColumnOrder ?? []`. The value is an array of strings (status option names) that is JSON-serialized to disk. No injection vector — values are never interpolated into API calls or file paths.

#### D-3. Board Filter Persistence — INFO (No Issue)
- **File:** `src/composables/useWebSocket.js`
- **Finding:** Board filter state (`assignee`, `label`) is persisted to `localStorage` under `tofucode:board-filter`. Loading wraps `JSON.parse` in try/catch with fallback defaults. Values are simple strings that do not flow into dangerous sinks.

---

### E. Delete Loading UX

#### E-1. Multiple Concurrent Deletes Handled Correctly — LOW
- **File:** `src/views/BoardView.vue`
- **Finding:** `deletingIds` uses a `Set` ref with immutable swap pattern (`new Set()`) for Vue reactivity. Multiple cards can be in the deleting state simultaneously. The `onMessage` handler correctly matches `pageId` to remove from the set on completion. However, if the WebSocket disconnects during a delete, the card remains greyed out indefinitely until page refresh.
- **Recommendation:** Consider a timeout that restores the card if no response is received within a reasonable window (e.g., 30 seconds).

#### E-2. Error Modal Content — LOW
- **Files:** `src/views/BoardView.vue`, `src/views/TaskView.vue`
- **Finding:** Delete error modals display the error message from the server response (`msg.error`). As noted in A-3, this may include Notion API internals. The error is rendered via `{{ }}` interpolation (XSS-safe), but the content may confuse end users.
- **Recommendation:** Display a user-friendly message with the raw error available in a collapsible detail section.

---

## Previously Reported Issues — Status

| Issue | Version | Status |
|---|---|---|
| serialize-javascript RCE (High) | v1.2.1 | ⚠️ Accepted — build-time only |
| undici CVEs - Discord (High) | v1.2.1 | ⚠️ Accepted — opt-in, trusted upstream |
| lodash prototype pollution (High) | v1.4.0 | ✅ Fixed via `npm audit fix` |
| undici CVEs - root dep (High) | v1.4.0 | ✅ Fixed via `npm audit fix` |
| vite SSRF (High) | v1.4.0 | ✅ Fixed via `npm audit fix` |
| No `pageId` format validation | v1.3.0 | ⚠️ Carried forward (A-1) |
| Raw Notion errors sent to client | v1.3.0 | ⚠️ Carried forward (A-3) |
| No WS rate limiting | v1.3.0 | ⚠️ Carried forward (A-2) |
| `getComments` URL injection | v1.3.0 | ⚠️ Carried forward (D-1) |
| Notion config file permissions | v1.3.0 | ⚠️ Carried forward |
| DOMPurify XSS fix | v1.2.1 | ✅ Fix remains in place |
| Multer DoS fix | v1.2.1 | ✅ Fix remains in place |
| CSWSH origin validation | v1.2.0 | ✅ Fix remains in place |
| `validatePath` symlink resolution | v1.2.0 | ✅ Fix remains in place |

---

## Positive Security Observations

1. **No `v-html` in any new components** — All dynamic content uses `{{ }}` interpolation (XSS-safe)
2. **Delete is soft-delete (archive)** — Notion pages are archived, not permanently deleted; recoverable via Notion UI
3. **Two-tap delete confirmation on TaskView** — Prevents accidental single-click deletion with auto-disarm timeout
4. **Drag-drop uses native HTML5 API** — Zero external dependencies, no third-party script injection risk
5. **Board filter persistence uses simple JSON** — `try/catch` wrapped, fallback defaults, no eval or dynamic execution
6. **addSelectOption field type validation** — Restricts to `select`/`multi_select` only
7. **Token masking protection intact** — Round-trip save protection prevents masked token overwrite
8. **Error modal uses Teleport to body** — Proper z-index isolation without iframe or unsafe DOM manipulation
9. **WebSocket auth enforced on all new events** — `resolveContext()` validates session before all task operations
10. **Optimistic UI with rollback** — Board drag-drop restores original state on server failure

---

## Conclusion

No Critical vulnerabilities found. Two High-severity dependency issues carried forward as accepted risk (build-time only `serialize-javascript` and opt-in Discord-only `undici`). Three dependency vulnerabilities (lodash, undici root, vite) were fixed via `npm audit fix`. Three Medium findings identified — all are defense-in-depth improvements around input validation (pageId format, option name length, URL parameter construction) carried forward from v1.3.0. Five Low findings relate to rate limiting gaps, error message leakage, and minor UX concerns. The new kanban board, task delete, and label management features demonstrate good security practices with proper HTML escaping, soft-delete semantics, and WebSocket authentication enforcement. The application is approved for v1.4.0 release with the documented accepted risks.

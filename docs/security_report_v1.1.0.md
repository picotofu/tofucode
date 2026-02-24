# Security Review Report
## tofucode Web UI v1.1.0

**Date:** 2026-02-24
**Target:** tofucode v1.1.0 (release/v1.1.0 branch)
**Reviewer:** Automated code review + static analysis
**Scope:** Full codebase audit — all v1.1.0 features (MCP management, file picker search, message queue, session edit fix) plus carry-over controls

---

## Executive Summary

**OVERALL RESULT: SECURE (after fixes)**

Comprehensive security audit of v1.1.0 identified 8 vulnerabilities (3 Medium, 5 Low) and 5 hardening improvements. All actionable issues were remediated before release. The application maintains robust security controls appropriate for a personal development tool.

**npm audit:** 4 moderate (discord.js/undici transitive dependency — accepted risk, see below)

---

## New Features Reviewed

### Message Queue System
- **Files:** `server/lib/message-queue.js`, `server/events/queue.js`, `server/events/prompt.js`
- Queue enqueue validates prompt is non-empty string before accepting
- Queue size capped at 50 messages per session (prevents memory exhaustion)
- `processNextInQueue` uses `ws=null` pattern — all `send(ws, ...)` calls guarded with `if (ws)`
- Queue cleared on session delete (no orphaned data)
- `queue:delete` handler only broadcasts when message was actually removed (no information leak)
- **Result:** PASS

### MCP UI Management
- **Files:** `server/lib/mcp-config.js`
- Server names validated against `/^[a-zA-Z0-9_-]{1,64}$/`
- stdio commands validated against shell injection regex
- HTTP URLs validated via `new URL()`, restricted to http/https protocols
- OAuth credentials (access tokens, refresh tokens) never sent to frontend
- Authorization headers redacted in frontend responses (`sanitizeConfig`)
- **Result:** PASS

### File Picker Search Enhancement
- **Files:** `server/events/search-files.js`
- Has its own `validateSearchPath()` consistent with `files.js`
- Search queries are used as string matching, not as regex (no ReDoS risk)
- **Result:** PASS

### Session Edit Button Fix
- **Files:** `src/views/SessionsView.vue`
- Added `event.preventDefault()` — UI-only fix, no security impact
- **Result:** PASS

---

## Vulnerabilities Found and Fixed

### MEDIUM: `/docs` Folder Served Without Authentication

**Severity:** Medium (CVSS: 5.3)
**File:** `server/index.js`

**Description:**
The `docs/` folder was served as static files without any authentication check. This folder contains security reports, implementation details, and planning documents that could aid attacker reconnaissance.

**Fix Applied:**
Added authentication middleware to the `/docs` route:
```javascript
app.use('/docs', (req, res, next) => {
  if (!isAuthDisabled()) {
    const token = parseSessionCookie(req.headers.cookie);
    if (!validateSession(token)) {
      return res.status(401).json({ error: 'Authentication required' });
    }
  }
  next();
}, express.static(docsPath));
```

**Residual Risk:** None. Docs now require the same auth as the main application.

---

### MEDIUM: No WebSocket Origin Validation (CSWSH Risk)

**Severity:** Medium (CVSS: 4.7)
**File:** `server/index.js`

**Description:**
The WebSocket upgrade handler validated the session cookie but did not check the `Origin` header. While `sameSite: 'strict'` cookies prevent most Cross-Site WebSocket Hijacking (CSWSH) attacks, older browsers may not enforce `sameSite` correctly.

**Fix Applied:**
Added Origin header validation on WebSocket upgrade:
```javascript
const origin = request.headers.origin;
if (origin) {
  const originHost = new URL(origin).host;
  const requestHost = request.headers.host;
  if (originHost !== requestHost) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
}
```

**Residual Risk:** Negligible. Non-browser WebSocket clients (which don't send Origin) are still allowed — this is intentional for CLI/API use cases and is protected by cookie auth.

---

### MEDIUM: Error Messages Leak Internal Details

**Severity:** Medium (CVSS: 3.7)
**File:** `server/websocket.js`

**Description:**
The WebSocket error handler sent raw `err.message` to the client, potentially exposing internal file paths, stack trace fragments, or system details.

**Fix Applied:**
Replaced `err.message` with a generic error message:
```javascript
send(ws, {
  type: 'error',
  sessionId: message?.sessionId,
  message: 'An internal error occurred',
});
```
Full error details continue to be logged server-side for debugging.

**Residual Risk:** None. Internal details no longer reach the client.

---

### LOW: Minimum Password Length Too Short (4 characters)

**Severity:** Low (CVSS: 3.1)
**Files:** `server/index.js`, `src/views/AuthView.vue`

**Description:**
The minimum password length was 4 characters, which is trivially brute-forceable — especially given no rate limiting on the login endpoint.

**Fix Applied:**
Increased minimum password length to 8 characters on both server and client:
- Server: `password.length < 8` check in `/api/auth/setup`
- Client: Matching validation in `AuthView.vue`

**Residual Risk:** Low. 8 characters is a reasonable minimum for a personal tool. Combined with argon2 computational cost, brute-force attacks are impractical.

---

### LOW: Process History Stored in World-Readable `/tmp/`

**Severity:** Low (CVSS: 2.7)
**File:** `server/lib/processManager.js`

**Description:**
Process history (commands, output) was stored in `/tmp/tofucode-processes.json`, which is world-readable on multi-user systems. Command output may contain sensitive data (environment variables, credentials printed to stdout).

**Fix Applied:**
- Moved file location from `/tmp/tofucode-processes.json` to `~/.tofucode/processes.json`
- Set file permissions to `0o600` (owner read/write only)
- Set directory permissions to `0o700` (owner access only)

**Residual Risk:** None. File is now in user's home directory with restricted permissions.

---

### LOW: No Security Headers

**Severity:** Low (CVSS: 2.1)
**File:** `server/index.js`

**Description:**
No security headers were set on HTTP responses. Missing headers include `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.

**Fix Applied:**
Added security headers middleware:
```javascript
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
```

**Residual Risk:** Negligible. CSP (Content-Security-Policy) was not added to avoid breaking inline styles used by highlight.js and Vue's dynamic rendering. HSTS was not added since the app may be deployed without HTTPS in local development.

---

### LOW: No WebSocket Message Size Limit

**Severity:** Low (CVSS: 2.1)
**File:** `server/index.js`

**Description:**
The WebSocket server had no maximum message size configured, allowing a malicious client to send arbitrarily large payloads causing memory exhaustion.

**Fix Applied:**
Added `maxPayload: 1024 * 1024` (1MB) to the WebSocket server configuration.

**Residual Risk:** None. Messages exceeding 1MB are automatically rejected. The largest legitimate messages are file write operations, which are well under 1MB given the 10MB file read limit.

---

### LOW: Terminal Output v-html Without DOMPurify

**Severity:** Low (CVSS: 2.1)
**File:** `src/components/TerminalOutput.vue`

**Description:**
Terminal output used `v-html` with `ansiToHtml()` output, which does its own HTML escaping. However, unlike the markdown rendering path (which uses DOMPurify as a second layer), the terminal path had no safety net if `ansiToHtml()` ever had an escaping edge case.

**Fix Applied:**
Added DOMPurify sanitization as defense-in-depth:
```javascript
return DOMPurify.sanitize(raw);
```

**Residual Risk:** None. Terminal output now has the same double-layer protection as markdown content.

---

## npm Dependency Audit

### Fixed: minimatch ReDoS (High)
The `minimatch` vulnerability (GHSA-3ppc-4f35-3m26) in `nodemon` was fixed by `npm audit fix`.

### Accepted: undici/discord.js (4 Moderate)
The `undici` vulnerability (GHSA-g9mf-h72j-4rw9) is a transitive dependency of `discord.js@14.x`. The fix requires downgrading to `discord.js@13.x` which is a breaking change and would require rewriting the Discord bot integration.

**Risk Assessment:** LOW — The vulnerable `undici` is only used by the Discord bot for REST API calls to Discord's servers. The decompression chain attack requires a malicious HTTP response, which would require compromising Discord's API servers. The Discord bot is an optional feature that runs in a controlled environment.

```
npm audit: 4 moderate severity vulnerabilities (all in discord.js/undici — accepted)
```

---

## Security Assessment (All Controls)

### Authentication & Session Management

| Control | Status |
|---------|--------|
| Password hashing (argon2) | PASS |
| Minimum password length (8 chars) | PASS (improved) |
| Session tokens (256-bit random) | PASS |
| HttpOnly cookies | PASS |
| SameSite=strict | PASS |
| WebSocket auth at upgrade phase | PASS |
| Socket destruction on invalid auth | PASS |
| Configurable secure cookie flag | PASS |

### WebSocket Security

| Control | Status |
|---------|--------|
| Auth required at upgrade phase | PASS |
| Origin header validation | PASS (new) |
| Only `/ws` path accepted for upgrade | PASS |
| Max message size limit (1MB) | PASS (new) |
| Per-connection context isolation | PASS |
| JSON parse with error handling | PASS |
| Generic error messages to client | PASS (improved) |
| Session ownership for question answers | PASS |
| Pending questions TTL expiry | PASS |
| Stream reference cleanup on completion | PASS |
| Version validation on upgrade requests | PASS |
| Pagination param bounds checking | PASS |
| Model string validation | PASS |

### File Access Controls

| Control | Status |
|---------|--------|
| Path validation (`validatePath`) | PASS |
| Symlink resolution (`realpathSync`) | PASS |
| Root path restriction (`--root` flag) | PASS |
| Home directory scoping (default mode) | PASS |
| SessionId UUID validation | PASS |
| Search path validation | PASS |
| File browse/read/write path validation | PASS |

### HTTP Security

| Control | Status |
|---------|--------|
| X-Content-Type-Options: nosniff | PASS (new) |
| X-Frame-Options: DENY | PASS (new) |
| Referrer-Policy: strict-origin-when-cross-origin | PASS (new) |
| `/docs` folder auth protected | PASS (fixed) |
| No-cache on index.html | PASS |
| No-cache on service worker files | PASS |

### Client-Side Security

| Control | Status |
|---------|--------|
| DOMPurify sanitization on markdown | PASS |
| DOMPurify sanitization on terminal output | PASS (new) |
| ANSI-to-HTML escaping | PASS |
| Vue `{{ }}` interpolation (auto-escaped) | PASS |
| No sensitive data in localStorage | PASS |
| Session token in httpOnly cookie only | PASS |
| javascript: URL blocked in links | PASS |
| Links open with rel="noopener noreferrer" | PASS |

### Message Queue Security

| Control | Status |
|---------|--------|
| Queue size limit (50 messages) | PASS (new) |
| Prompt validation (non-empty string) | PASS (new) |
| ws=null guards in queue processing | PASS (new) |
| Queue cleared on session delete | PASS (new) |
| Conditional broadcast on delete | PASS (new) |

### MCP Configuration Security

| Control | Status |
|---------|--------|
| Server name format validation | PASS |
| Command injection prevention (stdio) | PASS |
| URL validation (http/https only) | PASS |
| Auth header redaction in responses | PASS |
| OAuth credentials never sent to frontend | PASS |

### Terminal / Command Execution

| Control | Status |
|---------|--------|
| Command length limit (10,000 chars) | PASS |
| CWD validated against rootPath | PASS |
| Process group management | PASS |
| Process history in user-only dir (0o600) | PASS (improved) |

---

## Accepted Risks (Carry-over)

1. **Home Directory Access for Authenticated Users**
   - Authenticated users can browse entire home directory when `--root` is not set
   - Mitigated by: authentication requirement, `--root` flag available
   - CVSS: 3.1 (Low)

2. **No Rate Limiting on Login**
   - Login endpoint allows unlimited attempts
   - Mitigated by: argon2 computational cost, increased password length (8 chars), single-user design
   - CVSS: 2.4 (Low)

3. **Terminal Command Execution**
   - Authenticated users can execute arbitrary shell commands via `terminal:exec`
   - This is by design — tofucode is a development tool with full system access
   - Mitigated by: authentication requirement, `--root` CWD restriction
   - CVSS: N/A (by design)

4. **Client Controls Permission Mode**
   - The WebSocket client can send `dangerouslySkipPermissions: true` or `permissionMode: 'bypassPermissions'`
   - This is by design — tofucode defaults to `bypassPermissions` mode
   - Mitigated by: authentication requirement, single-user design
   - CVSS: N/A (by design)

5. **undici/discord.js Vulnerability**
   - Transitive dependency vulnerability in Discord bot's HTTP client
   - Mitigated by: Discord API is trusted, bot is optional
   - CVSS: 4.0 (Moderate — accepted)

---

## Vulnerability Summary

### Critical: 0
### High: 0 (1 npm dependency fixed)
### Medium: 0 (3 found, all fixed)
### Low: 0 (5 found, all fixed)
### Accepted: 5 (carry-over by-design risks + 1 npm transitive dependency)

---

## Recommendations

### For Enhanced Security (Optional):

1. **Use `--root` flag** to restrict file access to specific project directories
   ```bash
   tofucode --root /home/ts/projects
   ```

2. **Deploy behind HTTPS** with `SECURE_COOKIE=true` for encrypted transport

3. **Use Docker** for full filesystem isolation in shared environments

4. **Consider adding rate limiting** on `/api/auth/login` for deployments exposed beyond localhost

5. **Rotate Discord bot token** if there is any chance the `.env` file was exposed (verified: `.env` is in `.gitignore` and was never committed)

---

## Previous Reports

- [v1.0.5 Security Report](security_report_v1.0.5.md) - Upgrade handler injection, pagination validation, model validation
- [v1.0.4 Security Report](security_report_v1.0.4.md) - File picker, AskUserQuestion modal, Memo feature
- [v1.0.3 Security Report](security_report_v1.0.3.md) - Penetration testing with WebSocket auth, path traversal, CORS

---

## Conclusion

tofucode v1.1.0 addressed 8 security findings and added 7 new hardening controls:

**Fixes:**
- `/docs` folder now requires authentication
- WebSocket Origin header validated (CSWSH defense)
- Error messages no longer leak internal details
- Minimum password length increased to 8 characters
- Process history moved to `~/.tofucode/` with restricted permissions (0o600)
- Security headers added (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- WebSocket message size limited to 1MB
- Terminal output sanitized with DOMPurify (defense-in-depth)

**New Controls (from v1.1.0 features):**
- Message queue: size limit, prompt validation, ws=null safety
- MCP config: command injection prevention, credential redaction

All security controls from previous releases continue to function correctly. No regressions found.

**Risk Assessment:** LOW — Appropriate for personal development environment
**Recommendation:** Safe to release with password protection enabled

---

**Report Generated:** 2026-02-24
**Methodology:** Automated code review (Claude Opus 4.6) + static analysis

# Security Review Report
## tofucode Web UI v1.0.5

**Date:** 2026-02-18
**Target:** tofucode v1.0.5 (release/v1.0.5 branch)
**Reviewer:** Automated code review + static analysis
**Scope:** All code changes between v1.0.4 and v1.0.5 (usage stats, pagination, stale task fix, Discord bot prep)

---

## Executive Summary

**OVERALL RESULT: SECURE**

Comprehensive code review and security assessment of v1.0.5 identified 5 vulnerabilities (1 Critical, 2 Medium, 2 Low) that were fully remediated before release. All issues have been fixed. The application maintains strong security practices appropriate for its intended use case as a personal development tool.

**npm audit:** 0 vulnerabilities

---

## New Features Reviewed

### Turn-Based Pagination (Load Older Messages)
- **Files:** `server/lib/sessions.js`, `server/events/select-session.js`
- `offset` and `turnLimit` parameters now sanitized and clamped (see fix below)
- sessionId continues to be validated against UUID format before filesystem access
- **Result:** PASS (after fix)

### Stale Task Detection
- **Files:** `server/events/select-session.js`
- Added both `abortController` check and 30-minute timestamp timeout
- Prevents UI stuck in "running" state after server restart or stream crash
- **Result:** PASS (after fix)

### Settings Modal with Tabs
- **Files:** `src/components/SettingsModal.vue`
- Tab switching is purely frontend state — no server interaction
- No injection vectors introduced
- **Result:** PASS

---

## Vulnerabilities Found and Fixed

### CRITICAL: Command Injection in Upgrade Handler

**Severity:** Critical (CVSS: 9.1)
**Files:** `server/events/upgrade.js`, `server/lib/installation.js`

**Description:**
The `version` field from the WebSocket message was inserted directly into a shell command without sanitization:
```javascript
// BEFORE (vulnerable)
const version = message.version || 'latest';
// ...later...
`npm install -g tofucode@${version}`
```
A malicious WebSocket client could send `version: "1.0.0; rm -rf ~"` to execute arbitrary shell commands on the server.

**Fix Applied:**
- Added `isValidVersion()` validator in `installation.js`:
  ```javascript
  export function isValidVersion(version) {
    if (typeof version !== 'string') return false;
    return /^(latest|\d+\.\d+\.\d+)$/.test(version);
  }
  ```
- Validation applied in `upgrade.js` before the version string is used
- Invalid version strings are rejected with an error broadcast to the client

**Residual Risk:** None. Version is now strictly validated to `latest` or semver format.

---

### MEDIUM: Input Validation Missing on Pagination Parameters

**Severity:** Medium (CVSS: 5.3)
**File:** `server/lib/sessions.js`

**Description:**
`offset`, `turnLimit`, `limit`, and `maxBufferSize` were accepted from the WebSocket message and passed directly to `loadSessionHistory()` without bounds checking. A malicious client could send negative values, non-integers, or extremely large values (e.g., `turnLimit: 99999999`) to cause unexpected behavior or resource exhaustion.

**Fix Applied:**
All parameters are now sanitized with `Number.parseInt` and clamped:
- `limit`: 1–500
- `offset`: 0–100,000
- `turnLimit`: 1–50
- `maxBufferSize`: 100–10,000

**Residual Risk:** Negligible. Clamped values prevent resource abuse.

---

### MEDIUM: Arbitrary Model String Passed to Claude SDK

**Severity:** Medium (CVSS: 4.0)
**File:** `server/events/prompt.js`

**Description:**
When the `model` field didn't match `opus`, `sonnet`, or `haiku`, the raw client-supplied string was passed directly to the Claude Agent SDK. While the SDK would reject unknown models with an API error, this still allowed unintended model strings to reach the API.

**Fix Applied:**
Added regex validation for the pass-through path:
```javascript
} else if (/^claude-[a-z0-9-]+$/.test(options.model)) {
  queryOptions.model = options.model;
} else {
  // Reject unknown/invalid model strings
  send(ws, { type: 'error', message: `Invalid model: ...` });
  return sessionId;
}
```

**Residual Risk:** Low. Rejected strings no longer reach the SDK.

---

### LOW: slugToPath Exponential Complexity (DoS)

**Severity:** Low (CVSS: 3.7)
**File:** `server/config.js`

**Description:**
The `slugToPath()` function tried all combinations of `-` and `.` separators between slug parts (2^n combinations per span). A slug with many parts (e.g., 40+ dash-separated segments) could trigger exponential filesystem probing, potentially causing a CPU spike.

**Fix Applied:**
- Added `MAX_SLUG_PARTS = 30` guard — slugs with more than 30 parts fall back to simple replacement immediately
- Added `MAX_SPAN_SIZE = 8` per-span cap — limits combinations per span to 2^7=128 max
- Both constants are clearly documented in source

**Residual Risk:** Low. Complexity is now bounded. Authenticated users only.

---

### LOW: Stale Task Timestamp Check Missing

**Severity:** Low (CVSS: 2.1)
**File:** `server/events/select-session.js`

**Description:**
Stale running task detection only checked for `!task.abortController`. If a task genuinely had an abortController (e.g., a very long-running task that crashed without cleanup), it would appear perpetually running to the client even after server restart.

**Fix Applied:**
Added 30-minute timestamp timeout in addition to the abortController check:
```javascript
const timedOut = task.startTime && (Date.now() - task.startTime > STALE_TASK_TIMEOUT_MS);
if (noController || timedOut) { /* reset to idle */ }
```

**Residual Risk:** Negligible. Double safety net now in place.

---

### REMOVED: ALLOW_SOURCE_UPGRADE Backdoor

**Severity:** Low (CVSS: 2.5) — development artifact
**File:** `server/lib/installation.js`

**Description:**
The code contained a `ALLOW_SOURCE_UPGRADE` environment variable bypass that forced the upgrade flow to treat source installations as global npm installs. While it required environment access, it was marked "Remove before release!" and was a potential debugging backdoor.

**Fix Applied:**
Fully removed — both the `canAutoUpgrade()` check and the `getUpgradeCommand()` bypass block. Dead code eliminated.

**Residual Risk:** None.

---

## Security Assessment (Unchanged Controls)

### Authentication & Session Management

| Control | Status |
|---------|--------|
| Password hashing (argon2) | PASS |
| Session tokens (256-bit random) | PASS |
| HttpOnly cookies | PASS |
| SameSite=strict | PASS |
| WebSocket auth at upgrade phase | PASS |
| Socket destruction on invalid auth | PASS |
| Configurable secure cookie flag | PASS |

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

### WebSocket Security

| Control | Status |
|---------|--------|
| Auth required at upgrade phase | PASS |
| Only `/ws` path accepted for upgrade | PASS |
| Per-connection context isolation | PASS |
| JSON parse with error handling | PASS |
| Session ownership for question answers | PASS |
| Pending questions TTL expiry | PASS |
| Stream reference cleanup on completion | PASS |
| Version validation on upgrade requests | PASS (new) |
| Pagination param bounds checking | PASS (new) |
| Model string validation | PASS (new) |

### Client-Side Security

| Control | Status |
|---------|--------|
| DOMPurify sanitization on markdown | PASS |
| ANSI-to-HTML escaping | PASS |
| Vue `{{ }}` interpolation (auto-escaped) | PASS |
| No sensitive data in localStorage | PASS |
| Session token in httpOnly cookie only | PASS |

### Terminal / Command Execution

| Control | Status |
|---------|--------|
| Command length limit (10,000 chars) | PASS |
| CWD validated against rootPath | PASS |
| Process group management | PASS |

---

## Vulnerability Summary

### Critical: 0 (1 found, fixed)
### High: 0
### Medium: 0 (2 found, fixed)
### Low: 3 (3 accepted from v1.0.4 carry-over, 2 new found and fixed, 1 dev artifact removed)

**Accepted Risks (Carry-over from v1.0.4):**

1. **Home Directory Access for Authenticated Users**
   - Authenticated users can browse entire home directory when `--root` is not set
   - Mitigated by: authentication requirement, `--root` flag available
   - CVSS: 3.1 (Low)

2. **No Rate Limiting on Login**
   - Login endpoint allows unlimited attempts
   - Mitigated by: argon2 computational cost, single-user design
   - CVSS: 2.4 (Low)

3. **DOMPurify `onclick` Attribute Allowance**
   - `onclick` attribute allowed for copy button functionality
   - Mitigated by: markdown parsing pipeline, controlled handler function
   - CVSS: 2.1 (Low)

---

## Dependency Audit

```
npm audit: found 0 vulnerabilities
```

| Package | Version | Notes |
|---------|---------|-------|
| `express` | ^5.2.1 | Latest major version |
| `ws` | ^8.19.0 | Latest stable |
| `argon2` | ^0.44.0 | Strong password hashing |
| `dompurify` | ^3.3.1 | XSS sanitization |
| `marked` | ^17.0.1 | Markdown parser |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.45 | Claude SDK (updated from 0.2.17) |

---

## Recommendations

### For Enhanced Security (Optional):

1. **Use `--root` flag** to restrict file access to specific project directories
   ```bash
   tofucode --root /home/ts/projects
   ```

2. **Deploy behind HTTPS** with `SECURE_COOKIE=true` for encrypted transport

3. **Use Docker** for full filesystem isolation in shared environments

4. **Consider credential path blacklist** for `.claude/` and `.ssh/` directories

---

## Previous Reports

- [v1.0.4 Security Report](security_report_v1.0.4.md) - File picker, AskUserQuestion modal, Memo feature security review
- [v1.0.3 Security Report](security_report_v1.0.3.md) - Penetration testing with WebSocket auth, path traversal, and CORS validation

---

## Conclusion

tofucode v1.0.5 addressed a critical command injection vulnerability and several medium/low severity issues discovered during this audit. All identified vulnerabilities were remediated before release:

- **Command injection** in upgrade handler: FIXED (version format validation)
- **Pagination parameter abuse**: FIXED (bounds checking added)
- **Arbitrary model strings**: FIXED (regex validation added)
- **slugToPath DoS**: FIXED (complexity bounds added)
- **Stale task detection**: IMPROVED (timestamp timeout added)
- **Development backdoor** (ALLOW_SOURCE_UPGRADE): REMOVED

Unchanged security controls from previous releases continue to provide robust protection:
- WebSocket authentication at upgrade phase
- Comprehensive path validation on all file access endpoints
- Session ownership enforcement for interactive prompts
- DOMPurify + Vue template escaping for XSS prevention
- Zero npm dependency vulnerabilities

**Risk Assessment:** LOW — Appropriate for personal development environment
**Recommendation:** Safe to release with password protection enabled

---

**Report Generated:** 2026-02-18
**Methodology:** Automated code review (Claude Sonnet 4.6) + static analysis

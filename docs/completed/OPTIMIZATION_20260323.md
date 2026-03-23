# First Page Load Optimization

**Date:** 2026-03-23
**Scope:** Frontend bundle, static asset serving, WebSocket initial payload, backend I/O

## Analysis Summary

Full page refresh to `/` currently loads a single 1,094 KB JS bundle (305 KB gzip), establishes 1 WebSocket connection, fires 1 blocking HTTP auth check + 8 WS messages (4 of which are duplicates), and never serves the pre-built Brotli files despite generating them.

## Optimizations

### 1. Route-Level Lazy Loading (Code Splitting)

- **Priority:** Critical
- **Impact:** ~60-70% less JS on first load
- **Effort:** Low

All 5 views are eagerly imported in `src/router/index.js`. ChatView alone pulls in tiny-markdown-editor, highlight.js (21 langs), marked, dompurify, tabulator-tables, diff, papaparse, plus ~15 sub-components. All parsed even on the home page.

**Fix:** Convert static imports to `() => import(...)` for all routes.

### 2. Serve Pre-Built Brotli via express-static-gzip

- **Priority:** Critical
- **Impact:** 18% smaller transfers + eliminate runtime compression CPU for static assets
- **Effort:** Low

`vite-plugin-compression2` generates `.br` and `.gz` files in `dist/assets/`, but the server uses `express.static()` + runtime `compression` middleware (gzip only, no Brotli). `express-static-gzip` is in `package.json` but never imported.

**Fix:** Use `express-static-gzip` for `dist/` static serving with Brotli preference. Keep `compression` middleware for dynamic responses (API, index.html fallback).

### 3. Vendor Chunk Splitting

- **Priority:** High
- **Impact:** Better repeat-visit caching — vendor code cached across deploys
- **Effort:** Low

All vendor libraries bundled into one chunk with app code. Any app change invalidates the entire 1 MB bundle.

**Fix:** Add `manualChunks` in `vite.config.js` to split vendor libs into stable chunks.

### 4. Deduplicate WebSocket Requests

- **Priority:** High
- **Impact:** 4 fewer redundant WS messages per page load
- **Effort:** Low

Both `Sidebar` and `ProjectsView` independently call `getProjects()` + `getRecentSessionsImmediate()` when the WS connects — 4 duplicate messages every load.

**Fix:** Deduplicate in the composable or coordinate between components.

### 5. Async FS in getProjectsList

- **Priority:** High
- **Impact:** Unblock Node event loop during initial data fetch
- **Effort:** Medium

`getProjectsList()` uses `readdirSync`, `readFileSync`, `statSync` extensively — blocks the event loop. Noticeable for users with many projects/sessions.

**Fix:** Convert to `fs/promises` with `Promise.all` for parallelism.

### 6. Source Maps in Production

- **Priority:** Medium
- **Impact:** Security + reduced stat overhead in static middleware
- **Effort:** Low

`dist/` contains 3.9 MB of `.map` files served to anyone opening devtools. Leaks source code.

**Fix:** Block `.map` files from being served, or disable sourcemaps in prod build.

### 7. Auth Check in WS Handshake

- **Priority:** Medium
- **Impact:** Eliminate 1 blocking HTTP round-trip before first render
- **Effort:** Medium

Router `beforeEach` guard does `await checkAuthStatus()` (HTTP fetch to `/api/auth/status`) before allowing navigation. Serial blocking call before any component renders.

**Fix:** Include auth status in the WS `connected` message, or perform the check in parallel with WS connection.

### ~~8. Cache index.html in Memory~~ — SKIPPED

Skipped. index.html is small, and we need it to always read fresh from disk so PWA asset hash updates propagate correctly on deploys.

### 9. Local Component Registration

- **Priority:** Low
- **Impact:** Minor chunk size improvement when combined with #1
- **Effort:** Low

`main.js` globally registers `AppHeader`, `MessageItem`, `ToolGroup` — included in the main bundle even when only used in ChatView.

**Fix:** Move to local registration in consuming components to enable code-split with their parent view.

## Already Well-Implemented

- Immutable caching for hashed assets (1y) ✅
- `no-cache` for index.html ✅
- `no-cache, no-store` for service worker files ✅
- WebSocket `perMessageDeflate` enabled ✅
- PWA with Workbox + Google Fonts runtime cache ✅
- Security headers ✅
- Selective highlight.js language imports (21, not full) ✅

## Results

**Before:** 1,094 KB raw / 305 KB gzip / 251 KB brotli (single monolithic JS bundle)

**After (initial load for `/`):**
- `index.js` — 35.2 KB br (app core, sidebar, composables)
- `vendor-vue.js` — 35.7 KB br (Vue + Vue Router, stable across deploys)
- `ProjectsView.js` — 3.8 KB br (route component)
- `AppHeader.js` — 0.8 KB br (header component)
- CSS total — ~10.5 KB br
- **Total: ~86 KB brotli (66% reduction)**

Heavy dependencies deferred to route navigation:
- `ChatView` chunk + deps — ~180 KB br (only on chat page)
- `vendor-tabulator` — 84 KB br (only on CSV editor)

## Status

| # | Optimization | Status |
|---|-------------|--------|
| 1 | Route-level lazy loading | Done |
| 2 | Pre-built Brotli serving | Done |
| 3 | Vendor chunk splitting | Done |
| 4 | Deduplicate WS requests | Done |
| 5 | Async FS in getProjectsList | Done |
| 6 | Source maps in production | Done |
| 7 | Auth check in WS handshake | Deferred — low impact (in-memory check, <5ms) |
| 8 | Cache index.html | Skipped — need fresh reads for PWA hash updates |
| 9 | Local component registration | Done |

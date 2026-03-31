# Port Table

## Objective

Add a Ports tab (⌘8) to the chat view alongside Chat/Terminal/Files. Shows all listening TCP ports, their owning process, and lets you kill a process.

## Questions Resolved

**1. REST API vs WebSocket?**

Stick with WebSocket.

- The WS connection is already open for the duration of a chat session — no overhead advantage to REST
- All existing tab features (terminal, files) use WS; mixing transports adds inconsistency
- The kill-then-refresh flow maps naturally to WS async response (send kill → receive result → re-fetch)
- No need to manage auth separately — WS session context is already established

**2. Load and auto-refresh only when tab is active?**

This is already solved by the `v-if` architecture.

- `PortsPanel` renders with `v-else-if="currentMode === 'ports'"` — same as all other non-chat panels
- `v-if` means the component **mounts when the tab opens** and **unmounts when you leave**
- `onMounted` starts the initial fetch + 5s interval; `onUnmounted` clears the interval
- No visibility tracking or extra gating needed — the lifecycle handles it naturally

## Plan

### New Files

**`server/events/ports.js`**
- `ports:list` — scans listening ports via `lsof -iTCP -sTCP:LISTEN -P -n`
  - Uses `execFile` (not `exec`) — no shell injection surface
  - Parses each line into `{ port, pid, process, address }`
  - Handles IPv6 (`[::]:8080` → address `[::]`, port `8080`)
  - Deduplicates by pid+port
  - Returns `ports:list:result { ports }` or `ports:list:error`
- `ports:kill` — kills a process by PID
  - Validates: PID must be a number and > 1 (guards init/kernel)
  - Uses `process.kill(pid, 'SIGTERM')`
  - Returns `ports:kill:result { pid }` or `ports:kill:error { pid, error }`

**`src/components/PortsPanel.vue`**
- Props: `send`, `onMessage`
- State: `ports` (array), `loading`, `error`, `killing` (Set of PIDs)
- `onMounted`: initial fetch + `setInterval(refresh, 5000)`
- `onUnmounted`: `clearInterval` + cleanup message listener
- Message handling:
  - `ports:list:result` → update `ports`, clear `loading`
  - `ports:list:error` → set `error`
  - `ports:kill:result` → remove PID from `killing`, call `refresh()`
  - `ports:kill:error` → remove PID from `killing`, set `error`
- Table (CSS Grid, 5 columns): Port | PID | Process | Address | Kill
  - Mono font for Port and PID
  - Kill button: icon-only, danger hover (rgba(239,68,68,0.08) + --error-color)
  - Header row: --text-secondary, 11px, weight 500
  - Data rows: --bg-secondary background
  - Empty state + error state messages
  - Manual refresh button in header

### Modified Files

**`server/events/index.js`**
- Import `handlePortsList`, `handlePortsKill` from `./ports.js`
- Register `'ports:list'` and `'ports:kill'` in `handlers`

**`src/views/ChatView.vue`** (6 targeted edits)
1. Mode comment: add `'ports'` to the type annotation
2. Keybinding: add `e.key === '8'` → `currentMode.value = 'ports'`
3. Import `PortsPanel`
4. Panel: `<PortsPanel v-else-if="currentMode === 'ports'" :send="send" :on-message="onMessage" />`
5. Tab button: after Files button, signal/wifi SVG icon + "Ports" label
6. URL sync (3 spots): add `'ports'` to allowed modes arrays and `else if` branch

**`src/components/SettingsModal.vue`**
- Add `{ keys: ['⌘/^', '8'], description: 'Switch to Ports tab' }` after the Files entry

## Status

- [x] `server/events/ports.js`
- [x] `src/components/PortsPanel.vue`
- [x] `server/events/index.js`
- [x] `src/views/ChatView.vue`
- [x] `src/components/SettingsModal.vue`
- [x] `npm run check` + `npm run build`

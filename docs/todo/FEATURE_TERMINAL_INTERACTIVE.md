# Feature Plan: Terminal Interactive Support

## Overview

Add stdin input support to the terminal feature, enabling users to interact with running processes that require input. This transforms the current output-only terminal into a fully interactive terminal capable of running programs like `nano`, `vim`, password prompts, and interactive installers.

---

## Current State

### What Works
- Command execution with real-time output streaming
- Stdout and stderr differentiation (colored output)
- Process management (spawn, kill, list)
- Interactive shell loading (`.zshrc`/`.bashrc` via `-i` flag)
- Command history with up/down arrows
- Active/History tabs for process organization
- Process state persistence across server restarts

### What Doesn't Work
- **No stdin support** - Cannot send input to running processes
- **Interactive programs fail** - `nano`, `vim`, `less`, `top`, etc. don't work
- **Prompts hang** - Programs waiting for input (passwords, confirmations) freeze
- **No terminal control codes** - No proper PTY, can't handle cursor movement or screen clearing
- **One-shot commands only** - Works great for `ls`, `cat`, `grep` but not interactive sessions

### Technical Details

**Current Process Spawning** (`server/lib/processManager.js` lines 152-163):
```javascript
const userShell = process.env.SHELL || '/bin/sh';
const proc = spawn(userShell, ['-i', '-c', command], {
  cwd,
  env: {
    ...process.env,
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
  },
  // stdio not explicitly set - defaults to ['pipe', 'pipe', 'pipe']
});
```

**Current Stdio Handling:**
- `stdin`: Pipe created but never written to
- `stdout`: Piped and streamed to frontend
- `stderr`: Piped and streamed to frontend

**Problem:** Basic pipes don't provide full terminal capabilities (no TTY, no control sequences, no proper line buffering).

---

## Solution Approaches

### Option A: PTY (Pseudo-Terminal) - Full Terminal Emulation

**Recommended for:** Interactive programs like `nano`, `vim`, `python` REPL, `ssh` sessions

**Implementation:** Use `node-pty` library

**Pros:**
- Full terminal emulation with TTY
- Handles all control sequences (cursor movement, colors, etc.)
- Works with programs that check `isatty()`
- Proper line buffering and canonical mode
- Terminal size negotiation

**Cons:**
- Additional dependency (~500KB)
- More complex to implement
- Requires native bindings (may have installation issues)
- Overkill for simple stdin needs

**When to use:**
- If you want to support `vim`, `nano`, `emacs`, etc.
- If you need proper terminal control sequences
- If programs refuse to run without a TTY

---

### Option B: Simple stdin Piping - Basic Input

**Recommended for:** Simple prompts, confirmations, password inputs

**Implementation:** Use existing `spawn()` with explicit stdin handling

**Pros:**
- No additional dependencies
- Simple to implement
- Works for 80% of use cases (confirmations, passwords, simple input)
- Lightweight

**Cons:**
- Won't work with programs that require TTY (`nano`, `vim`, etc.)
- No terminal control sequence support
- Line buffering may behave differently
- Some programs detect non-TTY and change behavior

**When to use:**
- If you only need basic stdin (passwords, confirmations, text input)
- If you want to keep implementation simple
- If you're okay with saying "advanced editors not supported"

---

## Implementation: Option B (Simple stdin Piping)

Starting with the simpler approach. Can upgrade to PTY later if needed.

### 1. Server-Side stdin Handling

#### 1.1 Modify Process Manager

**File:** `server/lib/processManager.js`

Update spawn options to explicitly configure stdio:

```javascript
// Lines 152-165 (current spawn call)
const proc = spawn(userShell, ['-i', '-c', command], {
  cwd,
  env: {
    ...process.env,
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
  },
  stdio: ['pipe', 'pipe', 'pipe'], // Explicitly set stdin, stdout, stderr as pipes
});

// NEW: Store stdin reference for later writing
entry.proc = proc;
entry.stdin = proc.stdin;  // Keep reference to stdin stream
```

Add method to send input to process:

```javascript
/**
 * Send input to a running process
 * @param {string} processId - Process ID
 * @param {string} data - Input data to send
 * @returns {boolean} Success
 */
export function sendInput(processId, data) {
  const entry = getProcessById(processId);
  if (!entry) {
    console.error(`Process ${processId} not found`);
    return false;
  }

  if (!entry.proc || !entry.stdin) {
    console.error(`Process ${processId} has no stdin`);
    return false;
  }

  if (entry.status !== 'running') {
    console.error(`Process ${processId} is not running`);
    return false;
  }

  try {
    // Write data to stdin
    entry.stdin.write(data);

    // Log for debugging
    console.log(`Sent ${data.length} bytes to process ${processId}`);

    return true;
  } catch (error) {
    console.error(`Failed to send input to process ${processId}:`, error.message);
    return false;
  }
}
```

Handle stdin pipe errors:

```javascript
// Add after proc.stdout.on('data', ...) and proc.stderr.on('data', ...)
proc.stdin.on('error', (error) => {
  console.error(`stdin error for process ${entry.id}:`, error.message);
  // Don't crash, just log - stdin errors are usually recoverable
});

proc.on('close', (code, signal) => {
  // Clean up stdin reference
  entry.stdin = null;
  // ... existing close handling
});
```

#### 1.2 Add Terminal Input Event Handler

**File:** `server/events/terminal.js`

Add new handler for stdin input:

```javascript
/**
 * Event: terminal:input
 *
 * Send input to a running terminal process
 *
 * @event terminal:input
 * @param {Object} message - { processId: string, data: string }
 */

import { sendInput } from '../lib/processManager.js';

// Add to existing exports
export const handlers = {
  // ... existing handlers (exec, kill, list, clear)

  input: (ws, message, context) => {
    const { processId, data } = message;

    if (!processId || typeof data !== 'string') {
      send(ws, {
        type: 'terminal:error',
        error: 'Invalid input parameters',
      });
      return;
    }

    const success = sendInput(processId, data);

    if (!success) {
      send(ws, {
        type: 'terminal:error',
        processId,
        error: 'Failed to send input',
      });
    }

    // Note: Don't send success response - the output will be the confirmation
  },
};
```

**Update:** `server/events/terminal.js` - Modify router

```javascript
export async function handler(ws, message, context) {
  const action = message.action; // 'exec', 'kill', 'list', 'clear', 'input'

  const handler = handlers[action];
  if (handler) {
    await handler(ws, message, context);
  } else {
    send(ws, {
      type: 'terminal:error',
      error: `Unknown action: ${action}`,
    });
  }
}
```

---

### 2. Frontend Terminal Input UI

#### 2.1 Add Input State to ChatView

**File:** `src/views/ChatView.vue`

Add state for tracking which process to send input to:

```javascript
// Terminal input
const terminalInput = ref('');
const terminalInputFocused = ref(false);
const activeProcessForInput = ref(null); // Process ID to send input to

// Determine if we should show input field
const showTerminalInput = computed(() => {
  if (!terminalMode.value) return false;

  // Show input if there's a running process
  const runningProcesses = terminalProcesses.value.filter(p => p.status === 'running');
  return runningProcesses.length > 0;
});

// Auto-select first running process for input
watch(terminalProcesses, (processes) => {
  const running = processes.filter(p => p.status === 'running');
  if (running.length > 0 && !activeProcessForInput.value) {
    activeProcessForInput.value = running[0].id;
  } else if (running.length === 0) {
    activeProcessForInput.value = null;
  }
}, { deep: true });
```

Add input handler:

```javascript
function sendTerminalInput(data) {
  if (!activeProcessForInput.value) {
    console.warn('No active process for input');
    return;
  }

  send({
    type: 'terminal:input',
    processId: activeProcessForInput.value,
    data,
  });

  // Clear input field
  terminalInput.value = '';
}

// Handle Enter key to send input
function handleTerminalInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const value = terminalInput.value;
    if (value) {
      // Send with newline
      sendTerminalInput(value + '\n');
    } else {
      // Just newline (for prompts that need Enter)
      sendTerminalInput('\n');
    }
  }
}
```

#### 2.2 Update Terminal UI Template

**File:** `src/views/ChatView.vue`

Add input field to terminal section:

```vue
<!-- Terminal mode -->
<div v-if="terminalMode" class="terminal-section">
  <!-- Existing terminal tabs (Active/History) -->
  <div class="terminal-tabs">...</div>

  <!-- Terminal output -->
  <div class="terminal-output">
    <TerminalOutput
      v-for="proc in displayedProcesses"
      :key="proc.id"
      :process="proc"
      :expanded="expandedHistory.has(proc.id)"
      @toggle="toggleHistoryItem(proc.id)"
      @kill="killProcess(proc.id)"
    />
  </div>

  <!-- NEW: Terminal input (shown when process is running) -->
  <div v-if="showTerminalInput" class="terminal-input-section">
    <div class="terminal-input-header">
      <span class="input-label">Input to:</span>
      <select
        v-model="activeProcessForInput"
        class="process-selector"
        v-if="runningProcesses.length > 1"
      >
        <option
          v-for="proc in runningProcesses"
          :key="proc.id"
          :value="proc.id"
        >
          {{ proc.command.substring(0, 50) }}
        </option>
      </select>
      <span v-else class="active-process">
        {{ runningProcesses[0]?.command.substring(0, 50) }}
      </span>
    </div>

    <div class="terminal-input-container">
      <textarea
        v-model="terminalInput"
        class="terminal-input"
        placeholder="Type input and press Enter to send..."
        rows="1"
        @keydown="handleTerminalInputKey"
        @focus="terminalInputFocused = true"
        @blur="terminalInputFocused = false"
      ></textarea>
      <button
        class="send-input-btn"
        @click="sendTerminalInput(terminalInput + '\n')"
        :disabled="!terminalInput"
        title="Send input (Enter)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <div class="input-hint">
      <kbd>Enter</kbd> to send • <kbd>Shift+Enter</kbd> for new line
    </div>
  </div>

  <!-- Existing: Command input (shown when no process running or for new commands) -->
  <div v-else class="terminal-command-section">
    <!-- Existing command input UI -->
  </div>
</div>
```

Computed property for running processes:

```javascript
const runningProcesses = computed(() => {
  return terminalProcesses.value.filter(p => p.status === 'running');
});
```

#### 2.3 Add Styles

**File:** `src/views/ChatView.vue` (style section)

```css
/* Terminal input section */
.terminal-input-section {
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  padding: 8px 12px;
}

.terminal-input-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.input-label {
  font-weight: 500;
}

.process-selector {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.active-process {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.terminal-input-container {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.terminal-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  resize: none;
  min-height: 36px;
  max-height: 120px;
  line-height: 1.4;
}

.terminal-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.send-input-btn {
  padding: 8px 12px;
  background: #3b82f6;
  border: 1px solid #3b82f6;
  border-radius: var(--radius-md);
  color: white;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-input-btn:hover:not(:disabled) {
  background: #2563eb;
}

.send-input-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.input-hint kbd {
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
}
```

---

### 3. Enhanced Features

#### 3.1 Special Input Handling

Add helper for common inputs:

```javascript
// Quick send buttons
const quickInputs = [
  { label: 'y', value: 'y\n', tooltip: 'Send "y" (yes)' },
  { label: 'n', value: 'n\n', tooltip: 'Send "n" (no)' },
  { label: 'Enter', value: '\n', tooltip: 'Send Enter key' },
  { label: 'Ctrl+C', value: '\x03', tooltip: 'Send Ctrl+C (interrupt)' },
  { label: 'Ctrl+D', value: '\x04', tooltip: 'Send Ctrl+D (EOF)' },
];

function sendQuickInput(value) {
  if (activeProcessForInput.value) {
    send({
      type: 'terminal:input',
      processId: activeProcessForInput.value,
      data: value,
    });
  }
}
```

Add quick buttons to UI:

```vue
<div class="quick-inputs">
  <button
    v-for="input in quickInputs"
    :key="input.label"
    class="quick-input-btn"
    @click="sendQuickInput(input.value)"
    :title="input.tooltip"
  >
    {{ input.label }}
  </button>
</div>
```

#### 3.2 Password Input Mode

Add toggle for password visibility:

```javascript
const inputIsPassword = ref(false);
```

```vue
<input
  v-if="inputIsPassword"
  v-model="terminalInput"
  type="password"
  class="terminal-input"
  placeholder="Enter password..."
  @keydown="handleTerminalInputKey"
/>
<textarea
  v-else
  v-model="terminalInput"
  class="terminal-input"
  placeholder="Type input and press Enter..."
  @keydown="handleTerminalInputKey"
></textarea>

<button
  class="password-toggle"
  @click="inputIsPassword = !inputIsPassword"
  :title="inputIsPassword ? 'Show as text' : 'Hide as password'"
>
  {{ inputIsPassword ? '👁️' : '🔒' }}
</button>
```

#### 3.3 Input Echo Display (Optional)

Show what was sent (useful for debugging):

```javascript
// In terminal output component
const inputEchoes = ref([]); // Store recent inputs

function addInputEcho(processId, data) {
  inputEchoes.value.push({
    processId,
    data,
    timestamp: Date.now(),
  });

  // Keep only last 10
  if (inputEchoes.value.length > 10) {
    inputEchoes.value.shift();
  }
}
```

Display in output:

```vue
<div class="input-echo">
  <span class="echo-prefix">›</span>
  <span class="echo-content">{{ data }}</span>
</div>
```

---

### 4. Advanced: PTY Support (Future Enhancement)

If simple stdin isn't enough, upgrade to PTY using `node-pty`.

#### 4.1 Install Dependency

```bash
npm install node-pty
```

#### 4.2 Replace spawn with PTY

**File:** `server/lib/processManager.js`

```javascript
import pty from 'node-pty';

// Replace spawn call
const proc = pty.spawn(userShell, ['-i', '-c', command], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd,
  env: process.env,
});

// PTY has different API
entry.proc = proc;
entry.pty = proc;

// Single data stream (stdout + stderr combined)
proc.onData((data) => {
  processManager.addOutput(entry, 'stdout', data);
  // Broadcast via WebSocket
});

proc.onExit(({ exitCode, signal }) => {
  // Handle close
});
```

#### 4.3 Send Input to PTY

```javascript
export function sendInput(processId, data) {
  const entry = getProcessById(processId);
  if (!entry || !entry.pty) return false;

  entry.pty.write(data);
  return true;
}
```

#### 4.4 Handle Terminal Resize

```javascript
export function resizeTerminal(processId, cols, rows) {
  const entry = getProcessById(processId);
  if (!entry || !entry.pty) return false;

  entry.pty.resize(cols, rows);
  return true;
}
```

Add event handler:

```javascript
// server/events/terminal.js
resize: (ws, message, context) => {
  const { processId, cols, rows } = message;
  resizeTerminal(processId, cols, rows);
},
```

Frontend sends resize on terminal container size change:

```javascript
// Use ResizeObserver on terminal output element
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const width = entry.contentRect.width;
    const height = entry.contentRect.height;

    // Calculate cols/rows based on char size (monospace ~8x16px)
    const cols = Math.floor(width / 8);
    const rows = Math.floor(height / 16);

    send({
      type: 'terminal:resize',
      processId: activeProcessForInput.value,
      cols,
      rows,
    });
  }
});
```

---

## 5. Use Cases & Testing

### Basic Input Testing

1. **Simple Confirmation:**
   ```bash
   read -p "Continue? (y/n): " answer && echo "You said: $answer"
   ```
   - Type `y` and press Enter
   - Should see "You said: y"

2. **Password Input:**
   ```bash
   read -sp "Password: " pass && echo "Password entered"
   ```
   - Toggle password mode
   - Type password
   - Press Enter

3. **Multiple Inputs:**
   ```bash
   read -p "Name: " name && read -p "Age: " age && echo "$name is $age"
   ```
   - Enter name, press Enter
   - Enter age, press Enter

4. **apt-get Install:**
   ```bash
   sudo apt-get install cowsay
   ```
   - Should prompt for password
   - Then prompt Y/n for confirmation
   - Test both inputs

### Interactive Program Testing (PTY Required)

1. **nano:**
   ```bash
   nano test.txt
   ```
   - Should open editor
   - Type text
   - Ctrl+X to exit
   - Y to save

2. **vim:**
   ```bash
   vim test.txt
   ```
   - Should open vim
   - Press `i` for insert
   - Type text
   - `:wq` to save

3. **Python REPL:**
   ```bash
   python3
   ```
   - Should see `>>>` prompt
   - Type `print("hello")`
   - Press Enter
   - Type `exit()`

---

## 6. File Structure

```
server/
├── lib/
│   └── processManager.js       # MODIFY - Add sendInput(), stdin handling
└── events/
    └── terminal.js             # MODIFY - Add 'input' action handler

src/
└── views/
    └── ChatView.vue            # MODIFY - Add terminal input UI
```

---

## 7. Implementation Order

### Phase 1: Basic stdin (Simple Approach)
1. ✅ Modify processManager.js to store stdin reference
2. ✅ Add sendInput() function
3. ✅ Add terminal:input event handler
4. ✅ Add frontend input state and UI
5. ✅ Add keyboard handling (Enter to send)
6. ✅ Test with simple prompts (read, confirmations)

### Phase 2: Enhanced UX
1. ✅ Add process selector (multiple running processes)
2. ✅ Add quick input buttons (y/n/Enter/Ctrl+C/Ctrl+D)
3. ✅ Add password mode toggle
4. ✅ Add input echo display (optional)
5. ✅ Add visual indicator when process is waiting for input

### Phase 3: PTY Support (Optional)
1. ✅ Install node-pty dependency
2. ✅ Replace spawn with pty.spawn
3. ✅ Handle terminal resize events
4. ✅ Test with nano, vim, python REPL
5. ✅ Add terminal emulator for full experience

---

## 8. Limitations & Known Issues

### With Simple stdin (Option B):
- ❌ Programs like `nano`, `vim`, `emacs` won't work (need TTY)
- ❌ No terminal control codes (cursor movement, colors may be limited)
- ❌ Programs that check `isatty()` may behave differently
- ✅ Works for: passwords, confirmations, simple text input, scripts

### With PTY (Option A):
- ✅ Full terminal support
- ⚠️ Native bindings may cause installation issues on some systems
- ⚠️ Requires terminal emulator on frontend for best experience
- ⚠️ More complex to debug

---

## 9. Success Criteria

### Phase 1 (Basic stdin):
- [ ] Can send text input to running process
- [ ] `read` commands work and receive input
- [ ] Password prompts work (input is sent)
- [ ] `apt-get install` confirmations work
- [ ] Multiple running processes can be selected for input
- [ ] Enter key sends with newline
- [ ] Shift+Enter adds newline in textarea

### Phase 2 (Enhanced):
- [ ] Quick input buttons work (y/n/Ctrl+C)
- [ ] Password mode hides input
- [ ] Input echo shows what was sent
- [ ] Visual indicator when waiting for input

### Phase 3 (PTY):
- [ ] `nano` opens and is usable
- [ ] `vim` works with normal key commands
- [ ] Python REPL accepts input and executes
- [ ] Terminal resize is handled properly
- [ ] Colors and formatting work correctly

---

## 10. Documentation

Update these docs after implementation:

- **README.md** - Add terminal input capabilities to feature list
- **CHANGELOG.md** - Document new terminal input feature
- **User Guide** (if exists) - Explain how to use terminal input
- **Known Limitations** - Document what works and what doesn't (with/without PTY)

---

## Alternative: WebSocket TTY Streaming

Instead of just input events, stream full TTY data bidirectionally:

**Server:**
- Stream PTY output as binary data
- Receive input as binary data
- Handle ANSI escape codes

**Frontend:**
- Use xterm.js for full terminal emulation
- Render all control codes
- Handle resize, colors, cursor

**Trade-off:** More complex but provides professional terminal experience similar to VSCode integrated terminal.

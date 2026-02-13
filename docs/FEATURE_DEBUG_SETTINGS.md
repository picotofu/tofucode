# Feature: Debug Mode & Settings Modal

## Overview
Add a settings modal accessible from the toolbar with a Debug Mode toggle. Debug Mode enables element inspection via hover popover, showing element ID and primary class name for development discussions.

## Requirements

### 1. Settings Button
- **Location:** Toolbar, beside the restart icon
- **Icon:** Gear/cog icon (⚙️)
- **Action:** Opens settings modal

### 2. Settings Modal
- **Storage:** `.cc-web/settings.json` (user's home directory)
- **Auto-save:** Changes saved immediately (no save button)
- **Close:** X button or click outside modal
- **Initial setting:** Debug Mode toggle (checkbox)

### 3. Debug Mode
- **Default:** `false`
- **When enabled:**
  - Hovering over any element shows a small popover
  - Popover displays:
    - Element ID (if present)
    - Primary class name (excluding Vue's cache-busting classes)
- **Purpose:** Quick element identification for development discussions

## Implementation Plan

### Phase 1: Settings Storage (Backend)

**File:** `server/lib/settings.js` (new)

```javascript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SETTINGS_DIR = join(homedir(), '.cc-web');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

// Default settings
const DEFAULT_SETTINGS = {
  debugMode: false,
};

export function loadSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }
    const data = readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch (err) {
    console.error('Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    // Ensure directory exists
    if (!existsSync(SETTINGS_DIR)) {
      mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { success: false, error: err.message };
  }
}
```

**WebSocket Events:**

File: `server/events/get-settings.js` (new)
```javascript
import { send } from '../lib/ws.js';
import { loadSettings } from '../lib/settings.js';

export async function handler(ws, message) {
  const settings = loadSettings();
  send(ws, {
    type: 'settings',
    settings,
  });
}
```

File: `server/events/update-settings.js` (new)
```javascript
import { send } from '../lib/ws.js';
import { saveSettings } from '../lib/settings.js';

export async function handler(ws, message) {
  const { settings } = message;
  const result = saveSettings(settings);

  send(ws, {
    type: 'settings_updated',
    success: result.success,
    error: result.error,
    settings,
  });
}
```

### Phase 2: Settings Modal (Frontend)

**File:** `src/components/SettingsModal.vue` (new)

```vue
<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  settings: {
    type: Object,
    default: () => ({ debugMode: false }),
  },
});

const emit = defineEmits(['close', 'update']);

// Local copy of settings
const localSettings = ref({ ...props.settings });

// Watch for external changes
watch(() => props.settings, (newSettings) => {
  localSettings.value = { ...newSettings };
}, { deep: true });

// Auto-save on change
watch(localSettings, (newSettings) => {
  emit('update', newSettings);
}, { deep: true });

function closeModal() {
  emit('close');
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="closeModal" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Debug Mode Setting -->
        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              v-model="localSettings.debugMode"
              class="setting-checkbox"
            />
            <span class="setting-title">Debug Mode</span>
          </label>
          <p class="setting-description">
            Hover over elements to see their ID and class name for development
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: #1e1e1e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.setting-item {
  margin-bottom: 20px;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.setting-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #60a5fa;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.setting-description {
  margin: 8px 0 0 30px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
}
</style>
```

### Phase 3: Debug Mode Inspector (Frontend)

**File:** `src/composables/useDebugMode.js` (new)

```javascript
import { onMounted, onUnmounted, ref } from 'vue';

export function useDebugMode(enabled) {
  const hoveredElement = ref(null);
  const popoverPosition = ref({ x: 0, y: 0 });
  const popoverData = ref({ id: '', className: '' });

  function handleMouseOver(event) {
    if (!enabled.value) return;

    const target = event.target;
    hoveredElement.value = target;

    // Get element info
    const id = target.id || '';
    // Get first class that's not a Vue cache-busting class (hash)
    const classes = Array.from(target.classList);
    const primaryClass = classes.find(c => !c.match(/^_[a-zA-Z0-9_-]+$/)) || '';

    popoverData.value = {
      id,
      className: primaryClass,
    };

    // Position popover near cursor
    popoverPosition.value = {
      x: event.clientX + 10,
      y: event.clientY + 10,
    };
  }

  function handleMouseOut() {
    if (!enabled.value) return;
    hoveredElement.value = null;
  }

  onMounted(() => {
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
  });

  onUnmounted(() => {
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
  });

  return {
    hoveredElement,
    popoverPosition,
    popoverData,
  };
}
```

**File:** `src/components/DebugPopover.vue` (new)

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Object,
    default: () => ({ x: 0, y: 0 }),
  },
  data: {
    type: Object,
    default: () => ({ id: '', className: '' }),
  },
});

const hasData = computed(() => props.data.id || props.data.className);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && hasData"
      class="debug-popover"
      :style="{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }"
    >
      <div v-if="data.id" class="debug-item">
        <span class="debug-label">ID:</span>
        <span class="debug-value">{{ data.id }}</span>
      </div>
      <div v-if="data.className" class="debug-item">
        <span class="debug-label">Class:</span>
        <span class="debug-value">{{ data.className }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.debug-popover {
  position: fixed;
  background: rgba(0, 0, 0, 0.95);
  border: 1px solid #60a5fa;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 11px;
  font-family: 'Monaco', 'Courier New', monospace;
  color: #fff;
  pointer-events: none;
  z-index: 100000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  max-width: 300px;
  word-break: break-all;
}

.debug-item {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.debug-item:last-child {
  margin-bottom: 0;
}

.debug-label {
  color: #60a5fa;
  font-weight: 600;
}

.debug-value {
  color: #fbbf24;
}
</style>
```

### Phase 4: Integration

**Update:** `src/views/ChatView.vue`

1. Add settings button to toolbar
2. Import SettingsModal and DebugPopover
3. Load settings on mount
4. Enable debug mode based on settings

```vue
<script setup>
// Add imports
import SettingsModal from '../components/SettingsModal.vue';
import DebugPopover from '../components/DebugPopover.vue';
import { useDebugMode } from '../composables/useDebugMode';

// Settings state
const showSettings = ref(false);
const settings = ref({ debugMode: false });

// Debug mode
const debugModeEnabled = computed(() => settings.value.debugMode);
const { hoveredElement, popoverPosition, popoverData } = useDebugMode(debugModeEnabled);

// Load settings on mount
onMounted(() => {
  send({ type: 'get_settings' });
});

// Handle settings messages
onMessage((msg) => {
  if (msg.type === 'settings') {
    settings.value = msg.settings;
  } else if (msg.type === 'settings_updated') {
    if (msg.success) {
      settings.value = msg.settings;
    }
  }
});

// Update settings
function updateSettings(newSettings) {
  send({
    type: 'update_settings',
    settings: newSettings,
  });
}
</script>

<template>
  <!-- Add settings button beside restart button -->
  <button
    class="toolbar-icon-btn"
    @click="showSettings = true"
    title="Settings"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v6m0 6v6m5.196-15.196l-4.243 4.243m0 5.657l-4.242 4.242M23 12h-6m-6 0H1m15.196 5.196l-4.243-4.243m0-5.657l-4.242-4.242"/>
    </svg>
  </button>

  <!-- Settings Modal -->
  <SettingsModal
    :show="showSettings"
    :settings="settings"
    @close="showSettings = false"
    @update="updateSettings"
  />

  <!-- Debug Popover -->
  <DebugPopover
    v-if="debugModeEnabled"
    :visible="!!hoveredElement"
    :position="popoverPosition"
    :data="popoverData"
  />
</template>
```

## Edge Cases

### 1. Settings File Missing
- Create `.cc-web` directory if needed
- Use default settings

### 2. Malformed JSON
- Fallback to defaults
- Log error to console

### 3. Debug Mode Performance
- Use event capturing for efficiency
- Debounce if needed (likely not needed)
- Popover has `pointer-events: none`

### 4. Cache-Busting Class Detection
- Filter out Vue's scoped classes (e.g., `_xyz123`)
- Show first "real" class name only

## Testing Checklist

- [ ] Settings button appears beside restart
- [ ] Modal opens on click
- [ ] Modal closes on X or outside click
- [ ] Checkbox toggle works
- [ ] Settings auto-save immediately
- [ ] Settings persist across page reloads
- [ ] Debug mode popover appears on hover
- [ ] Popover shows ID when present
- [ ] Popover shows primary class name
- [ ] Popover doesn't show Vue cache-busting classes
- [ ] Popover doesn't interfere with clicks
- [ ] Performance is smooth (no lag on hover)

## Future Enhancements

1. **More Settings:**
   - Theme selection
   - Font size
   - Auto-save interval
   - Terminal default shell

2. **Debug Mode Features:**
   - Show element dimensions
   - Show computed styles
   - Click to copy selector
   - Highlight element on hover

3. **Settings Categories:**
   - General
   - Debug
   - Editor
   - Terminal

## Implementation Order

1. ✅ Create plan (this document)
2. ✅ Backend: settings.js, events
3. ✅ Frontend: SettingsModal.vue
4. ✅ Frontend: useDebugMode.js, DebugPopover.vue (simplified)
5. ✅ Integration: ChatView.vue
6. ⏳ Test all functionality
7. ⏳ Update CHANGELOG

## Implementation Notes

- Simplified popover to show `#id .class1 .class2` format
- Filters out Vue runtime classes (starting with `_`)
- Settings icon uses flat SVG style consistent with other toolbar icons
- Auto-save on checkbox toggle (no save button needed)

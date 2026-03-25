<script setup>
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFilesManager } from '../composables/useFilesManager';
import { useWebSocket } from '../composables/useWebSocket';
import MiniCalendar from './MiniCalendar.vue';

const RECENT_NOTES_KEY = 'tofucode:recent-notes';
const CALENDAR_OPEN_KEY = 'tofucode:notes-calendar-open';
const SHOW_DOTFILES_KEY = 'tofucode:notes-show-dotfiles';
const MAX_RECENT = 5;

const emit = defineEmits(['open-settings']);

const route = useRoute();
const router = useRouter();
const settingsContext = inject('settings');
const { send, onMessage } = useWebSocket();

const notesBasePath = computed(() => settingsContext.notesBasePath());
const notesIncludePaths = computed(
  () => settingsContext.notesIncludePaths() || [],
);
const configured = computed(() => !!notesBasePath.value);

// ── File manager (search only) ────────────────────────────────────────────────

const fm = useFilesManager({ send, onMessage });
const { filesFilter, filesSearchResults, filesSearching } = fm;
fm.mdMode.value = true;

// ── Inline tree state ─────────────────────────────────────────────────────────

// expandedPaths: Set of folder paths currently expanded in the UI
const expandedPaths = ref(new Set());
// treeChildren: Map<path, items[]> — pre-fetched children per folder (dirs + .md files only)
const treeChildren = ref(new Map());
// fetchedPaths: Set of paths already fetched (avoid duplicate requests)
const fetchedPaths = ref(new Set());
// loadingRoots: Set of root paths whose subtree is still being fetched
const loadingRoots = ref(new Set());

// Which root owns a given path (used to clear loadingRoots when all done)
const pendingByRoot = ref(new Map()); // root path → count of in-flight requests

function rootForPath(path) {
  for (const root of treeRoots.value) {
    if (path === root.path || path.startsWith(`${root.path}/`))
      return root.path;
  }
  return null;
}

function decrementPending(rootPath) {
  if (!rootPath) return;
  const pb = new Map(pendingByRoot.value);
  const n = (pb.get(rootPath) ?? 0) - 1;
  if (n <= 0) {
    pb.delete(rootPath);
    const lr = new Set(loadingRoots.value);
    lr.delete(rootPath);
    loadingRoots.value = lr;
  } else {
    pb.set(rootPath, n);
  }
  pendingByRoot.value = pb;
}

function fetchFolder(path) {
  const fp = new Set(fetchedPaths.value);
  if (fp.has(path)) return;
  fp.add(path);
  fetchedPaths.value = fp;

  // Increment pending counter for this root
  const rootPath = rootForPath(path);
  if (rootPath) {
    const pb = new Map(pendingByRoot.value);
    pb.set(rootPath, (pb.get(rootPath) || 0) + 1);
    pendingByRoot.value = pb;
  }

  send({ type: 'files:browse', path });
}

// Listen for browse results — cache and immediately recurse into subdirs
const unsubBrowse = onMessage((msg) => {
  if (msg.type === 'files:browse:result') {
    const rootPath = rootForPath(msg.path);
    // Only process results for paths that belong to our tree
    if (!rootPath) return;

    // Filter: dirs that contain .md files + .md files only (mirrors useFilesManager mdMode)
    const filtered = (msg.items || []).filter(
      (item) =>
        (item.isDirectory && item.hasMarkdown) ||
        item.name.toLowerCase().endsWith('.md'),
    );
    // Sort: directories first, then files, both alphabetically
    filtered.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const tc = new Map(treeChildren.value);
    tc.set(msg.path, filtered);
    treeChildren.value = tc;

    // Eagerly fetch all subdirectories
    for (const item of filtered) {
      if (item.isDirectory) {
        fetchFolder(item.path);
      }
    }

    decrementPending(rootPath);
  }

  if (msg.type === 'files:browse:error') {
    const rootPath = rootForPath(msg.path);
    // Only process errors for paths that belong to our tree
    if (!rootPath) return;
    // Cache empty so we don't retry
    const tc = new Map(treeChildren.value);
    if (!tc.has(msg.path)) tc.set(msg.path, []);
    treeChildren.value = tc;
    decrementPending(rootPath);
  }
});

onUnmounted(() => unsubBrowse());

function toggleFolder(path) {
  const ep = new Set(expandedPaths.value);
  if (ep.has(path)) {
    ep.delete(path);
  } else {
    ep.add(path);
  }
  expandedPaths.value = ep;
}

// Tree roots: vault first, then linked folders
const treeRoots = computed(() => {
  if (!notesBasePath.value) return [];
  const roots = [
    {
      path: notesBasePath.value,
      label: notesBasePath.value.split('/').pop() || 'Vault',
      isLinked: false,
    },
  ];
  for (const inc of notesIncludePaths.value) {
    if (inc.path)
      roots.push({
        path: inc.path,
        label: inc.label || inc.path.split('/').pop(),
        isLinked: true,
      });
  }
  return roots;
});

// Flat tree: walk expanded folders recursively
// Children are already sorted (dirs first, then files) from fetch time
function walkTree(path, depth, rootPath) {
  const children = treeChildren.value.get(path) || [];
  const rows = [];
  for (const item of children) {
    if (!showDotfiles.value && item.name.startsWith('.')) continue;
    rows.push({ item, depth, rootPath });
    if (item.isDirectory && expandedPaths.value.has(item.path)) {
      rows.push(...walkTree(item.path, depth + 1, rootPath));
    }
  }
  return rows;
}

const flatTree = computed(() => {
  const rows = [];
  for (const root of treeRoots.value) {
    rows.push({ root, depth: 0 });
    if (expandedPaths.value.has(root.path)) {
      for (const row of walkTree(root.path, 1, root.path)) {
        rows.push(row);
      }
    }
  }
  return rows;
});

// ── Calendar & daily dates ────────────────────────────────────────────────────

const showCalendar = ref(localStorage.getItem(CALENDAR_OPEN_KEY) === 'true');
const showDotfiles = ref(localStorage.getItem(SHOW_DOTFILES_KEY) === 'true');

watch(showCalendar, (val) => {
  localStorage.setItem(CALENDAR_OPEN_KEY, String(val));
});
watch(showDotfiles, (val) => {
  localStorage.setItem(SHOW_DOTFILES_KEY, String(val));
});
const dailyDates = ref(new Set());
const dailyDatesFetched = ref(false);
const pendingDailyScan = ref(false);

function scanDailyDates() {
  if (!notesBasePath.value || dailyDatesFetched.value) return;
  pendingDailyScan.value = true;
  const dailyDir = `${notesBasePath.value}/daily`;
  setTimeout(() => {
    if (!pendingDailyScan.value) return;
    send({ type: 'files:browse', path: dailyDir });
  }, 300);
}

const unsubDailyScan = onMessage((msg) => {
  if (!pendingDailyScan.value) return;
  const dailyDir = `${notesBasePath.value}/daily`;
  if (msg.type === 'files:browse:error' && msg.path === dailyDir) {
    pendingDailyScan.value = false;
    return;
  }
  if (msg.type !== 'files:browse:result' || msg.path !== dailyDir) return;
  const dates = new Set();
  for (const item of msg.items) {
    const match = item.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (match) dates.add(match[1]);
  }
  dailyDates.value = dates;
  dailyDatesFetched.value = true;
  pendingDailyScan.value = false;
});

onUnmounted(() => unsubDailyScan());

// ── Recent notes ──────────────────────────────────────────────────────────────

const recentNotes = ref(loadRecentNotes());

function loadRecentNotes() {
  try {
    const stored = localStorage.getItem(RECENT_NOTES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentNotes() {
  localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(recentNotes.value));
}

function addToRecent(path) {
  if (!path) return;
  const filtered = recentNotes.value.filter((p) => p !== path);
  filtered.unshift(path);
  recentNotes.value = filtered.slice(0, MAX_RECENT);
  saveRecentNotes();
}

function recentNoteName(path) {
  return path.split('/').pop() || path;
}

function recentNoteRelPath(path) {
  if (!notesBasePath.value) return path;
  if (path.startsWith(`${notesBasePath.value}/`)) {
    return path.slice(notesBasePath.value.length + 1);
  }
  for (const inc of notesIncludePaths.value) {
    if (inc.path && path.startsWith(`${inc.path}/`)) {
      const label = inc.label || inc.path.split('/').pop();
      return `${label}/${path.slice(inc.path.length + 1)}`;
    }
  }
  return path;
}

// ── Initialization ────────────────────────────────────────────────────────────

const initialized = ref(false);

function loadRoots() {
  for (const root of treeRoots.value) {
    loadingRoots.value = new Set([...loadingRoots.value, root.path]);
    expandedPaths.value = new Set([...expandedPaths.value, root.path]);
    fetchFolder(root.path);
  }
}

function initNotes() {
  if (initialized.value || !configured.value) return;
  initialized.value = true;
  scanDailyDates();
  loadRoots();
}

// If notesBasePath arrives after mount (settings loaded async), retry init
watch(notesBasePath, (path) => {
  if (!path) return;
  if (!initialized.value) {
    initNotes();
    return;
  }
  // Already initialized — path changed (e.g. settings updated), reset and re-fetch
  dailyDatesFetched.value = false;
  scanDailyDates();
  loadRoots();
});

defineExpose({ initNotes, openTodayNote });
onMounted(() => initNotes());

// ── Active note ───────────────────────────────────────────────────────────────

const activeNotePath = computed(() => {
  if (route.name !== 'notes') return '';
  const p = route.params.notePath;
  if (!p) return '';
  const path = Array.isArray(p) ? p.join('/') : p;
  if (path.startsWith('__abs/')) return `/${path.slice('__abs/'.length)}`;
  if (path.startsWith('/')) return path;
  if (!notesBasePath.value) return path;
  return `${notesBasePath.value}/${path}`;
});

const selectedDate = computed(() => {
  const path = activeNotePath.value;
  if (!path) return '';
  const match = path.match(/\/daily\/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : '';
});

// ── Navigation helpers ────────────────────────────────────────────────────────

function todayDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function openNote(path) {
  if (!notesBasePath.value) return;
  const absPath = path.startsWith('/')
    ? path
    : `${notesBasePath.value}/${path}`;
  addToRecent(absPath);
  if (absPath.startsWith(`${notesBasePath.value}/`)) {
    router.push({
      name: 'notes',
      params: { notePath: absPath.slice(notesBasePath.value.length + 1) },
    });
  } else {
    router.push({ name: 'notes', params: { notePath: `__abs${absPath}` } });
  }
}

function openDailyNote(dateStr) {
  const path = `${notesBasePath.value}/daily/${dateStr}.md`;
  addToRecent(path);
  router.push({ name: 'notes', params: { notePath: `daily/${dateStr}.md` } });
}

function openTodayNote() {
  openDailyNote(todayDateStr());
}
function onCalendarSelect(dateStr) {
  openDailyNote(dateStr);
}

// ── Create new note (inline per folder) ──────────────────────────────────────

// Which folder currently has the inline input open (null = none)
const createInFolder = ref(null);
const newNoteName = ref('');
const newNoteInputRef = ref(null);

async function startNewNote(folderPath) {
  createInFolder.value = folderPath;
  newNoteName.value = '';
  await nextTick();
  newNoteInputRef.value?.[0]?.focus() ?? newNoteInputRef.value?.focus();
}

function cancelNewNote() {
  createInFolder.value = null;
  newNoteName.value = '';
}

function confirmNewNote() {
  const dir = createInFolder.value;
  if (!dir) return;
  let name = newNoteName.value.trim();
  if (!name) {
    cancelNewNote();
    return;
  }
  if (!name.endsWith('.md')) name += '.md';
  const path = `${dir}/${name}`;
  send({ type: 'files:create', path, isFile: true });
  cancelNewNote();
  // Invalidate cache for this folder so the new file appears
  const tc = new Map(treeChildren.value);
  tc.delete(dir);
  treeChildren.value = tc;
  const fp = new Set(fetchedPaths.value);
  fp.delete(dir);
  fetchedPaths.value = fp;
  setTimeout(() => {
    fetchFolder(dir);
    openNote(path);
  }, 300);
}

// ── Search ────────────────────────────────────────────────────────────────────

const isSearching = computed(() => !!filesFilter.value.trim());
const displaySearchItems = computed(() => filesSearchResults.value || []);

// Search needs a valid projectPath — use vault root
watch(filesFilter, (query) => {
  if (query.trim() && notesBasePath.value) {
    fm.filesCurrentPath.value = notesBasePath.value;
  }
});

// ── Context menu ──────────────────────────────────────────────────────────────

const contextMenu = ref({ visible: false, x: 0, y: 0, item: null });
const renameItem = ref(null); // item being renamed inline
const renameValue = ref('');
const renameInputRef = ref(null);
const deleteItem = ref(null); // item pending delete confirm

function openContextMenu(event, item) {
  event.preventDefault();
  event.stopPropagation();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item,
  };
}

function closeContextMenu() {
  contextMenu.value = { visible: false, x: 0, y: 0, item: null };
}

async function startRename(item) {
  closeContextMenu();
  renameItem.value = item;
  renameValue.value = item.name;
  await nextTick();
  const el = renameInputRef.value?.[0] ?? renameInputRef.value;
  el?.focus();
  el?.select();
}

function cancelRename() {
  renameItem.value = null;
  renameValue.value = '';
}

function confirmRename() {
  const item = renameItem.value;
  if (!item) return;
  const newName = renameValue.value.trim();
  if (!newName || newName === item.name) {
    cancelRename();
    return;
  }
  const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
  const newPath = `${parentDir}/${newName}`;
  send({ type: 'files:rename', oldPath: item.path, newPath });
  // Invalidate cache for parent folder so rename appears
  const tc = new Map(treeChildren.value);
  tc.delete(parentDir);
  treeChildren.value = tc;
  const fp = new Set(fetchedPaths.value);
  fp.delete(parentDir);
  fetchedPaths.value = fp;
  setTimeout(() => fetchFolder(parentDir), 300);
  cancelRename();
}

function startDelete(item) {
  closeContextMenu();
  deleteItem.value = item;
}

function cancelDelete() {
  deleteItem.value = null;
}

function confirmDelete() {
  const item = deleteItem.value;
  if (!item) return;
  send({ type: 'files:delete', path: item.path });
  // Invalidate cache for parent folder so deleted item disappears
  const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
  const tc = new Map(treeChildren.value);
  tc.delete(parentDir);
  treeChildren.value = tc;
  const fp = new Set(fetchedPaths.value);
  fp.delete(parentDir);
  fetchedPaths.value = fp;
  setTimeout(() => fetchFolder(parentDir), 300);
  deleteItem.value = null;
}

// Close context menu on outside click
function onWindowClick() {
  if (contextMenu.value.visible) closeContextMenu();
}
onMounted(() => window.addEventListener('click', onWindowClick));
onUnmounted(() => window.removeEventListener('click', onWindowClick));
</script>

<template>
  <div class="notes-panel">
    <!-- Not configured state -->
    <div v-if="!configured" class="notes-empty">
      <p>Notes vault is not configured.</p>
      <button class="notes-link-btn" @click="emit('open-settings', 'notes')">
        Configure in Settings → Notes
      </button>
    </div>

    <!-- Configured state -->
    <template v-else>
      <!-- Toolbar -->
      <div class="notes-toolbar">
        <input
          v-model="filesFilter"
          type="text"
          class="notes-search"
          placeholder="Search notes..."
        />
        <div class="notes-toolbar-actions">
          <button class="notes-toolbar-btn" title="Today's daily note" @click="openTodayNote">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button
            class="notes-toolbar-btn"
            :class="{ active: showCalendar }"
            title="Toggle calendar"
            @click="showCalendar = !showCalendar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </button>
          <button
            class="notes-toolbar-btn notes-toolbar-btn--right"
            :class="{ active: showDotfiles }"
            title="Toggle dotfiles"
            @click="showDotfiles = !showDotfiles"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <path d="M5 12h2M17 12h2"/>
              <circle cx="12" cy="12" r="9"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Mini Calendar -->
      <MiniCalendar
        v-if="showCalendar"
        :existing-dates="dailyDates"
        :selected-date="selectedDate"
        @select-date="onCalendarSelect"
      />

      <!-- Recent notes (shown when not searching) -->
      <div v-if="!isSearching && recentNotes.length > 0" class="notes-recent">
        <div class="notes-section-label">Recent</div>
        <button
          v-for="path in recentNotes"
          :key="path"
          class="notes-item"
          :class="{ active: path === activeNotePath }"
          :title="recentNoteRelPath(path)"
          @click="openNote(path)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="notes-item-name">{{ recentNoteName(path) }}</span>
        </button>
      </div>

      <!-- Search results -->
      <div v-if="isSearching" class="notes-list">
        <template v-if="filesSearching">
          <div v-for="n in 3" :key="n" class="notes-skeleton" style="margin: 4px 10px;" />
        </template>
        <template v-else>
          <button
            v-for="item in displaySearchItems"
            :key="item.path"
            class="notes-item"
            :class="{ active: item.path === activeNotePath }"
            :title="item.path"
            @click="openNote(item.path)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="notes-item-name">{{ item.name }}</span>
          </button>
          <div v-if="displaySearchItems.length === 0" class="notes-empty-list">No matches</div>
        </template>
      </div>

      <!-- Inline file tree (shown when not searching) -->
      <div v-else class="notes-list">
        <template v-for="row in flatTree" :key="row.root ? row.root.path : row.item.path">
          <!-- Root folder row -->
          <div
            v-if="row.root"
            class="notes-row"
            :style="{ paddingLeft: '8px' }"
          >
            <button
              class="notes-item directory"
              :class="{ expanded: expandedPaths.has(row.root.path) }"
              :title="row.root.path"
              @click="toggleFolder(row.root.path)"
              @contextmenu="openContextMenu($event, { path: row.root.path, name: row.root.label, isDirectory: true })"
            >
              <svg
                class="chevron"
                :class="{ open: expandedPaths.has(row.root.path) }"
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="notes-item-name">{{ row.root.label }}</span>
            </button>
            <!-- + new note button -->
            <button
              class="new-note-btn"
              title="New note in this folder"
              @click.stop="startNewNote(row.root.path)"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
          <!-- Loading row for root folder -->
          <div
            v-if="row.root && loadingRoots.has(row.root.path)"
            class="notes-folder-loading"
            :style="{ paddingLeft: `${8 + 24}px` }"
          >
            <svg class="spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          </div>
          <!-- Inline new-note input for root folder -->
          <div
            v-if="row.root && createInFolder === row.root.path"
            class="notes-inline-create"
            :style="{ paddingLeft: `${8 + 24}px` }"
          >
            <input
              ref="newNoteInputRef"
              v-model="newNoteName"
              type="text"
              class="notes-inline-input"
              placeholder="note-name.md"
              @keydown.enter="confirmNewNote"
              @keydown.escape="cancelNewNote"
              @blur="cancelNewNote"
            />
            <button class="notes-inline-confirm" @mousedown.prevent="confirmNewNote" title="Create">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>

          <!-- Child item row (file or folder) -->
          <template v-if="!row.root && row.item">
            <!-- Sub-folder -->
            <div
              v-if="row.item.isDirectory"
              class="notes-row"
              :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
            >
              <button
                class="notes-item directory"
                :class="{ expanded: expandedPaths.has(row.item.path) }"
                :title="row.item.path"
                @click="toggleFolder(row.item.path)"
                @contextmenu="openContextMenu($event, row.item)"
              >
                <svg
                  class="chevron"
                  :class="{ open: expandedPaths.has(row.item.path) }"
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                >
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="notes-item-name">{{ row.item.name }}</span>
              </button>
              <!-- + new note button -->
              <button
                class="new-note-btn"
                title="New note in this folder"
                @click.stop="startNewNote(row.item.path)"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <!-- Inline new-note input for sub-folder -->
            <div
              v-if="row.item.isDirectory && createInFolder === row.item.path"
              class="notes-inline-create"
              :style="{ paddingLeft: `${8 + row.depth * 16 + 24}px` }"
            >
              <input
                ref="newNoteInputRef"
                v-model="newNoteName"
                type="text"
                class="notes-inline-input"
                placeholder="note-name.md"
                @keydown.enter="confirmNewNote"
                @keydown.escape="cancelNewNote"
                @blur="cancelNewNote"
              />
              <button class="notes-inline-confirm" @mousedown.prevent="confirmNewNote" title="Create">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>
            <!-- File -->
            <template v-if="!row.item.isDirectory">
              <!-- Inline rename input -->
              <div
                v-if="renameItem?.path === row.item.path"
                class="notes-inline-create"
                :style="{ paddingLeft: `${8 + row.depth * 16 + 16}px` }"
              >
                <input
                  ref="renameInputRef"
                  v-model="renameValue"
                  type="text"
                  class="notes-inline-input"
                  @keydown.enter="confirmRename"
                  @keydown.escape="cancelRename"
                  @blur="cancelRename"
                />
                <button class="notes-inline-confirm" @mousedown.prevent="confirmRename" title="Rename">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </div>
              <!-- Normal file button -->
              <button
                v-else
                class="notes-item"
                :class="{ active: row.item.path === activeNotePath }"
                :title="row.item.path"
                :style="{ paddingLeft: `${8 + row.depth * 16 + 16}px` }"
                @click="openNote(row.item.path)"
                @contextmenu="openContextMenu($event, row.item)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span class="notes-item-name">{{ row.item.name }}</span>
              </button>
            </template>
          </template>
        </template>
      </div>
    </template>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="notes-context-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <button class="notes-ctx-item" @click="startRename(contextMenu.item)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Rename
      </button>
      <button class="notes-ctx-item danger" @click="startDelete(contextMenu.item)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        Delete
      </button>
    </div>
  </Teleport>

  <!-- Delete confirm dialog -->
  <Teleport to="body">
    <div v-if="deleteItem" class="notes-dialog-overlay" @click.self="cancelDelete">
      <div class="notes-dialog">
        <p class="notes-dialog-msg">
          Delete <strong>{{ deleteItem.name }}</strong>?
          <span v-if="deleteItem.isDirectory"> This will remove the folder and all its contents.</span>
        </p>
        <div class="notes-dialog-actions">
          <button class="notes-dialog-cancel" @click="cancelDelete">Cancel</button>
          <button class="notes-dialog-confirm" @click="confirmDelete">Delete</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.notes-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.notes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8px;
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.notes-link-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.notes-link-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Toolbar */
.notes-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.notes-search {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.notes-search:focus {
  border-color: var(--text-muted);
}

.notes-search::placeholder {
  color: var(--text-muted);
}

.notes-toolbar-actions {
  display: flex;
  gap: 4px;
}

.notes-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.notes-toolbar-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.notes-toolbar-btn.active {
  background: var(--bg-hover);
  color: var(--accent-color);
}

.notes-toolbar-btn--right {
  margin-left: auto;
}

/* Inline tree row (folder button + new-note btn) */
.notes-row {
  display: flex;
  align-items: center;
  padding-right: 4px;
}

.notes-row .notes-item {
  flex: 1;
  min-width: 0;
  padding-left: 0;
}

.new-note-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}

.notes-row:hover .new-note-btn {
  opacity: 1;
}

.new-note-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Always visible on touch devices */
@media (hover: none) {
  .new-note-btn {
    opacity: 1;
  }
}

/* Inline new note input row */
.notes-inline-create {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 0;
}

.notes-inline-input {
  flex: 1;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  font-family: inherit;
  min-width: 0;
}

.notes-inline-input:focus {
  border-color: var(--text-muted);
}

.notes-inline-input::placeholder {
  color: var(--text-muted);
}

.notes-inline-confirm {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
}

.notes-inline-confirm:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Section labels */
.notes-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding: 8px 10px 4px;
}

/* Recent notes */
.notes-recent {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}

/* File tree list */
.notes-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}

.notes-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text-secondary);
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.notes-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.notes-item.active {
  background: var(--bg-hover);
  color: var(--accent-color);
}

.notes-item.directory {
  color: var(--text-primary);
}

.notes-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* Chevron toggle */
.chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 0.15s;
}

.chevron.open {
  transform: rotate(90deg);
}

/* Loading spinner */
.spin {
  flex-shrink: 0;
  color: var(--text-muted);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Folder loading indicator row */
.notes-folder-loading {
  display: flex;
  align-items: center;
  padding: 4px 0;
  color: var(--text-muted);
}

.notes-empty-list {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

/* Skeleton loading */
.notes-skeleton {
  height: 24px;
  margin: 4px 10px;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Context menu */
.notes-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.notes-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.notes-ctx-item:hover {
  background: var(--bg-hover);
}

.notes-ctx-item.danger {
  color: #ef4444;
}

/* Delete confirm dialog */
.notes-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.notes-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px 24px;
  max-width: 340px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.notes-dialog-msg {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

.notes-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.notes-dialog-cancel {
  padding: 7px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.notes-dialog-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.notes-dialog-confirm {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: #ef4444;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity 0.15s;
}

.notes-dialog-confirm:hover {
  opacity: 0.85;
}
</style>

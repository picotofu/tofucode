<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'select', 'reference', 'download']);

const route = useRoute();

const searchQuery = ref('');
const selectedIndex = ref(0);
const inputRef = ref(null);
const searching = ref(false);
const results = ref([]);
const currentCwd = ref('');

// WebSocket connection
import { useWebSocket } from '../composables/useWebSocket';

const { send, onMessage } = useWebSocket();

// Sort results: folders first, then files (both alphabetically)
function sortResults(items) {
  return items.sort((a, b) => {
    // Folders first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    // Then alphabetically by name
    return a.name.localeCompare(b.name);
  });
}

// Transform item: add "/" suffix to folders
function transformItem(item) {
  return {
    ...item,
    displayName: item.isDirectory ? `${item.name}/` : item.name,
  };
}

// Handle search results and browse results
onMessage((msg) => {
  if (msg.type === 'files:search:result') {
    const items = (msg.results || []).map(transformItem);
    results.value = sortResults(items);
    currentCwd.value = msg.projectPath || '';
    searching.value = false;
  } else if (msg.type === 'files:search:error') {
    console.error('File search error:', msg.error);
    results.value = [];
    searching.value = false;
  } else if (msg.type === 'files:browse:result') {
    // Initial directory listing (only show if no search query)
    if (!searchQuery.value) {
      // Transform browse results to match search result format
      // For browse results, all items are in the same dir (shown in CWD), so no need to show path
      const items = (msg.items || [])
        .map((item) => ({
          ...item,
          directory: '', // Empty since CWD indicator already shows the location
        }))
        .map(transformItem);
      results.value = sortResults(items);
      currentCwd.value = msg.path || '';
      searching.value = false;
    }
  } else if (msg.type === 'files:browse:error') {
    console.error('File browse error:', msg.error);
    if (!searchQuery.value) {
      results.value = [];
      searching.value = false;
    }
  }
});

// Debounced search
let searchTimeout = null;
watch(searchQuery, (query) => {
  clearTimeout(searchTimeout);

  if (!query.trim()) {
    results.value = [];
    searching.value = false;
    return;
  }

  searching.value = true;
  searchTimeout = setTimeout(() => {
    send({
      type: 'files:search',
      query: query.trim(),
      // Send project slug from route - backend will convert it to path
      projectPath: route.params.project,
    });
  }, 150); // 150ms debounce
});

// Reset state when palette opens and load initial directory
watch(
  () => props.show,
  (isVisible) => {
    if (isVisible) {
      searchQuery.value = '';
      results.value = [];
      selectedIndex.value = 0;
      searching.value = true;

      // Load current directory listing
      send({
        type: 'files:browse',
        path: route.params.project, // Send project slug, backend will convert
      });

      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  },
);

// Reset selected index when results change
watch(results, () => {
  selectedIndex.value = 0;
});

// Scroll selected item into view when navigating with keyboard
watch(selectedIndex, () => {
  nextTick(() => {
    const selectedElement = document.querySelector('.picker-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  });
});

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex.value < results.value.length - 1) {
      selectedIndex.value++;
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const file = results.value[selectedIndex.value];
    if (file) {
      if (e.metaKey || e.ctrlKey) {
        // Cmd+Enter / Ctrl+Enter → reference in chat
        handleReference(null, file);
      } else {
        selectFile(file);
      }
    }
    return;
  }
}

function selectFile(file) {
  if (!file) return;
  emit('select', file);
  // Don't close here - let parent handle closing after navigation
}

function handleReference(event, file) {
  if (event) event.stopPropagation(); // Prevent triggering file selection
  if (!file) return;
  emit('reference', file);
  emit('close'); // Close picker after referencing
}

function handleDownload(event, file) {
  if (event) event.stopPropagation();
  if (!file || file.isDirectory) return;
  emit('download', file);
  emit('close');
}

// Normalize word separators for flexible matching (mirrors backend logic)
function normalizeSeps(s) {
  return s.replace(/[\s_\-/]+/g, ' ').trim();
}

// Highlight matching characters in filename (fuzzy, char-by-char)
function highlightMatch(text, query) {
  if (!query) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts = [];
  let lastIndex = 0;
  let queryIndex = 0;

  for (let i = 0; i < text.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      if (i > lastIndex) {
        parts.push({ text: text.slice(lastIndex, i), match: false });
      }
      parts.push({ text: text[i], match: true });
      lastIndex = i + 1;
      queryIndex++;
      if (queryIndex === lowerQuery.length) break;
    }
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return parts;
}

// Highlight a substring match within a path string (used for fullpath match type).
// Tries exact substring first; falls back to normalized separator matching.
function highlightPathMatch(text, query) {
  if (!query) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Try exact substring match first
  const idx = lowerText.indexOf(lowerQuery);
  if (idx !== -1) {
    const parts = [];
    if (idx > 0) parts.push({ text: text.slice(0, idx), match: false });
    parts.push({ text: text.slice(idx, idx + lowerQuery.length), match: true });
    if (idx + lowerQuery.length < text.length) {
      parts.push({ text: text.slice(idx + lowerQuery.length), match: false });
    }
    return parts;
  }

  // Fall back: find the normalized query inside the normalized text, then map
  // character ranges back to the original string for highlighting.
  const normQuery = normalizeSeps(lowerQuery);
  const normText = normalizeSeps(lowerText);
  const normIdx = normText.indexOf(normQuery);
  if (normIdx === -1) return [{ text, match: false }];

  // Map normalized index back to original: count non-separator chars
  // Build a map: normText[i] → original index of that char
  const normToOrig = [];
  let ni = 0;
  let prevWasSep = false;
  for (let oi = 0; oi < lowerText.length; oi++) {
    const isSep = /[\s_\-/]/.test(lowerText[oi]);
    if (isSep) {
      if (!prevWasSep) {
        normToOrig[ni] = oi; // the single space in normText maps here
        ni++;
      }
      prevWasSep = true;
    } else {
      normToOrig[ni] = oi;
      ni++;
      prevWasSep = false;
    }
  }

  const origStart = normToOrig[normIdx] ?? 0;
  const origEnd = normToOrig[normIdx + normQuery.length - 1] ?? text.length - 1;

  const parts = [];
  if (origStart > 0)
    parts.push({ text: text.slice(0, origStart), match: false });
  parts.push({ text: text.slice(origStart, origEnd + 1), match: true });
  if (origEnd + 1 < text.length)
    parts.push({ text: text.slice(origEnd + 1), match: false });
  return parts;
}
</script>

<template>
	<Teleport to="body">
		<div v-if="show" class="picker-overlay" @click="$emit('close')">
			<div class="picker" @click.stop>
				<div class="picker-input-wrapper">
					<svg
						class="picker-icon"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
						/>
						<polyline points="13 2 13 9 20 9" />
					</svg>
					<input
						ref="inputRef"
						v-model="searchQuery"
						type="text"
						class="picker-input"
						placeholder="Search files..."
						@keydown="handleKeydown"
					/>
					<span v-if="searching" class="picker-loading">Searching...</span>
					<kbd class="picker-hint">esc</kbd>
				</div>

				<!-- CWD indicator -->
				<div v-if="currentCwd" class="picker-cwd">
					<span class="picker-cwd-label">cwd:</span>
					<span class="picker-cwd-path">{{ currentCwd }}</span>
					<span class="picker-cwd-legend"><kbd>↵</kbd> open · <kbd>⌘↵</kbd> reference</span>
				</div>

				<div class="picker-results" v-if="results.length > 0">
					<div
						v-for="(file, index) in results"
						:key="file.path"
						class="picker-item"
						:class="{ selected: index === selectedIndex }"
						@click="selectFile(file)"
						@mouseenter="selectedIndex = index"
					>
						<div class="picker-item-content">
							<div class="picker-item-name">
								<template v-for="(part, i) in highlightMatch(file.displayName, file.matchType === 'fullpath' ? '' : searchQuery)" :key="i">
									<span :class="{ 'match-highlight': part.match }">{{ part.text }}</span>
								</template>
							</div>
							<div class="picker-item-path">
								<template v-if="file.matchType === 'fullpath'" v-for="(part, i) in highlightPathMatch(file.relativePath?.split('\\').join('/') || file.directory, searchQuery)" :key="i">
									<span :class="{ 'match-highlight': part.match }">{{ part.text }}</span>
								</template>
								<template v-else>{{ file.directory }}</template>
							</div>
						</div>

						<!-- Action buttons -->
						<div class="picker-item-actions">
							<button
								v-if="!file.isDirectory"
								class="picker-download-btn"
								title="Download this file"
								@click="handleDownload($event, file)"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
									<polyline points="7 10 12 15 17 10"/>
									<line x1="12" y1="15" x2="12" y2="3"/>
								</svg>
							</button>
							<button
								class="picker-ref-btn"
								:title="file.isDirectory ? 'Reference this folder' : 'Reference this file'"
								@click="handleReference($event, file)"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
									<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
								</svg>
							</button>
						</div>

						<!-- Folder icon -->
						<svg
							v-if="file.isDirectory"
							class="picker-item-icon picker-folder-icon"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
						</svg>
						<!-- File icon -->
						<svg
							v-else
							class="picker-item-icon"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
							/>
							<polyline points="13 2 13 9 20 9" />
						</svg>
					</div>
				</div>

				<div class="picker-empty" v-else-if="searchQuery && !searching">
					<p>No files found</p>
				</div>

				<div class="picker-empty" v-else-if="!searchQuery">
					<p>Type to search files and folders...</p>
					<p class="picker-hint-text">Supports fuzzy search and glob patterns (*.md, *.js, etc.)</p>
				</div>

				<div class="picker-empty" v-else-if="searching">
					<p>Searching...</p>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.picker-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	justify-content: center;
	padding-top: 15vh;
	z-index: 1000;
}

.picker {
	width: 100%;
	max-width: 600px;
	max-height: 500px;
	background: var(--bg-primary);
	border: 1px solid var(--border-color);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-lg);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.picker-input-wrapper {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	border-bottom: 1px solid var(--border-color);
}

.picker-icon {
	flex-shrink: 0;
	color: var(--text-muted);
}

.picker-input {
	flex: 1;
	font-size: 14px;
	background: transparent;
	color: var(--text-primary);
}

.picker-input::placeholder {
	color: var(--text-muted);
}

.picker-loading {
	font-size: 11px;
	color: var(--text-muted);
	font-style: italic;
}

.picker-hint {
	font-size: 11px;
	padding: 2px 6px;
	background: var(--bg-tertiary);
	border-radius: var(--radius-sm);
	color: var(--text-muted);
	font-family: var(--font-mono);
}

.picker-cwd {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 16px;
	border-bottom: 1px solid var(--border-color);
	background: var(--bg-tertiary);
	font-size: 11px;
	font-family: var(--font-mono);
}

.picker-cwd-label {
	color: var(--text-muted);
	font-weight: 600;
}

.picker-cwd-path {
	color: var(--text-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	flex: 1;
}

.picker-cwd-legend {
	margin-left: auto;
	color: var(--text-muted);
	font-size: 10px;
	white-space: nowrap;
	display: flex;
	align-items: center;
	gap: 2px;
	flex-shrink: 0;
}

.picker-cwd-legend kbd {
	font-size: 10px;
	padding: 1px 4px;
	background: var(--bg-secondary);
	border-radius: var(--radius-sm);
	font-family: var(--font-mono);
}

.picker-results {
	flex: 1;
	overflow-y: auto;
	padding: 8px;
}

.picker-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 12px;
	border-radius: var(--radius-md);
	cursor: pointer;
	transition: background 0.1s;
}

.picker-item:hover,
.picker-item.selected {
	background: var(--bg-hover);
}

.picker-item.selected {
	background: var(--bg-tertiary);
}

.picker-item-content {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.picker-item-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.match-highlight {
	background: rgba(255, 200, 0, 0.3);
	color: var(--text-primary);
	font-weight: 600;
}

.picker-item-path {
	font-size: 11px;
	color: var(--text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-family: var(--font-mono);
}

.picker-ref-btn {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	background: transparent;
	color: var(--text-muted);
	border: 1px solid transparent;
	border-radius: var(--radius-sm);
	cursor: pointer;
	transition: all 0.15s;
	opacity: 0;
}

.picker-item:hover .picker-ref-btn,
.picker-item.selected .picker-ref-btn,
.picker-item:hover .picker-download-btn,
.picker-item.selected .picker-download-btn {
	opacity: 1;
}

.picker-item-actions {
	display: flex;
	align-items: center;
	gap: 2px;
	flex-shrink: 0;
}

.picker-ref-btn:hover {
	background: var(--bg-secondary);
	color: var(--text-secondary);
	border-color: var(--border-color);
}

.picker-download-btn {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	background: transparent;
	color: var(--text-muted);
	border: 1px solid transparent;
	border-radius: var(--radius-sm);
	cursor: pointer;
	transition: all 0.15s;
	opacity: 0;
}

.picker-download-btn:hover {
	background: var(--bg-secondary);
	color: var(--text-secondary);
	border-color: var(--border-color);
}

.picker-item-icon {
	flex-shrink: 0;
	color: var(--text-muted);
}

.picker-folder-icon {
	color: var(--accent-color, #4a9eff);
}

.picker-empty {
	padding: 32px;
	text-align: center;
	color: var(--text-muted);
	font-size: 13px;
}

.picker-hint-text {
	margin-top: 8px;
	font-size: 11px;
	color: var(--text-muted);
	opacity: 0.7;
}
</style>

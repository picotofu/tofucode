import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

const SHOW_DOTFILES_KEY = 'tofucode:show-dotfiles';
const MD_MODE_KEY = 'tofucode:md-mode';

/**
 * useFilesManager — transport-agnostic files state and logic.
 *
 * @param {object} options
 * @param {function} options.send        - WS send function (session-scoped or global)
 * @param {function} options.onMessage   - WS message listener registration
 * @param {function} [options.onReference] - Called with item when "Reference" is triggered.
 *                                          If omitted, the Reference context-menu action is hidden.
 * @param {import('vue').ComputedRef<boolean>} [options.autoSave] - Whether auto-save is enabled
 * @param {string} [options.initialPath] - Starting directory path (fallback: home resolved server-side)
 * @param {import('vue').Ref<string>|string} [options.homePath] - Topmost browsable path (ref or plain string).
 *                                                                 Prevents navigating above home/root.
 */
export function useFilesManager({
  send,
  onMessage,
  onReference,
  autoSave,
  initialPath,
  homePath,
} = {}) {
  // ─── State ─────────────────────────────────────────────────────────────────

  const filesCurrentPath = ref('');
  // The topmost browsable path — always homePath (root config ?? homedir()).
  // Empty string means no restriction (no homePath provided).
  const isRef = homePath && typeof homePath === 'object' && 'value' in homePath;
  const filesRootPath = ref(isRef ? (homePath.value ?? '') : (homePath ?? ''));
  // If homePath is a ref, sync whenever it resolves (arrives after the connected message)
  if (isRef) {
    watch(homePath, (val) => {
      if (val) filesRootPath.value = val;
    });
  }
  const filesItems = ref([]);
  const filesLoading = ref(false);
  const filesFilter = ref('');
  const filesSearchResults = ref(null); // null = not searching; array = results
  const filesSearching = ref(false);

  const showDotfiles = ref(localStorage.getItem(SHOW_DOTFILES_KEY) === 'true');
  watch(showDotfiles, (val) => localStorage.setItem(SHOW_DOTFILES_KEY, val));

  const mdMode = ref(localStorage.getItem(MD_MODE_KEY) === 'true');
  watch(mdMode, (val) =>
    localStorage.setItem(MD_MODE_KEY, val ? 'true' : 'false'),
  );

  const openedFile = ref(null); // { path, content, loading, isBinary, binaryReason, size }
  const fileEditorRef = ref(null);
  const fileExplorerRef = ref(null);
  const savedFileListScrollTop = ref(0);
  const htmlRenderMode = ref(false);

  const fileModals = ref({
    createFile: false,
    createFileName: '',
    createFolder: false,
    createFolderName: '',
    rename: null,
    renameNewName: '',
    delete: null,
    editPath: false,
    editPathValue: '',
    pendingFileToOpen: null,
  });

  // ─── Computed ───────────────────────────────────────────────────────────────

  const filteredFilesItems = computed(() => {
    let items = filesItems.value;
    if (!showDotfiles.value) {
      items = items.filter((item) => !item.name.startsWith('.'));
    }
    if (mdMode.value) {
      items = items.filter(
        (item) =>
          (item.isDirectory && item.hasMarkdown) ||
          item.name.toLowerCase().endsWith('.md'),
      );
    }
    return items;
  });

  const filesBreadcrumbs = computed(() => {
    if (!filesCurrentPath.value) return [];
    const parts = filesCurrentPath.value.split('/').filter(Boolean);
    return parts.map((part, index) => {
      const path = `/${parts.slice(0, index + 1).join('/')}`;
      const navigable =
        !filesRootPath.value || path.startsWith(filesRootPath.value);
      return { name: part, path, navigable };
    });
  });

  const openedFileName = computed(() => {
    if (!openedFile.value?.path) return '';
    return openedFile.value.path.split('/').pop();
  });

  const fileSize = computed(() => {
    if (!openedFile.value?.content) return '0 B';
    const bytes = new Blob([openedFile.value.content]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  });

  const totalLines = computed(() => {
    if (!openedFile.value?.content) return 0;
    return openedFile.value.content.split('\n').length;
  });

  const totalChars = computed(() => {
    if (!openedFile.value?.content) return 0;
    return openedFile.value.content.length;
  });

  const isHtmlFile = computed(() => {
    const ext = openedFile.value?.path?.split('.').pop()?.toLowerCase();
    return ext === 'html' || ext === 'htm';
  });

  /** Whether the Reference context menu action is available */
  const hasReference = computed(() => typeof onReference === 'function');

  // ─── Debounced search watcher ───────────────────────────────────────────────

  let filesSearchTimeout = null;
  watch(filesFilter, (query) => {
    clearTimeout(filesSearchTimeout);
    if (!query.trim()) {
      filesSearchResults.value = null;
      filesSearching.value = false;
      return;
    }
    filesSearching.value = true;
    filesSearchResults.value = null;
    filesSearchTimeout = setTimeout(() => {
      send({
        type: 'files:search',
        query: query.trim(),
        projectPath: filesCurrentPath.value,
        showDotfiles: showDotfiles.value,
      });
    }, 150);
  });

  // ─── WS message handler ─────────────────────────────────────────────────────

  function handleFileMessage(msg) {
    switch (msg.type) {
      case 'files:browse:result':
        filesCurrentPath.value = msg.path;
        filesItems.value = msg.items;
        filesLoading.value = false;
        filesFilter.value = '';
        filesSearchResults.value = null;
        filesSearching.value = false;
        break;

      case 'files:browse:error':
        console.error('Browse error:', msg.error);
        filesLoading.value = false;
        break;

      case 'files:search:result':
        if (filesFilter.value.trim()) {
          filesSearchResults.value = msg.results || [];
        }
        filesSearching.value = false;
        break;

      case 'files:search:error':
        console.error('File search error:', msg.error);
        filesSearchResults.value = [];
        filesSearching.value = false;
        break;

      case 'files:read:result':
        if (openedFile.value && openedFile.value.path === msg.path) {
          openedFile.value = {
            path: msg.path,
            content: msg.content,
            size: msg.size,
            isBinary: msg.isBinary || false,
            binaryReason: msg.reason || null,
            loading: false,
          };
        }
        break;

      case 'files:read:error':
        console.error('Read error:', msg.error);
        if (openedFile.value) {
          openedFile.value = null;
        }
        break;

      case 'files:write:result':
        break;

      case 'files:write:error':
        console.error('Write error:', msg.error);
        break;

      case 'files:create:result':
        if (fileModals.value.pendingFileToOpen === msg.path) {
          openedFile.value = { path: msg.path, content: '', loading: true };
          send({ type: 'files:read', path: msg.path });
          fileModals.value.pendingFileToOpen = null;
        }
        break;

      case 'files:create:error':
        console.error('Create error:', msg.error);
        fileModals.value.pendingFileToOpen = null;
        break;
    }
  }

  const unsubscribe = onMessage(handleFileMessage);
  onUnmounted(() => unsubscribe?.());

  // ─── Navigation & file handlers ─────────────────────────────────────────────

  function handleFilesNavigate(path) {
    filesCurrentPath.value = path;
    filesLoading.value = true;
    send({ type: 'files:browse', path });
  }

  /** Initialize the browser at a given path, or fall back to null (server resolves home). */
  function initialize(path) {
    const target = path || initialPath || null;
    if (target) {
      handleFilesNavigate(target);
    } else {
      // Let server resolve home directory
      filesLoading.value = true;
      send({ type: 'files:browse', path: null });
    }
  }

  function resetState() {
    filesCurrentPath.value = '';
    // Restore root to homePath if available, so root guard stays active after session changes
    filesRootPath.value = isRef ? (homePath.value ?? '') : (homePath ?? '');
    filesItems.value = [];
    filesLoading.value = false;
    openedFile.value = null;
    filesFilter.value = '';
    filesSearchResults.value = null;
    filesSearching.value = false;
  }

  function goUpDirectory() {
    if (openedFile.value) {
      fileEditorRef.value?.close();
      return;
    }
    const current = filesCurrentPath.value;
    if (!current || current === '/' || current === filesRootPath.value) return;
    const parent = current.split('/').slice(0, -1).join('/') || '/';
    handleFilesNavigate(parent);
  }

  function handleFileSelect(file) {
    savedFileListScrollTop.value = fileExplorerRef.value?.getScrollTop() ?? 0;
    htmlRenderMode.value = false;
    openedFile.value = { path: file.path, content: '', loading: true };
    send({ type: 'files:read', path: file.path });
  }

  function handleFileSave(data) {
    send({ type: 'files:write', path: data.path, content: data.content });
  }

  function handleFileClose() {
    openedFile.value = null;
    htmlRenderMode.value = false;
    nextTick(() => {
      fileExplorerRef.value?.setScrollTop(savedFileListScrollTop.value);
    });
  }

  function handleFileDownload() {
    const file = openedFile.value;
    if (!file || file.loading || !file.content) return;
    const fileName = file.path.split('/').pop();
    let href;
    if (file.content.startsWith('data:')) {
      href = file.content;
    } else {
      const blob = new Blob([file.content], { type: 'text/plain' });
      href = URL.createObjectURL(blob);
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.click();
    if (!file.content.startsWith('data:')) {
      URL.revokeObjectURL(href);
    }
  }

  function handleReference(item) {
    if (typeof onReference === 'function') {
      onReference(item);
    }
  }

  function handleRename(item) {
    fileModals.value.rename = item;
    fileModals.value.renameNewName = item.name;
  }

  function handleDelete(item) {
    fileModals.value.delete = item;
  }

  function handleEditPath() {
    fileModals.value.editPath = true;
    fileModals.value.editPathValue = filesCurrentPath.value;
  }

  function cancelEditPath() {
    fileModals.value.editPath = false;
    fileModals.value.editPathValue = '';
  }

  function confirmEditPath() {
    let newPath = fileModals.value.editPathValue.trim();
    if (!newPath) return;
    // Clamp to root: if typed path is above the root, fall back to root
    if (
      filesRootPath.value &&
      newPath !== filesRootPath.value &&
      !newPath.startsWith(`${filesRootPath.value}/`)
    ) {
      newPath = filesRootPath.value;
    }
    handleFilesNavigate(newPath);
    fileModals.value.editPath = false;
    fileModals.value.editPathValue = '';
  }

  function confirmCreateFile() {
    const fileName = fileModals.value.createFileName.trim();
    if (!fileName) return;
    const filePath = `${filesCurrentPath.value}/${fileName}`.replace(
      /\/+/g,
      '/',
    );
    fileModals.value.pendingFileToOpen = filePath;
    send({ type: 'files:create', path: filePath, isDirectory: false });
    fileModals.value.createFile = false;
    fileModals.value.createFileName = '';
  }

  function confirmCreateFolder() {
    const folderName = fileModals.value.createFolderName.trim();
    if (!folderName) return;
    const folderPath = `${filesCurrentPath.value}/${folderName}`.replace(
      /\/+/g,
      '/',
    );
    send({ type: 'files:create', path: folderPath, isDirectory: true });
    fileModals.value.createFolder = false;
    fileModals.value.createFolderName = '';
  }

  function confirmRename() {
    const item = fileModals.value.rename;
    const newName = fileModals.value.renameNewName.trim();
    if (!item || !newName) return;
    const oldPath = item.path;
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${newName}`.replace(/\/+/g, '/');
    send({ type: 'files:rename', oldPath, newPath });
    fileModals.value.rename = null;
    fileModals.value.renameNewName = '';
  }

  function confirmDelete() {
    const item = fileModals.value.delete;
    if (!item) return;
    send({ type: 'files:delete', path: item.path });
    fileModals.value.delete = null;
  }

  // ─── Public interface ───────────────────────────────────────────────────────

  return {
    // State
    filesCurrentPath,
    filesRootPath,
    filesItems,
    filesLoading,
    filesFilter,
    filesSearchResults,
    filesSearching,
    showDotfiles,
    mdMode,
    openedFile,
    fileEditorRef,
    fileExplorerRef,
    savedFileListScrollTop,
    htmlRenderMode,
    fileModals,

    // Computed
    filteredFilesItems,
    filesBreadcrumbs,
    openedFileName,
    fileSize,
    totalLines,
    totalChars,
    isHtmlFile,
    hasReference,

    // Config
    autoSave: autoSave ?? ref(false),

    // Handlers
    initialize,
    resetState,
    goUpDirectory,
    handleFilesNavigate,
    handleFileSelect,
    handleFileSave,
    handleFileClose,
    handleFileDownload,
    handleReference,
    handleRename,
    handleDelete,
    handleEditPath,
    cancelEditPath,
    confirmEditPath,
    confirmCreateFile,
    confirmCreateFolder,
    confirmRename,
    confirmDelete,
  };
}

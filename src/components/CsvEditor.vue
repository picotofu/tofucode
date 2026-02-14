<script setup>
import Papa from 'papaparse';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  content: { type: String, required: true },
  filePath: { type: String, required: true },
});

const emit = defineEmits(['change']);

const tableRef = ref(null);
const hasHeader = ref(true);
let tabulatorInstance = null;
let isInitializing = true;

// Parse CSV to table data
function parseCSV(csvContent, useHeader = true) {
  const result = Papa.parse(csvContent, {
    header: useHeader,
    skipEmptyLines: true,
    dynamicTyping: false, // Keep as strings for editing
  });

  if (useHeader) {
    return {
      columns: result.meta.fields.map((field) => ({
        title: field,
        field: field,
        editor: 'input',
        headerSort: true,
        resizable: true,
      })),
      data: result.data,
    };
  }

  // No header - generate column names (Column 1, Column 2, etc.)
  const columnCount = result.data[0]?.length || 0;
  return {
    columns: Array.from({ length: columnCount }, (_, i) => ({
      title: `Column ${i + 1}`,
      field: String(i),
      editor: 'input',
      headerSort: true,
      resizable: true,
    })),
    data: result.data,
  };
}

// Convert table data back to CSV
function tableToCSV() {
  if (!tabulatorInstance) return '';
  const data = tabulatorInstance.getData();

  if (hasHeader.value) {
    // When header mode is on, Papa.unparse will use object keys as headers
    return Papa.unparse(data);
  }

  // When header mode is off, convert array of objects back to array of arrays
  const arrayData = data.map((row) => {
    const columns = tabulatorInstance.getColumns();
    return columns.map((col) => row[col.getField()] || '');
  });

  return Papa.unparse(arrayData, { header: false });
}

// Reinitialize table with current header setting
function reinitializeTable() {
  if (!tabulatorInstance) return;

  const { columns, data } = parseCSV(props.content, hasHeader.value);
  tabulatorInstance.setColumns(columns);
  tabulatorInstance.setData(data);
}

// Toggle header mode
function toggleHeader() {
  hasHeader.value = !hasHeader.value;
  reinitializeTable();
  // Don't emit change for just toggling view mode
}

// Initialize Tabulator
onMounted(() => {
  const { columns, data } = parseCSV(props.content, hasHeader.value);

  tabulatorInstance = new Tabulator(tableRef.value, {
    data: data,
    columns: columns,
    layout: 'fitDataStretch',
    reactiveData: true,
    height: '100%',
  });

  // Register events using .on() (Tabulator v6 events API)
  tabulatorInstance.on('cellEdited', (cell) => {
    console.log('[CsvEditor] Cell edited:', cell.getField(), cell.getValue());
    const csvContent = tableToCSV();
    emit('change', csvContent);
  });

  tabulatorInstance.on('dataChanged', (data) => {
    if (isInitializing) return;
    console.log('[CsvEditor] Data changed, rows:', data.length);
    const csvContent = tableToCSV();
    emit('change', csvContent);
  });

  // Mark initialization as complete after a short delay
  setTimeout(() => {
    isInitializing = false;
    console.log('[CsvEditor] Initialization complete, ready for edits');
  }, 100);
});

// Watch for external content changes (file reload)
watch(
  () => props.content,
  (newContent) => {
    if (tabulatorInstance) {
      const { columns, data } = parseCSV(newContent, hasHeader.value);
      tabulatorInstance.setColumns(columns);
      tabulatorInstance.setData(data);
    }
  },
);

// Cleanup on unmount
onBeforeUnmount(() => {
  if (tabulatorInstance) {
    tabulatorInstance.destroy();
    tabulatorInstance = null;
  }
});
</script>

<template>
	<div class="csv-editor-container">
		<!-- Header toggle toolbar -->
		<div class="csv-toolbar">
			<label class="header-toggle-label">
				<input
					type="checkbox"
					v-model="hasHeader"
					class="header-checkbox"
					@change="reinitializeTable"
				/>
				<span class="header-label-text">Header</span>
			</label>
		</div>

		<!-- Table -->
		<div ref="tableRef" class="csv-editor" />
	</div>
</template>

<style scoped>
.csv-editor-container {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
}

.csv-toolbar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: var(--bg-secondary);
	border-bottom: 1px solid var(--border-color);
}

.header-toggle-label {
	display: flex;
	align-items: center;
	gap: 10px;
	cursor: pointer;
}

.header-checkbox {
	appearance: none;
	width: 18px;
	height: 18px;
	cursor: pointer;
	border: 1.5px solid var(--border-color);
	border-radius: var(--radius-sm);
	background: var(--bg-primary);
	transition: all 0.15s ease;
	position: relative;
	flex-shrink: 0;
}

.header-checkbox:hover {
	border-color: var(--text-secondary);
}

.header-checkbox:checked {
	background: var(--text-primary);
	border-color: var(--text-primary);
}

.header-checkbox:checked::after {
	content: '';
	position: absolute;
	left: 5px;
	top: 2px;
	width: 4px;
	height: 8px;
	border: solid var(--bg-primary);
	border-width: 0 2px 2px 0;
	transform: rotate(45deg);
}

.header-label-text {
	font-size: 12px;
	color: var(--text-primary);
	user-select: none;
}

.csv-editor {
	flex: 1;
	overflow: auto;
}
</style>

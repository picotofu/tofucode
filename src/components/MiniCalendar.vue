<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  existingDates: {
    type: Set,
    default: () => new Set(),
  },
  selectedDate: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['select-date']);

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const todayStr = computed(() => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
});

const monthLabel = computed(() => {
  const date = new Date(currentYear.value, currentMonth.value, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
});

const dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const calendarDays = computed(() => {
  const year = currentYear.value;
  const month = currentMonth.value;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = [];

  // Leading blanks
  for (let i = 0; i < firstDay; i++) {
    days.push({ day: '', dateStr: '', blank: true });
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;
    days.push({ day: d, dateStr, blank: false });
  }

  return days;
});

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

function goToToday() {
  const d = new Date();
  currentYear.value = d.getFullYear();
  currentMonth.value = d.getMonth();
}

function selectDate(dateStr) {
  if (dateStr) {
    emit('select-date', dateStr);
  }
}
</script>

<template>
  <div class="mini-calendar">
    <div class="calendar-nav">
      <button class="cal-nav-btn" title="Previous month" @click="prevMonth">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <button class="cal-month-label" @click="goToToday" title="Go to today">{{ monthLabel }}</button>
      <button class="cal-nav-btn" title="Next month" @click="nextMonth">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
    <div class="calendar-grid">
      <div v-for="header in dayHeaders" :key="header" class="cal-header">{{ header }}</div>
      <div
        v-for="(cell, i) in calendarDays"
        :key="i"
        class="cal-day"
        :class="{
          blank: cell.blank,
          today: cell.dateStr === todayStr,
          selected: cell.dateStr === selectedDate,
          'has-note': !cell.blank && existingDates.has(cell.dateStr),
        }"
        @click="!cell.blank && selectDate(cell.dateStr)"
      >
        <span v-if="!cell.blank" class="day-number">{{ cell.day }}</span>
        <span v-if="!cell.blank && existingDates.has(cell.dateStr)" class="note-dot" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-calendar {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.cal-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.cal-nav-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cal-month-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.cal-month-label:hover {
  background: var(--bg-hover);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.cal-header {
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  padding: 2px 0;
  user-select: none;
}

.cal-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 26px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}

.cal-day.blank {
  cursor: default;
}

.cal-day:not(.blank):hover {
  background: var(--bg-hover);
}

.day-number {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1;
}

.cal-day.today .day-number {
  color: var(--text-primary);
  font-weight: 600;
}

.cal-day.today {
  background: var(--bg-tertiary);
}

.cal-day.selected {
  background: var(--bg-hover);
}

.cal-day.selected .day-number {
  color: var(--accent-color);
  font-weight: 600;
}

.note-dot {
  position: absolute;
  bottom: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--success-color);
}
</style>

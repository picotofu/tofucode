import { onMounted, onUnmounted, ref } from 'vue';

export function useDebugMode(enabled) {
  const hoveredElement = ref(null);
  const popoverPosition = ref({ x: 0, y: 0 });
  const popoverData = ref({ id: '', classes: [] });

  function handleMouseOver(event) {
    if (!enabled.value) return;

    const target = event.target;
    hoveredElement.value = target;

    // Get element info
    const id = target.id || '';

    // Get all classes except Vue's scoped/runtime classes
    // Filter out: data-v-* attributes and classes starting with _
    const classes = Array.from(target.classList).filter((c) => {
      // Exclude Vue scoped classes (starts with _) and hash-like classes
      return !c.match(/^_[a-zA-Z0-9_-]+$/) && !c.match(/^data-v-/);
    });

    popoverData.value = {
      id,
      classes,
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

import { onUnmounted, watch } from 'vue';

/**
 * Composable to intercept the Android hardware back button (and browser back)
 * to close an overlay (modal, sidebar, drawer) instead of navigating away.
 *
 * How it works:
 * - When the overlay opens (isOpen: false → true), pushes a synthetic history entry
 *   so the back button has something to "pop" before real navigation occurs.
 * - When the user presses back (popstate), the overlay is closed instead of navigating.
 * - When the overlay is closed programmatically (X button, Escape, etc.),
 *   the synthetic entry is removed via history.back().
 *
 * @param {import('vue').Ref<boolean>} isOpen - Reactive boolean indicating overlay state
 * @param {() => void} close - Function that sets isOpen to false
 * @param {{ mobileOnly?: boolean, mobileBreakpoint?: number }} [options]
 *   mobileOnly: if true, only pushes history sentinel when on mobile.
 *   mobileBreakpoint: max-width in px to consider "mobile" (default: 768).
 *   Useful for overlays that become non-blocking panels on desktop.
 */
export function useBackButton(isOpen, close, options = {}) {
  const { mobileOnly = false, mobileBreakpoint = 768 } = options;

  // Tracks whether the current close was triggered by the popstate event.
  // If so, the sentinel is already consumed — we must NOT call history.back() again.
  let closedByPopstate = false;

  // Tracks whether we actually pushed a sentinel for the current open state.
  // On desktop with mobileOnly=true, we skip pushState — must not call history.back() on close.
  let sentinelPushed = false;

  function shouldPushSentinel() {
    if (!mobileOnly) return true;
    return window.matchMedia(`(max-width: ${mobileBreakpoint}px)`).matches;
  }

  // Note: each useBackButton instance has its own popstate listener. If two overlays
  // are open simultaneously, both listeners fire — but only the one whose isOpen is true
  // will act. This relies on at most one overlay being open at a time per consumer.
  function onPopstate() {
    if (isOpen.value) {
      closedByPopstate = true;
      sentinelPushed = false;
      close();
    }
  }

  window.addEventListener('popstate', onPopstate);

  watch(isOpen, (nowOpen, wasOpen) => {
    if (nowOpen && !wasOpen) {
      // Overlay just opened — push sentinel if applicable
      if (shouldPushSentinel()) {
        history.pushState({ overlay: true }, '');
        sentinelPushed = true;
      }
    } else if (!nowOpen && wasOpen) {
      if (closedByPopstate) {
        // Closed by popstate — sentinel already consumed, reset flag
        closedByPopstate = false;
      } else if (sentinelPushed) {
        // Programmatic close — pop the sentinel
        sentinelPushed = false;
        history.back();
      }
    }
  });

  onUnmounted(() => {
    window.removeEventListener('popstate', onPopstate);
  });
}

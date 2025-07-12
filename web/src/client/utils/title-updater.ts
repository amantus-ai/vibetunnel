/**
 * Simple utility to update page title based on URL
 */

let currentSessionId: string | null = null;
let cleanupFunctions: Array<() => void> = [];

function updateTitleFromUrl() {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get('session');

  if (sessionId && sessionId !== currentSessionId) {
    currentSessionId = sessionId;
    // Title updates for session view are handled by app.ts
    // Don't interfere with that logic
  } else if (!sessionId && currentSessionId) {
    // Back to list view
    currentSessionId = null;
    // Wait a bit for DOM to update before counting
    setTimeout(() => {
      const sessionCount = document.querySelectorAll('session-card').length;
      document.title =
        sessionCount > 0
          ? `VibeTunnel - ${sessionCount} Session${sessionCount !== 1 ? 's' : ''}`
          : 'VibeTunnel';
    }, 100);
  }
}

// Initialize
export function initTitleUpdater() {
  // Clean up any existing listeners first
  cleanup();

  // Check on load
  updateTitleFromUrl();

  // Monitor URL changes with debouncing
  let mutationTimeout: NodeJS.Timeout | null = null;
  const observer = new MutationObserver(() => {
    if (mutationTimeout) clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(updateTitleFromUrl, 100);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also listen for popstate
  const popstateHandler = () => updateTitleFromUrl();
  window.addEventListener('popstate', popstateHandler);

  // Check periodically as fallback
  const intervalId = setInterval(updateTitleFromUrl, 2000); // Less frequent

  // Store cleanup functions
  cleanupFunctions = [
    () => observer.disconnect(),
    () => window.removeEventListener('popstate', popstateHandler),
    () => clearInterval(intervalId),
    () => {
      if (mutationTimeout) clearTimeout(mutationTimeout);
    },
  ];
}

// Cleanup function to prevent memory leaks
export function cleanup() {
  cleanupFunctions.forEach((fn) => fn());
  cleanupFunctions = [];
}

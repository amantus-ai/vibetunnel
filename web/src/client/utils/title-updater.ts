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

    // Find session name from the page content
    setTimeout(() => {
      // Look for session name in multiple places
      const sessionElements = document.querySelectorAll(
        'session-card, .sidebar, [data-session-id], .session-name, h1, h2'
      );
      let sessionName: string | null = null;

      for (const element of sessionElements) {
        const text = element.textContent?.trim() || '';

        // Look for any text that could be a session name
        // First try to find data attributes
        if (element.hasAttribute('data-session-name')) {
          sessionName = element.getAttribute('data-session-name');
          break;
        }

        // Try to extract from element content - be more flexible
        // Look for patterns like "Session X", "test-session-X", or any non-path text
        if (text && !text.includes('/') && text.length > 0 && text.length < 100) {
          // Skip if it looks like a path or too generic
          if (!text.startsWith('~') && !text.startsWith('/')) {
            sessionName = text.split('\n')[0]; // Take first line if multi-line
            break;
          }
        }
      }

      if (sessionName) {
        document.title = `${sessionName} - VibeTunnel`;
      } else {
        // Fallback to generic session title
        document.title = `Session - VibeTunnel`;
      }
    }, 500);
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

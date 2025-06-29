/**
 * Simple utility to update page title based on URL
 */

let currentSessionId: string | null = null;

function updateTitleFromUrl() {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get('session');

  if (sessionId && sessionId !== currentSessionId) {
    currentSessionId = sessionId;

    // Find session name from the page content
    setTimeout(() => {
      // Look for session name in the sidebar or session cards
      const sessionElements = document.querySelectorAll('session-card, .sidebar');
      let sessionName: string | null = null;

      for (const element of sessionElements) {
        const text = element.textContent || '';
        // Extract session name - it usually appears before the path
        const match = text.match(/test-session-[\d-\w]+|Session \d+/);
        if (match) {
          sessionName = match[0];
          break;
        }
      }

      if (sessionName) {
        document.title = `${sessionName} - VibeTunnel`;
      }
    }, 500);
  } else if (!sessionId && currentSessionId) {
    // Back to list view
    currentSessionId = null;
    const sessionCount = document.querySelectorAll('session-card').length;
    document.title = `VibeTunnel - ${sessionCount} Session${sessionCount !== 1 ? 's' : ''}`;
  }
}

// Initialize
export function initTitleUpdater() {
  // Check on load
  updateTitleFromUrl();

  // Monitor URL changes
  const observer = new MutationObserver(() => {
    updateTitleFromUrl();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also listen for popstate
  window.addEventListener('popstate', updateTitleFromUrl);

  // Check periodically as fallback
  setInterval(updateTitleFromUrl, 1000);
}

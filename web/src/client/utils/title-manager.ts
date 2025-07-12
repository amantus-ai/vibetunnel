/**
 * Centralized title management for VibeTunnel
 */

export class TitleManager {
  private static instance: TitleManager;
  private cleanupFunctions: Array<() => void> = [];
  private currentSessionId: string | null = null;

  private constructor() {}

  static getInstance(): TitleManager {
    if (!TitleManager.instance) {
      TitleManager.instance = new TitleManager();
    }
    return TitleManager.instance;
  }

  /**
   * Set title for session view
   */
  setSessionTitle(sessionName: string): void {
    document.title = `VibeTunnel - ${sessionName}`;
  }

  /**
   * Set title for list view with session count
   */
  setListTitle(sessionCount: number): void {
    document.title =
      sessionCount > 0
        ? `VibeTunnel - ${sessionCount} Session${sessionCount !== 1 ? 's' : ''}`
        : 'VibeTunnel';
  }

  /**
   * Set title for file browser
   */
  setFileBrowserTitle(): void {
    document.title = 'VibeTunnel - File Browser';
  }

  /**
   * Initialize automatic title updates for list view
   */
  initAutoUpdates(): void {
    this.cleanup();

    // Monitor URL changes for list view updates
    const updateFromUrl = () => {
      const url = new URL(window.location.href);
      const sessionId = url.searchParams.get('session');

      if (sessionId !== this.currentSessionId) {
        this.currentSessionId = sessionId;

        // Only auto-update title for list view (no session ID)
        if (!sessionId) {
          setTimeout(() => {
            const sessionCount = document.querySelectorAll('session-card').length;
            this.setListTitle(sessionCount);
          }, 100);
        }
      }
    };

    // Initial check
    updateFromUrl();

    // Monitor DOM changes for session count updates
    let mutationTimeout: NodeJS.Timeout | null = null;
    const observer = new MutationObserver(() => {
      if (mutationTimeout) clearTimeout(mutationTimeout);
      mutationTimeout = setTimeout(updateFromUrl, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for URL changes
    const popstateHandler = () => updateFromUrl();
    window.addEventListener('popstate', popstateHandler);

    // Store cleanup functions
    this.cleanupFunctions = [
      () => observer.disconnect(),
      () => window.removeEventListener('popstate', popstateHandler),
      () => {
        if (mutationTimeout) clearTimeout(mutationTimeout);
      },
    ];
  }

  /**
   * Clean up event listeners
   */
  cleanup(): void {
    this.cleanupFunctions.forEach((fn) => fn());
    this.cleanupFunctions = [];
  }
}

// Export singleton instance
export const titleManager = TitleManager.getInstance();

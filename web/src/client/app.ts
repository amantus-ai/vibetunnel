import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

// Import shared types
import type { Session } from '../shared/types.js';

// Import logger
import { createLogger } from './utils/logger.js';

// Import version
import { VERSION } from './version.js';

// Import components
import './components/app-header.js';
import './components/session-create-form.js';
import './components/session-list.js';
import './components/session-view.js';
import './components/session-card.js';
import './components/file-browser.js';
import './components/log-viewer.js';
import './components/notification-settings.js';
import './components/notification-status.js';

import type { SessionCard } from './components/session-card.js';

const logger = createLogger('app');

@customElement('vibetunnel-app')
export class VibeTunnelApp extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private errorMessage = '';
  @state() private successMessage = '';
  @state() private sessions: Session[] = [];
  @state() private loading = false;
  @state() private currentView: 'list' | 'session' = 'list';
  @state() private selectedSessionId: string | null = null;
  @state() private hideExited = this.loadHideExitedState();
  @state() private showCreateModal = false;
  @state() private showFileBrowser = false;
  @state() private showNotificationSettings = false;
  private initialLoadComplete = false;

  private hotReloadWs: WebSocket | null = null;
  private errorTimeoutId: number | null = null;
  private successTimeoutId: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.setupHotReload();
    this.loadSessions();
    this.startAutoRefresh();
    this.setupRouting();
    this.setupKeyboardShortcuts();
    this.setupNotificationHandlers();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.hotReloadWs) {
      this.hotReloadWs.close();
    }
    // Clean up routing listeners
    window.removeEventListener('popstate', this.handlePopState);
    // Clean up keyboard shortcuts
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // Handle Cmd+O / Ctrl+O to open file browser
    if ((e.metaKey || e.ctrlKey) && e.key === 'o' && this.currentView === 'list') {
      e.preventDefault();
      this.showFileBrowser = true;
    }
  };

  private setupKeyboardShortcuts() {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private showError(message: string) {
    // Clear any existing error timeout
    if (this.errorTimeoutId !== null) {
      clearTimeout(this.errorTimeoutId);
      this.errorTimeoutId = null;
    }

    this.errorMessage = message;
    // Clear error after 5 seconds
    this.errorTimeoutId = window.setTimeout(() => {
      this.errorMessage = '';
      this.errorTimeoutId = null;
    }, 5000);
  }

  private showSuccess(message: string) {
    // Clear any existing success timeout
    if (this.successTimeoutId !== null) {
      clearTimeout(this.successTimeoutId);
      this.successTimeoutId = null;
    }

    this.successMessage = message;
    // Clear success after 5 seconds
    this.successTimeoutId = window.setTimeout(() => {
      this.successMessage = '';
      this.successTimeoutId = null;
    }, 5000);
  }

  private clearError() {
    // Only clear if there's no active timeout
    if (this.errorTimeoutId === null) {
      this.errorMessage = '';
    }
  }

  private clearSuccess() {
    // Clear the timeout if active
    if (this.successTimeoutId !== null) {
      clearTimeout(this.successTimeoutId);
      this.successTimeoutId = null;
    }
    this.successMessage = '';
  }

  private async loadSessions() {
    // Only show loading state on initial load, not on refreshes
    if (!this.initialLoadComplete) {
      this.loading = true;
    }
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        this.sessions = (await response.json()) as Session[];
        this.clearError();
      } else {
        this.showError('Failed to load sessions');
      }
    } catch (error) {
      logger.error('error loading sessions:', error);
      this.showError('Failed to load sessions');
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
    }
  }

  private startAutoRefresh() {
    // Refresh sessions every 3 seconds, but only when showing session list
    setInterval(() => {
      if (this.currentView === 'list') {
        this.loadSessions();
      }
    }, 3000);
  }

  private async handleSessionCreated(e: CustomEvent) {
    const sessionId = e.detail.sessionId;
    const message = e.detail.message;

    if (!sessionId) {
      this.showError('Session created but ID not found in response');
      return;
    }

    this.showCreateModal = false;

    // Check if this was a terminal spawn (not a web session)
    if (message && message.includes('Terminal spawned successfully')) {
      // Don't try to switch to the session - it's running in a terminal window
      this.showSuccess('Terminal window opened successfully');
      return;
    }

    // Wait for session to appear in the list and then switch to it
    await this.waitForSessionAndSwitch(sessionId);
  }

  private async waitForSessionAndSwitch(sessionId: string) {
    const maxAttempts = 10;
    const delay = 500; // 500ms between attempts

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.loadSessions();

      // Try to find by exact ID match
      const session = this.sessions.find((s) => s.id === sessionId);

      if (session) {
        // Session found, switch to session view via URL
        window.location.search = `?session=${session.id}`;
        return;
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // If we get here, session creation might have failed
    logger.log('session not found after all attempts');
    this.showError('Session created but could not be found. Please refresh.');
  }

  private handleSessionKilled(e: CustomEvent) {
    logger.log(`session ${e.detail} killed`);
    this.loadSessions(); // Refresh the list
  }

  private handleRefresh() {
    this.loadSessions();
  }

  private handleError(e: CustomEvent) {
    this.showError(e.detail);
  }

  private handleHideExitedChange(e: CustomEvent) {
    this.hideExited = e.detail;
    this.saveHideExitedState(this.hideExited);
  }

  private handleCreateSession() {
    // Check if View Transitions API is supported
    if ('startViewTransition' in document && typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => {
        this.showCreateModal = true;
      });
    } else {
      this.showCreateModal = true;
    }
  }

  private handleCreateModalClose() {
    // Check if View Transitions API is supported
    if ('startViewTransition' in document && typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => {
        this.showCreateModal = false;
      });
    } else {
      this.showCreateModal = false;
    }
  }

  private async handleNavigateToSession(e: CustomEvent): Promise<void> {
    const { sessionId } = e.detail;

    // Check if View Transitions API is supported
    if ('startViewTransition' in document && typeof document.startViewTransition === 'function') {
      // Debug: Check what elements have view-transition-name before transition
      logger.debug('before transition - elements with view-transition-name:');
      document.querySelectorAll('[style*="view-transition-name"]').forEach((el) => {
        logger.debug('element:', el, 'style:', el.getAttribute('style'));
      });

      // Use View Transitions API for smooth animation
      const transition = document.startViewTransition(async () => {
        // Update state which will trigger a re-render
        this.selectedSessionId = sessionId;
        this.currentView = 'session';
        this.updateUrl(sessionId);

        // Wait for LitElement to complete its update
        await this.updateComplete;

        // Debug: Check what elements have view-transition-name after transition
        logger.debug('after transition - elements with view-transition-name:');
        document.querySelectorAll('[style*="view-transition-name"]').forEach((el) => {
          logger.debug('element:', el, 'style:', el.getAttribute('style'));
        });
      });

      // Log if transition is ready
      transition.ready
        .then(() => {
          logger.debug('view transition ready');
        })
        .catch((err) => {
          logger.error('view transition failed:', err);
        });
    } else {
      // Fallback for browsers without View Transitions support
      this.selectedSessionId = sessionId;
      this.currentView = 'session';
      this.updateUrl(sessionId);
    }
  }

  private handleNavigateToList(): void {
    // Check if View Transitions API is supported
    if ('startViewTransition' in document && typeof document.startViewTransition === 'function') {
      // Use View Transitions API for smooth animation
      document.startViewTransition(() => {
        // Update state which will trigger a re-render
        this.selectedSessionId = null;
        this.currentView = 'list';
        this.updateUrl();

        // Force update to ensure DOM changes happen within the transition
        return this.updateComplete;
      });
    } else {
      // Fallback for browsers without View Transitions support
      this.selectedSessionId = null;
      this.currentView = 'list';
      this.updateUrl();
    }
  }

  private async handleKillAll() {
    // Find all session cards and call their kill method
    const sessionCards = this.querySelectorAll<SessionCard>('session-card');
    const killPromises: Promise<boolean>[] = [];

    sessionCards.forEach((card: SessionCard) => {
      // Check if this session is running
      if (card.session && card.session.status === 'running') {
        // Call the public kill method which handles animation and API call
        killPromises.push(card.kill());
      }
    });

    if (killPromises.length === 0) {
      return;
    }

    // Wait for all kill operations to complete
    const results = await Promise.all(killPromises);
    const successCount = results.filter((r) => r).length;

    if (successCount === killPromises.length) {
      this.showSuccess(`All ${successCount} sessions killed successfully`);
    } else if (successCount > 0) {
      this.showError(`Killed ${successCount} of ${killPromises.length} sessions`);
    } else {
      this.showError('Failed to kill sessions');
    }

    // Refresh the session list after a short delay to allow animations to complete
    setTimeout(() => {
      this.loadSessions();
    }, 500);
  }

  private handleCleanExited() {
    // Find the session list and call its cleanup method directly
    const sessionList = this.querySelector('session-list') as HTMLElement & {
      handleCleanupExited?: () => void;
    };
    if (sessionList && sessionList.handleCleanupExited) {
      sessionList.handleCleanupExited();
    }
  }

  // State persistence methods
  private loadHideExitedState(): boolean {
    try {
      const saved = localStorage.getItem('hideExitedSessions');
      return saved !== null ? saved === 'true' : true; // Default to true if not set
    } catch (error) {
      logger.error('error loading hideExited state:', error);
      return true; // Default to true on error
    }
  }

  private saveHideExitedState(value: boolean): void {
    try {
      localStorage.setItem('hideExitedSessions', String(value));
    } catch (error) {
      logger.error('error saving hideExited state:', error);
    }
  }

  // URL Routing methods
  private setupRouting() {
    // Handle browser back/forward navigation
    window.addEventListener('popstate', this.handlePopState.bind(this));

    // Parse initial URL and set state
    this.parseUrlAndSetState();
  }

  private handlePopState = (_event: PopStateEvent) => {
    // Handle browser back/forward navigation
    this.parseUrlAndSetState();
  };

  private parseUrlAndSetState() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('session');

    if (sessionId) {
      this.selectedSessionId = sessionId;
      this.currentView = 'session';
    } else {
      this.selectedSessionId = null;
      this.currentView = 'list';
    }
  }

  private updateUrl(sessionId?: string) {
    const url = new URL(window.location.href);

    if (sessionId) {
      url.searchParams.set('session', sessionId);
    } else {
      url.searchParams.delete('session');
    }

    // Update browser URL without triggering page reload
    window.history.pushState(null, '', url.toString());
  }

  private setupHotReload(): void {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}?hotReload=true`;

        this.hotReloadWs = new WebSocket(wsUrl);
        this.hotReloadWs.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'reload') {
            window.location.reload();
          }
        };
      } catch (error) {
        logger.log('error setting up hot reload:', error);
      }
    }
  }

  private setupNotificationHandlers() {
    // Listen for notification settings events
    this.addEventListener('show-notification-settings', this.handleShowNotificationSettings);
  }

  private handleShowNotificationSettings = () => {
    this.showNotificationSettings = true;
  };

  private handleCloseNotificationSettings = () => {
    this.showNotificationSettings = false;
  };

  private handleNotificationEnabled = (e: CustomEvent) => {
    const { success, reason } = e.detail;
    if (success) {
      this.showSuccess('Notifications enabled successfully');
    } else {
      this.showError(`Failed to enable notifications: ${reason || 'Unknown error'}`);
    }
  };

  render() {
    return html`
      <!-- Error notification overlay -->
      ${this.errorMessage
        ? html`
            <div class="fixed top-4 right-4 z-50">
              <div
                class="bg-status-error text-dark-bg px-4 py-2 rounded shadow-lg font-mono text-sm"
              >
                ${this.errorMessage}
                <button
                  @click=${() => {
                    if (this.errorTimeoutId !== null) {
                      clearTimeout(this.errorTimeoutId);
                      this.errorTimeoutId = null;
                    }
                    this.errorMessage = '';
                  }}
                  class="ml-2 text-dark-bg hover:text-dark-text"
                >
                  ✕
                </button>
              </div>
            </div>
          `
        : ''}
      ${this.successMessage
        ? html`
            <div class="fixed top-4 right-4 z-50">
              <div
                class="bg-status-success text-dark-bg px-4 py-2 rounded shadow-lg font-mono text-sm"
              >
                ${this.successMessage}
                <button
                  @click=${() => {
                    if (this.successTimeoutId !== null) {
                      clearTimeout(this.successTimeoutId);
                      this.successTimeoutId = null;
                    }
                    this.successMessage = '';
                  }}
                  class="ml-2 text-dark-bg hover:text-dark-text"
                >
                  ✕
                </button>
              </div>
            </div>
          `
        : ''}

      <!-- Main content -->
      ${this.currentView === 'session' && this.selectedSessionId
        ? keyed(
            this.selectedSessionId,
            html`
              <session-view
                .session=${this.sessions.find((s) => s.id === this.selectedSessionId)}
                @navigate-to-list=${this.handleNavigateToList}
              ></session-view>
            `
          )
        : html`
            <div>
              <app-header
                .sessions=${this.sessions}
                .hideExited=${this.hideExited}
                @create-session=${this.handleCreateSession}
                @hide-exited-change=${this.handleHideExitedChange}
                @kill-all-sessions=${this.handleKillAll}
                @clean-exited-sessions=${this.handleCleanExited}
                @open-file-browser=${() => (this.showFileBrowser = true)}
                @open-notification-settings=${this.handleShowNotificationSettings}
              ></app-header>
              <session-list
                .sessions=${this.sessions}
                .loading=${this.loading}
                .hideExited=${this.hideExited}
                .showCreateModal=${this.showCreateModal}
                @session-killed=${this.handleSessionKilled}
                @session-created=${this.handleSessionCreated}
                @create-modal-close=${this.handleCreateModalClose}
                @refresh=${this.handleRefresh}
                @error=${this.handleError}
                @hide-exited-change=${this.handleHideExitedChange}
                @kill-all-sessions=${this.handleKillAll}
                @navigate-to-session=${this.handleNavigateToSession}
              ></session-list>
            </div>
          `}

      <!-- File Browser Modal -->
      <file-browser
        .visible=${this.showFileBrowser}
        .mode=${'browse'}
        .session=${null}
        @browser-cancel=${() => (this.showFileBrowser = false)}
      ></file-browser>

      <!-- Notification Settings Modal -->
      <notification-settings
        .visible=${this.showNotificationSettings}
        @close=${this.handleCloseNotificationSettings}
        @notifications-enabled=${() => this.showSuccess('Notifications enabled')}
        @notifications-disabled=${() => this.showSuccess('Notifications disabled')}
        @success=${(e: CustomEvent) => this.showSuccess(e.detail)}
        @error=${(e: CustomEvent) => this.showError(e.detail)}
      ></notification-settings>

      <!-- Version and logs link in bottom right -->
      <div class="fixed bottom-4 right-4 text-dark-text-secondary text-xs font-mono">
        <a href="/logs" class="hover:text-dark-text transition-colors">Logs</a>
        <span class="ml-2">v${VERSION}</span>
      </div>
    `;
  }
}

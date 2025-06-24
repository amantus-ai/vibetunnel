import { html, LitElement } from 'lit';
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
import './components/auth-login.js';
import './components/ssh-key-manager.js';

import type { SessionCard } from './components/session-card.js';
import { AuthClient } from './services/auth-client.js';

const logger = createLogger('app');

// Interface for session view component's stream connection
interface SessionViewElement extends HTMLElement {
  streamConnection?: {
    disconnect: () => void;
  } | null;
}

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
  @state() private currentView: 'list' | 'session' | 'auth' = 'auth';
  @state() private selectedSessionId: string | null = null;
  @state() private hideExited = this.loadHideExitedState();
  @state() private showCreateModal = false;
  @state() private showFileBrowser = false;
  @state() private showNotificationSettings = false;
  @state() private showSSHKeyManager = false;
  @state() private isAuthenticated = false;
  private initialLoadComplete = false;
  private authClient = new AuthClient();

  private hotReloadWs: WebSocket | null = null;
  private errorTimeoutId: number | null = null;
  private successTimeoutId: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.setupHotReload();
    this.setupKeyboardShortcuts();
    this.setupNotificationHandlers();
    // Initialize authentication and routing together
    this.initializeApp();
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

  private async initializeApp() {
    // First check authentication
    await this.checkAuthenticationStatus();

    // Then setup routing after auth is determined and sessions are loaded
    this.setupRouting();
  }

  private async checkAuthenticationStatus() {
    // Check if no-auth is enabled first
    try {
      const configResponse = await fetch('/api/auth/config');
      if (configResponse.ok) {
        const authConfig = await configResponse.json();
        console.log('🔧 Auth config:', authConfig);

        if (authConfig.noAuth) {
          console.log('🔓 No auth required, bypassing authentication');
          this.isAuthenticated = true;
          this.currentView = 'list';
          await this.loadSessions(); // Wait for sessions to load
          this.startAutoRefresh();
          return;
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch auth config:', error);
    }

    this.isAuthenticated = this.authClient.isAuthenticated();
    console.log('🔐 Authentication status:', this.isAuthenticated);

    if (this.isAuthenticated) {
      this.currentView = 'list';
      await this.loadSessions(); // Wait for sessions to load
      this.startAutoRefresh();
    } else {
      this.currentView = 'auth';
    }
  }

  private async handleAuthSuccess() {
    console.log('✅ Authentication successful');
    this.isAuthenticated = true;
    this.currentView = 'list';
    await this.loadSessions();
    this.startAutoRefresh();

    // Check if there was a session ID in the URL that we should navigate to
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('session');
    if (sessionId) {
      // Try to find the session and navigate to it
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        this.selectedSessionId = sessionId;
        this.currentView = 'session';
      }
    }
  }

  private async handleLogout() {
    console.log('👋 Logging out');
    await this.authClient.logout();
    this.isAuthenticated = false;
    this.currentView = 'auth';
    this.sessions = [];
  }

  private handleShowSSHKeyManager() {
    this.showSSHKeyManager = true;
  }

  private handleCloseSSHKeyManager() {
    this.showSSHKeyManager = false;
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
      const headers = this.authClient.getAuthHeader();
      const response = await fetch('/api/sessions', { headers });
      if (response.ok) {
        this.sessions = (await response.json()) as Session[];
        this.clearError();
      } else if (response.status === 401) {
        // Authentication failed, redirect to login
        this.handleLogout();
        return;
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
    if (message?.includes('Terminal spawned successfully')) {
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
        // Session found, navigate to it using the proper navigation method
        await this.handleNavigateToSession(
          new CustomEvent('navigate-to-session', {
            detail: { sessionId: session.id },
          })
        );
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

  private cleanupSessionViewStream(): void {
    const sessionView = this.querySelector('session-view') as SessionViewElement;
    if (sessionView?.streamConnection) {
      logger.log('Cleaning up stream connection');
      sessionView.streamConnection.disconnect();
      sessionView.streamConnection = null;
    }
  }

  private async handleNavigateToSession(e: CustomEvent): Promise<void> {
    const { sessionId } = e.detail;

    // Clean up any existing session view stream before switching
    if (this.selectedSessionId !== sessionId) {
      this.cleanupSessionViewStream();
    }

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
    // Clean up the session view before navigating away
    this.cleanupSessionViewStream();

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
    if (sessionList?.handleCleanupExited) {
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
    this.parseUrlAndSetState().catch(console.error);
  }

  private handlePopState = (_event: PopStateEvent) => {
    // Handle browser back/forward navigation
    this.parseUrlAndSetState().catch(console.error);
  };

  private async parseUrlAndSetState() {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('session');

    // Check authentication status first (unless no-auth is enabled)
    try {
      const configResponse = await fetch('/api/auth/config');
      if (configResponse.ok) {
        const authConfig = await configResponse.json();
        if (authConfig.noAuth) {
          // Skip auth check for no-auth mode
        } else if (!this.authClient.isAuthenticated()) {
          this.currentView = 'auth';
          this.selectedSessionId = null;
          return;
        }
      } else if (!this.authClient.isAuthenticated()) {
        this.currentView = 'auth';
        this.selectedSessionId = null;
        return;
      }
    } catch (_error) {
      if (!this.authClient.isAuthenticated()) {
        this.currentView = 'auth';
        this.selectedSessionId = null;
        return;
      }
    }

    if (sessionId) {
      // Check if we have sessions loaded
      if (this.sessions.length === 0 && this.isAuthenticated) {
        // Sessions not loaded yet, load them first
        await this.loadSessions();
      }

      // Now check if the session exists
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        this.selectedSessionId = sessionId;
        this.currentView = 'session';
      } else {
        // Session not found, go to list view
        console.warn(`Session ${sessionId} not found in sessions list`);
        this.selectedSessionId = null;
        this.currentView = 'list';
        // Clear the session param from URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('session');
        window.history.replaceState({}, '', newUrl.toString());
      }
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

  private handleOpenFileBrowser = () => {
    this.showFileBrowser = true;
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
      ${
        this.errorMessage
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
          : ''
      }
      ${
        this.successMessage
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
          : ''
      }

      <!-- Main content -->
      ${
        this.currentView === 'auth'
          ? html`
            <auth-login
              .authClient=${this.authClient}
              @auth-success=${this.handleAuthSuccess}
              @show-ssh-key-manager=${this.handleShowSSHKeyManager}
            ></auth-login>
          `
          : this.currentView === 'session' && this.selectedSessionId
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
                  .currentUser=${this.authClient.getCurrentUser()?.userId || null}
                  .authMethod=${this.authClient.getCurrentUser()?.authMethod || null}
                  @create-session=${this.handleCreateSession}
                  @hide-exited-change=${this.handleHideExitedChange}
                  @kill-all-sessions=${this.handleKillAll}
                  @clean-exited-sessions=${this.handleCleanExited}
                  @open-file-browser=${this.handleOpenFileBrowser}
                  @open-notification-settings=${this.handleShowNotificationSettings}
                  @logout=${this.handleLogout}
                ></app-header>
                <session-list
                  .sessions=${this.sessions}
                  .loading=${this.loading}
                  .hideExited=${this.hideExited}
                  .showCreateModal=${this.showCreateModal}
                  .authClient=${this.authClient}
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
            `
      }

      <!-- File Browser Modal -->
      <file-browser
        .visible=${this.showFileBrowser}
        .mode=${'browse'}
        .session=${null}
        @browser-cancel=${() => {
          this.showFileBrowser = false;
        }}
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

      <!-- SSH Key Manager Modal -->
      <ssh-key-manager
        .visible=${this.showSSHKeyManager}
        .sshAgent=${this.authClient.getSSHAgent()}
        @close=${this.handleCloseSSHKeyManager}
      ></ssh-key-manager>

      <!-- Version and logs link in bottom right -->
      <div class="fixed bottom-4 right-4 text-dark-text-muted text-xs font-mono">
        <a href="/logs" class="hover:text-dark-text transition-colors">Logs</a>
        <span class="ml-2">v${VERSION}</span>
      </div>
    `;
  }
}

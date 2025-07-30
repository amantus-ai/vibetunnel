// Install crypto polyfill first - must be before any code that uses crypto.randomUUID()
import './utils/crypto-polyfill.js';

// Suppress xterm.js errors globally - must be before any other imports
import { suppressXtermErrors } from '../shared/suppress-xterm-errors.js';

suppressXtermErrors();

import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

// Import shared types
import type { Session } from '../shared/types.js';
import { HttpMethod } from '../shared/types.js';
import { isBrowserShortcut } from './utils/browser-shortcuts.js';
// Import utilities
import { BREAKPOINTS, SIDEBAR, TIMING, TRANSITIONS, Z_INDEX } from './utils/constants.js';
// Import logger
import { createLogger } from './utils/logger.js';
import { isIOS } from './utils/mobile-utils.js';
import { type MediaQueryState, responsiveObserver } from './utils/responsive-utils.js';
import { triggerTerminalResize } from './utils/terminal-utils.js';
import { titleManager } from './utils/title-manager.js';

// Import components
import './components/app-header.js';
import './components/session-create-form.js';
import './components/multiplexer-modal.js';
import './components/session-list.js';
import './components/session-view.js';
import './components/session-card.js';
import './components/file-browser.js';
import './components/log-viewer.js';
import './components/settings.js';
import './components/notification-status.js';
import './components/auth-login.js';
import './components/ssh-key-manager.js';
import './components/git-notification-handler.js';
import type { GitNotificationHandler } from './components/git-notification-handler.js';

import { authClient } from './services/auth-client.js';
import { bufferSubscriptionService } from './services/buffer-subscription-service.js';
import { getControlEventService } from './services/control-event-service.js';
import { notificationEventService } from './services/notification-event-service.js';
import { pushNotificationService } from './services/push-notification-service.js';

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
  @state() private currentView: 'list' | 'session' | 'auth' | 'file-browser' = 'auth';
  @state() private selectedSessionId: string | null = null;
  @state() private hideExited = this.loadHideExitedState();
  @state() private showCreateModal = false;
  @state() private createDialogWorkingDir = '';
  @state() private showTmuxModal = false;
  @state() private showSSHKeyManager = false;
  @state() private showSettings = false;
  @state() private isAuthenticated = false;
  @state() private sidebarCollapsed = this.loadSidebarState();
  @state() private sidebarWidth = this.loadSidebarWidth();
  @state() private isResizing = false;
  @state() private mediaState: MediaQueryState = responsiveObserver.getCurrentState();
  @state() private hasActiveOverlay = false;
  @state() private keyboardCaptureActive = true;
  private initialLoadComplete = false;
  private responsiveObserverInitialized = false;
  private initialRenderComplete = false;
  private sidebarAnimationReady = false;
  // Session caching to reduce re-renders
  private _cachedSelectedSession: Session | undefined;
  private _cachedSelectedSessionId: string | null = null;
  private _lastLoggedView: string | null = null;

  private hotReloadWs: WebSocket | null = null;
  private errorTimeoutId: number | null = null;
  private successTimeoutId: number | null = null;
  private autoRefreshIntervalId: number | null = null;
  private responsiveUnsubscribe?: () => void;
  private resizeCleanupFunctions: (() => void)[] = [];
  private sessionLoadingState: 'idle' | 'loading' | 'loaded' | 'not-found' = 'idle';
  private controlEventService?: ReturnType<typeof getControlEventService>;

  connectedCallback() {
    super.connectedCallback();
    this.setupHotReload();
    this.setupKeyboardShortcuts();
    this.setupNotificationHandlers();
    this.setupResponsiveObserver();
    this.setupPreferences();
    // Initialize title updater
    titleManager.initAutoUpdates();
    // Listen for keyboard capture toggle events from input manager
    document.addEventListener('capture-toggled', this.handleCaptureToggled as EventListener);
    // Initialize authentication and routing together
    this.initializeApp();
  }

  firstUpdated() {
    // Connect control event service to git notification handler
    if (this.controlEventService) {
      const gitNotificationHandler = this.querySelector(
        'git-notification-handler'
      ) as GitNotificationHandler;
      if (gitNotificationHandler) {
        gitNotificationHandler.setControlEventService(this.controlEventService);
      }
    }

    // Mark initial render as complete after a microtask to ensure DOM is settled
    Promise.resolve().then(() => {
      this.initialRenderComplete = true;
      // Enable sidebar animations after a short delay to prevent initial load animations
      setTimeout(() => {
        this.sidebarAnimationReady = true;
      }, 100);
    });
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    // Update hasActiveOverlay whenever any overlay state changes
    if (
      changedProperties.has('showCreateModal') ||
      changedProperties.has('showTmuxModal') ||
      changedProperties.has('showSSHKeyManager') ||
      changedProperties.has('showSettings')
    ) {
      this.hasActiveOverlay =
        this.showCreateModal || this.showTmuxModal || this.showSSHKeyManager || this.showSettings;
    }

    // Force re-render when sessions change or view changes to update log button position
    if (changedProperties.has('sessions') || changedProperties.has('currentView')) {
      this.requestUpdate();
    }

    // Add/remove body class based on current view to control animations
    if (changedProperties.has('currentView')) {
      if (this.currentView === 'session') {
        document.body.classList.add('in-session-view');
      } else {
        document.body.classList.remove('in-session-view');
      }
    }
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
    // Clean up capture toggle listener
    document.removeEventListener('capture-toggled', this.handleCaptureToggled as EventListener);
    // Clean up auto refresh interval
    if (this.autoRefreshIntervalId !== null) {
      clearInterval(this.autoRefreshIntervalId);
      this.autoRefreshIntervalId = null;
    }
    // Clean up responsive observer
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
    }
    // Clean up any active resize listeners
    this.cleanupResizeListeners();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const isMacOS = navigator.platform.toLowerCase().includes('mac');

    // Handle Cmd/Ctrl+1234567890 for session switching when keyboard capture is active
    if (this.currentView === 'session' && this.keyboardCaptureActive) {
      const primaryModifier = isMacOS ? e.metaKey : e.ctrlKey;
      const wrongModifier = isMacOS ? e.ctrlKey : e.metaKey;

      if (primaryModifier && !wrongModifier && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();

        // Get the session number (1-9, 0 = 10)
        const sessionNumber = e.key === '0' ? 10 : Number.parseInt(e.key);

        // Get visible sessions in the same order as the session list
        const activeSessions = this.sessions.filter(
          (session) => session.status === 'running' && session.activityStatus?.isActive !== false
        );

        // Check if the requested session exists
        if (sessionNumber > 0 && sessionNumber <= activeSessions.length) {
          const targetSession = activeSessions[sessionNumber - 1];
          if (targetSession) {
            logger.log(`Switching to session ${sessionNumber}: ${targetSession.name}`);
            this.handleNavigateToSession(
              new CustomEvent('navigate-to-session', {
                detail: { sessionId: targetSession.id },
              })
            );
          }
        }

        return;
      }
    }

    // Check if we're capturing and what the shortcut would do
    const checkCapturedShortcut = (): {
      captured: boolean;
      browserAction?: string;
      terminalAction?: string;
    } => {
      const key = e.key.toLowerCase();

      // Define what shortcuts we capture and their actions
      const capturedShortcuts: Record<
        string,
        { browser: string; terminal: string; check: () => boolean }
      > = {
        'mod+a': {
          browser: 'Select all',
          terminal: 'Line start',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'a',
        },
        'mod+e': {
          browser: 'Search/Extension',
          terminal: 'Line end',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'e',
        },
        'mod+w': {
          browser: 'Close tab',
          terminal: 'Delete word',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'w',
        },
        'mod+r': {
          browser: 'Reload',
          terminal: 'History search',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'r',
        },
        'mod+l': {
          browser: 'Address bar',
          terminal: 'Clear screen',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'l',
        },
        'mod+d': {
          browser: 'Bookmark',
          terminal: 'EOF/Exit',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'd',
        },
        'mod+f': {
          browser: 'Find',
          terminal: 'Forward char',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'f',
        },
        'mod+p': {
          browser: 'Print',
          terminal: 'Previous cmd',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'p',
        },
        'mod+u': {
          browser: 'View source',
          terminal: 'Delete to start',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'u',
        },
        'mod+k': {
          browser: 'Search bar',
          terminal: 'Delete to end',
          check: () => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k',
        },
        'alt+d': {
          browser: 'Address bar',
          terminal: 'Delete word fwd',
          check: () => e.altKey && !e.ctrlKey && !e.metaKey && key === 'd',
        },
      };

      for (const config of Object.values(capturedShortcuts)) {
        if (config.check()) {
          return {
            captured: true,
            browserAction: config.browser,
            terminalAction: config.terminal,
          };
        }
      }

      return { captured: false };
    };

    // Always allow critical browser shortcuts
    if (isBrowserShortcut(e)) {
      return;
    }

    // In session view with capture active, check if we're capturing this shortcut
    // But don't capture shortcuts if the session has exited
    const isSessionExited = this.selectedSession?.status === 'exited';
    if (this.currentView === 'session' && this.keyboardCaptureActive && !isSessionExited) {
      const { captured, browserAction, terminalAction } = checkCapturedShortcut();
      if (captured) {
        // Dispatch event for indicator animation
        window.dispatchEvent(
          new CustomEvent('shortcut-captured', {
            detail: {
              shortcut: this.formatShortcut(e),
              browserAction,
              terminalAction,
            },
          })
        );
        // Don't prevent default - let terminal handle it
        // The terminal's input manager will capture these
      }
    }

    // Browser shortcut checking for non-session views
    const shouldAllowBrowserShortcut = (): boolean => {
      // If we're not in session view or capture is disabled, use the browser shortcut allow list
      if (this.currentView !== 'session' || !this.keyboardCaptureActive) {
        const key = e.key.toLowerCase();
        const hasModifier = e.ctrlKey || e.metaKey;
        const hasShift = e.shiftKey;
        const hasAlt = e.altKey;

        // Tab management shortcuts
        if (hasModifier && !hasShift && !hasAlt) {
          if (['t', 'w', 'r'].includes(key)) return true;
          if (/^[0-9]$/.test(key)) return true; // Include 0 for tab switching
          if (['l', 'p', 's', 'f', 'd', 'h', 'j'].includes(key)) return true;
        }

        // Ctrl/Cmd + Shift shortcuts
        if (hasModifier && hasShift && !hasAlt) {
          if (['t', 'r', 'n'].includes(key)) return true;
          if (key === 'delete') return true;
          if (key === 'tab') return true;
          if (!isMacOS && key === 'q') return true;
          if (isMacOS && key === 'a') return true;
        }

        // Ctrl/Cmd + Tab
        if (hasModifier && !hasShift && !hasAlt && key === 'tab') {
          return true;
        }

        // Function keys
        if (['f5', 'f6', 'f11'].includes(key)) return true;
      }

      return false;
    };

    // Check if this is a browser shortcut we should not intercept
    if (shouldAllowBrowserShortcut()) {
      return;
    }

    // VibeTunnel-specific shortcuts below this line

    // Handle Cmd+O / Ctrl+O to open file browser (only in list view)
    if ((e.metaKey || e.ctrlKey) && e.key === 'o' && this.currentView === 'list') {
      e.preventDefault();
      this.handleNavigateToFileBrowser();
      return;
    }

    // Handle Cmd+B / Ctrl+B to toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      this.handleToggleSidebar();
      return;
    }

    // Handle Escape to close the session and return to list view
    if (
      e.key === 'Escape' &&
      (this.currentView === 'session' || this.currentView === 'file-browser') &&
      !this.showCreateModal
    ) {
      e.preventDefault();
      this.handleNavigateToList();
      return;
    }
  };

  private setupKeyboardShortcuts() {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private async initializeApp() {
    logger.log('🚀 initializeApp() started');

    // First check authentication
    await this.checkAuthenticationStatus();

    logger.log('✅ checkAuthenticationStatus() completed', {
      isAuthenticated: this.isAuthenticated,
      sessionCount: this.sessions.length,
      currentView: this.currentView,
      initialLoadComplete: this.initialLoadComplete,
    });

    // Then setup routing after auth is determined and sessions are loaded
    // For session routes, this ensures sessions are already loaded before routing
    this.setupRouting();

    logger.log('✅ setupRouting() completed');
  }

  private async checkAuthenticationStatus() {
    // Check if no-auth is enabled first
    let noAuthEnabled = false;
    try {
      const configResponse = await fetch('/api/auth/config');
      if (configResponse.ok) {
        const authConfig = await configResponse.json();
        logger.log('🔧 Auth config:', authConfig);
        noAuthEnabled = authConfig.noAuth;

        if (authConfig.noAuth) {
          logger.log('🔓 No auth required, bypassing authentication');
          this.isAuthenticated = true;
          this.currentView = 'list';
          await this.initializeServices(noAuthEnabled); // Initialize services with no-auth flag
          await this.loadSessions(); // Wait for sessions to load
          this.startAutoRefresh();
          this.initialLoadComplete = true;
          return;
        }
      }
    } catch (error) {
      logger.warn('⚠️ Could not fetch auth config:', error);
    }

    this.isAuthenticated = authClient.isAuthenticated();
    logger.log('🔐 Authentication status:', this.isAuthenticated);

    if (this.isAuthenticated) {
      this.currentView = 'list';
      await this.initializeServices(noAuthEnabled); // Initialize services with no-auth flag
      await this.loadSessions(); // Wait for sessions to load
      this.startAutoRefresh();
      this.initialLoadComplete = true;
    } else {
      this.currentView = 'auth';
    }
  }

  private async handleAuthSuccess() {
    logger.log('✅ Authentication successful');

    // If already authenticated (e.g., in no-auth mode), don't re-initialize
    if (this.isAuthenticated && this.initialLoadComplete) {
      logger.debug('Already authenticated and initialized, skipping re-initialization');
      return;
    }

    // If services are already being initialized, skip
    if (this.servicesInitialized || this.isAuthenticated) {
      logger.debug('Services already initialized or being initialized, skipping');
      return;
    }

    this.isAuthenticated = true;
    this.currentView = 'list';
    await this.initializeServices(false); // Initialize services after auth (auth is enabled)
    await this.loadSessions();
    this.startAutoRefresh();
    this.initialLoadComplete = true;

    // Check if there was a session ID in the URL that we should navigate to
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Check for /session/:id pattern
    if (pathParts.length === 2 && pathParts[0] === 'session') {
      const sessionId = pathParts[1];
      logger.log(`Navigating to session ${sessionId} from URL after auth`);
      this.selectedSessionId = sessionId;
      this.sessionLoadingState = 'idle'; // Reset loading state for new session
      this.currentView = 'session';
    }
  }

  private servicesInitialized = false;

  private async initializeServices(_noAuthEnabled = false) {
    if (this.servicesInitialized) {
      logger.debug('Services already initialized, skipping');
      return;
    }

    logger.log('🚀 Initializing services...');
    try {
      // Initialize buffer subscription service for WebSocket connections
      await bufferSubscriptionService.initialize();

      // Initialize push notification service always
      // It handles its own permission checks and user preferences
      await pushNotificationService.initialize();

      // Initialize control event service for real-time notifications
      this.controlEventService = getControlEventService(authClient);
      this.controlEventService.connect();

      // Initialize notification event service to monitor /api/events SSE connection
      // This is used by the Mac app for notifications
      notificationEventService.setAuthClient(authClient);
      await notificationEventService.connect();

      this.servicesInitialized = true;
      logger.log('✅ Services initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize services:', error);
      // Don't fail the whole app if services fail to initialize
      // These are optional features
    }
  }

  private async handleLogout() {
    logger.log('👋 Logging out');
    await authClient.logout();
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
    // Clear error after configured timeout
    this.errorTimeoutId = window.setTimeout(() => {
      this.errorMessage = '';
      this.errorTimeoutId = null;
    }, TIMING.ERROR_MESSAGE_TIMEOUT);
  }

  private showSuccess(message: string) {
    // Clear any existing success timeout
    if (this.successTimeoutId !== null) {
      clearTimeout(this.successTimeoutId);
      this.successTimeoutId = null;
    }

    this.successMessage = message;
    // Clear success after configured timeout
    this.successTimeoutId = window.setTimeout(() => {
      this.successMessage = '';
      this.successTimeoutId = null;
    }, TIMING.SUCCESS_MESSAGE_TIMEOUT);
  }

  private clearError() {
    // Only clear if there's no active timeout
    if (this.errorTimeoutId === null) {
      this.errorMessage = '';
    }
  }

  private async loadSessions() {
    // Only show loading state on initial load, not on refreshes
    if (!this.initialLoadComplete) {
      this.loading = true;
    }

    const performLoad = async () => {
      try {
        const headers = authClient.getAuthHeader();
        const response = await fetch('/api/sessions', { headers });
        if (response.ok) {
          const newSessions = (await response.json()) as Session[];

          // Debug: Log sessions with activity status
          const sessionsWithActivity = newSessions.filter((s) => s.activityStatus);
          if (sessionsWithActivity.length > 0) {
            logger.debug(
              'Sessions with activity status:',
              sessionsWithActivity.map((s) => ({
                id: s.id,
                name: s.name,
                command: s.command,
                status: s.status,
                activityStatus: s.activityStatus,
              }))
            );
          } else {
            logger.debug('No sessions have activity status');
          }

          // Preserve Git information and reuse existing session objects when possible
          // This prevents unnecessary re-renders by maintaining object references
          const updatedSessions = newSessions.map((newSession) => {
            const existingSession = this.sessions.find((s) => s.id === newSession.id);

            if (existingSession) {
              // Check if the session has actually changed
              const hasChanges =
                existingSession.status !== newSession.status ||
                existingSession.name !== newSession.name ||
                existingSession.workingDir !== newSession.workingDir ||
                existingSession.activityStatus !== newSession.activityStatus ||
                existingSession.exitCode !== newSession.exitCode ||
                // Check if Git info has been added in the new data
                (!existingSession.gitRepoPath && newSession.gitRepoPath) ||
                // Don't check Git counts here - they are updated by git-status-badge component
                // and we want to preserve those updates, not trigger re-renders
                false;

              if (!hasChanges) {
                // No changes - return the existing object reference
                return existingSession;
              }

              // Merge changes, preserving Git info if not in new data
              if (existingSession.gitRepoPath && !newSession.gitRepoPath) {
                logger.debug('[App] Preserving Git info for session', {
                  sessionId: existingSession.id,
                  gitRepoPath: existingSession.gitRepoPath,
                  gitModifiedCount: existingSession.gitModifiedCount,
                  gitUntrackedCount: existingSession.gitUntrackedCount,
                });
                // Update the existing session object in place to preserve reference
                existingSession.status = newSession.status;
                existingSession.name = newSession.name;
                existingSession.workingDir = newSession.workingDir;
                existingSession.activityStatus = newSession.activityStatus;
                existingSession.exitCode = newSession.exitCode;
                existingSession.lastModified = newSession.lastModified;
                existingSession.active = newSession.active;
                existingSession.source = newSession.source;
                existingSession.remoteId = newSession.remoteId;
                existingSession.remoteName = newSession.remoteName;
                existingSession.remoteUrl = newSession.remoteUrl;
                // Git fields are already in existingSession, so we don't need to copy them
                return existingSession;
              }
            }

            // If newSession has Git data, ensure we create a complete session object
            return newSession;
          });

          // Only update sessions if there are actual changes
          const hasSessionChanges =
            updatedSessions.length !== this.sessions.length ||
            updatedSessions.some((session, index) => session !== this.sessions[index]);

          if (hasSessionChanges) {
            this.sessions = updatedSessions;
            // Clear session cache when sessions change
            this._cachedSelectedSession = undefined;
            this._cachedSelectedSessionId = null;
          }
          this.clearError();

          // Update page title if we're in list view
          if (this.currentView === 'list') {
            const sessionCount = this.sessions.length;
            titleManager.setListTitle(sessionCount);
          }

          // Handle session loading state tracking
          if (this.selectedSessionId && this.currentView === 'session') {
            const sessionExists = this.sessions.find((s) => s.id === this.selectedSessionId);

            if (sessionExists) {
              // Session found - mark as loaded
              if (this.sessionLoadingState !== 'loaded') {
                this.sessionLoadingState = 'loaded';
                logger.debug(`Session ${this.selectedSessionId} found and loaded`);
              }
            } else {
              // Session not found - determine action based on loading state and load completion
              if (this.sessionLoadingState === 'loaded') {
                // Session was previously loaded but is now missing (e.g., cleaned up)
                this.sessionLoadingState = 'not-found';
                logger.warn(
                  `Session ${this.selectedSessionId} was loaded but is now missing (possibly cleaned up)`
                );
                this.showError(`Session ${this.selectedSessionId} not found`);
                this.handleNavigateToList();
              } else if (this.sessionLoadingState === 'loading' && this.initialLoadComplete) {
                // We were loading and finished, but session still doesn't exist
                this.sessionLoadingState = 'not-found';
                logger.warn(`Session ${this.selectedSessionId} not found after loading completed`);
                this.showError(`Session ${this.selectedSessionId} not found`);
                this.handleNavigateToList();
              } else if (this.sessionLoadingState === 'idle') {
                // First time checking - start loading
                this.sessionLoadingState = 'loading';
                logger.debug(`Looking for session ${this.selectedSessionId}...`);
              }
              // If state is 'loading' and !initialLoadComplete, just wait
              // If state is 'not-found', we've already handled it
            }
          }
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
    };

    // Use view transition for initial load with fade effect
    if (
      !this.initialLoadComplete &&
      'startViewTransition' in document &&
      typeof document.startViewTransition === 'function'
    ) {
      logger.log('🎨 Using View Transition API for initial session load');
      // Add initial-load class for specific CSS handling
      document.body.classList.add('initial-session-load');

      const transition = document.startViewTransition(async () => {
        await performLoad();
        await this.updateComplete;
      });

      // Log when transition is ready
      transition.ready
        .then(() => {
          logger.log('✨ Initial load view transition ready');
        })
        .catch((err) => {
          // This is expected to fail in browsers that don't support View Transitions
          logger.debug('View transition not supported or failed (this is normal):', err);
        });

      // Clean up the class after transition completes
      transition.finished
        .finally(() => {
          logger.log('✅ Initial load view transition finished');
          document.body.classList.remove('initial-session-load');
        })
        .catch(() => {
          // Ignore errors, just make sure we clean up
          document.body.classList.remove('initial-session-load');
        });
    } else {
      // Regular load without transition
      if (!this.initialLoadComplete) {
        logger.log('🎨 Using CSS animation fallback for initial load');
        document.body.classList.add('initial-session-load');
        await performLoad();
        // Remove class after animation completes
        setTimeout(() => {
          document.body.classList.remove('initial-session-load');
        }, 600);
      } else {
        await performLoad();
      }
    }
  }

  private startAutoRefresh() {
    // Refresh sessions at configured interval for both list and session views
    this.autoRefreshIntervalId = window.setInterval(() => {
      if (this.currentView === 'list' || this.currentView === 'session') {
        this.loadSessions();
      }
    }, TIMING.AUTO_REFRESH_INTERVAL);
  }

  private async handleSessionCreated(e: CustomEvent) {
    const sessionId = e.detail.sessionId;
    const message = e.detail.message;

    if (!sessionId) {
      this.showError('Session created but ID not found in response');
      return;
    }

    // Simply close the modal without animation
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
    console.log('[App] waitForSessionAndSwitch called with:', sessionId);
    const maxAttempts = 10;
    const delay = TIMING.SESSION_SEARCH_DELAY; // Configured delay between attempts

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
      await new Promise((resolve) => window.setTimeout(resolve, delay));
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
    this.showError(e.detail.message || e.detail);
  }

  private async handleHideExitedChange(e: CustomEvent) {
    logger.log('handleHideExitedChange', {
      currentHideExited: this.hideExited,
      newHideExited: e.detail,
      currentView: this.currentView,
    });

    // Skip animations entirely when in session detail view
    const isInSessionDetailView = this.currentView === 'session';

    if (isInSessionDetailView) {
      // Just update state without any animations
      this.hideExited = e.detail;
      this.saveHideExitedState(this.hideExited);
      await this.updateComplete;
      logger.log('Skipped animations in session detail view');
      return;
    }

    // Don't use View Transitions for hide/show exited toggle
    // as it causes the entire UI to fade. Use CSS animations instead.
    const wasHidingExited = this.hideExited;

    // Capture current scroll position and check if we're near the bottom
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100; // Within 100px of bottom

    // Add pre-animation class
    document.body.classList.add('sessions-animating');
    logger.log('Added sessions-animating class');

    // Update state
    this.hideExited = e.detail;
    this.saveHideExitedState(this.hideExited);

    // Wait for render and trigger animations
    await this.updateComplete;
    logger.log('Update complete, scheduling animation');

    requestAnimationFrame(() => {
      // Add specific animation direction
      const animationClass = wasHidingExited ? 'sessions-showing' : 'sessions-hiding';
      document.body.classList.add(animationClass);
      logger.log('Added animation class:', animationClass);

      // Check what elements will be animated
      const cards = document.querySelectorAll('.session-flex-responsive > session-card');
      logger.log('Found session cards to animate:', cards.length);

      // If we were near the bottom, maintain that position
      if (isNearBottom) {
        // Use a small delay to ensure DOM has updated
        requestAnimationFrame(() => {
          window.scrollTo({
            top: document.documentElement.scrollHeight - clientHeight,
            behavior: 'instant',
          });
        });
      }

      // Clean up after animation
      setTimeout(() => {
        document.body.classList.remove('sessions-animating', 'sessions-showing', 'sessions-hiding');
        logger.log('Cleaned up animation classes');

        // Final scroll adjustment after animation completes
        if (isNearBottom) {
          window.scrollTo({
            top: document.documentElement.scrollHeight - clientHeight,
            behavior: 'instant',
          });
        }
      }, 300);
    });
  }

  private handleCreateSession() {
    logger.log('handleCreateSession called');
    // Remove any lingering modal-closing class from previous interactions
    document.body.classList.remove('modal-closing');

    // Clear workingDir when opening from header
    this.createDialogWorkingDir = '';

    // Immediately set the modal to visible
    this.showCreateModal = true;
    logger.log('showCreateModal set to true');

    // Force a re-render immediately
    this.requestUpdate();

    // Animation disabled - modal appears instantly
  }

  private handleCreateModalClose() {
    // Simply close the modal without animation
    this.showCreateModal = false;
    this.createDialogWorkingDir = '';
    this.requestUpdate();
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
    console.log('[App] handleNavigateToSession called with:', sessionId);

    // Clean up any existing session view stream before switching
    if (this.selectedSessionId !== sessionId) {
      this.cleanupSessionViewStream();
    }

    // Debug: Log current state before navigation
    logger.debug('Navigation to session:', {
      sessionId,
      windowWidth: window.innerWidth,
      mobileBreakpoint: BREAKPOINTS.MOBILE,
      isMobile: this.mediaState.isMobile,
      currentSidebarCollapsed: this.sidebarCollapsed,
      mediaStateIsMobile: this.mediaState.isMobile,
    });

    // View Transitions disabled for session navigation to prevent animations
    // Direct state update for instant navigation
    this.selectedSessionId = sessionId;
    this.sessionLoadingState = 'idle'; // Reset loading state for new session
    this.currentView = 'session';
    this.updateUrl(sessionId);

    // Update page title with session name
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      const sessionName = session.name || session.command.join(' ');
      console.log('[App] Setting title:', sessionName);
      titleManager.setSessionTitle(sessionName);
    } else {
      console.log('[App] No session found:', sessionId);
    }

    // Collapse sidebar on mobile after selecting a session
    if (this.mediaState.isMobile) {
      this.sidebarCollapsed = true;
      this.saveSidebarState(true);
    }

    // Trigger terminal resize after session switch to ensure proper dimensions
    this.updateComplete.then(() => {
      triggerTerminalResize(sessionId, this);
    });
  }

  private handleNavigateToFileBrowser(sessionId?: string): void {
    // Store the session ID for context in file browser
    this.selectedSessionId = sessionId || null;

    // Update document title
    titleManager.setFileBrowserTitle();

    // Navigate to file browser view
    this.currentView = 'file-browser';
    this.updateUrl();
  }

  private handleNavigateToList(): void {
    // Clean up the session view before navigating away
    this.cleanupSessionViewStream();

    // Update document title with session count
    const sessionCount = this.sessions.length;
    titleManager.setListTitle(sessionCount);

    // Disable View Transitions when navigating from session detail view
    // to prevent animations when sidebar is involved
    const skipViewTransition = this.currentView === 'session';

    // Check if View Transitions API is supported and should be used
    if (
      !skipViewTransition &&
      'startViewTransition' in document &&
      typeof document.startViewTransition === 'function'
    ) {
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
      // Fallback for browsers without View Transitions support or when skipping
      this.selectedSessionId = null;
      this.currentView = 'list';
      this.updateUrl();
    }
  }

  private async handleKillAll() {
    // Get all running sessions from data instead of DOM elements
    const runningSessions = this.sessions.filter((session) => session.status === 'running');

    if (runningSessions.length === 0) {
      return;
    }

    // Kill all running sessions directly via API
    const killPromises = runningSessions.map(async (session) => {
      try {
        const response = await fetch(`/api/sessions/${session.id}`, {
          method: HttpMethod.DELETE,
          headers: {
            ...authClient.getAuthHeader(),
          },
        });

        if (!response.ok) {
          logger.error(`Failed to kill session ${session.id}:`, response.status);
          return false;
        }

        logger.debug(`Successfully killed session ${session.id}`);
        return true;
      } catch (error) {
        logger.error(`Error killing session ${session.id}:`, error);
        return false;
      }
    });

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

    // Refresh the session list immediately
    await this.loadSessions();
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

  private handleToggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.saveSidebarState(this.sidebarCollapsed);
  }

  private formatShortcut(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push(navigator.platform.toLowerCase().includes('mac') ? 'Option' : 'Alt');
    parts.push(e.key);
    return parts.join('+');
  }

  private handleSessionStatusChanged(e: CustomEvent) {
    logger.log('Session status changed:', e.detail);
    // Immediately refresh the session list to show updated status
    this.loadSessions();
  }

  private handleMobileOverlayClick = (e: Event) => {
    // In portrait mode, dismiss the sidebar
    if (this.isInSidebarDismissMode) {
      e.preventDefault();
      e.stopPropagation();
      this.handleToggleSidebar();
    }
    // In landscape mode, the overlay is transparent and pointer-events-none,
    // so this handler won't be called
  };

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

  private loadSidebarState(): boolean {
    try {
      const saved = localStorage.getItem('sidebarCollapsed');
      const isMobile = window.innerWidth < BREAKPOINTS.MOBILE;

      // Respect saved state if it exists, otherwise default based on device type
      const result = saved !== null ? saved === 'true' : isMobile;

      logger.debug('Loading sidebar state:', {
        savedValue: saved,
        windowWidth: window.innerWidth,
        mobileBreakpoint: BREAKPOINTS.MOBILE,
        isMobile,
        hasSavedState: saved !== null,
        resultingState: result ? 'collapsed' : 'expanded',
      });

      return result;
    } catch (error) {
      logger.error('error loading sidebar state:', error);
      return window.innerWidth < BREAKPOINTS.MOBILE; // Default based on screen size on error
    }
  }

  private saveSidebarState(value: boolean): void {
    try {
      localStorage.setItem('sidebarCollapsed', String(value));
    } catch (error) {
      logger.error('error saving sidebar state:', error);
    }
  }

  private loadSidebarWidth(): number {
    try {
      const saved = localStorage.getItem('sidebarWidth');
      const width = saved !== null ? Number.parseInt(saved, 10) : SIDEBAR.DEFAULT_WIDTH;
      // Validate width is within bounds
      return Math.max(SIDEBAR.MIN_WIDTH, Math.min(SIDEBAR.MAX_WIDTH, width));
    } catch (error) {
      logger.error('error loading sidebar width:', error);
      return SIDEBAR.DEFAULT_WIDTH;
    }
  }

  private saveSidebarWidth(value: number): void {
    try {
      localStorage.setItem('sidebarWidth', String(value));
    } catch (error) {
      logger.error('error saving sidebar width:', error);
    }
  }

  private setupResponsiveObserver(): void {
    this.responsiveUnsubscribe = responsiveObserver.subscribe((state) => {
      const oldState = this.mediaState;
      this.mediaState = state;

      // Only trigger state changes after initial setup and render
      // This prevents the sidebar from flickering on page load
      if (this.responsiveObserverInitialized && this.initialRenderComplete) {
        // Auto-collapse sidebar when switching to mobile
        if (!oldState.isMobile && state.isMobile && !this.sidebarCollapsed) {
          this.sidebarCollapsed = true;
          this.saveSidebarState(true);
        }
        // Auto-expand sidebar when switching from mobile to desktop
        else if (oldState.isMobile && !state.isMobile && this.sidebarCollapsed) {
          this.sidebarCollapsed = false;
          this.saveSidebarState(false);
        }
      } else if (!this.responsiveObserverInitialized) {
        // Mark as initialized after first callback
        this.responsiveObserverInitialized = true;
      }
    });
  }

  private cleanupResizeListeners(): void {
    this.resizeCleanupFunctions.forEach((cleanup) => cleanup());
    this.resizeCleanupFunctions = [];

    // Reset any global styles that might have been applied
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  private handleResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    this.isResizing = true;

    // Clean up any existing listeners first
    this.cleanupResizeListeners();

    document.addEventListener('mousemove', this.handleResize);
    document.addEventListener('mouseup', this.handleResizeEnd);

    // Store cleanup functions
    this.resizeCleanupFunctions.push(() => {
      document.removeEventListener('mousemove', this.handleResize);
      document.removeEventListener('mouseup', this.handleResizeEnd);
    });

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  private handleResize = (e: MouseEvent) => {
    if (!this.isResizing) return;

    const newWidth = Math.max(SIDEBAR.MIN_WIDTH, Math.min(SIDEBAR.MAX_WIDTH, e.clientX));
    this.sidebarWidth = newWidth;
    this.saveSidebarWidth(newWidth);
  };

  private handleResizeEnd = () => {
    this.isResizing = false;
    this.cleanupResizeListeners();
  };

  // URL Routing methods
  private setupRouting() {
    // Handle browser back/forward navigation
    window.addEventListener('popstate', this.handlePopState.bind(this));

    // Parse initial URL and set state
    this.parseUrlAndSetState().catch((error) => logger.error('Error parsing URL:', error));
  }

  private handlePopState = (_event: PopStateEvent) => {
    // Handle browser back/forward navigation
    this.parseUrlAndSetState().catch((error) => logger.error('Error parsing URL:', error));
  };

  private async parseUrlAndSetState() {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(Boolean);

    logger.log('🔍 parseUrlAndSetState() called', {
      url: url.href,
      pathname: url.pathname,
      pathParts,
      currentView: this.currentView,
      isAuthenticated: this.isAuthenticated,
      sessionCount: this.sessions.length,
    });

    // Check for single-segment paths first
    if (pathParts.length === 1) {
      // Check authentication first
      try {
        const configResponse = await fetch('/api/auth/config');
        if (configResponse.ok) {
          const authConfig = await configResponse.json();
          if (!authConfig.noAuth && !authClient.isAuthenticated()) {
            this.currentView = 'auth';
            this.selectedSessionId = null;
            return;
          }
        } else if (!authClient.isAuthenticated()) {
          this.currentView = 'auth';
          this.selectedSessionId = null;
          return;
        }
      } catch (_error) {
        if (!authClient.isAuthenticated()) {
          this.currentView = 'auth';
          this.selectedSessionId = null;
          return;
        }
      }

      // Route based on the path segment
      if (pathParts[0] === 'file-browser') {
        this.currentView = 'file-browser';
        return;
      }
    }

    // Check for /session/:id pattern
    let sessionId: string | null = null;
    if (pathParts.length === 2 && pathParts[0] === 'session') {
      sessionId = pathParts[1];
    }

    // Only check authentication if we haven't initialized yet
    // This prevents duplicate auth checks during initial load
    if (!this.initialLoadComplete && !this.isAuthenticated) {
      logger.log('🔐 Not authenticated, redirecting to auth view');
      this.currentView = 'auth';
      this.selectedSessionId = null;
      return;
    }

    if (sessionId) {
      // Always navigate to the session view if a session ID is provided
      // The session-view component will handle loading and error cases
      logger.log(`🎯 Navigating to session ${sessionId} from URL`);

      // Load sessions if not already loaded and wait for them
      if (this.sessions.length === 0 && this.isAuthenticated) {
        logger.log('📋 Sessions not loaded yet, loading now...');
        await this.loadSessions();
        logger.log('✅ Sessions loaded', { sessionCount: this.sessions.length });
      }

      // Verify the session exists
      const sessionExists = this.sessions.find((s) => s.id === sessionId);
      logger.log('🔍 Looking for session', {
        sessionId,
        found: !!sessionExists,
        availableSessions: this.sessions.map((s) => ({ id: s.id, status: s.status })),
      });

      if (!sessionExists) {
        logger.warn(`❌ Session ${sessionId} not found in loaded sessions`);
        // Show error and navigate to list
        this.showError(`Session ${sessionId} not found`);
        this.selectedSessionId = null;
        this.currentView = 'list';
        return;
      }

      // Session exists, navigate to it
      logger.log('✅ Session found, navigating to session view', {
        sessionId,
        sessionStatus: sessionExists.status,
      });
      this.selectedSessionId = sessionId;
      this.sessionLoadingState = 'loaded';
      this.currentView = 'session';

      // Force update to ensure render happens
      this.requestUpdate();

      logger.log('📍 Navigation complete', {
        currentView: this.currentView,
        selectedSessionId: this.selectedSessionId,
        sessionLoadingState: this.sessionLoadingState,
      });
    } else {
      this.selectedSessionId = null;
      this.currentView = 'list';
    }
  }

  private updateUrl(sessionId?: string) {
    const url = new URL(window.location.href);

    // Clear all params
    url.search = '';

    if (this.currentView === 'file-browser') {
      // Use path-based URL for file-browser view
      url.pathname = '/file-browser';
    } else if (sessionId) {
      // Use path-based URL for session view
      url.pathname = `/session/${sessionId}`;
    } else {
      // Reset to root for list view
      url.pathname = '/';
    }

    // Update browser URL without triggering page reload
    window.history.pushState(null, '', url.toString());
  }

  private setupHotReload(): void {
    // Skip hot reload in test environment
    const isTestEnvironment =
      // Check for NODE_ENV=test (set by CI build)
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
      window.location.search.includes('test=true') ||
      navigator.userAgent.includes('HeadlessChrome') ||
      navigator.userAgent.includes('Headless') ||
      // Check if running in Playwright test context
      (window as unknown as { __playwright?: unknown }).__playwright !== undefined ||
      // Check for playwright-specific user agent
      navigator.userAgent.includes('Playwright') ||
      // Check for common headless indicators
      navigator.webdriver === true ||
      // Check if running on test port
      window.location.port === '4022';

    if (isTestEnvironment) {
      logger.log('Hot reload disabled in test environment');
      return;
    }

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
        this.hotReloadWs.onerror = () => {
          // Silently ignore errors - hot reload is optional
          logger.debug('Hot reload WebSocket connection failed (this is normal in production)');
        };
      } catch (error) {
        logger.debug('Hot reload setup failed (this is normal in production):', error);
      }
    }
  }

  private setupNotificationHandlers() {
    // Listen for notification settings events
  }

  private setupPreferences() {
    // Load preferences from localStorage
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      if (stored) {
        JSON.parse(stored); // Parse to validate JSON
        // Preferences loaded but showLogLink removed
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
    }

    // Listen for preference changes
    window.addEventListener('app-preferences-changed', () => {
      // Preference changes handled but showLogLink removed
    });
  }

  private handleOpenSettings = () => {
    this.showSettings = true;
  };

  private handleCloseSettings = () => {
    this.showSettings = false;
  };

  private handleOpenFileBrowser = () => {
    this.handleNavigateToFileBrowser();
  };

  private handleOpenCreateDialog = (e: CustomEvent) => {
    const workingDir = e.detail?.workingDir || '';
    this.createDialogWorkingDir = workingDir;
    this.handleCreateSession();
  };

  private handleOpenTmuxSessions = () => {
    this.showTmuxModal = true;
  };

  private handleCaptureToggled = (e: CustomEvent) => {
    logger.log(`🎯 handleCaptureToggled called with:`, e.detail);
    this.keyboardCaptureActive = e.detail.active;
    logger.log(
      `Keyboard capture ${this.keyboardCaptureActive ? 'enabled' : 'disabled'} via indicator`
    );
  };

  private get showSplitView(): boolean {
    return this.currentView === 'session' && this.selectedSessionId !== null;
  }

  private get selectedSession(): Session | undefined {
    // Use cached value if session ID hasn't changed
    if (this._cachedSelectedSessionId === this.selectedSessionId && this._cachedSelectedSession) {
      // Verify the cached session still exists in the sessions array
      // Note: We're now updating session objects in place, so the reference should remain stable
      const stillExists = this.sessions.find((s) => s.id === this._cachedSelectedSession?.id);
      if (stillExists) {
        // Update cache to point to the current session object (might be the same reference)
        this._cachedSelectedSession = stillExists;
        return stillExists;
      }
    }

    // Recalculate and cache
    this._cachedSelectedSessionId = this.selectedSessionId;
    this._cachedSelectedSession = this.sessions.find((s) => s.id === this.selectedSessionId);
    return this._cachedSelectedSession;
  }

  private get sidebarClasses(): string {
    if (!this.showSplitView) {
      // Main view - allow normal document flow and scrolling
      return 'w-full min-h-screen flex flex-col';
    }

    const baseClasses = 'bg-secondary flex flex-col';
    const isMobile = this.mediaState.isMobile;
    // Only apply transition class when animations are ready (not during initial load)
    const transitionClass = this.sidebarAnimationReady && !isMobile ? 'sidebar-transition' : '';
    const mobileClasses = isMobile ? `absolute left-0 top-0 bottom-0 flex` : transitionClass;

    const collapsedClasses = this.sidebarCollapsed
      ? isMobile
        ? 'hidden mobile-sessions-sidebar collapsed'
        : 'sm:overflow-hidden sm:translate-x-0 flex'
      : isMobile
        ? 'overflow-visible sm:translate-x-0 flex mobile-sessions-sidebar expanded'
        : 'overflow-visible sm:translate-x-0 flex';

    return `${baseClasses} ${this.showSplitView ? collapsedClasses : ''} ${this.showSplitView ? mobileClasses : ''}`;
  }

  private get sidebarStyles(): string {
    if (!this.showSplitView) {
      return '';
    }

    const isMobile = this.mediaState.isMobile;

    if (this.sidebarCollapsed) {
      // Hide completely on both desktop and mobile
      return 'width: 0px;';
    }

    // Expanded state
    if (isMobile) {
      return `width: calc(100vw - ${SIDEBAR.MOBILE_RIGHT_MARGIN}px); z-index: ${Z_INDEX.SIDEBAR_MOBILE};`;
    }

    return `width: ${this.sidebarWidth}px;`;
  }

  private get shouldShowMobileOverlay(): boolean {
    return this.showSplitView && !this.sidebarCollapsed && this.mediaState.isMobile;
  }

  private get shouldShowResizeHandle(): boolean {
    return this.showSplitView && !this.sidebarCollapsed && !this.mediaState.isMobile;
  }

  private get mainContainerClasses(): string {
    // In split view, we need strict height control and overflow hidden
    // In main view, we need normal document flow for scrolling
    if (this.showSplitView) {
      // Add iOS-specific class to prevent rubber band scrolling
      const iosClass = isIOS() ? 'ios-split-view' : '';
      return `flex h-screen overflow-hidden relative ${iosClass}`;
    }
    return 'min-h-screen';
  }

  private get isInSidebarDismissMode(): boolean {
    if (!this.mediaState.isMobile || !this.shouldShowMobileOverlay) return false;

    // Use orientation-based detection for simplicity and reliability
    const isPortrait = window.innerHeight > window.innerWidth;
    return isPortrait;
  }

  render() {
    const showSplitView = this.showSplitView;
    const selectedSession = this.selectedSession;

    // Reduced logging frequency - only log when view changes
    const shouldLog = this.currentView !== this._lastLoggedView;

    if (shouldLog) {
      logger.log('🎨 App render()', {
        currentView: this.currentView,
        showSplitView,
        selectedSessionId: this.selectedSessionId,
        selectedSession: selectedSession
          ? { id: selectedSession.id, status: selectedSession.status }
          : null,
        isAuthenticated: this.isAuthenticated,
        sessionCount: this.sessions.length,
        cacheHit: this._cachedSelectedSessionId === this.selectedSessionId,
      });
      this._lastLoggedView = this.currentView;
    }

    return html`
      <!-- Error notification overlay -->
      ${
        this.errorMessage
          ? html`
            <div class="fixed top-4 right-4" style="z-index: ${Z_INDEX.MODAL_BACKDROP};">
              <div
                class="bg-status-error text-bg-elevated px-4 py-2 rounded shadow-lg font-mono text-sm"
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
                  class="ml-2 text-bg-elevated hover:text-text-muted"
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
            <div class="fixed top-4 right-4" style="z-index: ${Z_INDEX.MODAL_BACKDROP};">
              <div
                class="bg-status-success text-bg-elevated px-4 py-2 rounded shadow-lg font-mono text-sm"
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
                  class="ml-2 text-bg-elevated hover:text-text-muted"
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
              .authClient=${authClient}
              @auth-success=${this.handleAuthSuccess}
              @show-ssh-key-manager=${this.handleShowSSHKeyManager}
              @open-settings=${this.handleOpenSettings}
            ></auth-login>
          `
          : this.currentView === 'file-browser'
            ? html`
              <!-- Full page file browser view -->
              <file-browser
                .visible=${true}
                .mode=${'browse'}
                .session=${this.selectedSession}
                @browser-cancel=${this.handleNavigateToList}
                @insert-path=${this.handleNavigateToList}
              ></file-browser>
            `
            : html`
      <!-- Main content with split view support -->
      <div class="${this.mainContainerClasses}">
        <!-- Mobile overlay when sidebar is open -->
        ${
          this.shouldShowMobileOverlay
            ? html`
              <div
                class="fixed inset-0 sm:hidden transition-all ${
                  this.isInSidebarDismissMode
                    ? 'bg-bg bg-opacity-50 backdrop-blur-sm'
                    : 'bg-transparent pointer-events-none'
                }"
                style="z-index: ${Z_INDEX.MOBILE_OVERLAY}; transition-duration: ${TRANSITIONS.MOBILE_SLIDE}ms;"
                @click=${this.handleMobileOverlayClick}
              ></div>
            `
            : ''
        }

        <!-- Sidebar with session list - always visible on desktop -->
        <div class="${this.sidebarClasses}" style="${this.sidebarStyles}">
          <app-header
            .sessions=${this.sessions}
            .hideExited=${this.hideExited}
            .showSplitView=${showSplitView}
            .currentUser=${authClient.getCurrentUser()?.userId || null}
            .authMethod=${authClient.getCurrentUser()?.authMethod || null}
            @create-session=${this.handleCreateSession}
            @hide-exited-change=${this.handleHideExitedChange}
            @kill-all-sessions=${this.handleKillAll}
            @clean-exited-sessions=${this.handleCleanExited}
            @open-file-browser=${this.handleOpenFileBrowser}
            @open-tmux-sessions=${this.handleOpenTmuxSessions}
            @open-settings=${this.handleOpenSettings}
            @logout=${this.handleLogout}
            @navigate-to-list=${this.handleNavigateToList}
            @toggle-sidebar=${this.handleToggleSidebar}
          ></app-header>
          <div class="${this.showSplitView ? 'flex-1 overflow-y-auto' : 'flex-1'} bg-secondary">
            <session-list
              .sessions=${this.sessions}
              .loading=${this.loading}
              .hideExited=${this.hideExited}
              .selectedSessionId=${this.selectedSessionId}
              .compactMode=${showSplitView}
              .collapsed=${this.sidebarCollapsed}
              .authClient=${authClient}
              @session-killed=${this.handleSessionKilled}
              @refresh=${this.handleRefresh}
              @error=${this.handleError}
              @hide-exited-change=${this.handleHideExitedChange}
              @kill-all-sessions=${this.handleKillAll}
              @navigate-to-session=${this.handleNavigateToSession}
              @open-file-browser=${this.handleOpenFileBrowser}
              @open-create-dialog=${this.handleOpenCreateDialog}
            ></session-list>
          </div>
        </div>

        <!-- Resize handle for sidebar -->
        ${
          this.shouldShowResizeHandle
            ? html`
              <div
                class="w-1 bg-border hover:bg-accent-green cursor-ew-resize transition-colors ${
                  this.isResizing ? 'bg-accent-green' : ''
                }"
                style="transition-duration: ${TRANSITIONS.RESIZE_HANDLE}ms;"
                @mousedown=${this.handleResizeStart}
                title="Drag to resize sidebar"
              ></div>
            `
            : ''
        }

        <!-- Main content area -->
        ${
          showSplitView
            ? html`
              <div class="flex-1 relative sm:static transition-none">
                ${keyed(
                  this.selectedSessionId,
                  html`
                    <session-view
                      .session=${selectedSession}
                      .showBackButton=${false}
                      .showSidebarToggle=${true}
                      .sidebarCollapsed=${this.sidebarCollapsed}
                      .disableFocusManagement=${this.hasActiveOverlay}
                      .keyboardCaptureActive=${this.keyboardCaptureActive}
                      @navigate-to-list=${this.handleNavigateToList}
                      @toggle-sidebar=${this.handleToggleSidebar}
                      @create-session=${this.handleCreateSession}
                      @session-status-changed=${this.handleSessionStatusChanged}
                      @open-settings=${this.handleOpenSettings}
                      @capture-toggled=${this.handleCaptureToggled}
                    ></session-view>
                  `
                )}
              </div>
            `
            : ''
        }
      </div>
      `
      }


      <!-- Unified Settings Modal -->
      <vt-settings
        .visible=${this.showSettings}
        .authClient=${authClient}
        @close=${this.handleCloseSettings}
        @notifications-enabled=${async () => {
          this.showSuccess('Notifications enabled');
          // Reconnect SSE when notifications are enabled
          await notificationEventService.connect();
        }}
        @notifications-disabled=${() => {
          this.showSuccess('Notifications disabled');
          // Disconnect SSE when notifications are disabled
          notificationEventService.disconnect();
        }}
        @success=${(e: CustomEvent) => this.showSuccess(e.detail)}
        @error=${(e: CustomEvent) => this.showError(e.detail)}
      ></vt-settings>

      <!-- SSH Key Manager Modal -->
      <ssh-key-manager
        .visible=${this.showSSHKeyManager}
        .sshAgent=${authClient.getSSHAgent()}
        @close=${this.handleCloseSSHKeyManager}
      ></ssh-key-manager>

      <!-- Session Create Modal -->
      <session-create-form
        .visible=${this.showCreateModal}
        .workingDir=${this.createDialogWorkingDir}
        .authClient=${authClient}
        @session-created=${this.handleSessionCreated}
        @cancel=${this.handleCreateModalClose}
        @error=${this.handleError}
      ></session-create-form>

      <!-- Git Notification Handler -->
      <git-notification-handler></git-notification-handler>

      <!-- Multiplexer Modal (tmux/Zellij) -->
      <multiplexer-modal
        .open=${this.showTmuxModal}
        @close=${() => {
          this.showTmuxModal = false;
        }}
        @navigate-to-session=${this.handleNavigateToSession}
        @create-session=${this.handleCreateSession}
      ></multiplexer-modal>
    `;
  }
}

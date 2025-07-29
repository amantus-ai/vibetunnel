/**
 * Session View Component
 *
 * Full-screen terminal view for an active session. Handles terminal I/O,
 * streaming updates via SSE, file browser integration, and mobile overlays.
 *
 * @fires navigate-to-list - When navigating back to session list
 * @fires error - When an error occurs (detail: string)
 * @fires warning - When a warning occurs (detail: string)
 *
 * @listens session-exit - From SSE stream when session exits
 * @listens terminal-ready - From terminal component when ready
 * @listens file-selected - From file browser when file is selected
 * @listens browser-cancel - From file browser when cancelled
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import './clickable-path.js';
import './session-view/session-header.js';
import './worktree-manager.js';
import { authClient } from '../services/auth-client.js';
import { GitService } from '../services/git-service.js';
import { createLogger } from '../utils/logger.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';
// Manager imports
import { ConnectionManager } from './session-view/connection-manager.js';
import {
  type DirectKeyboardCallbacks,
  DirectKeyboardManager,
} from './session-view/direct-keyboard-manager.js';
// New managers
import { FileOperationsManager } from './session-view/file-operations-manager.js';
import { InputManager } from './session-view/input-manager.js';
import type { LifecycleEventManagerCallbacks } from './session-view/interfaces.js';
import { LifecycleEventManager } from './session-view/lifecycle-event-manager.js';
import { LoadingAnimationManager } from './session-view/loading-animation-manager.js';
import { MobileInputManager } from './session-view/mobile-input-manager.js';
import { SessionActionsHandler } from './session-view/session-actions-handler.js';
import {
  type TerminalEventHandlers,
  TerminalLifecycleManager,
  type TerminalStateCallbacks,
} from './session-view/terminal-lifecycle-manager.js';
import { TerminalSettingsManager } from './session-view/terminal-settings-manager.js';
import { UIStateManager } from './session-view/ui-state-manager.js';
import type { AppPreferences } from './settings.js';
import { STORAGE_KEY } from './settings.js';

// Components
import './session-view/terminal-renderer.js';
import './session-view/overlays-container.js';
import type { Terminal } from './terminal.js';
import type { VibeTerminalBinary } from './vibe-terminal-binary.js';

// Extend Window interface to include our custom property
declare global {
  interface Window {
    __deviceType?: 'phone' | 'tablet' | 'desktop';
  }
}

const logger = createLogger('session-view');

@customElement('session-view')
export class SessionView extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) showBackButton = true;
  @property({ type: Boolean }) showSidebarToggle = false;
  @property({ type: Boolean }) sidebarCollapsed = false;
  @property({ type: Boolean }) disableFocusManagement = false;
  @property({ type: Boolean }) keyboardCaptureActive = true;

  // Managers
  private connectionManager!: ConnectionManager;
  private inputManager!: InputManager;
  private mobileInputManager!: MobileInputManager;
  private directKeyboardManager!: DirectKeyboardManager;
  private terminalLifecycleManager!: TerminalLifecycleManager;
  private lifecycleEventManager!: LifecycleEventManager;
  private loadingAnimationManager = new LoadingAnimationManager();
  private fileOperationsManager = new FileOperationsManager();
  private terminalSettingsManager = new TerminalSettingsManager();
  private sessionActionsHandler = new SessionActionsHandler();
  private uiStateManager = new UIStateManager();

  private gitService = new GitService(authClient);
  private boundHandleOrientationChange?: () => void;

  // Bound terminal event handlers
  private boundHandleTerminalClick = this.handleTerminalClick.bind(this);
  private boundHandleTerminalInput = this.handleTerminalInput.bind(this);
  private boundHandleTerminalResize = this.handleTerminalResize.bind(this);
  private boundHandleTerminalReady = this.handleTerminalReady.bind(this);

  private instanceId = `session-view-${Math.random().toString(36).substr(2, 9)}`;
  private _updateTerminalTransformTimeout: ReturnType<typeof setTimeout> | null = null;

  private createLifecycleEventManagerCallbacks(): LifecycleEventManagerCallbacks {
    return {
      requestUpdate: () => this.requestUpdate(),
      handleBack: () => this.handleBack(),
      handleKeyboardInput: (e: KeyboardEvent) => this.handleKeyboardInput(e),
      getIsMobile: () => this.uiStateManager.getState().isMobile,
      setIsMobile: (value: boolean) => {
        this.uiStateManager.setIsMobile(value);
      },
      getUseDirectKeyboard: () => this.uiStateManager.getState().useDirectKeyboard,
      setUseDirectKeyboard: (value: boolean) => {
        this.uiStateManager.setUseDirectKeyboard(value);
      },
      getDirectKeyboardManager: () => ({
        getShowQuickKeys: () => this.directKeyboardManager.getShowQuickKeys(),
        setShowQuickKeys: (value: boolean) => this.directKeyboardManager.setShowQuickKeys(value),
        ensureHiddenInputVisible: () => this.directKeyboardManager.ensureHiddenInputVisible(),
        cleanup: () => this.directKeyboardManager.cleanup(),
      }),
      setShowQuickKeys: (value: boolean) => {
        this.uiStateManager.setShowQuickKeys(value);
        this.updateTerminalTransform();
      },
      setShowFileBrowser: (value: boolean) => {
        this.uiStateManager.setShowFileBrowser(value);
      },
      getInputManager: () => this.inputManager,
      getShowWidthSelector: () => this.uiStateManager.getState().showWidthSelector,
      setShowWidthSelector: (value: boolean) => {
        this.uiStateManager.setShowWidthSelector(value);
      },
      setCustomWidth: (value: string) => {
        this.uiStateManager.setCustomWidth(value);
      },
      querySelector: (selector: string) => this.querySelector(selector),
      setTabIndex: (value: number) => {
        this.tabIndex = value;
      },
      addEventListener: (event: string, handler: EventListener) =>
        this.addEventListener(event, handler),
      removeEventListener: (event: string, handler: EventListener) =>
        this.removeEventListener(event, handler),
      focus: () => this.focus(),
      getDisableFocusManagement: () => this.disableFocusManagement,
      startLoading: () => this.loadingAnimationManager.startLoading(() => this.requestUpdate()),
      stopLoading: () => this.loadingAnimationManager.stopLoading(),
      setKeyboardHeight: (value: number) => {
        this.uiStateManager.setKeyboardHeight(value);
        this.updateTerminalTransform();
      },
      getTerminalLifecycleManager: () =>
        this.terminalLifecycleManager
          ? {
              resetTerminalSize: () => this.terminalLifecycleManager.resetTerminalSize(),
              cleanup: () => this.terminalLifecycleManager.cleanup(),
            }
          : null,
      getConnectionManager: () =>
        this.connectionManager
          ? {
              setConnected: (connected: boolean) => this.connectionManager.setConnected(connected),
              cleanupStreamConnection: () => this.connectionManager.cleanupStreamConnection(),
            }
          : null,
      setConnected: (connected: boolean) => {
        this.uiStateManager.setConnected(connected);
      },
      getKeyboardCaptureActive: () => this.uiStateManager.getState().keyboardCaptureActive,
    };
  }

  connectedCallback() {
    super.connectedCallback();

    // Initialize UIStateManager callbacks
    this.uiStateManager.setCallbacks({
      requestUpdate: () => this.requestUpdate(),
    });

    // Initialize FileOperationsManager callbacks
    this.fileOperationsManager.setCallbacks({
      requestUpdate: () => this.requestUpdate(),
      getSession: () => this.session,
      getInputManager: () => this.inputManager,
      querySelector: (selector: string) => this.querySelector(selector),
      setIsDragOver: (isDragOver: boolean) => this.uiStateManager.setIsDragOver(isDragOver),
      setShowFileBrowser: (value: boolean) => this.uiStateManager.setShowFileBrowser(value),
      setShowImagePicker: (value: boolean) => this.uiStateManager.setShowImagePicker(value),
      getIsMobile: () => this.uiStateManager.getState().isMobile,
      getShowFileBrowser: () => this.uiStateManager.getState().showFileBrowser,
      getShowImagePicker: () => this.uiStateManager.getState().showImagePicker,
      getShowMobileInput: () => this.uiStateManager.getState().showMobileInput,
      dispatchEvent: (event: Event) => this.dispatchEvent(event),
    });

    // Initialize TerminalSettingsManager
    this.terminalSettingsManager.setCallbacks({
      requestUpdate: () => this.requestUpdate(),
      getSession: () => this.session,
      getTerminalElement: () => this.getTerminalElement(),
      setTerminalMaxCols: (cols: number) => this.uiStateManager.setTerminalMaxCols(cols),
      setTerminalFontSize: (size: number) => this.uiStateManager.setTerminalFontSize(size),
      setTerminalTheme: (theme: TerminalThemeId) => this.uiStateManager.setTerminalTheme(theme),
      setShowWidthSelector: (show: boolean) => this.uiStateManager.setShowWidthSelector(show),
      setCustomWidth: (width: string) => this.uiStateManager.setCustomWidth(width),
      getTerminalLifecycleManager: () => this.terminalLifecycleManager,
    });

    // Initialize SessionActionsHandler
    this.sessionActionsHandler.setCallbacks({
      getSession: () => this.session,
      setSession: (session: Session) => {
        this.session = session;
      },
      requestUpdate: () => this.requestUpdate(),
      dispatchEvent: (event: Event) => this.dispatchEvent(event),
      getViewMode: () => this.uiStateManager.getState().viewMode,
      setViewMode: (mode: 'terminal' | 'worktree') => this.uiStateManager.setViewMode(mode),
      handleBack: () => this.handleBack(),
      ensureTerminalInitialized: () => this.ensureTerminalInitialized(),
    });

    // Load direct keyboard preference
    this.uiStateManager.loadDirectKeyboardPreference();

    // Check server status to see if Mac app is connected
    this.checkServerStatus();

    // Check initial orientation
    this.checkOrientation();

    // Load binary mode preference
    this.loadBinaryModePreference();

    // Create bound orientation handler
    this.boundHandleOrientationChange = () => this.handleOrientationChange();

    // Listen for orientation changes
    window.addEventListener('orientationchange', this.boundHandleOrientationChange);
    window.addEventListener('resize', this.boundHandleOrientationChange);

    // Listen for binary mode changes
    window.addEventListener('terminal-binary-mode-changed', this.handleBinaryModeChange);

    // Initialize connection manager
    this.connectionManager = new ConnectionManager(
      (sessionId: string) => {
        // Handle session exit
        if (this.session && sessionId === this.session.id) {
          this.session = { ...this.session, status: 'exited' };
          this.requestUpdate();

          // Check if this window should auto-close
          // Only attempt to close if we're on a session-specific URL
          const urlParams = new URLSearchParams(window.location.search);
          const sessionParam = urlParams.get('session');

          if (sessionParam === sessionId) {
            // This window was opened specifically for this session
            logger.log(`Session ${sessionId} exited, attempting to close window`);

            // Try to close the window
            // This will work for:
            // 1. Windows opened via window.open() from JavaScript
            // 2. Windows where the user has granted permission
            // It won't work for regular browser tabs, which is fine
            setTimeout(() => {
              try {
                window.close();

                // If window.close() didn't work (we're still here after 100ms),
                // show a message to the user
                setTimeout(() => {
                  logger.log('Window close failed - likely opened as a regular tab');
                }, 100);
              } catch (e) {
                logger.warn('Failed to close window:', e);
              }
            }, 500); // Give user time to see the "exited" status
          }
        }
      },
      (session: Session) => {
        // Handle session update
        this.session = session;
        this.requestUpdate();
      }
    );
    this.connectionManager.setConnected(true);

    // Set connected state in UI state manager
    this.uiStateManager.setConnected(true);

    // Initialize input manager
    this.inputManager = new InputManager();
    this.inputManager.setCallbacks({
      requestUpdate: () => this.requestUpdate(),
      getKeyboardCaptureActive: () => this.uiStateManager.getState().keyboardCaptureActive,
    });

    // Initialize mobile input manager
    this.mobileInputManager = new MobileInputManager(this);
    this.mobileInputManager.setInputManager(this.inputManager);

    // Initialize direct keyboard manager
    this.directKeyboardManager = new DirectKeyboardManager(this.instanceId);
    this.directKeyboardManager.setInputManager(this.inputManager);
    this.directKeyboardManager.setSessionViewElement(this);

    // Set up callbacks for direct keyboard manager
    const directKeyboardCallbacks: DirectKeyboardCallbacks = {
      getShowMobileInput: () => this.uiStateManager.getState().showMobileInput,
      getShowCtrlAlpha: () => this.uiStateManager.getState().showCtrlAlpha,
      getDisableFocusManagement: () => this.disableFocusManagement,
      getVisualViewportHandler: () => {
        // Trigger the visual viewport handler if it exists
        if (this.lifecycleEventManager && window.visualViewport) {
          // Manually trigger keyboard height calculation
          const viewport = window.visualViewport;
          const keyboardHeight = window.innerHeight - viewport.height;
          this.uiStateManager.setKeyboardHeight(keyboardHeight);

          logger.log(`Visual Viewport keyboard height (manual trigger): ${keyboardHeight}px`);

          // Return a function that can be called to trigger the calculation
          return () => {
            if (window.visualViewport) {
              const currentHeight = window.innerHeight - window.visualViewport.height;
              this.uiStateManager.setKeyboardHeight(currentHeight);
            }
          };
        }
        return null;
      },
      getKeyboardHeight: () => this.uiStateManager.getState().keyboardHeight,
      setKeyboardHeight: (height: number) => {
        this.uiStateManager.setKeyboardHeight(height);
        this.updateTerminalTransform();
        this.requestUpdate();
      },
      updateShowQuickKeys: (value: boolean) => {
        this.uiStateManager.setShowQuickKeys(value);
        this.requestUpdate();
        // Update terminal transform when quick keys visibility changes
        this.updateTerminalTransform();
      },
      toggleMobileInput: () => {
        this.uiStateManager.toggleMobileInput();
        this.requestUpdate();
      },
      clearMobileInputText: () => {
        this.uiStateManager.setMobileInputText('');
        this.requestUpdate();
      },
      toggleCtrlAlpha: () => {
        this.uiStateManager.toggleCtrlAlpha();
        this.requestUpdate();
      },
      clearCtrlSequence: () => {
        this.uiStateManager.clearCtrlSequence();
        this.requestUpdate();
      },
    };
    this.directKeyboardManager.setCallbacks(directKeyboardCallbacks);

    // Initialize terminal lifecycle manager
    this.terminalLifecycleManager = new TerminalLifecycleManager();
    this.terminalLifecycleManager.setConnectionManager(this.connectionManager);
    this.terminalLifecycleManager.setInputManager(this.inputManager);
    this.terminalLifecycleManager.setConnected(this.uiStateManager.getState().connected);
    this.terminalLifecycleManager.setDomElement(this);

    // Set up event handlers for terminal lifecycle manager
    const eventHandlers: TerminalEventHandlers = {
      handleSessionExit: this.handleSessionExit.bind(this),
      handleTerminalResize: this.terminalLifecycleManager.handleTerminalResize.bind(
        this.terminalLifecycleManager
      ),
      handleTerminalPaste: this.terminalLifecycleManager.handleTerminalPaste.bind(
        this.terminalLifecycleManager
      ),
    };
    this.terminalLifecycleManager.setEventHandlers(eventHandlers);

    // Set up state callbacks for terminal lifecycle manager
    const stateCallbacks: TerminalStateCallbacks = {
      updateTerminalDimensions: (cols: number, rows: number) => {
        this.uiStateManager.setTerminalDimensions(cols, rows);
        this.requestUpdate();
      },
    };
    this.terminalLifecycleManager.setStateCallbacks(stateCallbacks);

    if (this.session) {
      this.inputManager.setSession(this.session);
      this.terminalLifecycleManager.setSession(this.session);
    }

    // Load terminal preferences
    const maxCols = this.terminalSettingsManager.getMaxCols();
    const fontSize = this.terminalSettingsManager.getFontSize();
    const theme = this.terminalSettingsManager.getTheme();
    this.uiStateManager.setTerminalMaxCols(maxCols);
    this.uiStateManager.setTerminalFontSize(fontSize);
    this.uiStateManager.setTerminalTheme(theme);
    logger.debug('Loaded terminal theme:', theme);
    this.terminalLifecycleManager.setTerminalFontSize(fontSize);
    this.terminalLifecycleManager.setTerminalMaxCols(maxCols);
    this.terminalLifecycleManager.setTerminalTheme(theme);

    // Initialize lifecycle event manager
    this.lifecycleEventManager = new LifecycleEventManager();
    this.lifecycleEventManager.setSessionViewElement(this);
    this.lifecycleEventManager.setCallbacks(this.createLifecycleEventManagerCallbacks());
    this.lifecycleEventManager.setSession(this.session);

    // Session action callbacks will be provided per-call to the service

    // Load direct keyboard preference (needed before lifecycle setup)
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      if (stored) {
        const preferences = JSON.parse(stored);
        this.uiStateManager.setUseDirectKeyboard(preferences.useDirectKeyboard ?? true); // Default to true for new users
      } else {
        this.uiStateManager.setUseDirectKeyboard(true); // Default to true when no settings exist
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
      this.uiStateManager.setUseDirectKeyboard(true); // Default to true on error
    }

    // Set up lifecycle (replaces the extracted lifecycle logic)
    this.lifecycleEventManager.setupLifecycle();

    // Use FileOperationsManager's event setup which includes dragend and global dragover
    this.fileOperationsManager.setupEventListeners(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Remove orientation listeners
    if (this.boundHandleOrientationChange) {
      window.removeEventListener('orientationchange', this.boundHandleOrientationChange);
      window.removeEventListener('resize', this.boundHandleOrientationChange);
    }

    // Remove binary mode listener
    window.removeEventListener('terminal-binary-mode-changed', this.handleBinaryModeChange);

    // Remove drag & drop and paste event listeners using FileOperationsManager
    this.fileOperationsManager.removeEventListeners(this);

    // Reset drag state
    this.fileOperationsManager.resetDragState();

    // Clear any pending updateTerminalTransform timeout
    if (this._updateTerminalTransformTimeout) {
      clearTimeout(this._updateTerminalTransformTimeout);
      this._updateTerminalTransformTimeout = null;
    }

    // Use lifecycle event manager for teardown
    if (this.lifecycleEventManager) {
      this.lifecycleEventManager.teardownLifecycle();
      this.lifecycleEventManager.cleanup();
    }

    // Clean up loading animation manager
    this.loadingAnimationManager.cleanup();
  }

  private checkOrientation() {
    // Check if we're in landscape mode
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    this.uiStateManager.setIsLandscape(isLandscape);
  }

  private handleOrientationChange() {
    this.checkOrientation();
    // Request update to re-render with new safe area classes
    this.requestUpdate();
  }

  private loadBinaryModePreference() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const preferences = JSON.parse(stored) as AppPreferences;
        this.uiStateManager.setUseBinaryMode(preferences.useBinaryMode ?? false);
      }
    } catch (error) {
      logger.warn('Failed to load binary mode preference', error);
    }
  }

  private handleBinaryModeChange = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    const newValue = customEvent.detail;

    // Only update if value actually changed
    const currentState = this.uiStateManager.getState();
    if (currentState.useBinaryMode !== newValue) {
      this.uiStateManager.setUseBinaryMode(newValue);

      // If we have an active session, reconnect with new mode
      if (this.session && currentState.connected) {
        // Disconnect current terminal
        this.connectionManager.cleanupStreamConnection();

        // Force a re-render to switch terminal components
        this.requestUpdate();

        // Re-establish connection after component switch
        requestAnimationFrame(() => {
          this.ensureTerminalInitialized();
        });
      }
    }
  };

  private getTerminalElement(): Terminal | VibeTerminalBinary | null {
    // Look for terminal inside terminal-renderer (no shadow DOM, so direct descendant selector works)
    const terminalRenderer = this.querySelector('terminal-renderer');
    if (terminalRenderer) {
      return this.uiStateManager.getState().useBinaryMode
        ? (terminalRenderer.querySelector('vibe-terminal-binary') as VibeTerminalBinary | null)
        : (terminalRenderer.querySelector('vibe-terminal') as Terminal | null);
    }

    // Fallback to direct search (shouldn't happen with new structure)
    return this.uiStateManager.getState().useBinaryMode
      ? (this.querySelector('vibe-terminal-binary') as VibeTerminalBinary | null)
      : (this.querySelector('vibe-terminal') as Terminal | null);
  }

  firstUpdated(changedProperties: PropertyValues) {
    super.firstUpdated(changedProperties);

    // Load terminal preferences BEFORE terminal setup to ensure proper initialization
    const terminalTheme = this.terminalSettingsManager.getTerminalTheme();
    logger.debug('Loaded terminal theme from preferences:', terminalTheme);

    // Don't setup terminal here - wait for session data to be available
    // Terminal setup will be triggered in updated() when session becomes available
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // If session changed, clean up old stream connection and reset terminal state
    if (changedProperties.has('session')) {
      const oldSession = changedProperties.get('session') as Session | null;
      const sessionChanged = oldSession?.id !== this.session?.id;

      if (sessionChanged && oldSession) {
        logger.log('Session changed, cleaning up old stream connection');
        if (this.connectionManager) {
          this.connectionManager.cleanupStreamConnection();
        }
        // Clean up terminal lifecycle manager for fresh start
        if (this.terminalLifecycleManager) {
          this.terminalLifecycleManager.cleanup();
        }
      }

      // Update managers with new session
      if (this.inputManager) {
        this.inputManager.setSession(this.session);
      }
      if (this.terminalLifecycleManager) {
        this.terminalLifecycleManager.setSession(this.session);
      }
      if (this.lifecycleEventManager) {
        this.lifecycleEventManager.setSession(this.session);
      }

      // Initialize terminal when session first becomes available
      if (this.session && this.uiStateManager.getState().connected && !oldSession) {
        logger.log('Session data now available, initializing terminal');
        this.ensureTerminalInitialized();
      }
    }

    // Stop loading and ensure terminal is initialized when session becomes available
    if (
      changedProperties.has('session') &&
      this.session &&
      this.loadingAnimationManager.isLoading()
    ) {
      this.loadingAnimationManager.stopLoading();
      this.ensureTerminalInitialized();
    }

    // Ensure terminal is initialized when connected state changes
    if (
      changedProperties.has('connected') &&
      this.uiStateManager.getState().connected &&
      this.session
    ) {
      this.ensureTerminalInitialized();
    }

    // Update UIStateManager when keyboardCaptureActive prop changes
    if (changedProperties.has('keyboardCaptureActive')) {
      this.uiStateManager.setKeyboardCaptureActive(this.keyboardCaptureActive);
      logger.log(`Keyboard capture state updated to: ${this.keyboardCaptureActive}`);
    }
  }

  /**
   * Ensures terminal is properly initialized with current session data.
   * This method is idempotent and can be called multiple times safely.
   */
  private ensureTerminalInitialized() {
    if (!this.session || !this.uiStateManager.getState().connected) {
      logger.log('Cannot initialize terminal: missing session or not connected');
      return;
    }

    // Check if terminal is already initialized
    if (this.terminalLifecycleManager.getTerminal()) {
      logger.log('Terminal already initialized');
      return;
    }

    // Check if terminal element exists in DOM
    const terminalElement = this.getTerminalElement();
    if (!terminalElement) {
      logger.log('Terminal element not found in DOM, deferring initialization');
      // Retry after next render cycle with a small delay to ensure terminal-renderer has rendered
      setTimeout(() => {
        requestAnimationFrame(() => {
          this.ensureTerminalInitialized();
        });
      }, 100);
      return;
    }

    logger.log('Initializing terminal with session:', this.session.id);

    // Setup terminal with session data
    this.terminalLifecycleManager.setupTerminal();

    // Initialize terminal after setup
    this.terminalLifecycleManager.initializeTerminal();
  }

  async handleKeyboardInput(e: KeyboardEvent) {
    if (!this.inputManager) return;

    await this.inputManager.handleKeyboardInput(e);

    // Check if session status needs updating after input attempt
    // The input manager will have attempted to send input and may have detected session exit
    if (this.session && this.session.status !== 'exited') {
      // InputManager doesn't directly update session status, so we don't need to handle that here
      // This is handled by the connection manager when it detects connection issues
    }
  }

  handleBack() {
    // Dispatch a custom event that the app can handle with view transitions
    this.dispatchEvent(
      new CustomEvent('navigate-to-list', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleSidebarToggle() {
    // Dispatch event to toggle sidebar
    this.dispatchEvent(
      new CustomEvent('toggle-sidebar', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleCreateSession() {
    // Dispatch event to create a new session
    this.dispatchEvent(
      new CustomEvent('create-session', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private async checkServerStatus() {
    try {
      const response = await fetch('/api/server/status', {
        headers: authClient.getAuthHeader(),
      });
      if (response.ok) {
        const status = await response.json();
        this.uiStateManager.setMacAppConnected(status.macAppConnected || false);
        logger.debug('server status:', status);
      }
    } catch (error) {
      logger.warn('failed to check server status:', error);
      // Default to not connected if we can't check
      this.uiStateManager.setMacAppConnected(false);
    }
  }

  private handleOpenSettings() {
    // Dispatch event to open settings modal
    this.dispatchEvent(
      new CustomEvent('open-settings', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleSessionExit(e: Event) {
    const customEvent = e as CustomEvent;
    this.sessionActionsHandler.handleSessionExit(
      customEvent.detail.sessionId,
      customEvent.detail.exitCode
    );

    // Switch to snapshot mode - disconnect stream and load final snapshot
    if (this.session && customEvent.detail.sessionId === this.session.id) {
      if (this.connectionManager) {
        this.connectionManager.cleanupStreamConnection();
      }
    }
  }

  // Mobile input methods
  private handleMobileInputToggle() {
    this.mobileInputManager.handleMobileInputToggle();
  }

  // Helper methods for MobileInputManager
  shouldUseDirectKeyboard(): boolean {
    return this.uiStateManager.getState().useDirectKeyboard;
  }

  toggleMobileInputDisplay(): void {
    this.uiStateManager.toggleMobileInput();
    if (!this.uiStateManager.getState().showMobileInput) {
      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    }
  }

  private async handleSpecialKey(key: string) {
    if (this.inputManager) {
      await this.inputManager.sendInputText(key);
    }
  }

  private async handleCtrlKey(letter: string) {
    // Add to sequence instead of immediately sending
    this.uiStateManager.addCtrlSequence(letter);
  }

  private async handleSendCtrlSequence() {
    // Send each ctrl key in sequence
    const ctrlSequence = this.uiStateManager.getState().ctrlSequence;
    if (this.inputManager) {
      for (const letter of ctrlSequence) {
        const controlCode = String.fromCharCode(letter.charCodeAt(0) - 64);
        await this.inputManager.sendInputText(controlCode);
      }
    }
    // Clear sequence and close overlay
    this.uiStateManager.clearCtrlSequence();
    this.uiStateManager.setShowCtrlAlpha(false);

    // Refocus the hidden input
    if (this.directKeyboardManager.shouldRefocusHiddenInput()) {
      this.directKeyboardManager.refocusHiddenInput();
    }
  }

  private handleClearCtrlSequence() {
    this.uiStateManager.clearCtrlSequence();
  }

  private handleCtrlAlphaCancel() {
    this.uiStateManager.setShowCtrlAlpha(false);
    this.uiStateManager.clearCtrlSequence();

    // Refocus the hidden input
    if (this.directKeyboardManager.shouldRefocusHiddenInput()) {
      this.directKeyboardManager.refocusHiddenInput();
    }
  }

  private toggleDirectKeyboard() {
    this.uiStateManager.toggleDirectKeyboard();

    // If enabling direct keyboard on mobile, ensure hidden input
    const state = this.uiStateManager.getState();
    if (state.isMobile && state.useDirectKeyboard) {
      this.directKeyboardManager.ensureHiddenInputVisible();
    }
  }

  private handleKeyboardButtonClick() {
    // Show quick keys immediately for visual feedback
    this.uiStateManager.setShowQuickKeys(true);

    // Update terminal transform immediately
    this.updateTerminalTransform();

    // Focus the hidden input synchronously - critical for iOS Safari
    // Must be called directly in the click handler without any delays
    this.directKeyboardManager.focusHiddenInput();

    // Request update after all synchronous operations
    this.requestUpdate();
  }

  private handleTerminalClick(e: Event) {
    const uiState = this.uiStateManager.getState();
    if (uiState.isMobile && uiState.useDirectKeyboard) {
      // Prevent the event from bubbling and default action
      e.stopPropagation();
      e.preventDefault();

      // Don't do anything - the hidden input should handle all interactions
      // The click on the terminal is actually a click on the hidden input overlay
      return;
    }
  }

  private async handleTerminalInput(e: CustomEvent) {
    const { text } = e.detail;
    if (this.inputManager && text) {
      await this.inputManager.sendInputText(text);
    }
  }

  private handleTerminalResize(event: CustomEvent<{ cols: number; rows: number }>) {
    logger.log('Terminal resized:', event.detail);
    this.terminalLifecycleManager.handleTerminalResize(event);
  }

  private handleTerminalReady() {
    logger.log('Terminal ready event received');
    // Terminal is ready, ensure it's properly initialized
    this.ensureTerminalInitialized();
  }

  private updateTerminalTransform(): void {
    // Clear any existing timeout to debounce calls
    if (this._updateTerminalTransformTimeout) {
      clearTimeout(this._updateTerminalTransformTimeout);
    }

    const state = this.uiStateManager.getState();

    this._updateTerminalTransformTimeout = setTimeout(() => {
      // Log for debugging
      logger.log(
        `Terminal transform updated: quickKeys=${state.showQuickKeys}, keyboardHeight=${state.keyboardHeight}px`
      );

      // Force immediate update to apply CSS variable changes
      this.requestUpdate();

      // Always notify terminal to resize when there's a change
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const terminal = this.getTerminalElement();
        if (terminal) {
          // Notify terminal of size change
          const terminalElement = terminal as unknown as { fitTerminal?: () => void };
          if (typeof terminalElement.fitTerminal === 'function') {
            terminalElement.fitTerminal();
          }

          // If keyboard is visible, scroll to keep cursor visible
          if (state.keyboardHeight > 0 || state.showQuickKeys) {
            // Small delay then scroll to bottom to keep cursor visible
            setTimeout(() => {
              if ('scrollToBottom' in terminal) {
                terminal.scrollToBottom();
              }
            }, 50);
          }
        }
      });
    }, 100); // Debounce by 100ms
  }

  // SessionViewInterface methods required by managers
  focusHiddenInput(): void {
    this.directKeyboardManager.focusHiddenInput();
  }

  getMobileInputText(): string {
    return this.uiStateManager.getState().mobileInputText;
  }

  clearMobileInputText(): void {
    this.uiStateManager.setMobileInputText('');
  }

  closeMobileInput(): void {
    this.uiStateManager.setShowMobileInput(false);
  }

  shouldRefocusHiddenInput(): boolean {
    return this.directKeyboardManager.shouldRefocusHiddenInput();
  }

  refocusHiddenInput(): void {
    this.directKeyboardManager.refocusHiddenInput();
  }

  startFocusRetention(): void {
    this.directKeyboardManager.startFocusRetentionPublic();
  }

  delayedRefocusHiddenInput(): void {
    this.directKeyboardManager.delayedRefocusHiddenInputPublic();
  }

  refreshTerminalAfterMobileInput() {
    // After closing mobile input, the viewport changes and the terminal
    // needs to recalculate its scroll position to avoid getting stuck
    const terminal = this.terminalLifecycleManager.getTerminal();
    if (!terminal) return;

    // Give the viewport time to settle after keyboard disappears
    setTimeout(() => {
      const currentTerminal = this.terminalLifecycleManager.getTerminal();
      if (currentTerminal) {
        // Force the terminal to recalculate its viewport dimensions and scroll boundaries
        // This fixes the issue where maxScrollPixels becomes incorrect after keyboard changes
        const terminalElement = currentTerminal as unknown as { fitTerminal?: () => void };
        if (typeof terminalElement.fitTerminal === 'function') {
          terminalElement.fitTerminal();
        }

        // Then scroll to bottom to fix the position
        currentTerminal.scrollToBottom();
      }
    }, 300); // Wait for viewport to settle
  }

  render() {
    if (!this.session) {
      return html`
        <div class="fixed inset-0 bg-base flex items-center justify-center">
          <div class="text-primary font-mono text-center">
            <div class="text-2xl mb-2">${this.loadingAnimationManager.getLoadingText()}</div>
            <div class="text-sm text-muted">Waiting for session...</div>
          </div>
        </div>
      `;
    }

    // Get UI state once for the entire render method
    const uiState = this.uiStateManager.getState();

    return html`
      <style>
        session-view *,
        session-view *:focus,
        session-view *:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        session-view:focus {
          outline: 2px solid rgb(var(--color-primary)) !important;
          outline-offset: -2px;
        }
        
        /* Grid layout for stable touch handling */
        .session-view-grid {
          display: grid;
          grid-template-areas:
            "header"
            "terminal"
            "quickkeys";
          grid-template-rows: auto 1fr auto;
          grid-template-columns: 1fr;
          height: 100vh;
          height: 100dvh;
          width: 100%;
          max-width: 100vw;
          position: relative;
          background-color: rgb(var(--color-bg));
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
          overflow: hidden;
          box-sizing: border-box;
        }
        
        /* Adjust grid when keyboard is visible */
        .session-view-grid[data-keyboard-visible="true"] {
          height: calc(100vh - var(--keyboard-height, 0px) - var(--quickkeys-height, 0px));
          height: calc(100dvh - var(--keyboard-height, 0px) - var(--quickkeys-height, 0px));
          transition: height 0.2s ease-out;
        }
        
        .session-header-area {
          grid-area: header;
        }
        
        .terminal-area {
          grid-area: terminal;
          position: relative;
          overflow: hidden;
          min-height: 0; /* Critical for grid */
          contain: layout style paint; /* Isolate terminal updates */
        }
        
        /* Add padding to terminal when quick keys are visible */
        .terminal-area[data-quickkeys-visible="true"] vibe-terminal,
        .terminal-area[data-quickkeys-visible="true"] vibe-terminal-binary {
          padding-bottom: 120px !important;
          box-sizing: border-box;
        }
        
        .quickkeys-area {
          grid-area: quickkeys;
        }
        
        /* Overlay container - spans entire grid */
        .overlay-container {
          grid-area: 1 / 1 / -1 / -1;
          pointer-events: none;
          z-index: 20;
          position: relative;
        }
        
        .overlay-container > * {
          pointer-events: auto;
          touch-action: manipulation; /* Eliminates 300ms delay */
          -webkit-tap-highlight-color: transparent;
        }
        
        /* Apply touch optimizations to all interactive elements */
        button, [role="button"], .clickable {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
      </style>
      <!-- Background wrapper to extend header color to status bar -->
      <div class="bg-bg-secondary" style="padding-top: env(safe-area-inset-top);">
        <div
          class="session-view-grid"
          style="outline: none !important; box-shadow: none !important; --keyboard-height: ${uiState.keyboardHeight}px; --quickkeys-height: 0px;"
          data-keyboard-visible="${uiState.keyboardHeight > 0 || uiState.showQuickKeys ? 'true' : 'false'}"
        >
        <!-- Session Header Area -->
        <div class="session-header-area">
          <session-header
            .session=${this.session}
            .showBackButton=${this.showBackButton}
            .showSidebarToggle=${this.showSidebarToggle}
            .sidebarCollapsed=${this.sidebarCollapsed}
            .terminalMaxCols=${uiState.terminalMaxCols}
            .terminalFontSize=${uiState.terminalFontSize}
            .customWidth=${uiState.customWidth}
            .showWidthSelector=${uiState.showWidthSelector}
            .keyboardCaptureActive=${uiState.keyboardCaptureActive}
            .isMobile=${uiState.isMobile}
            .widthLabel=${this.terminalSettingsManager.getCurrentWidthLabel()}
            .widthTooltip=${this.terminalSettingsManager.getWidthTooltip()}
            .onBack=${() => this.handleBack()}
            .onSidebarToggle=${() => this.handleSidebarToggle()}
            .onCreateSession=${() => this.handleCreateSession()}
            .onOpenFileBrowser=${() => this.fileOperationsManager.openFileBrowser()}
            .onOpenImagePicker=${() => this.fileOperationsManager.openFilePicker()}
            .onMaxWidthToggle=${() => this.terminalSettingsManager.handleMaxWidthToggle()}
            .onWidthSelect=${(width: number) => this.terminalSettingsManager.handleWidthSelect(width)}
            .onFontSizeChange=${(size: number) => this.terminalSettingsManager.handleFontSizeChange(size)}
            .onOpenSettings=${() => this.handleOpenSettings()}
            .macAppConnected=${uiState.macAppConnected}
            .onTerminateSession=${() => this.sessionActionsHandler.handleTerminateSession()}
            .onClearSession=${() => this.sessionActionsHandler.handleClearSession()}
            .onToggleViewMode=${() => this.sessionActionsHandler.handleToggleViewMode()}
            @close-width-selector=${() => {
              this.uiStateManager.setShowWidthSelector(false);
              this.uiStateManager.setCustomWidth('');
            }}
            @session-rename=${async (e: CustomEvent) => {
              const { sessionId, newName } = e.detail;
              await this.sessionActionsHandler.handleRename(sessionId, newName);
            }}
            @paste-image=${async () => await this.fileOperationsManager.pasteImage()}
            @select-image=${() => this.fileOperationsManager.selectImage()}
            @open-camera=${() => this.fileOperationsManager.openCamera()}
            @show-image-upload-options=${() => this.fileOperationsManager.selectImage()}
            @toggle-view-mode=${() => this.sessionActionsHandler.handleToggleViewMode()}
            @capture-toggled=${(e: CustomEvent) => {
              this.dispatchEvent(
                new CustomEvent('capture-toggled', {
                  detail: e.detail,
                  bubbles: true,
                  composed: true,
                })
              );
            }}
            .hasGitRepo=${!!this.session?.gitRepoPath}
            .viewMode=${uiState.viewMode}
          >
          </session-header>
        </div>

        <!-- Content Area (Terminal or Worktree) -->
        <div
          class="terminal-area bg-bg ${
            this.session?.status === 'exited' && uiState.viewMode === 'terminal'
              ? 'session-exited opacity-90'
              : ''
          } ${
            // Add safe area padding for landscape mode on mobile to handle notch
            uiState.isMobile && uiState.isLandscape ? 'safe-area-left safe-area-right' : ''
          }"
          data-quickkeys-visible="${uiState.showQuickKeys && uiState.keyboardHeight > 0}"
        >
          ${
            this.loadingAnimationManager.isLoading()
              ? html`
                <!-- Enhanced Loading overlay -->
                <div
                  class="absolute inset-0 bg-bg bg-opacity-90 backdrop-filter backdrop-blur-sm flex items-center justify-center z-10 animate-fade-in"
                >
                  <div class="text-primary font-mono text-center">
                    <div class="text-2xl mb-3 text-primary animate-pulse-primary">${this.loadingAnimationManager.getLoadingText()}</div>
                    <div class="text-sm text-muted">Connecting to session...</div>
                  </div>
                </div>
              `
              : ''
          }
          ${
            uiState.viewMode === 'worktree' && this.session?.gitRepoPath
              ? html`
              <worktree-manager
                .gitService=${this.gitService}
                .repoPath=${this.session.gitRepoPath}
                @back=${() => {
                  this.uiStateManager.setViewMode('terminal');
                }}
              ></worktree-manager>
            `
              : uiState.viewMode === 'terminal'
                ? html`
              <!-- Enhanced Terminal Component -->
              <terminal-renderer
                id="session-terminal"
                .session=${this.session}
                .useBinaryMode=${uiState.useBinaryMode}
                .terminalFontSize=${uiState.terminalFontSize}
                .terminalMaxCols=${uiState.terminalMaxCols}
                .terminalTheme=${uiState.terminalTheme}
                .disableClick=${uiState.isMobile && uiState.useDirectKeyboard}
                .hideScrollButton=${uiState.showQuickKeys}
                .onTerminalClick=${this.boundHandleTerminalClick}
                .onTerminalInput=${this.boundHandleTerminalInput}
                .onTerminalResize=${this.boundHandleTerminalResize}
                .onTerminalReady=${this.boundHandleTerminalReady}
              ></terminal-renderer>
            `
                : ''
          }
        </div>

        <!-- Quick Keys Area -->
        <div class="quickkeys-area">
          <!-- Mobile Input Controls (only show when direct keyboard is disabled) -->
          ${
            uiState.isMobile && !uiState.showMobileInput && !uiState.useDirectKeyboard
              ? html`
                <div class="p-4 bg-secondary">
                <!-- First row: Arrow keys -->
                <div class="flex gap-2 mb-2">
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer quick-start-btn"
                    @click=${() => this.handleSpecialKey('arrow_up')}
                  >
                    <span class="text-xl">↑</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer quick-start-btn"
                    @click=${() => this.handleSpecialKey('arrow_down')}
                  >
                    <span class="text-xl">↓</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer quick-start-btn"
                    @click=${() => this.handleSpecialKey('arrow_left')}
                  >
                    <span class="text-xl">←</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer quick-start-btn"
                    @click=${() => this.handleSpecialKey('arrow_right')}
                  >
                    <span class="text-xl">→</span>
                  </button>
                </div>

                <!-- Second row: Special keys -->
                <div class="flex gap-2">
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${() => this.handleSpecialKey('escape')}
                  >
                    ESC
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${() => this.handleSpecialKey('\t')}
                  >
                    <span class="text-xl">⇥</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer quick-start-btn"
                    @click=${this.handleMobileInputToggle}
                  >
                    ABC123
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${() => this.fileOperationsManager.openFilePicker()}
                    title="Upload file"
                  >
                    📷
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${this.toggleDirectKeyboard}
                    title="Switch to direct keyboard mode"
                  >
                    ⌨️
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${() => this.uiStateManager.toggleCtrlAlpha()}
                  >
                    CTRL
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16 quick-start-btn"
                    @click=${() => this.handleSpecialKey('enter')}
                  >
                    <span class="text-xl">⏎</span>
                  </button>
                  </div>
                </div>
              `
              : ''
          }
        </div>

        <!-- Overlay Container - All overlays go here for stable positioning -->
        <div class="overlay-container">
          <overlays-container
            .session=${this.session}
            .uiState=${uiState}
            .callbacks=${{
              // Mobile input callbacks
              onMobileInputSendOnly: (text: string) =>
                this.mobileInputManager.handleMobileInputSendOnly(text),
              onMobileInputSend: (text: string) =>
                this.mobileInputManager.handleMobileInputSend(text),
              onMobileInputCancel: () => this.mobileInputManager.handleMobileInputCancel(),
              onMobileInputTextChange: (text: string) =>
                this.uiStateManager.setMobileInputText(text),

              // Ctrl+Alpha callbacks
              onCtrlKey: (letter: string) => this.handleCtrlKey(letter),
              onSendCtrlSequence: () => this.handleSendCtrlSequence(),
              onClearCtrlSequence: () => this.handleClearCtrlSequence(),
              onCtrlAlphaCancel: () => this.handleCtrlAlphaCancel(),

              // Quick keys
              onQuickKeyPress: (key: string) => this.directKeyboardManager.handleQuickKeyPress(key),

              // File browser/picker
              onCloseFileBrowser: () => this.fileOperationsManager.closeFileBrowser(),
              onInsertPath: async (e: CustomEvent) => {
                const { path, type } = e.detail;
                await this.fileOperationsManager.insertPath(path, type);
              },
              onFileSelected: async (e: CustomEvent) => {
                await this.fileOperationsManager.handleFileSelected(e.detail.path);
              },
              onFileError: (e: CustomEvent) => {
                this.fileOperationsManager.handleFileError(e.detail);
              },
              onCloseFilePicker: () => this.fileOperationsManager.closeFilePicker(),

              // Terminal settings
              onWidthSelect: (width: number) =>
                this.terminalSettingsManager.handleWidthSelect(width),
              onFontSizeChange: (size: number) =>
                this.terminalSettingsManager.handleFontSizeChange(size),
              onThemeChange: (theme: TerminalThemeId) =>
                this.terminalSettingsManager.handleThemeChange(theme),
              onCloseWidthSelector: () => {
                this.uiStateManager.setShowWidthSelector(false);
                this.uiStateManager.setCustomWidth('');
              },

              // Keyboard button
              onKeyboardButtonClick: () => this.handleKeyboardButtonClick(),

              // Navigation
              handleBack: () => this.handleBack(),
            }}
          ></overlays-container>
        </div>
      </div>
      </div>
    `;
  }
}

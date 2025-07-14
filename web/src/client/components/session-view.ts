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
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from './session-list.js';
import './terminal.js';
import './file-browser.js';
import './file-picker.js';
import type { FilePicker } from './file-picker.js';
import './clickable-path.js';
import './terminal-quick-keys.js';
import './session-view/mobile-input-overlay.js';
import { titleManager } from '../utils/title-manager.js';
import './session-view/ctrl-alpha-overlay.js';
import './session-view/width-selector.js';
import './session-view/session-header.js';
import { authClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';
import { ConnectionManager } from './session-view/connection-manager.js';
import {
  type DirectKeyboardCallbacks,
  DirectKeyboardManager,
} from './session-view/direct-keyboard-manager.js';
import { InputManager } from './session-view/input-manager.js';
import type { LifecycleEventManagerCallbacks } from './session-view/interfaces.js';
import { LifecycleEventManager } from './session-view/lifecycle-event-manager.js';
import { LoadingAnimationManager } from './session-view/loading-animation-manager.js';
import { MobileInputManager } from './session-view/mobile-input-manager.js';
import {
  type TerminalEventHandlers,
  TerminalLifecycleManager,
  type TerminalStateCallbacks,
} from './session-view/terminal-lifecycle-manager.js';
import type { Terminal } from './terminal.js';

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
  @state() private connected = false;
  @state() private showMobileInput = false;
  @state() private mobileInputText = '';
  @state() private isMobile = false;
  @state() private touchStartX = 0;
  @state() private touchStartY = 0;
  @state() private terminalCols = 0;
  @state() private terminalRows = 0;
  @state() private showCtrlAlpha = false;
  @state() private terminalFitHorizontally = false;
  @state() private terminalMaxCols = 0;
  @state() private showWidthSelector = false;
  @state() private customWidth = '';
  @state() private showFileBrowser = false;
  @state() private showImagePicker = false;
  @state() private isDragOver = false;
  @state() private terminalFontSize = 14;
  @state() private terminalTheme: TerminalThemeId = 'auto';
  @state() private terminalContainerHeight = '100%';
  @state() private isLandscape = false;

  private preferencesManager = TerminalPreferencesManager.getInstance();

  // Bound event handlers to ensure proper cleanup
  private boundHandleDragOver = this.handleDragOver.bind(this);
  private boundHandleDragLeave = this.handleDragLeave.bind(this);
  private boundHandleDrop = this.handleDrop.bind(this);
  private boundHandlePaste = this.handlePaste.bind(this);
  private boundHandleOrientationChange?: () => void;
  private connectionManager!: ConnectionManager;
  private inputManager!: InputManager;
  private mobileInputManager!: MobileInputManager;
  private directKeyboardManager!: DirectKeyboardManager;
  private terminalLifecycleManager!: TerminalLifecycleManager;
  private lifecycleEventManager!: LifecycleEventManager;
  private loadingAnimationManager = new LoadingAnimationManager();
  @state() private ctrlSequence: string[] = [];
  @state() private useDirectKeyboard = false;
  @state() private showQuickKeys = false;
  @state() private keyboardHeight = 0;

  private instanceId = `session-view-${Math.random().toString(36).substr(2, 9)}`;
  private createHiddenInputTimeout: ReturnType<typeof setTimeout> | null = null;

  // Removed methods that are now in LifecycleEventManager:
  // - handlePreferencesChanged
  // - keyboardHandler
  // - touchStartHandler
  // - touchEndHandler
  // - handleClickOutside

  private createLifecycleEventManagerCallbacks(): LifecycleEventManagerCallbacks {
    return {
      requestUpdate: () => this.requestUpdate(),
      handleBack: () => this.handleBack(),
      handleKeyboardInput: (e: KeyboardEvent) => this.handleKeyboardInput(e),
      getIsMobile: () => this.isMobile,
      setIsMobile: (value: boolean) => {
        this.isMobile = value;
      },
      getUseDirectKeyboard: () => this.useDirectKeyboard,
      setUseDirectKeyboard: (value: boolean) => {
        this.useDirectKeyboard = value;
      },
      getDirectKeyboardManager: () => ({
        getShowQuickKeys: () => this.directKeyboardManager.getShowQuickKeys(),
        setShowQuickKeys: (value: boolean) => this.directKeyboardManager.setShowQuickKeys(value),
        ensureHiddenInputVisible: () => this.directKeyboardManager.ensureHiddenInputVisible(),
        cleanup: () => this.directKeyboardManager.cleanup(),
      }),
      setShowQuickKeys: (value: boolean) => {
        this.showQuickKeys = value;
        this.updateTerminalTransform();
      },
      setShowFileBrowser: (value: boolean) => {
        this.showFileBrowser = value;
      },
      getInputManager: () => this.inputManager,
      getShowWidthSelector: () => this.showWidthSelector,
      setShowWidthSelector: (value: boolean) => {
        this.showWidthSelector = value;
      },
      setCustomWidth: (value: string) => {
        this.customWidth = value;
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
        this.keyboardHeight = value;
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
        this.connected = connected;
      },
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this.connected = true;

    // Check initial orientation
    this.checkOrientation();

    // Create bound orientation handler
    this.boundHandleOrientationChange = () => this.handleOrientationChange();

    // Listen for orientation changes
    window.addEventListener('orientationchange', this.boundHandleOrientationChange);
    window.addEventListener('resize', this.boundHandleOrientationChange);

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

    // Initialize input manager
    this.inputManager = new InputManager();
    this.inputManager.setCallbacks({
      requestUpdate: () => this.requestUpdate(),
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
      getShowMobileInput: () => this.showMobileInput,
      getShowCtrlAlpha: () => this.showCtrlAlpha,
      getDisableFocusManagement: () => this.disableFocusManagement,
      getVisualViewportHandler: () => {
        // Trigger the visual viewport handler if it exists
        if (this.lifecycleEventManager && window.visualViewport) {
          // Manually trigger keyboard height calculation
          const viewport = window.visualViewport;
          const keyboardHeight = window.innerHeight - viewport.height;
          this.keyboardHeight = keyboardHeight;

          // Update quick keys component if it exists
          const quickKeys = this.querySelector('terminal-quick-keys') as HTMLElement & {
            keyboardHeight: number;
          };
          if (quickKeys) {
            quickKeys.keyboardHeight = keyboardHeight;
          }

          logger.log(`Visual Viewport keyboard height (manual trigger): ${keyboardHeight}px`);

          // Return a function that can be called to trigger the calculation
          return () => {
            if (window.visualViewport) {
              const currentHeight = window.innerHeight - window.visualViewport.height;
              this.keyboardHeight = currentHeight;
              if (quickKeys) {
                quickKeys.keyboardHeight = currentHeight;
              }
            }
          };
        }
        return null;
      },
      getKeyboardHeight: () => this.keyboardHeight,
      setKeyboardHeight: (height: number) => {
        this.keyboardHeight = height;
        this.updateTerminalTransform();
        this.requestUpdate();
      },
      updateShowQuickKeys: (value: boolean) => {
        this.showQuickKeys = value;
        this.requestUpdate();
        // Update terminal transform when quick keys visibility changes
        this.updateTerminalTransform();
      },
      toggleMobileInput: () => {
        this.showMobileInput = !this.showMobileInput;
        this.requestUpdate();
      },
      clearMobileInputText: () => {
        this.mobileInputText = '';
        this.requestUpdate();
      },
      toggleCtrlAlpha: () => {
        this.showCtrlAlpha = !this.showCtrlAlpha;
        this.requestUpdate();
      },
      clearCtrlSequence: () => {
        this.ctrlSequence = [];
        this.requestUpdate();
      },
    };
    this.directKeyboardManager.setCallbacks(directKeyboardCallbacks);

    // Initialize terminal lifecycle manager
    this.terminalLifecycleManager = new TerminalLifecycleManager();
    this.terminalLifecycleManager.setConnectionManager(this.connectionManager);
    this.terminalLifecycleManager.setInputManager(this.inputManager);
    this.terminalLifecycleManager.setConnected(this.connected);
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
        this.terminalCols = cols;
        this.terminalRows = rows;
        this.requestUpdate();
      },
    };
    this.terminalLifecycleManager.setStateCallbacks(stateCallbacks);

    if (this.session) {
      this.inputManager.setSession(this.session);
      this.terminalLifecycleManager.setSession(this.session);
    }

    // Load terminal preferences
    this.terminalMaxCols = this.preferencesManager.getMaxCols();
    this.terminalFontSize = this.preferencesManager.getFontSize();
    this.terminalTheme = this.preferencesManager.getTheme();
    logger.debug('Loaded terminal theme:', this.terminalTheme);
    this.terminalLifecycleManager.setTerminalFontSize(this.terminalFontSize);
    this.terminalLifecycleManager.setTerminalMaxCols(this.terminalMaxCols);
    this.terminalLifecycleManager.setTerminalTheme(this.terminalTheme);

    // Initialize lifecycle event manager
    this.lifecycleEventManager = new LifecycleEventManager();
    this.lifecycleEventManager.setSessionViewElement(this);
    this.lifecycleEventManager.setCallbacks(this.createLifecycleEventManagerCallbacks());
    this.lifecycleEventManager.setSession(this.session);

    // Load direct keyboard preference (needed before lifecycle setup)
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      if (stored) {
        const preferences = JSON.parse(stored);
        this.useDirectKeyboard = preferences.useDirectKeyboard ?? true; // Default to true for new users
      } else {
        this.useDirectKeyboard = true; // Default to true when no settings exist
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
      this.useDirectKeyboard = true; // Default to true on error
    }

    // Set up lifecycle (replaces the extracted lifecycle logic)
    this.lifecycleEventManager.setupLifecycle();

    // Add drag & drop and paste event listeners
    this.addEventListener('dragover', this.boundHandleDragOver);
    this.addEventListener('dragleave', this.boundHandleDragLeave);
    this.addEventListener('drop', this.boundHandleDrop);
    document.addEventListener('paste', this.boundHandlePaste);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Remove orientation listeners
    if (this.boundHandleOrientationChange) {
      window.removeEventListener('orientationchange', this.boundHandleOrientationChange);
      window.removeEventListener('resize', this.boundHandleOrientationChange);
    }

    // Remove drag & drop and paste event listeners
    this.removeEventListener('dragover', this.boundHandleDragOver);
    this.removeEventListener('dragleave', this.boundHandleDragLeave);
    this.removeEventListener('drop', this.boundHandleDrop);
    document.removeEventListener('paste', this.boundHandlePaste);

    // Clear any pending timeout
    if (this.createHiddenInputTimeout) {
      clearTimeout(this.createHiddenInputTimeout);
      this.createHiddenInputTimeout = null;
    }

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
    this.isLandscape = isLandscape;
  }

  private handleOrientationChange() {
    this.checkOrientation();
    // Request update to re-render with new safe area classes
    this.requestUpdate();
  }

  firstUpdated(changedProperties: PropertyValues) {
    super.firstUpdated(changedProperties);

    // Load terminal preferences BEFORE terminal setup to ensure proper initialization
    this.terminalTheme = this.preferencesManager.getTheme();
    logger.debug('Loaded terminal theme from preferences:', this.terminalTheme);

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
      if (this.session && this.connected && !oldSession) {
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
    if (changedProperties.has('connected') && this.connected && this.session) {
      this.ensureTerminalInitialized();
    }
  }

  /**
   * Ensures terminal is properly initialized with current session data.
   * This method is idempotent and can be called multiple times safely.
   */
  private ensureTerminalInitialized() {
    if (!this.session || !this.connected) {
      logger.log('Cannot initialize terminal: missing session or not connected');
      return;
    }

    // Check if terminal is already initialized
    if (this.terminalLifecycleManager.getTerminal()) {
      logger.log('Terminal already initialized');
      return;
    }

    // Check if terminal element exists in DOM
    const terminalElement = this.querySelector('vibe-terminal') as Terminal;
    if (!terminalElement) {
      logger.log('Terminal element not found in DOM, deferring initialization');
      // Retry after next render cycle
      requestAnimationFrame(() => {
        this.ensureTerminalInitialized();
      });
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

  private handleScreenshare() {
    // Dispatch event to start screenshare
    this.dispatchEvent(
      new CustomEvent('start-screenshare', {
        bubbles: true,
        composed: true,
      })
    );
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
    logger.log('session exit event received', customEvent.detail);

    if (this.session && customEvent.detail.sessionId === this.session.id) {
      // Update session status to exited
      this.session = { ...this.session, status: 'exited' };
      this.requestUpdate();

      // Switch to snapshot mode - disconnect stream and load final snapshot
      if (this.connectionManager) {
        this.connectionManager.cleanupStreamConnection();
      }

      // Notify parent app that session status changed so it can refresh the session list
      this.dispatchEvent(
        new CustomEvent('session-status-changed', {
          detail: {
            sessionId: this.session.id,
            newStatus: 'exited',
            exitCode: customEvent.detail.exitCode,
          },
          bubbles: true,
        })
      );
    }
  }

  // Mobile input methods
  private handleMobileInputToggle() {
    this.mobileInputManager.handleMobileInputToggle();
  }

  // Helper methods for MobileInputManager
  shouldUseDirectKeyboard(): boolean {
    return this.useDirectKeyboard;
  }

  toggleMobileInputDisplay(): void {
    this.showMobileInput = !this.showMobileInput;
    if (!this.showMobileInput) {
      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    }
  }

  getMobileInputText(): string {
    return this.mobileInputText;
  }

  clearMobileInputText(): void {
    this.mobileInputText = '';
  }

  closeMobileInput(): void {
    this.showMobileInput = false;
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

  private async handleMobileInputSendOnly(text: string) {
    await this.mobileInputManager.handleMobileInputSendOnly(text);
  }

  private async handleMobileInputSend(text: string) {
    await this.mobileInputManager.handleMobileInputSend(text);
  }

  private handleMobileInputCancel() {
    this.mobileInputManager.handleMobileInputCancel();
  }

  private async handleSpecialKey(key: string) {
    if (this.inputManager) {
      await this.inputManager.sendInputText(key);
    }
  }

  private handleCtrlAlphaToggle() {
    this.showCtrlAlpha = !this.showCtrlAlpha;
  }

  private async handleCtrlKey(letter: string) {
    // Add to sequence instead of immediately sending
    this.ctrlSequence = [...this.ctrlSequence, letter];
    this.requestUpdate();
  }

  private async handleSendCtrlSequence() {
    // Send each ctrl key in sequence
    if (this.inputManager) {
      for (const letter of this.ctrlSequence) {
        const controlCode = String.fromCharCode(letter.charCodeAt(0) - 64);
        await this.inputManager.sendInputText(controlCode);
      }
    }
    // Clear sequence and close overlay
    this.ctrlSequence = [];
    this.showCtrlAlpha = false;
    this.requestUpdate();

    // Refocus the hidden input
    if (this.directKeyboardManager.shouldRefocusHiddenInput()) {
      this.directKeyboardManager.refocusHiddenInput();
    }
  }

  private handleClearCtrlSequence() {
    this.ctrlSequence = [];
    this.requestUpdate();
  }

  private handleCtrlAlphaCancel() {
    this.showCtrlAlpha = false;
    this.ctrlSequence = [];
    this.requestUpdate();

    // Refocus the hidden input
    if (this.directKeyboardManager.shouldRefocusHiddenInput()) {
      this.directKeyboardManager.refocusHiddenInput();
    }
  }

  private toggleDirectKeyboard() {
    this.useDirectKeyboard = !this.useDirectKeyboard;

    // Save preference
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      const preferences = stored ? JSON.parse(stored) : {};
      preferences.useDirectKeyboard = this.useDirectKeyboard;
      localStorage.setItem('vibetunnel_app_preferences', JSON.stringify(preferences));

      // Emit preference change event
      window.dispatchEvent(
        new CustomEvent('app-preferences-changed', {
          detail: preferences,
        })
      );
    } catch (error) {
      logger.error('Failed to save direct keyboard preference', error);
    }

    // Update UI
    this.requestUpdate();

    // If enabling direct keyboard on mobile, ensure hidden input
    if (this.isMobile && this.useDirectKeyboard) {
      this.directKeyboardManager.ensureHiddenInputVisible();
    }
  }

  private handleKeyboardButtonClick() {
    // Show quick keys immediately for visual feedback
    this.showQuickKeys = true;

    // Update terminal transform immediately
    this.updateTerminalTransform();

    // Focus the hidden input synchronously - critical for iOS Safari
    // Must be called directly in the click handler without any delays
    this.directKeyboardManager.focusHiddenInput();

    // Request update after all synchronous operations
    this.requestUpdate();
  }

  private handleTerminalFitToggle() {
    this.terminalFitHorizontally = !this.terminalFitHorizontally;
    // Find the terminal component and call its handleFitToggle method
    const terminal = this.querySelector('vibe-terminal') as HTMLElement & {
      handleFitToggle?: () => void;
    };
    if (terminal?.handleFitToggle) {
      // Use the terminal's own toggle method which handles scroll position correctly
      terminal.handleFitToggle();
    }
  }

  private handleMaxWidthToggle() {
    this.showWidthSelector = !this.showWidthSelector;
  }

  private handleWidthSelect(newMaxCols: number) {
    this.terminalMaxCols = newMaxCols;
    this.preferencesManager.setMaxCols(newMaxCols);
    this.showWidthSelector = false;

    // Update the terminal lifecycle manager
    this.terminalLifecycleManager.setTerminalMaxCols(newMaxCols);

    // Update the terminal component
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    if (terminal) {
      terminal.maxCols = newMaxCols;
      // Mark that user has manually selected a width
      terminal.setUserOverrideWidth(true);
      // Trigger a resize to apply the new constraint
      terminal.requestUpdate();
    } else {
      logger.warn('Terminal component not found when setting width');
    }
  }

  getCurrentWidthLabel(): string {
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    const userOverrideWidth = terminal?.userOverrideWidth || false;
    const initialCols = terminal?.initialCols || 0;

    // Only apply width restrictions to tunneled sessions (those with 'fwd_' prefix)
    const isTunneledSession = this.session?.id?.startsWith('fwd_');

    // If no manual selection and we have initial dimensions that are limiting (only for tunneled sessions)
    if (this.terminalMaxCols === 0 && initialCols > 0 && !userOverrideWidth && isTunneledSession) {
      return `≤${initialCols}`; // Shows "≤120" to indicate limited to session width
    } else if (this.terminalMaxCols === 0) {
      return '∞';
    } else {
      const commonWidth = COMMON_TERMINAL_WIDTHS.find((w) => w.value === this.terminalMaxCols);
      return commonWidth ? commonWidth.label : this.terminalMaxCols.toString();
    }
  }

  getWidthTooltip(): string {
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    const userOverrideWidth = terminal?.userOverrideWidth || false;
    const initialCols = terminal?.initialCols || 0;

    // Only apply width restrictions to tunneled sessions (those with 'fwd_' prefix)
    const isTunneledSession = this.session?.id?.startsWith('fwd_');

    // If no manual selection and we have initial dimensions that are limiting (only for tunneled sessions)
    if (this.terminalMaxCols === 0 && initialCols > 0 && !userOverrideWidth && isTunneledSession) {
      return `Terminal width: Limited to native terminal width (${initialCols} columns)`;
    } else {
      return `Terminal width: ${this.terminalMaxCols === 0 ? 'Unlimited' : `${this.terminalMaxCols} columns`}`;
    }
  }

  private handleFontSizeChange(newSize: number) {
    // Clamp to reasonable bounds
    const clampedSize = Math.max(8, Math.min(32, newSize));
    this.terminalFontSize = clampedSize;
    this.preferencesManager.setFontSize(clampedSize);

    // Update the terminal lifecycle manager
    this.terminalLifecycleManager.setTerminalFontSize(clampedSize);

    // Update the terminal component
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    if (terminal) {
      terminal.fontSize = clampedSize;
      terminal.requestUpdate();
    }
  }

  private handleThemeChange(newTheme: TerminalThemeId) {
    logger.debug('Changing terminal theme to:', newTheme);

    this.terminalTheme = newTheme;
    this.preferencesManager.setTheme(newTheme);
    this.terminalLifecycleManager.setTerminalTheme(newTheme);

    const terminal = this.querySelector('vibe-terminal') as Terminal;
    if (terminal) {
      terminal.theme = newTheme;
      terminal.requestUpdate();
    }
  }

  private handleOpenFileBrowser() {
    this.showFileBrowser = true;
  }

  private handleCloseFileBrowser() {
    this.showFileBrowser = false;
  }

  private handleOpenFilePicker() {
    if (!this.isMobile) {
      // On desktop, directly open the file picker without showing the dialog
      const filePicker = this.querySelector('file-picker') as FilePicker | null;
      if (filePicker && typeof filePicker.openFilePicker === 'function') {
        filePicker.openFilePicker();
      }
    } else {
      // On mobile, show the file picker dialog
      this.showImagePicker = true;
    }
  }

  private handleCloseFilePicker() {
    this.showImagePicker = false;
  }

  private async handleFileSelected(event: CustomEvent) {
    const { path } = event.detail;
    if (!path || !this.session) return;

    // Close the file picker
    this.showImagePicker = false;

    // Escape the path for shell use (wrap in quotes if it contains spaces)
    const escapedPath = path.includes(' ') ? `"${path}"` : path;

    // Send the path to the terminal
    if (this.inputManager) {
      await this.inputManager.sendInputText(escapedPath);
    }

    logger.log(`inserted file path into terminal: ${escapedPath}`);
  }

  private handleFileError(event: CustomEvent) {
    const error = event.detail;
    logger.error('File picker error:', error);

    // Show error to user (you might want to implement a toast notification system)
    this.dispatchEvent(new CustomEvent('error', { detail: error }));
  }

  private async handleRename(event: CustomEvent) {
    const { sessionId, newName } = event.detail;
    if (!this.session || sessionId !== this.session.id) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to rename session', { errorData, sessionId });
        throw new Error(`Rename failed: ${response.status}`);
      }

      // Get the actual name from the server response
      const result = await response.json();
      const actualName = result.name || newName;

      // Update the local session object with the server-assigned name
      this.session = { ...this.session, name: actualName };

      // Update the page title with the new session name
      const sessionName = actualName || this.session.command.join(' ');
      titleManager.setSessionTitle(sessionName);

      // Dispatch event to notify parent components with the actual name
      this.dispatchEvent(
        new CustomEvent('session-renamed', {
          detail: { sessionId, newName: actualName },
          bubbles: true,
          composed: true,
        })
      );

      logger.log(`Session ${sessionId} renamed to: ${actualName}`);
    } catch (error) {
      logger.error('Error renaming session', { error, sessionId });

      // Show error to user
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to rename session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      );
    }
  }

  // Drag & Drop handlers
  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Check if the drag contains files
    if (e.dataTransfer?.types.includes('Files')) {
      this.isDragOver = true;
    }
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Only hide drag overlay if we're leaving the main container
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.isDragOver = false;
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;

    const files = Array.from(e.dataTransfer?.files || []);

    if (files.length === 0) {
      logger.warn('No files found in drop');
      return;
    }

    // Upload all files sequentially
    for (const file of files) {
      try {
        await this.uploadFile(file);
        logger.log(`Successfully uploaded file: ${file.name}`);
      } catch (error) {
        logger.error(`Failed to upload file: ${file.name}`, error);
      }
    }
  }

  // Paste handler
  private async handlePaste(e: ClipboardEvent) {
    // Only handle paste if session view is focused and no modal is open
    if (this.showFileBrowser || this.showImagePicker || this.showMobileInput) {
      return;
    }

    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter((item) => item.kind === 'file');

    if (fileItems.length === 0) {
      return; // Let normal paste handling continue
    }

    e.preventDefault(); // Prevent default paste behavior for files

    // Upload all pasted files
    for (const fileItem of fileItems) {
      const file = fileItem.getAsFile();
      if (file) {
        try {
          await this.uploadFile(file);
          logger.log(`Successfully pasted and uploaded file: ${file.name}`);
        } catch (error) {
          logger.error(`Failed to upload pasted file: ${file?.name}`, error);
        }
      }
    }
  }

  private async uploadFile(file: File) {
    try {
      // Get the file picker component and use its upload method
      const filePicker = this.querySelector('file-picker') as FilePicker | null;
      if (filePicker && typeof filePicker.uploadFile === 'function') {
        await filePicker.uploadFile(file);
      } else {
        logger.error('File picker component not found or upload method not available');
      }
    } catch (error) {
      logger.error('Failed to upload dropped/pasted file:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: error instanceof Error ? error.message : 'Failed to upload file',
        })
      );
    }
  }

  private async handleInsertPath(event: CustomEvent) {
    const { path, type } = event.detail;
    if (!path || !this.session) return;

    // Escape the path for shell use (wrap in quotes if it contains spaces)
    const escapedPath = path.includes(' ') ? `"${path}"` : path;

    // Send the path to the terminal
    if (this.inputManager) {
      await this.inputManager.sendInputText(escapedPath);
    }

    logger.log(`inserted ${type} path into terminal: ${escapedPath}`);
  }

  focusHiddenInput() {
    // Delegate to the DirectKeyboardManager
    this.directKeyboardManager.focusHiddenInput();
  }

  private handleTerminalClick(e: Event) {
    if (this.isMobile && this.useDirectKeyboard) {
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

  private _updateTerminalTransformTimeout: ReturnType<typeof setTimeout> | null = null;

  private updateTerminalTransform(): void {
    // Clear any existing timeout to debounce calls
    if (this._updateTerminalTransformTimeout) {
      clearTimeout(this._updateTerminalTransformTimeout);
    }

    this._updateTerminalTransformTimeout = setTimeout(() => {
      // Calculate height reduction for keyboard and quick keys
      let heightReduction = 0;

      if (this.showQuickKeys) {
        // Quick keys height (approximately 140px based on CSS)
        // Add 10px buffer to ensure content is visible above quick keys
        const quickKeysHeight = 150;
        heightReduction += quickKeysHeight;
      }

      if (this.keyboardHeight > 0) {
        // Add small buffer for keyboard too
        heightReduction += this.keyboardHeight + 10;
      }

      // Calculate terminal container height
      if (heightReduction > 0) {
        // Use calc to subtract from full height (accounting for header)
        this.terminalContainerHeight = `calc(100% - ${heightReduction}px)`;
      } else {
        this.terminalContainerHeight = '100%';
      }

      // Log for debugging
      logger.log(
        `Terminal height updated: quickKeys=${this.showQuickKeys}, keyboardHeight=${this.keyboardHeight}, reduction=${heightReduction}px`
      );

      // Force immediate update to apply height change
      this.requestUpdate();

      // Always notify terminal to resize when there's a change
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const terminal = this.querySelector('vibe-terminal') as Terminal;
        if (terminal) {
          // Notify terminal of size change
          const terminalElement = terminal as unknown as { fitTerminal?: () => void };
          if (typeof terminalElement.fitTerminal === 'function') {
            terminalElement.fitTerminal();
          }

          // If height was reduced, scroll to keep cursor visible
          if (heightReduction > 0) {
            // Small delay then scroll to bottom to keep cursor visible
            setTimeout(() => {
              terminal.scrollToBottom();
            }, 50);
          }
        }
      });
    }, 100); // Debounce by 100ms
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
      </style>
      <div
        class="flex flex-col bg-base font-mono relative"
        style="height: 100vh; height: 100dvh; outline: none !important; box-shadow: none !important;"
      >
        <!-- Session Header -->
        <session-header
          .session=${this.session}
          .showBackButton=${this.showBackButton}
          .showSidebarToggle=${this.showSidebarToggle}
          .sidebarCollapsed=${this.sidebarCollapsed}
          .terminalMaxCols=${this.terminalMaxCols}
          .terminalFontSize=${this.terminalFontSize}
          .customWidth=${this.customWidth}
          .showWidthSelector=${this.showWidthSelector}
          .widthLabel=${this.getCurrentWidthLabel()}
          .widthTooltip=${this.getWidthTooltip()}
          .onBack=${() => this.handleBack()}
          .onSidebarToggle=${() => this.handleSidebarToggle()}
          .onCreateSession=${() => this.handleCreateSession()}
          .onOpenFileBrowser=${() => this.handleOpenFileBrowser()}
          .onOpenImagePicker=${() => this.handleOpenFilePicker()}
          .onMaxWidthToggle=${() => this.handleMaxWidthToggle()}
          .onWidthSelect=${(width: number) => this.handleWidthSelect(width)}
          .onFontSizeChange=${(size: number) => this.handleFontSizeChange(size)}
          .onScreenshare=${() => this.handleScreenshare()}
          .onOpenSettings=${() => this.handleOpenSettings()}
          @close-width-selector=${() => {
            this.showWidthSelector = false;
            this.customWidth = '';
          }}
          @session-rename=${(e: CustomEvent) => this.handleRename(e)}
        >
        </session-header>

        <!-- Enhanced Terminal Container -->
        <div
          class="${this.terminalContainerHeight === '100%' ? 'flex-1' : ''} bg-bg overflow-hidden min-h-0 relative ${
            this.session?.status === 'exited' ? 'session-exited opacity-90' : ''
          } ${
            // Add safe area padding for landscape mode on mobile to handle notch
            this.isMobile && this.isLandscape ? 'safe-area-left safe-area-right' : ''
          }"
          id="terminal-container"
          style="${this.terminalContainerHeight !== '100%' ? `height: ${this.terminalContainerHeight}; flex: none; max-height: ${this.terminalContainerHeight};` : ''}"
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
          <!-- Enhanced Terminal Component -->
          <vibe-terminal
            .sessionId=${this.session?.id || ''}
            .sessionStatus=${this.session?.status || 'running'}
            .cols=${80}
            .rows=${24}
            .fontSize=${this.terminalFontSize}
            .fitHorizontally=${false}
            .maxCols=${this.terminalMaxCols}
            .theme=${this.terminalTheme}
            .initialCols=${this.session?.initialCols || 0}
            .initialRows=${this.session?.initialRows || 0}
            .disableClick=${this.isMobile && this.useDirectKeyboard}
            .hideScrollButton=${this.showQuickKeys}
            class="w-full h-full p-0 m-0 terminal-container"
            @click=${this.handleTerminalClick}
            @terminal-input=${this.handleTerminalInput}
          ></vibe-terminal>
        </div>

        <!-- Floating Session Exited Banner (outside terminal container to avoid filter effects) -->
        ${
          this.session?.status === 'exited'
            ? html`
              <div
                class="fixed inset-0 flex items-center justify-center pointer-events-none z-[25]"
              >
                <div
                  class="bg-elevated border border-status-warning text-status-warning font-medium text-sm tracking-wide px-6 py-3 rounded-lg shadow-elevated animate-scale-in"
                >
                  <span class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-status-warning"></span>
                    SESSION EXITED
                  </span>
                </div>
              </div>
            `
            : ''
        }

        <!-- Mobile Input Controls (only show when direct keyboard is disabled) -->
        ${
          this.isMobile && !this.showMobileInput && !this.useDirectKeyboard
            ? html`
              <div class="flex-shrink-0 p-4 bg-secondary">
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
                    @click=${this.handleOpenFilePicker}
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
                    @click=${this.handleCtrlAlphaToggle}
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

        <!-- Mobile Input Overlay -->
        <mobile-input-overlay
          .visible=${this.isMobile && this.showMobileInput}
          .mobileInputText=${this.mobileInputText}
          .keyboardHeight=${this.keyboardHeight}
          .touchStartX=${this.touchStartX}
          .touchStartY=${this.touchStartY}
          .onSend=${(text: string) => this.handleMobileInputSendOnly(text)}
          .onSendWithEnter=${(text: string) => this.handleMobileInputSend(text)}
          .onCancel=${() => this.handleMobileInputCancel()}
          .onTextChange=${(text: string) => {
            this.mobileInputText = text;
          }}
          .handleBack=${this.handleBack.bind(this)}
        ></mobile-input-overlay>

        <!-- Ctrl+Alpha Overlay -->
        <ctrl-alpha-overlay
          .visible=${this.isMobile && this.showCtrlAlpha}
          .ctrlSequence=${this.ctrlSequence}
          .keyboardHeight=${this.keyboardHeight}
          .onCtrlKey=${(letter: string) => this.handleCtrlKey(letter)}
          .onSendSequence=${() => this.handleSendCtrlSequence()}
          .onClearSequence=${() => this.handleClearCtrlSequence()}
          .onCancel=${() => this.handleCtrlAlphaCancel()}
        ></ctrl-alpha-overlay>

        <!-- Floating Keyboard Button (for direct keyboard mode on mobile) -->
        ${
          this.isMobile && this.useDirectKeyboard && !this.showQuickKeys
            ? html`
              <div
                class="keyboard-button"
                @pointerdown=${(e: PointerEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                @click=${(e: MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.handleKeyboardButtonClick();
                }}
                title="Show keyboard"
              >
                ⌨
              </div>
            `
            : ''
        }

        <!-- Terminal Quick Keys (for direct keyboard mode) -->
        <terminal-quick-keys
          .visible=${this.isMobile && this.useDirectKeyboard && this.showQuickKeys}
          .onKeyPress=${this.directKeyboardManager.handleQuickKeyPress}
        ></terminal-quick-keys>

        <!-- File Browser Modal -->
        <file-browser
          .visible=${this.showFileBrowser}
          .mode=${'browse'}
          .session=${this.session}
          @browser-cancel=${this.handleCloseFileBrowser}
          @insert-path=${this.handleInsertPath}
        ></file-browser>

        <!-- File Picker Modal -->
        <file-picker
          .visible=${this.showImagePicker}
          @file-selected=${this.handleFileSelected}
          @file-error=${this.handleFileError}
          @file-cancel=${this.handleCloseFilePicker}
        ></file-picker>
        
        <!-- Width Selector Modal (moved here for proper positioning) -->
        <terminal-settings-modal
          .visible=${this.showWidthSelector}
          .terminalMaxCols=${this.terminalMaxCols}
          .terminalFontSize=${this.terminalFontSize}
          .terminalTheme=${this.terminalTheme}
          .customWidth=${this.customWidth}
          .isMobile=${this.isMobile}
          .onWidthSelect=${(width: number) => this.handleWidthSelect(width)}
          .onFontSizeChange=${(size: number) => this.handleFontSizeChange(size)}
          .onThemeChange=${(theme: TerminalThemeId) => this.handleThemeChange(theme)}
          .onClose=${() => {
            this.showWidthSelector = false;
            this.customWidth = '';
          }}
        ></terminal-settings-modal>

        <!-- Drag & Drop Overlay -->
        ${
          this.isDragOver
            ? html`
              <div class="fixed inset-0 bg-bg bg-opacity-90 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none animate-fade-in">
                <div class="bg-elevated border-2 border-dashed border-primary rounded-xl p-10 text-center max-w-md mx-4 shadow-2xl animate-scale-in">
                  <div class="relative mb-6">
                    <div class="w-24 h-24 mx-auto bg-gradient-to-br from-primary to-primary-light rounded-full flex items-center justify-center shadow-glow">
                      <svg class="w-12 h-12 text-base" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                      </svg>
                    </div>
                    <div class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
                  </div>
                  <h3 class="text-2xl font-bold text-primary mb-3">Drop files here</h3>
                  <p class="text-sm text-muted mb-4">Files will be uploaded and the path sent to terminal</p>
                  <div class="inline-flex items-center gap-2 text-xs text-dim bg-secondary px-4 py-2 rounded-lg">
                    <span class="opacity-75">Or press</span>
                    <kbd class="px-2 py-1 bg-tertiary border border-base rounded text-primary font-mono text-xs">⌘V</kbd>
                    <span class="opacity-75">to paste from clipboard</span>
                  </div>
                </div>
              </div>
            `
            : ''
        }
      </div>
    `;
  }
}

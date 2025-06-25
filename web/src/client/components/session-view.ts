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
import './clickable-path.js';
import './terminal-quick-keys.js';
import { authClient } from '../services/auth-client.js';
import { CastConverter } from '../utils/cast-converter.js';
import { createLogger } from '../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../utils/terminal-preferences.js';
import { type AppPreferences, AppSettings } from './app-settings.js';
import type { Terminal } from './terminal.js';

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
  @state() private terminal: Terminal | null = null;
  @state() private streamConnection: {
    eventSource: EventSource;
    disconnect: () => void;
    errorHandler?: EventListener;
  } | null = null;
  @state() private showMobileInput = false;
  @state() private mobileInputText = '';
  @state() private isMobile = false;
  @state() private touchStartX = 0;
  @state() private touchStartY = 0;
  @state() private loading = false;
  @state() private loadingFrame = 0;
  @state() private terminalCols = 0;
  @state() private terminalRows = 0;
  @state() private showCtrlAlpha = false;
  @state() private terminalFitHorizontally = false;
  @state() private terminalMaxCols = 0;
  @state() private showWidthSelector = false;
  @state() private customWidth = '';
  @state() private showFileBrowser = false;
  @state() private terminalFontSize = 14;

  private preferencesManager = TerminalPreferencesManager.getInstance();
  @state() private reconnectCount = 0;
  @state() private ctrlSequence: string[] = [];
  @state() private useDirectKeyboard = false;
  @state() private showQuickKeys = false;
  @state() private keyboardHeight = 0;

  private loadingInterval: number | null = null;
  private keyboardListenerAdded = false;
  private touchListenersAdded = false;
  private hiddenInput: HTMLInputElement | null = null; // Will be removed after smart gesture implementation
  private tempInput: HTMLInputElement | null = null;
  private resizeTimeout: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;
  private instanceId = `session-view-${Math.random().toString(36).substr(2, 9)}`;
  private focusRetentionInterval: number | null = null;
  private visualViewportHandler: (() => void) | null = null;

  private handlePreferencesChanged = (e: Event) => {
    const event = e as CustomEvent;
    const preferences = event.detail as AppPreferences;
    this.useDirectKeyboard = preferences.useDirectKeyboard;

    // Update hidden input based on preference
    if (this.isMobile && this.useDirectKeyboard && !this.hiddenInput) {
      this.createHiddenInput();
    } else if (!this.useDirectKeyboard && this.hiddenInput) {
      // Remove hidden input when direct keyboard is disabled
      this.hiddenInput.remove();
      this.hiddenInput = null;
      this.showQuickKeys = false;
      if (this.focusRetentionInterval) {
        clearInterval(this.focusRetentionInterval);
        this.focusRetentionInterval = null;
      }
    }
  };

  private keyboardHandler = (e: KeyboardEvent) => {
    // Check if we're typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    ) {
      // Allow normal input in form fields
      return;
    }

    // Handle Cmd+O / Ctrl+O to open file browser
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
      e.preventDefault();
      this.showFileBrowser = true;
      return;
    }
    if (!this.session) return;

    // Allow important browser shortcuts to pass through
    const isMacOS = navigator.platform.toLowerCase().includes('mac');

    // Allow F12 and Ctrl+Shift+I (DevTools)
    if (
      e.key === 'F12' ||
      (!isMacOS && e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (isMacOS && e.metaKey && e.altKey && e.key === 'I')
    ) {
      return;
    }

    // Allow Ctrl+A (select all), Ctrl+F (find), Ctrl+R (refresh), Ctrl+C/V (copy/paste), etc.
    if (
      !isMacOS &&
      e.ctrlKey &&
      !e.shiftKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return;
    }

    // Allow Cmd+A, Cmd+F, Cmd+R, Cmd+C/V (copy/paste), etc. on macOS
    if (
      isMacOS &&
      e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return;
    }

    // Allow Alt+Tab, Cmd+Tab (window switching)
    if ((e.altKey || e.metaKey) && e.key === 'Tab') {
      return;
    }

    // Only prevent default for keys we're actually going to handle
    e.preventDefault();
    e.stopPropagation();

    this.handleKeyboardInput(e);
  };

  private touchStartHandler = (e: TouchEvent) => {
    if (!this.isMobile) return;

    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  };

  private touchEndHandler = (e: TouchEvent) => {
    if (!this.isMobile) return;

    const touch = e.changedTouches[0];
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;

    const deltaX = touchEndX - this.touchStartX;
    const deltaY = touchEndY - this.touchStartY;

    // Check for horizontal swipe from left edge (back gesture)
    const isSwipeRight = deltaX > 100;
    const isVerticallyStable = Math.abs(deltaY) < 100;
    const startedFromLeftEdge = this.touchStartX < 50;

    if (isSwipeRight && isVerticallyStable && startedFromLeftEdge) {
      // Trigger back navigation
      this.handleBack();
    }
  };

  private handleClickOutside = (e: Event) => {
    if (this.showWidthSelector) {
      const target = e.target as HTMLElement;
      const widthSelector = this.querySelector('.width-selector-container');
      const widthButton = this.querySelector('.width-selector-button');

      if (!widthSelector?.contains(target) && !widthButton?.contains(target)) {
        this.showWidthSelector = false;
        this.customWidth = '';
      }
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this.connected = true;

    // Load terminal preferences
    this.terminalMaxCols = this.preferencesManager.getMaxCols();
    this.terminalFontSize = this.preferencesManager.getFontSize();

    // Make session-view focusable
    this.tabIndex = 0;
    this.addEventListener('click', () => {
      if (!this.disableFocusManagement) {
        this.focus();
      }
    });

    // Add click outside handler for width selector
    document.addEventListener('click', this.handleClickOutside);

    // Show loading animation if no session yet
    if (!this.session) {
      this.startLoading();
    }

    // Detect mobile device - only show onscreen keyboard on actual mobile devices
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    // Load direct keyboard preference
    const preferences = AppSettings.getPreferences();
    this.useDirectKeyboard = preferences.useDirectKeyboard;

    // Listen for preference changes
    window.addEventListener('app-preferences-changed', this.handlePreferencesChanged);

    // Set up VirtualKeyboard API if available and on mobile
    if (this.isMobile && 'virtualKeyboard' in navigator) {
      // Enable overlays-content mode so keyboard doesn't resize viewport
      try {
        (navigator as any).virtualKeyboard.overlaysContent = true;
        logger.log('VirtualKeyboard API: overlaysContent enabled');
      } catch (e) {
        logger.warn('Failed to set virtualKeyboard.overlaysContent:', e);
      }
    } else if (this.isMobile) {
      logger.log('VirtualKeyboard API not available on this device');
    }

    // Set up Visual Viewport API for Safari keyboard detection
    if (this.isMobile && window.visualViewport) {
      this.visualViewportHandler = () => {
        const viewport = window.visualViewport!;
        const keyboardHeight = window.innerHeight - viewport.height;

        // Store keyboard height in state
        this.keyboardHeight = keyboardHeight;

        // Update quick keys component if it exists
        const quickKeys = this.querySelector('terminal-quick-keys') as any;
        if (quickKeys) {
          quickKeys.keyboardHeight = keyboardHeight;
        }

        logger.log(`Visual Viewport keyboard height: ${keyboardHeight}px`);
      };

      window.visualViewport.addEventListener('resize', this.visualViewportHandler);
      window.visualViewport.addEventListener('scroll', this.visualViewportHandler);
    }

    // Only add listeners if not already added
    if (!this.isMobile && !this.keyboardListenerAdded) {
      document.addEventListener('keydown', this.keyboardHandler);
      this.keyboardListenerAdded = true;
    } else if (this.isMobile && !this.touchListenersAdded) {
      // Add touch event listeners for mobile swipe gestures
      document.addEventListener('touchstart', this.touchStartHandler, { passive: true });
      document.addEventListener('touchend', this.touchEndHandler, { passive: true });
      this.touchListenersAdded = true;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.connected = false;

    logger.log('SessionView disconnectedCallback called', {
      sessionId: this.session?.id,
      sessionStatus: this.session?.status,
    });

    // Reset terminal size for external terminals when leaving session view
    if (this.session && this.session.status !== 'exited') {
      logger.log('Calling resetTerminalSize for session', this.session.id);
      this.resetTerminalSize();
    }

    // Remove click outside handler
    document.removeEventListener('click', this.handleClickOutside);

    // Remove click handler
    this.removeEventListener('click', () => this.focus());

    // Remove global keyboard event listener
    if (!this.isMobile && this.keyboardListenerAdded) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardListenerAdded = false;
    } else if (this.isMobile && this.touchListenersAdded) {
      // Remove touch event listeners
      document.removeEventListener('touchstart', this.touchStartHandler);
      document.removeEventListener('touchend', this.touchEndHandler);
      this.touchListenersAdded = false;
    }

    // Clear focus retention interval
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
      this.focusRetentionInterval = null;
    }

    // Clean up Visual Viewport listener
    if (this.visualViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.visualViewportHandler);
      window.visualViewport.removeEventListener('scroll', this.visualViewportHandler);
      this.visualViewportHandler = null;
    }

    // Remove preference change listener
    window.removeEventListener('app-preferences-changed', this.handlePreferencesChanged);

    // Remove hidden input if it exists
    if (this.hiddenInput) {
      this.hiddenInput.remove();
      this.hiddenInput = null;
    }

    // Remove temporary input if it exists
    if (this.tempInput) {
      this.tempInput.remove();
      this.tempInput = null;
    }

    // Stop loading animation
    this.stopLoading();

    // Cleanup stream connection if it exists
    this.cleanupStreamConnection();

    // Terminal cleanup is handled by the component itself
    this.terminal = null;
  }

  firstUpdated(changedProperties: PropertyValues) {
    super.firstUpdated(changedProperties);
    if (this.session) {
      this.stopLoading();
      this.setupTerminal();
    }
  }

  private cleanupStreamConnection(): void {
    if (this.streamConnection) {
      logger.log('Cleaning up stream connection');
      this.streamConnection.disconnect();
      this.streamConnection = null;
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // If session changed, clean up old stream connection
    if (changedProperties.has('session')) {
      const oldSession = changedProperties.get('session') as Session | null;
      if (oldSession && oldSession.id !== this.session?.id) {
        logger.log('Session changed, cleaning up old stream connection');
        this.cleanupStreamConnection();
      }
    }

    // Stop loading and create terminal when session becomes available
    if (changedProperties.has('session') && this.session && this.loading) {
      this.stopLoading();
      this.setupTerminal();
    }

    // Initialize terminal after first render when terminal element exists
    if (!this.terminal && this.session && !this.loading && this.connected) {
      const terminalElement = this.querySelector('vibe-terminal') as Terminal;
      if (terminalElement) {
        this.initializeTerminal();
      }
    }

    // Create hidden input if direct keyboard is enabled on mobile
    if (
      this.isMobile &&
      this.useDirectKeyboard &&
      !this.hiddenInput &&
      this.session &&
      !this.loading
    ) {
      // Delay creation to ensure terminal is rendered
      setTimeout(() => {
        if (this.isMobile && this.useDirectKeyboard && !this.hiddenInput) {
          this.createHiddenInput();
        }
      }, 100);
    }
  }

  private setupTerminal() {
    // Terminal element will be created in render()
    // We'll initialize it in updated() after first render
  }

  private async initializeTerminal() {
    const terminalElement = this.querySelector('vibe-terminal') as Terminal;
    if (!terminalElement || !this.session) {
      logger.warn(`Cannot initialize terminal - missing element or session`);
      return;
    }

    this.terminal = terminalElement;

    // Configure terminal for interactive session
    this.terminal.cols = 80;
    this.terminal.rows = 24;
    this.terminal.fontSize = this.terminalFontSize; // Apply saved font size preference
    this.terminal.fitHorizontally = false; // Allow natural terminal sizing
    this.terminal.maxCols = this.terminalMaxCols; // Apply saved max width preference

    // Listen for session exit events
    this.terminal.addEventListener(
      'session-exit',
      this.handleSessionExit.bind(this) as EventListener
    );

    // Listen for terminal resize events to capture dimensions
    this.terminal.addEventListener(
      'terminal-resize',
      this.handleTerminalResize.bind(this) as unknown as EventListener
    );

    // Listen for paste events from terminal
    this.terminal.addEventListener(
      'terminal-paste',
      this.handleTerminalPaste.bind(this) as EventListener
    );

    // Connect to stream directly without artificial delays
    // Use setTimeout to ensure we're still connected after all synchronous updates
    setTimeout(() => {
      if (this.connected) {
        this.connectToStream();
      } else {
        logger.warn(`Component disconnected before stream connection`);
      }
    }, 0);
  }

  private connectToStream() {
    if (!this.terminal || !this.session) {
      logger.warn(`Cannot connect to stream - missing terminal or session`);
      return;
    }

    // Don't connect if we're already disconnected
    if (!this.connected) {
      logger.warn(`Component already disconnected, not connecting to stream`);
      return;
    }

    logger.log(`Connecting to stream for session ${this.session.id}`);

    // Clean up existing connection
    this.cleanupStreamConnection();

    // Get auth client from the main app
    const user = authClient.getCurrentUser();

    // Build stream URL with auth token as query parameter (EventSource doesn't support headers)
    let streamUrl = `/api/sessions/${this.session.id}/stream`;
    if (user?.token) {
      streamUrl += `?token=${encodeURIComponent(user.token)}`;
    }

    // Use CastConverter to connect terminal to stream with reconnection tracking
    const connection = CastConverter.connectToStream(this.terminal, streamUrl);

    // Wrap the connection to track reconnections
    const originalEventSource = connection.eventSource;
    let lastErrorTime = 0;
    const reconnectThreshold = 3; // Max reconnects before giving up
    const reconnectWindow = 5000; // 5 second window

    const handleError = () => {
      const now = Date.now();

      // Reset counter if enough time has passed since last error
      if (now - lastErrorTime > reconnectWindow) {
        this.reconnectCount = 0;
      }

      this.reconnectCount++;
      lastErrorTime = now;

      logger.log(`stream error #${this.reconnectCount} for session ${this.session?.id}`);

      // If we've had too many reconnects, mark session as exited
      if (this.reconnectCount >= reconnectThreshold) {
        logger.warn(`session ${this.session?.id} marked as exited due to excessive reconnections`);

        if (this.session && this.session.status !== 'exited') {
          this.session = { ...this.session, status: 'exited' };
          this.requestUpdate();

          // Disconnect the stream and load final snapshot
          this.cleanupStreamConnection();

          // Load final snapshot
          requestAnimationFrame(() => {
            this.loadSessionSnapshot();
          });
        }
      }
    };

    // Override the error handler
    originalEventSource.addEventListener('error', handleError);

    // Store the connection with error handler reference
    this.streamConnection = {
      ...connection,
      errorHandler: handleError as EventListener,
    };
  }

  private async handleKeyboardInput(e: KeyboardEvent) {
    if (!this.session) return;

    // Handle Escape key specially for exited sessions
    if (e.key === 'Escape' && this.session.status === 'exited') {
      this.handleBack();
      return;
    }

    // Don't send input to exited sessions
    if (this.session.status === 'exited') {
      logger.log('ignoring keyboard input - session has exited');
      return;
    }

    // Allow standard browser copy/paste shortcuts
    const isMacOS = navigator.platform.toLowerCase().includes('mac');
    const isStandardPaste =
      (isMacOS && e.metaKey && e.key === 'v' && !e.ctrlKey && !e.shiftKey) ||
      (!isMacOS && e.ctrlKey && e.key === 'v' && !e.shiftKey);
    const isStandardCopy =
      (isMacOS && e.metaKey && e.key === 'c' && !e.ctrlKey && !e.shiftKey) ||
      (!isMacOS && e.ctrlKey && e.key === 'c' && !e.shiftKey);

    if (isStandardPaste || isStandardCopy) {
      // Allow standard browser copy/paste to work
      return;
    }

    let inputText = '';

    // Handle special keys
    switch (e.key) {
      case 'Enter':
        if (e.ctrlKey) {
          // Ctrl+Enter - send to tty-fwd for proper handling
          inputText = 'ctrl_enter';
        } else if (e.shiftKey) {
          // Shift+Enter - send to tty-fwd for proper handling
          inputText = 'shift_enter';
        } else {
          // Regular Enter
          inputText = 'enter';
        }
        break;
      case 'Escape':
        inputText = 'escape';
        break;
      case 'ArrowUp':
        inputText = 'arrow_up';
        break;
      case 'ArrowDown':
        inputText = 'arrow_down';
        break;
      case 'ArrowLeft':
        inputText = 'arrow_left';
        break;
      case 'ArrowRight':
        inputText = 'arrow_right';
        break;
      case 'Tab':
        inputText = '\t';
        break;
      case 'Backspace':
        inputText = '\b';
        break;
      case 'Delete':
        inputText = '\x7f';
        break;
      case ' ':
        inputText = ' ';
        break;
      default:
        // Handle regular printable characters
        if (e.key.length === 1) {
          inputText = e.key;
        } else {
          // Ignore other special keys
          return;
        }
        break;
    }

    // Handle Ctrl combinations (but not if we already handled Ctrl+Enter above)
    if (e.ctrlKey && e.key.length === 1 && e.key !== 'Enter') {
      const charCode = e.key.toLowerCase().charCodeAt(0);
      if (charCode >= 97 && charCode <= 122) {
        // a-z
        inputText = String.fromCharCode(charCode - 96); // Ctrl+A = \x01, etc.
      }
    }

    // Send the input to the session
    try {
      // Determine if we should send as key or text
      const body = [
        'enter',
        'escape',
        'arrow_up',
        'arrow_down',
        'arrow_left',
        'arrow_right',
        'ctrl_enter',
        'shift_enter',
        'backspace',
        'tab',
      ].includes(inputText)
        ? { key: inputText }
        : { text: inputText };

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 400) {
          logger.log('session no longer accepting input (likely exited)');
          // Update session status to exited if we get 400 error
          if (this.session && (this.session.status as string) !== 'exited') {
            this.session = { ...this.session, status: 'exited' };
            this.requestUpdate();
          }
        } else {
          logger.error('failed to send input to session', { status: response.status });
        }
      }
    } catch (error) {
      logger.error('error sending input', error);
    }
  }

  private handleBack() {
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

  private handleSessionExit(e: Event) {
    const customEvent = e as CustomEvent;
    logger.log('session exit event received', customEvent.detail);

    if (this.session && customEvent.detail.sessionId === this.session.id) {
      // Update session status to exited
      this.session = { ...this.session, status: 'exited' };
      this.requestUpdate();

      // Switch to snapshot mode - disconnect stream and load final snapshot
      this.cleanupStreamConnection();
    }
  }

  private async loadSessionSnapshot() {
    if (!this.terminal || !this.session) return;

    try {
      const url = `/api/sessions/${this.session.id}/snapshot`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch snapshot: ${response.status}`);

      const castContent = await response.text();

      // Clear terminal and load snapshot
      this.terminal.clear();
      await CastConverter.dumpToTerminal(this.terminal, castContent);

      // Scroll to bottom after loading
      this.terminal.queueCallback(() => {
        if (this.terminal) {
          this.terminal.scrollToBottom();
        }
      });
    } catch (error) {
      logger.error('failed to load session snapshot', error);
    }
  }

  private async handleTerminalResize(event: Event) {
    const customEvent = event as CustomEvent;
    // Update terminal dimensions for display
    const { cols, rows } = customEvent.detail;
    this.terminalCols = cols;
    this.terminalRows = rows;
    this.requestUpdate();

    // Debounce resize requests to prevent jumpiness
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    this.resizeTimeout = window.setTimeout(async () => {
      // Only send resize request if dimensions actually changed
      if (cols === this.lastResizeWidth && rows === this.lastResizeHeight) {
        logger.debug(`skipping redundant resize request: ${cols}x${rows}`);
        return;
      }

      // Send resize request to backend if session is active
      if (this.session && this.session.status !== 'exited') {
        try {
          logger.debug(
            `sending resize request: ${cols}x${rows} (was ${this.lastResizeWidth}x${this.lastResizeHeight})`
          );

          const response = await fetch(`/api/sessions/${this.session.id}/resize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authClient.getAuthHeader(),
            },
            body: JSON.stringify({ cols: cols, rows: rows }),
          });

          if (response.ok) {
            // Cache the successfully sent dimensions
            this.lastResizeWidth = cols;
            this.lastResizeHeight = rows;
          } else {
            logger.warn(`failed to resize session: ${response.status}`);
          }
        } catch (error) {
          logger.warn('failed to send resize request', error);
        }
      }
    }, 250) as unknown as number; // 250ms debounce delay
  }

  private handleTerminalPaste(e: Event) {
    const customEvent = e as CustomEvent;
    const text = customEvent.detail?.text;
    if (text && this.session) {
      this.sendInputText(text);
    }
  }

  // Mobile input methods
  private handleMobileInputToggle() {
    // If direct keyboard is enabled, focus a hidden input instead of showing overlay
    if (this.useDirectKeyboard) {
      this.focusHiddenInput();
      return;
    }

    this.showMobileInput = !this.showMobileInput;
    if (this.showMobileInput) {
      // Focus the textarea after ensuring it's rendered and visible
      setTimeout(() => {
        const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
        if (textarea) {
          // Ensure textarea is visible and focusable
          textarea.style.visibility = 'visible';
          textarea.removeAttribute('readonly');
          textarea.focus();
          // Trigger click to ensure keyboard shows
          textarea.click();
          this.adjustTextareaForKeyboard();
        }
      }, 100);
    } else {
      // Clean up viewport listener when closing overlay
      const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
      if (textarea) {
        const textareaWithCleanup = textarea as HTMLTextAreaElement & {
          _viewportCleanup?: () => void;
        };
        if (textareaWithCleanup._viewportCleanup) {
          textareaWithCleanup._viewportCleanup();
        }
      }

      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    }
  }

  private adjustTextareaForKeyboard() {
    // Adjust the layout when virtual keyboard appears
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    const controls = this.querySelector('#mobile-controls') as HTMLElement;
    if (!textarea || !controls) return;

    const adjustLayout = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const windowHeight = window.innerHeight;
      const keyboardHeight = windowHeight - viewportHeight;

      // If keyboard is visible (viewport height is significantly smaller)
      if (keyboardHeight > 100) {
        // Move controls above the keyboard
        controls.style.transform = `translateY(-${keyboardHeight}px)`;
        controls.style.transition = 'transform 0.3s ease';

        // Calculate available space to match closed keyboard layout
        const header = this.querySelector(
          '.flex.items-center.justify-between.p-4.border-b'
        ) as HTMLElement;
        const headerHeight = header?.offsetHeight || 60;
        const controlsHeight = controls?.offsetHeight || 120;

        // Calculate exact space to maintain same gap as when keyboard is closed
        const availableHeight = viewportHeight - headerHeight - controlsHeight;
        const inputArea = textarea.parentElement as HTMLElement;

        if (inputArea && availableHeight > 0) {
          // Set the input area to exactly fill the space, maintaining natural flex behavior
          inputArea.style.height = `${availableHeight}px`;
          inputArea.style.maxHeight = `${availableHeight}px`;
          inputArea.style.overflow = 'hidden';
          inputArea.style.display = 'flex';
          inputArea.style.flexDirection = 'column';
          inputArea.style.paddingBottom = '0px'; // Remove any extra padding

          // Let textarea use flex-1 behavior but constrain the container
          textarea.style.height = 'auto'; // Let it grow naturally
          textarea.style.maxHeight = 'none'; // Remove height constraints
          textarea.style.marginBottom = '8px'; // Keep consistent margin
          textarea.style.flex = '1'; // Fill available space
        }
      } else {
        // Reset position when keyboard is hidden
        controls.style.transform = 'translateY(0px)';
        controls.style.transition = 'transform 0.3s ease';

        // Reset textarea height and constraints to original flex behavior
        const inputArea = textarea.parentElement as HTMLElement;
        if (inputArea) {
          inputArea.style.height = '';
          inputArea.style.maxHeight = '';
          inputArea.style.overflow = '';
          inputArea.style.display = '';
          inputArea.style.flexDirection = '';
          inputArea.style.paddingBottom = '';
          textarea.style.height = '';
          textarea.style.maxHeight = '';
          textarea.style.flex = '';
        }
      }
    };

    // Listen for viewport changes (keyboard show/hide)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', adjustLayout);
      // Clean up listener when overlay is closed
      const cleanup = () => {
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', adjustLayout);
        }
      };
      // Store cleanup function for later use
      (textarea as HTMLTextAreaElement & { _viewportCleanup?: () => void })._viewportCleanup =
        cleanup;
    }

    // Initial adjustment
    requestAnimationFrame(adjustLayout);
  }

  private handleMobileInputChange(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.mobileInputText = textarea.value;
    // Force update to ensure button states update
    this.requestUpdate();
  }

  private focusMobileTextarea() {
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    // Multiple attempts to ensure focus on mobile
    textarea.focus();

    // iOS hack to show keyboard
    textarea.setAttribute('readonly', 'readonly');
    textarea.focus();
    setTimeout(() => {
      textarea.removeAttribute('readonly');
      textarea.focus();
      // Ensure cursor is at end
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 100);
  }

  private async handleMobileInputSendOnly() {
    // Get the current value from the textarea directly
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.mobileInputText.trim();

    if (!textToSend) return;

    try {
      // Send text without enter key
      await this.sendInputText(textToSend);

      // Clear both the reactive property and textarea
      this.mobileInputText = '';
      if (textarea) {
        textarea.value = '';
      }

      // Trigger re-render to update button state
      this.requestUpdate();

      // Hide the input overlay after sending
      this.showMobileInput = false;

      // Refocus the hidden input to restore keyboard functionality
      if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
        setTimeout(() => {
          if (!this.disableFocusManagement && this.hiddenInput) {
            this.hiddenInput.focus();
          }
        }, 100);
      }

      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    } catch (error) {
      logger.error('error sending mobile input', error);
      // Don't hide the overlay if there was an error
    }
  }

  private async handleMobileInputSend() {
    // Get the current value from the textarea directly
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.mobileInputText.trim();

    if (!textToSend) return;

    try {
      // Add enter key at the end to execute the command
      await this.sendInputText(textToSend);
      await this.sendInputText('enter');

      // Clear both the reactive property and textarea
      this.mobileInputText = '';
      if (textarea) {
        textarea.value = '';
      }

      // Trigger re-render to update button state
      this.requestUpdate();

      // Hide the input overlay after sending
      this.showMobileInput = false;

      // Refocus the hidden input to restore keyboard functionality
      if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
        setTimeout(() => {
          if (!this.disableFocusManagement && this.hiddenInput) {
            this.hiddenInput.focus();
          }
        }, 100);
      }

      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    } catch (error) {
      logger.error('error sending mobile input', error);
      // Don't hide the overlay if there was an error
    }
  }

  private async handleSpecialKey(key: string) {
    await this.sendInputText(key);
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
    for (const letter of this.ctrlSequence) {
      const controlCode = String.fromCharCode(letter.charCodeAt(0) - 64);
      await this.sendInputText(controlCode);
    }
    // Clear sequence and close overlay
    this.ctrlSequence = [];
    this.showCtrlAlpha = false;
    this.requestUpdate();

    // Refocus the hidden input
    if (this.hiddenInput && this.showQuickKeys) {
      setTimeout(() => {
        if (this.hiddenInput) {
          this.hiddenInput.focus();
        }
      }, 100);
    }
  }

  private handleClearCtrlSequence() {
    this.ctrlSequence = [];
    this.requestUpdate();
  }

  private handleCtrlAlphaBackdrop(e: Event) {
    if (e.target === e.currentTarget) {
      this.showCtrlAlpha = false;
      this.ctrlSequence = [];
      this.requestUpdate();

      // Refocus the hidden input
      if (this.hiddenInput && this.showQuickKeys) {
        setTimeout(() => {
          if (this.hiddenInput) {
            this.hiddenInput.focus();
          }
        }, 100);
      }
    }
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

    // Update the terminal component
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    if (terminal) {
      terminal.maxCols = newMaxCols;
      // Trigger a resize to apply the new constraint
      terminal.requestUpdate();
    }
  }

  private handleCustomWidthInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.customWidth = input.value;
  }

  private handleCustomWidthSubmit() {
    const width = Number.parseInt(this.customWidth, 10);
    if (!Number.isNaN(width) && width >= 20 && width <= 500) {
      this.handleWidthSelect(width);
      this.customWidth = '';
    }
  }

  private handleCustomWidthKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.handleCustomWidthSubmit();
    } else if (e.key === 'Escape') {
      this.customWidth = '';
      this.showWidthSelector = false;
    }
  }

  private getCurrentWidthLabel(): string {
    if (this.terminalMaxCols === 0) return '∞';
    const commonWidth = COMMON_TERMINAL_WIDTHS.find((w) => w.value === this.terminalMaxCols);
    return commonWidth ? commonWidth.label : this.terminalMaxCols.toString();
  }

  private handleFontSizeChange(newSize: number) {
    // Clamp to reasonable bounds
    const clampedSize = Math.max(8, Math.min(32, newSize));
    this.terminalFontSize = clampedSize;
    this.preferencesManager.setFontSize(clampedSize);

    // Update the terminal component
    const terminal = this.querySelector('vibe-terminal') as Terminal;
    if (terminal) {
      terminal.fontSize = clampedSize;
      terminal.requestUpdate();
    }
  }

  private handleOpenFileBrowser() {
    this.showFileBrowser = true;
  }

  private handleCloseFileBrowser() {
    this.showFileBrowser = false;
  }

  private async handleInsertPath(event: CustomEvent) {
    const { path, type } = event.detail;
    if (!path || !this.session) return;

    // Escape the path for shell use (wrap in quotes if it contains spaces)
    const escapedPath = path.includes(' ') ? `"${path}"` : path;

    // Send the path to the terminal
    await this.sendInputText(escapedPath);

    logger.log(`inserted ${type} path into terminal: ${escapedPath}`);
  }

  private async sendInputText(text: string) {
    if (!this.session) return;

    try {
      // Determine if we should send as key or text
      const body = [
        'enter',
        'escape',
        'backspace',
        'tab',
        'arrow_up',
        'arrow_down',
        'arrow_left',
        'arrow_right',
        'ctrl_enter',
        'shift_enter',
        'page_up',
        'page_down',
        'home',
        'end',
        'delete',
        'f1',
        'f2',
        'f3',
        'f4',
        'f5',
        'f6',
        'f7',
        'f8',
        'f9',
        'f10',
        'f11',
        'f12',
      ].includes(text)
        ? { key: text }
        : { text };

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.error('failed to send input to session', { status: response.status });
      }
    } catch (error) {
      logger.error('error sending input', error);
    }
  }

  private async resetTerminalSize() {
    if (!this.session) {
      logger.warn('resetTerminalSize called but no session available');
      return;
    }

    logger.log('Sending reset-size request for session', this.session.id);

    try {
      const response = await fetch(`/api/sessions/${this.session.id}/reset-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
      });

      if (!response.ok) {
        logger.error('failed to reset terminal size', {
          status: response.status,
          sessionId: this.session.id,
        });
      } else {
        logger.log('terminal size reset successfully for session', this.session.id);
      }
    } catch (error) {
      logger.error('error resetting terminal size', {
        error,
        sessionId: this.session.id,
      });
    }
  }

  private focusHiddenInput() {
    // Just delegate to the new method
    this.ensureHiddenInputVisible();
  }

  private handleTerminalClick(e: Event) {
    // This method is now handled by the terminal component's smart gesture detection
  }

  openMobileKeyboard() {
    if (!this.isMobile || !this.useDirectKeyboard) return;

    // Show quick keys
    this.showQuickKeys = true;

    // Create a temporary visible input specifically for iOS keyboard opening
    this.createTemporaryInput();
  }

  openMobileKeyboardDirect(touchEvent: TouchEvent) {
    if (!this.isMobile || !this.useDirectKeyboard) return;

    // Show quick keys
    this.showQuickKeys = true;

    // Create and focus input within the same user interaction context
    this.createTemporaryInputDirect(touchEvent);
  }

  private createTemporaryInput() {
    // Remove any existing temporary input
    const existingTemp = document.getElementById('temp-ios-input');
    if (existingTemp) {
      existingTemp.remove();
    }

    // Create a temporary input that's clearly visible for iOS
    const tempInput = document.createElement('input');
    tempInput.id = 'temp-ios-input';
    tempInput.type = 'text';
    tempInput.autocapitalize = 'off';
    tempInput.autocomplete = 'off';
    tempInput.setAttribute('autocorrect', 'off');
    tempInput.setAttribute('spellcheck', 'false');

    // Style it to be offscreen but still focusable
    tempInput.style.position = 'fixed';
    tempInput.style.top = '-1000px'; // Moved offscreen
    tempInput.style.left = '-1000px';
    tempInput.style.width = '1px';
    tempInput.style.height = '1px';
    tempInput.style.fontSize = '16px'; // Prevent zoom
    tempInput.style.padding = '0';
    tempInput.style.border = 'none';
    tempInput.style.background = 'transparent';
    tempInput.style.color = 'transparent';
    tempInput.style.zIndex = '10000';
    tempInput.style.opacity = '0';
    tempInput.placeholder = '';

    // Add input handling
    tempInput.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.value) {
        // Send input to terminal
        this.sendInputText(input.value);
        input.value = ''; // Clear immediately
      }
    });

    tempInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendInputText('enter');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.sendInputText('backspace');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.sendInputText('tab');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hideTempInput();
      }
    });

    // Hide when losing focus
    tempInput.addEventListener('blur', () => {
      setTimeout(() => {
        this.hideTempInput();
      }, 100);
    });

    // Add to body and focus
    document.body.appendChild(tempInput);

    // Focus with multiple attempts for iOS
    setTimeout(() => {
      tempInput.focus();
      tempInput.click();
    }, 50);

    // Store reference for cleanup
    this.tempInput = tempInput;
  }

  private createTemporaryInputDirect(touchEvent: TouchEvent) {
    // Remove any existing temporary input
    const existingTemp = document.getElementById('temp-ios-input');
    if (existingTemp) {
      existingTemp.remove();
    }

    // Create a temporary input that's clearly visible for iOS
    const tempInput = document.createElement('input');
    tempInput.id = 'temp-ios-input';
    tempInput.type = 'text';
    tempInput.autocapitalize = 'off';
    tempInput.autocomplete = 'off';
    tempInput.setAttribute('autocorrect', 'off');
    tempInput.setAttribute('spellcheck', 'false');

    // Style it to be offscreen but still focusable
    tempInput.style.position = 'fixed';
    tempInput.style.top = '-1000px'; // Moved offscreen
    tempInput.style.left = '-1000px';
    tempInput.style.width = '1px';
    tempInput.style.height = '1px';
    tempInput.style.fontSize = '16px'; // Prevent zoom
    tempInput.style.padding = '0';
    tempInput.style.border = 'none';
    tempInput.style.background = 'transparent';
    tempInput.style.color = 'transparent';
    tempInput.style.zIndex = '10000';
    tempInput.style.opacity = '0';
    tempInput.placeholder = '';

    // Add input handling
    tempInput.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.value) {
        // Send input to terminal
        this.sendInputText(input.value);
        input.value = ''; // Clear immediately
      }
    });

    tempInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendInputText('enter');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.sendInputText('backspace');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.sendInputText('tab');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hideTempInput();
      }
    });

    // Hide when losing focus
    tempInput.addEventListener('blur', () => {
      setTimeout(() => {
        this.hideTempInput();
      }, 100);
    });

    // Add to body immediately
    document.body.appendChild(tempInput);

    // Focus immediately within the touch event context - this is crucial for iOS
    tempInput.focus();

    // Store reference for cleanup
    this.tempInput = tempInput;
  }

  private hideTempInput() {
    if (this.tempInput) {
      this.tempInput.remove();
      this.tempInput = null;
    }

    // Create the hidden input for ongoing keyboard functionality
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }
  }

  private ensureHiddenInputVisible() {
    // Redirect to new method
    this.openMobileKeyboard();
  }

  private createHiddenInput() {
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.style.position = 'fixed';
    this.hiddenInput.style.bottom = '0';
    this.hiddenInput.style.left = '0';
    this.hiddenInput.style.width = '1px';
    this.hiddenInput.style.height = '1px';
    this.hiddenInput.style.opacity = '0';
    this.hiddenInput.style.fontSize = '16px'; // Prevent zoom on iOS
    this.hiddenInput.style.zIndex = '9999'; // Above everything to be focusable
    this.hiddenInput.style.border = 'none';
    this.hiddenInput.style.outline = 'none';
    this.hiddenInput.style.background = 'transparent';
    this.hiddenInput.style.color = 'transparent';
    this.hiddenInput.style.caretColor = 'transparent';
    this.hiddenInput.style.cursor = 'default';
    this.hiddenInput.style.pointerEvents = 'none'; // Don't intercept touches
    this.hiddenInput.autocapitalize = 'off';
    this.hiddenInput.autocomplete = 'off';
    this.hiddenInput.setAttribute('autocorrect', 'off');
    this.hiddenInput.setAttribute('spellcheck', 'false');
    this.hiddenInput.setAttribute('inputmode', 'none'); // Helps with iOS keyboard

    // Make it visible for debugging (comment out in production)
    // this.hiddenInput.style.opacity = '0.1';
    // this.hiddenInput.style.background = 'rgba(255,0,0,0.1)';

    // Prevent click events from propagating to terminal
    this.hiddenInput.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    // Handle touchstart but allow scrolling in the main terminal area
    this.hiddenInput.addEventListener('touchstart', (e) => {
      // Only stop propagation for taps in our tappable area (bottom 80px)
      // This allows scrolling to work in the rest of the terminal
      e.stopPropagation();
    });

    // Handle input events
    this.hiddenInput.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.value) {
        // Don't send input to terminal if mobile input overlay or Ctrl overlay is visible
        if (!this.showMobileInput && !this.showCtrlAlpha) {
          // Send each character to terminal
          this.sendInputText(input.value);
        }
        // Always clear the input to prevent buffer buildup
        input.value = '';
      }
    });

    // Handle special keys
    this.hiddenInput.addEventListener('keydown', (e) => {
      // Don't process special keys if mobile input overlay or Ctrl overlay is visible
      if (this.showMobileInput || this.showCtrlAlpha) {
        return;
      }

      // Prevent default for all keys to stop browser shortcuts
      if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === 'Enter') {
        this.sendInputText('enter');
      } else if (e.key === 'Backspace') {
        // Always send backspace to terminal
        this.sendInputText('backspace');
      } else if (e.key === 'Tab') {
        this.sendInputText('tab');
      } else if (e.key === 'Escape') {
        this.sendInputText('escape');
      }
    });

    // Handle focus/blur for quick keys visibility
    this.hiddenInput.addEventListener('focus', () => {
      this.showQuickKeys = true;
      logger.log('Hidden input focused, showing quick keys');

      // Trigger initial keyboard height calculation
      if (this.visualViewportHandler) {
        this.visualViewportHandler();
      }

      // Start focus retention
      if (this.focusRetentionInterval) {
        clearInterval(this.focusRetentionInterval);
      }

      this.focusRetentionInterval = setInterval(() => {
        if (
          !this.disableFocusManagement &&
          this.showQuickKeys &&
          this.hiddenInput &&
          document.activeElement !== this.hiddenInput &&
          !this.showMobileInput &&
          !this.showCtrlAlpha
        ) {
          logger.log('Refocusing hidden input to maintain keyboard');
          this.hiddenInput.focus();
        }
      }, 300) as unknown as number;
    });

    this.hiddenInput.addEventListener('blur', (e) => {
      const event = e as FocusEvent;

      // Immediately try to recapture focus
      if (!this.disableFocusManagement && this.showQuickKeys && this.hiddenInput) {
        // Use a very short timeout to allow any legitimate focus changes to complete
        setTimeout(() => {
          if (
            !this.disableFocusManagement &&
            this.showQuickKeys &&
            this.hiddenInput &&
            document.activeElement !== this.hiddenInput
          ) {
            // Check if focus went to a quick key or somewhere else in our component
            const activeElement = document.activeElement;
            const isWithinComponent = this.contains(activeElement);

            if (isWithinComponent || !activeElement || activeElement === document.body) {
              // Focus was lost to nowhere specific or within our component - recapture it
              logger.log('Recapturing focus on hidden input');
              this.hiddenInput.focus();
            } else {
              // Focus went somewhere legitimate outside our component
              // Wait a bit longer before hiding quick keys
              setTimeout(() => {
                if (document.activeElement !== this.hiddenInput) {
                  this.showQuickKeys = false;
                  logger.log('Hidden input blurred, hiding quick keys');

                  // Clear focus retention interval
                  if (this.focusRetentionInterval) {
                    clearInterval(this.focusRetentionInterval);
                    this.focusRetentionInterval = null;
                  }
                }
              }, 500);
            }
          }
        }, 10);
      }
    });

    // Add to the terminal container to overlay it
    const terminalContainer = this.querySelector('#terminal-container');
    if (terminalContainer) {
      terminalContainer.appendChild(this.hiddenInput);
    }
  }

  private handleQuickKeyPress = (key: string, isModifier?: boolean, isSpecial?: boolean) => {
    if (isSpecial && key === 'ABC') {
      // Toggle the mobile input overlay
      this.showMobileInput = !this.showMobileInput;

      if (this.showMobileInput) {
        // Stop focus retention when showing mobile input
        if (this.focusRetentionInterval) {
          clearInterval(this.focusRetentionInterval);
          this.focusRetentionInterval = null;
        }

        // Blur the hidden input to prevent it from capturing input
        if (this.hiddenInput) {
          this.hiddenInput.blur();
        }

        // Force update to render the textarea
        this.requestUpdate();

        // Focus the textarea after render completes
        this.updateComplete.then(() => {
          setTimeout(() => {
            this.focusMobileTextarea();
          }, 100);
        });
      } else {
        // Clear the text when closing
        this.mobileInputText = '';

        // Restart focus retention when closing mobile input
        if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
          // Restart focus retention
          this.focusRetentionInterval = setInterval(() => {
            if (
              !this.disableFocusManagement &&
              this.showQuickKeys &&
              this.hiddenInput &&
              document.activeElement !== this.hiddenInput &&
              !this.showMobileInput &&
              !this.showCtrlAlpha
            ) {
              logger.log('Refocusing hidden input to maintain keyboard');
              this.hiddenInput.focus();
            }
          }, 300) as unknown as number;

          setTimeout(() => {
            if (!this.disableFocusManagement && this.hiddenInput) {
              this.hiddenInput.focus();
            }
          }, 100);
        }
      }
      return;
    } else if (isModifier && key === 'Control') {
      // Just send Ctrl modifier - don't show the overlay
      // This allows using Ctrl as a modifier with physical keyboard
      return;
    } else if (key === 'CtrlFull') {
      // Toggle the full Ctrl+Alpha overlay
      this.showCtrlAlpha = !this.showCtrlAlpha;

      if (this.showCtrlAlpha) {
        // Stop focus retention when showing Ctrl overlay
        if (this.focusRetentionInterval) {
          clearInterval(this.focusRetentionInterval);
          this.focusRetentionInterval = null;
        }

        // Blur the hidden input to prevent it from capturing input
        if (this.hiddenInput) {
          this.hiddenInput.blur();
        }
      } else {
        // Clear the Ctrl sequence when closing
        this.ctrlSequence = [];

        // Restart focus retention when closing Ctrl overlay
        if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
          // Restart focus retention
          this.focusRetentionInterval = setInterval(() => {
            if (
              !this.disableFocusManagement &&
              this.showQuickKeys &&
              this.hiddenInput &&
              document.activeElement !== this.hiddenInput &&
              !this.showMobileInput &&
              !this.showCtrlAlpha
            ) {
              logger.log('Refocusing hidden input to maintain keyboard');
              this.hiddenInput.focus();
            }
          }, 300) as unknown as number;

          setTimeout(() => {
            if (!this.disableFocusManagement && this.hiddenInput) {
              this.hiddenInput.focus();
            }
          }, 100);
        }
      }
      return;
    } else if (key === 'Ctrl+A') {
      // Send Ctrl+A (start of line)
      this.sendInputText('\x01');
    } else if (key === 'Ctrl+C') {
      // Send Ctrl+C (interrupt signal)
      this.sendInputText('\x03');
    } else if (key === 'Ctrl+D') {
      // Send Ctrl+D (EOF)
      this.sendInputText('\x04');
    } else if (key === 'Ctrl+E') {
      // Send Ctrl+E (end of line)
      this.sendInputText('\x05');
    } else if (key === 'Ctrl+K') {
      // Send Ctrl+K (kill to end of line)
      this.sendInputText('\x0b');
    } else if (key === 'Ctrl+L') {
      // Send Ctrl+L (clear screen)
      this.sendInputText('\x0c');
    } else if (key === 'Ctrl+R') {
      // Send Ctrl+R (reverse search)
      this.sendInputText('\x12');
    } else if (key === 'Ctrl+U') {
      // Send Ctrl+U (clear line)
      this.sendInputText('\x15');
    } else if (key === 'Ctrl+W') {
      // Send Ctrl+W (delete word)
      this.sendInputText('\x17');
    } else if (key === 'Ctrl+Z') {
      // Send Ctrl+Z (suspend signal)
      this.sendInputText('\x1a');
    } else if (key === 'Option') {
      // Send ESC prefix for Option/Alt key
      this.sendInputText('\x1b');
    } else if (key === 'Command') {
      // Command key doesn't have a direct terminal equivalent
      // Could potentially show a message or ignore
      return;
    } else if (key === 'Delete') {
      // Send delete key
      this.sendInputText('delete');
    } else if (key.startsWith('F')) {
      // Handle function keys F1-F12
      const fNum = Number.parseInt(key.substring(1));
      if (fNum >= 1 && fNum <= 12) {
        this.sendInputText(`f${fNum}`);
      }
    } else {
      // Map key names to proper values
      let keyToSend = key;
      if (key === 'Tab') {
        keyToSend = 'tab';
      } else if (key === 'Escape') {
        keyToSend = 'escape';
      } else if (key === 'ArrowUp') {
        keyToSend = 'arrow_up';
      } else if (key === 'ArrowDown') {
        keyToSend = 'arrow_down';
      } else if (key === 'ArrowLeft') {
        keyToSend = 'arrow_left';
      } else if (key === 'ArrowRight') {
        keyToSend = 'arrow_right';
      } else if (key === 'PageUp') {
        keyToSend = 'page_up';
      } else if (key === 'PageDown') {
        keyToSend = 'page_down';
      } else if (key === 'Home') {
        keyToSend = 'home';
      } else if (key === 'End') {
        keyToSend = 'end';
      }

      // Send the key to terminal
      this.sendInputText(keyToSend.toLowerCase());
    }

    // Always keep focus on hidden input after any key press (except Done)
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
        this.hiddenInput.focus();
      }
    });
  };

  private refreshTerminalAfterMobileInput() {
    // After closing mobile input, the viewport changes and the terminal
    // needs to recalculate its scroll position to avoid getting stuck
    if (!this.terminal) return;

    // Give the viewport time to settle after keyboard disappears
    setTimeout(() => {
      if (this.terminal) {
        // Force the terminal to recalculate its viewport dimensions and scroll boundaries
        // This fixes the issue where maxScrollPixels becomes incorrect after keyboard changes
        const terminalElement = this.terminal as unknown as { fitTerminal?: () => void };
        if (typeof terminalElement.fitTerminal === 'function') {
          terminalElement.fitTerminal();
        }

        // Then scroll to bottom to fix the position
        this.terminal.scrollToBottom();
      }
    }, 300); // Wait for viewport to settle
  }

  private startLoading() {
    this.loading = true;
    this.loadingFrame = 0;
    this.loadingInterval = window.setInterval(() => {
      this.loadingFrame = (this.loadingFrame + 1) % 4;
      this.requestUpdate();
    }, 200) as unknown as number; // Update every 200ms for smooth animation
  }

  private stopLoading() {
    this.loading = false;
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
  }

  private getLoadingText(): string {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[this.loadingFrame % frames.length];
  }

  private getStatusText(): string {
    if (!this.session) return '';
    if ('active' in this.session && this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (!this.session) return 'text-dark-text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'text-dark-text-muted';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getStatusDotColor(): string {
    if (!this.session) return 'bg-dark-text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'bg-dark-text-muted';
    }
    return this.session.status === 'running' ? 'bg-status-success' : 'bg-status-warning';
  }

  render() {
    if (!this.session) {
      return html`
        <div class="fixed inset-0 bg-dark-bg flex items-center justify-center">
          <div class="text-dark-text font-mono text-center">
            <div class="text-2xl mb-2">${this.getLoadingText()}</div>
            <div class="text-sm text-dark-text-muted">Waiting for session...</div>
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
          outline: 2px solid #00ff88 !important;
          outline-offset: -2px;
        }
      </style>
      <div
        class="flex flex-col bg-black font-mono relative"
        style="height: 100vh; height: 100dvh; outline: none !important; box-shadow: none !important;"
      >
        <!-- Compact Header -->
        <div
          class="flex items-center justify-between px-3 py-2 border-b border-dark-border text-sm min-w-0 bg-dark-bg-secondary"
          style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(0.75rem, env(safe-area-inset-left)); padding-right: max(0.75rem, env(safe-area-inset-right));"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- Mobile Hamburger Menu Button (only on phones, only when session is shown) -->
            ${
              this.showSidebarToggle && this.sidebarCollapsed
                ? html`
                  <button
                    class="sm:hidden bg-dark-bg-tertiary border border-dark-border rounded-lg p-1 font-mono text-accent-green transition-all duration-300 hover:bg-dark-bg hover:border-accent-green flex-shrink-0"
                    @click=${this.handleSidebarToggle}
                    title="Show sessions"
                  >
                    <!-- Hamburger menu icon -->
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <line x1="3" y1="12" x2="21" y2="12"></line>
                      <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                  </button>
                `
                : ''
            }
            ${
              this.showBackButton
                ? html`
                  <button
                    class="btn-secondary font-mono text-xs px-3 py-1 flex-shrink-0"
                    @click=${this.handleBack}
                  >
                    Back
                  </button>
                `
                : ''
            }
            <div class="text-dark-text min-w-0 flex-1 overflow-hidden max-w-[50vw] sm:max-w-none">
              <div
                class="text-accent-green text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
                title="${
                  this.session.name ||
                  (Array.isArray(this.session.command)
                    ? this.session.command.join(' ')
                    : this.session.command)
                }"
              >
                ${
                  this.session.name ||
                  (Array.isArray(this.session.command)
                    ? this.session.command.join(' ')
                    : this.session.command)
                }
              </div>
              <div class="text-xs opacity-75 mt-0.5">
                <clickable-path .path=${this.session.workingDir} .iconSize=${12}></clickable-path>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-xs flex-shrink-0 ml-2 relative">
            <button
              class="btn-secondary font-mono text-xs p-1 flex-shrink-0"
              @click=${this.handleOpenFileBrowser}
              title="Browse Files (⌘O)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path
                  d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
                />
              </svg>
            </button>
            <button
              class="btn-secondary font-mono text-xs px-2 py-1 flex-shrink-0 width-selector-button"
              @click=${this.handleMaxWidthToggle}
              title="Terminal width: ${
                this.terminalMaxCols === 0 ? 'Unlimited' : `${this.terminalMaxCols} columns`
              }"
            >
              ${this.getCurrentWidthLabel()}
            </button>
            ${
              this.showWidthSelector
                ? html`
                  <div
                    class="width-selector-container absolute top-8 right-0 bg-dark-bg-secondary border border-dark-border rounded-md shadow-lg z-50 min-w-48"
                  >
                    <div class="p-2">
                      <div class="text-xs text-dark-text-muted mb-2 px-2">Terminal Width</div>
                      ${COMMON_TERMINAL_WIDTHS.map(
                        (width) => html`
                          <button
                            class="w-full text-left px-2 py-1 text-xs hover:bg-dark-border rounded-sm flex justify-between items-center
                              ${
                                this.terminalMaxCols === width.value
                                  ? 'bg-dark-border text-accent-green'
                                  : 'text-dark-text'
                              }"
                            @click=${() => this.handleWidthSelect(width.value)}
                          >
                            <span class="font-mono">${width.label}</span>
                            <span class="text-dark-text-muted text-xs">${width.description}</span>
                          </button>
                        `
                      )}
                      <div class="border-t border-dark-border mt-2 pt-2">
                        <div class="text-xs text-dark-text-muted mb-1 px-2">Custom (20-500)</div>
                        <div class="flex gap-1">
                          <input
                            type="number"
                            min="20"
                            max="500"
                            placeholder="80"
                            .value=${this.customWidth}
                            @input=${this.handleCustomWidthInput}
                            @keydown=${this.handleCustomWidthKeydown}
                            @click=${(e: Event) => e.stopPropagation()}
                            class="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono text-dark-text"
                          />
                          <button
                            class="btn-secondary text-xs px-2 py-1"
                            @click=${this.handleCustomWidthSubmit}
                            ?disabled=${
                              !this.customWidth ||
                              Number.parseInt(this.customWidth) < 20 ||
                              Number.parseInt(this.customWidth) > 500
                            }
                          >
                            Set
                          </button>
                        </div>
                      </div>
                      <div class="border-t border-dark-border mt-2 pt-2">
                        <div class="text-xs text-dark-text-muted mb-2 px-2">Font Size</div>
                        <div class="flex items-center gap-2 px-2">
                          <button
                            class="btn-secondary text-xs px-2 py-1"
                            @click=${() => this.handleFontSizeChange(this.terminalFontSize - 1)}
                            ?disabled=${this.terminalFontSize <= 8}
                          >
                            −
                          </button>
                          <span class="font-mono text-xs text-dark-text min-w-8 text-center">
                            ${this.terminalFontSize}px
                          </span>
                          <button
                            class="btn-secondary text-xs px-2 py-1"
                            @click=${() => this.handleFontSizeChange(this.terminalFontSize + 1)}
                            ?disabled=${this.terminalFontSize >= 32}
                          >
                            +
                          </button>
                          <button
                            class="btn-ghost text-xs px-2 py-1 ml-auto"
                            @click=${() => this.handleFontSizeChange(14)}
                            ?disabled=${this.terminalFontSize === 14}
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                `
                : ''
            }
            <div class="flex flex-col items-end gap-0">
              <span class="${this.getStatusColor()} text-xs flex items-center gap-1">
                <div class="w-2 h-2 rounded-full ${this.getStatusDotColor()}"></div>
                ${this.getStatusText().toUpperCase()}
              </span>
              ${
                this.terminalCols > 0 && this.terminalRows > 0
                  ? html`
                    <span
                      class="text-dark-text-muted text-xs opacity-60"
                      style="font-size: 10px; line-height: 1;"
                    >
                      ${this.terminalCols}×${this.terminalRows}
                    </span>
                  `
                  : ''
              }
            </div>
          </div>
        </div>

        <!-- Terminal Container -->
        <div
          class="flex-1 bg-black overflow-hidden min-h-0 relative ${
            this.session?.status === 'exited' ? 'session-exited' : ''
          }"
          id="terminal-container"
        >
          ${
            this.loading
              ? html`
                <!-- Loading overlay -->
                <div
                  class="absolute inset-0 bg-dark-bg bg-opacity-80 flex items-center justify-center z-10"
                >
                  <div class="text-dark-text font-mono text-center">
                    <div class="text-2xl mb-2">${this.getLoadingText()}</div>
                    <div class="text-sm text-dark-text-muted">Connecting to session...</div>
                  </div>
                </div>
              `
              : ''
          }
          <!-- Terminal Component -->
          <vibe-terminal
            .sessionId=${this.session?.id || ''}
            .sessionStatus=${this.session?.status || 'running'}
            .cols=${80}
            .rows=${24}
            .fontSize=${this.terminalFontSize}
            .fitHorizontally=${false}
            .maxCols=${this.terminalMaxCols}
            .disableClick=${false}
            class="w-full h-full p-0 m-0"
            @click=${this.handleTerminalClick}
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
                  class="bg-dark-bg-secondary border border-dark-border ${this.getStatusColor()} font-medium text-sm tracking-wide px-4 py-2 rounded-lg shadow-lg"
                >
                  SESSION EXITED
                </div>
              </div>
            `
            : ''
        }

        <!-- Mobile Input Controls (only show when direct keyboard is disabled) -->
        ${
          this.isMobile && !this.showMobileInput && !this.useDirectKeyboard
            ? html`
              <div class="flex-shrink-0 p-4" style="background: black;">
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

        <!-- Full-Screen Input Overlay (only when opened) -->
        ${
          this.isMobile && this.showMobileInput
            ? html`
              <div
                class="fixed inset-0 z-40 flex flex-col"
                style="background: rgba(0, 0, 0, 0.8);"
                @click=${(e: Event) => {
                  if (e.target === e.currentTarget) {
                    this.showMobileInput = false;
                    // Refocus the hidden input
                    if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
                      setTimeout(() => {
                        if (!this.disableFocusManagement && this.hiddenInput) {
                          this.hiddenInput.focus();
                        }
                      }, 100);
                    }
                  }
                }}
                @touchstart=${this.touchStartHandler}
                @touchend=${this.touchEndHandler}
              >
                <!-- Spacer to push content up above keyboard -->
                <div class="flex-1"></div>

                <div
                  class="mobile-input-container font-mono text-sm mx-4 flex flex-col"
                  style="background: black; border: 1px solid #569cd6; border-radius: 8px; margin-bottom: ${this.keyboardHeight > 0 ? `${this.keyboardHeight + 180}px` : 'calc(env(keyboard-inset-height, 0px) + 180px)'};/* 180px = estimated quick keyboard height (3 rows) */"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    // Focus textarea when clicking anywhere in the container
                    this.focusMobileTextarea();
                  }}
                >
                  <!-- Input Area -->
                  <div class="p-4 flex flex-col">
                    <textarea
                      id="mobile-input-textarea"
                      class="w-full font-mono text-sm resize-none outline-none"
                      placeholder="Type your command here..."
                      .value=${this.mobileInputText}
                      @input=${this.handleMobileInputChange}
                      @focus=${(e: FocusEvent) => {
                        e.stopPropagation();
                        logger.log('Mobile input textarea focused');
                      }}
                      @blur=${(e: FocusEvent) => {
                        e.stopPropagation();
                        logger.log('Mobile input textarea blurred');
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          this.handleMobileInputSend();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          this.showMobileInput = false;
                          // Clear the text
                          this.mobileInputText = '';
                          // Restart focus retention
                          if (
                            !this.disableFocusManagement &&
                            this.hiddenInput &&
                            this.showQuickKeys
                          ) {
                            this.focusRetentionInterval = setInterval(() => {
                              if (
                                !this.disableFocusManagement &&
                                this.showQuickKeys &&
                                this.hiddenInput &&
                                document.activeElement !== this.hiddenInput &&
                                !this.showMobileInput &&
                                !this.showCtrlAlpha
                              ) {
                                logger.log('Refocusing hidden input to maintain keyboard');
                                this.hiddenInput.focus();
                              }
                            }, 300) as unknown as number;

                            setTimeout(() => {
                              if (!this.disableFocusManagement && this.hiddenInput) {
                                this.hiddenInput.focus();
                              }
                            }, 100);
                          }
                        }
                      }}
                      style="height: 120px; background: black; color: #d4d4d4; border: none; padding: 12px;"
                      autocomplete="off"
                      autocorrect="off"
                      autocapitalize="off"
                      spellcheck="false"
                    ></textarea>
                  </div>

                  <!-- Controls -->
                  <div class="p-4 flex gap-2" style="border-top: 1px solid #444;">
                    <button
                      class="font-mono px-3 py-2 text-xs transition-colors btn-ghost"
                      @click=${() => {
                        this.showMobileInput = false;
                        // Clear the text
                        this.mobileInputText = '';
                        // Restart focus retention
                        if (
                          !this.disableFocusManagement &&
                          this.hiddenInput &&
                          this.showQuickKeys
                        ) {
                          this.focusRetentionInterval = setInterval(() => {
                            if (
                              !this.disableFocusManagement &&
                              this.showQuickKeys &&
                              this.hiddenInput &&
                              document.activeElement !== this.hiddenInput &&
                              !this.showMobileInput &&
                              !this.showCtrlAlpha
                            ) {
                              logger.log('Refocusing hidden input to maintain keyboard');
                              this.hiddenInput.focus();
                            }
                          }, 300) as unknown as number;

                          setTimeout(() => {
                            if (!this.disableFocusManagement && this.hiddenInput) {
                              this.hiddenInput.focus();
                            }
                          }, 100);
                        }
                      }}
                    >
                      CANCEL
                    </button>
                    <button
                      class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-ghost"
                      @click=${this.handleMobileInputSendOnly}
                      ?disabled=${!this.mobileInputText.trim()}
                    >
                      SEND
                    </button>
                    <button
                      class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-secondary"
                      @click=${this.handleMobileInputSend}
                      ?disabled=${!this.mobileInputText.trim()}
                    >
                      SEND + ⏎
                    </button>
                  </div>
                </div>
              </div>
            `
            : ''
        }

        <!-- Ctrl+Alpha Overlay -->
        ${
          this.isMobile && this.showCtrlAlpha
            ? html`
              <div
                class="fixed inset-0 z-50 flex flex-col"
                style="background: rgba(0, 0, 0, 0.8);"
                @click=${this.handleCtrlAlphaBackdrop}
              >
                <!-- Spacer to push content up above keyboard -->
                <div class="flex-1"></div>
                
                <div
                  class="font-mono text-sm mx-4 max-w-sm w-full self-center"
                  style="background: black; border: 1px solid #569cd6; border-radius: 8px; padding: 10px; margin-bottom: ${this.keyboardHeight > 0 ? `${this.keyboardHeight + 180}px` : 'calc(env(keyboard-inset-height, 0px) + 180px)'};/* 180px = estimated quick keyboard height (3 rows) */"
                  @click=${(e: Event) => e.stopPropagation()}
                >
                  <div class="text-vs-user text-center mb-2 font-bold">Ctrl + Key</div>

                  <!-- Help text -->
                  <div class="text-xs text-vs-muted text-center mb-3 opacity-70">
                    Build sequences like ctrl+c ctrl+c
                  </div>

                  <!-- Current sequence display -->
                  ${
                    this.ctrlSequence.length > 0
                      ? html`
                        <div class="text-center mb-4 p-2 border border-vs-muted rounded bg-vs-bg">
                          <div class="text-xs text-vs-muted mb-1">Current sequence:</div>
                          <div class="text-sm text-vs-accent font-bold">
                            ${this.ctrlSequence.map((letter) => `Ctrl+${letter}`).join(' ')}
                          </div>
                        </div>
                      `
                      : ''
                  }

                  <!-- Grid of A-Z buttons -->
                  <div class="grid grid-cols-6 gap-1 mb-3">
                    ${[
                      'A',
                      'B',
                      'C',
                      'D',
                      'E',
                      'F',
                      'G',
                      'H',
                      'I',
                      'J',
                      'K',
                      'L',
                      'M',
                      'N',
                      'O',
                      'P',
                      'Q',
                      'R',
                      'S',
                      'T',
                      'U',
                      'V',
                      'W',
                      'X',
                      'Y',
                      'Z',
                    ].map(
                      (letter) => html`
                        <button
                          class="font-mono text-xs transition-all cursor-pointer aspect-square flex items-center justify-center quick-start-btn py-2"
                          @click=${() => this.handleCtrlKey(letter)}
                        >
                          ${letter}
                        </button>
                      `
                    )}
                  </div>

                  <!-- Common shortcuts info -->
                  <div class="text-xs text-vs-muted text-center mb-3">
                    <div>Common: C=interrupt, X=exit, O=save, W=search</div>
                  </div>

                  <!-- Action buttons -->
                  <div class="flex gap-2 justify-center">
                    <button
                      class="font-mono px-4 py-2 text-sm transition-all cursor-pointer btn-ghost"
                      @click=${() => {
                        this.showCtrlAlpha = false;
                      }}
                    >
                      CANCEL
                    </button>
                    ${
                      this.ctrlSequence.length > 0
                        ? html`
                          <button
                            class="font-mono px-3 py-2 text-sm transition-all cursor-pointer btn-ghost"
                            @click=${this.handleClearCtrlSequence}
                          >
                            CLEAR
                          </button>
                          <button
                            class="font-mono px-3 py-2 text-sm transition-all cursor-pointer btn-secondary"
                            @click=${this.handleSendCtrlSequence}
                          >
                            SEND
                          </button>
                        `
                        : ''
                    }
                  </div>
                </div>
              </div>
            `
            : ''
        }

        <!-- Terminal Quick Keys (for direct keyboard mode) -->
        <terminal-quick-keys
          .visible=${this.isMobile && this.useDirectKeyboard && this.showQuickKeys}
          .onKeyPress=${this.handleQuickKeyPress}
        ></terminal-quick-keys>

        <!-- File Browser Modal -->
        <file-browser
          .visible=${this.showFileBrowser}
          .mode=${'browse'}
          .session=${this.session}
          @browser-cancel=${this.handleCloseFileBrowser}
          @insert-path=${this.handleInsertPath}
        ></file-browser>
      </div>
    `;
  }
}

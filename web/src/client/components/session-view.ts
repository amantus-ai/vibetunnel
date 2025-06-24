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
import { AuthClient } from '../services/auth-client.js';
import { CastConverter } from '../utils/cast-converter.js';
import { createLogger } from '../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../utils/terminal-preferences.js';
import type { Terminal } from './terminal.js';

const logger = createLogger('session-view');

@customElement('session-view')
export class SessionView extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
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
  private authClient = new AuthClient();
  @state() private reconnectCount = 0;
  @state() private ctrlSequence: string[] = [];

  private loadingInterval: number | null = null;
  private keyboardListenerAdded = false;
  private touchListenersAdded = false;
  private resizeTimeout: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;
  private instanceId = `session-view-${Math.random().toString(36).substr(2, 9)}`;

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
    this.addEventListener('click', () => this.focus());

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
    const authClient = new AuthClient();
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
      ].includes(inputText)
        ? { key: inputText }
        : { text: inputText };

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
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
              ...this.authClient.getAuthHeader(),
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
        'arrow_up',
        'arrow_down',
        'arrow_left',
        'arrow_right',
        'ctrl_enter',
        'shift_enter',
      ].includes(text)
        ? { key: text }
        : { text };

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
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
          ...this.authClient.getAuthHeader(),
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
        class="flex flex-col bg-black font-mono"
        style="height: 100vh; height: 100dvh; outline: none !important; box-shadow: none !important;"
      >
        <!-- Compact Header -->
        <div
          class="flex items-center justify-between px-3 py-2 border-b border-dark-border text-sm min-w-0 bg-dark-bg-secondary"
          style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(0.75rem, env(safe-area-inset-left)); padding-right: max(0.75rem, env(safe-area-inset-right));"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <button
              class="btn-secondary font-mono text-xs px-3 py-1 flex-shrink-0"
              @click=${this.handleBack}
            >
              Back
            </button>
            <div class="text-dark-text min-w-0 flex-1 overflow-hidden">
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
            class="w-full h-full p-0 m-0"
          ></vibe-terminal>
        </div>

        <!-- Floating Session Exited Banner (outside terminal container to avoid filter effects) -->
        ${
          this.session?.status === 'exited'
            ? html`
              <div
                class="absolute inset-0 flex items-center justify-center pointer-events-none z-50"
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

        <!-- Mobile Input Controls -->
        ${
          this.isMobile && !this.showMobileInput
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
                class="fixed inset-0 z-50 flex flex-col"
                style="background: rgba(0, 0, 0, 0.8);"
                @click=${(e: Event) => {
                  if (e.target === e.currentTarget) {
                    this.showMobileInput = false;
                  }
                }}
                @touchstart=${this.touchStartHandler}
                @touchend=${this.touchEndHandler}
              >
                <!-- Spacer to push content up above keyboard -->
                <div class="flex-1"></div>

                <div
                  class="font-mono text-sm mx-4 mb-4 flex flex-col"
                  style="background: black; border: 1px solid #569cd6; border-radius: 8px; transform: translateY(-120px);"
                  @click=${(e: Event) => e.stopPropagation()}
                >
                  <!-- Input Area -->
                  <div class="p-4 flex flex-col">
                    <textarea
                      id="mobile-input-textarea"
                      class="w-full font-mono text-sm resize-none outline-none"
                      placeholder="Type your command here..."
                      .value=${this.mobileInputText}
                      @input=${this.handleMobileInputChange}
                      @click=${(e: Event) => {
                        const textarea = e.target as HTMLTextAreaElement;
                        setTimeout(() => {
                          textarea.focus();
                        }, 10);
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          this.handleMobileInputSend();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          this.showMobileInput = false;
                        }
                      }}
                      style="height: 120px; background: black; color: #d4d4d4; border: none; padding: 12px;"
                    ></textarea>
                  </div>

                  <!-- Controls -->
                  <div class="p-4 flex gap-2" style="border-top: 1px solid #444;">
                    <button
                      class="font-mono px-3 py-2 text-xs transition-colors btn-ghost"
                      @click=${() => {
                        this.showMobileInput = false;
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
                class="fixed inset-0 z-50 flex items-center justify-center"
                style="background: rgba(0, 0, 0, 0.8);"
                @click=${this.handleCtrlAlphaBackdrop}
              >
                <div
                  class="font-mono text-sm m-4 max-w-sm w-full"
                  style="background: black; border: 1px solid #569cd6; border-radius: 8px; padding: 20px;"
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
                  <div class="grid grid-cols-6 gap-2 mb-4">
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
                          class="font-mono text-xs transition-all cursor-pointer aspect-square flex items-center justify-center quick-start-btn"
                          @click=${() => this.handleCtrlKey(letter)}
                        >
                          ${letter}
                        </button>
                      `
                    )}
                  </div>

                  <!-- Common shortcuts info -->
                  <div class="text-xs text-vs-muted text-center mb-4">
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

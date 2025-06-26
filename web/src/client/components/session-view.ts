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
import './session-view/mobile-input-overlay.js';
import './session-view/ctrl-alpha-overlay.js';
import './session-view/width-selector.js';
import './session-view/session-header.js';
import { authClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../utils/terminal-preferences.js';
import { type AppPreferences, AppSettings } from './app-settings.js';
import { ConnectionManager } from './session-view/connection-manager.js';
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
  private connectionManager!: ConnectionManager;
  @state() private ctrlSequence: string[] = [];
  @state() private useDirectKeyboard = false;
  @state() private showQuickKeys = false;
  @state() private keyboardHeight = 0;

  private loadingInterval: number | null = null;
  private keyboardListenerAdded = false;
  private touchListenersAdded = false;
  private hiddenInput: HTMLInputElement | null = null;
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

    // Initialize connection manager
    this.connectionManager = new ConnectionManager(
      (sessionId: string) => {
        // Handle session exit
        if (this.session && sessionId === this.session.id) {
          this.session = { ...this.session, status: 'exited' };
          this.requestUpdate();
        }
      },
      (session: Session) => {
        // Handle session update
        this.session = session;
        this.requestUpdate();
      }
    );
    this.connectionManager.setConnected(true);

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
        const nav = navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } };
        if (nav.virtualKeyboard) {
          nav.virtualKeyboard.overlaysContent = true;
        }
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
        const viewport = window.visualViewport;
        if (!viewport) return;
        const keyboardHeight = window.innerHeight - viewport.height;

        // Store keyboard height in state
        this.keyboardHeight = keyboardHeight;

        // Update quick keys component if it exists
        const quickKeys = this.querySelector('terminal-quick-keys') as HTMLElement & {
          keyboardHeight: number;
        };
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

    // Update connection manager
    if (this.connectionManager) {
      this.connectionManager.setConnected(false);
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

    // Stop loading animation
    this.stopLoading();

    // Cleanup stream connection if it exists
    if (this.connectionManager) {
      this.connectionManager.cleanupStreamConnection();
    }

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

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // If session changed, clean up old stream connection
    if (changedProperties.has('session')) {
      const oldSession = changedProperties.get('session') as Session | null;
      if (oldSession && oldSession.id !== this.session?.id) {
        logger.log('Session changed, cleaning up old stream connection');
        if (this.connectionManager) {
          this.connectionManager.cleanupStreamConnection();
        }
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

    // Update connection manager with terminal reference
    if (this.connectionManager) {
      this.connectionManager.setTerminal(this.terminal);
      this.connectionManager.setSession(this.session);
    }

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
      if (this.connected && this.connectionManager) {
        this.connectionManager.connectToStream();
      } else {
        logger.warn(`Component disconnected before stream connection`);
      }
    }, 0);
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
      if (this.connectionManager) {
        this.connectionManager.cleanupStreamConnection();
      }
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
    if (!this.showMobileInput) {
      // Refresh terminal scroll position after closing mobile input
      this.refreshTerminalAfterMobileInput();
    }
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

  private handleMobileInputCancel() {
    this.showMobileInput = false;
    // Clear the text
    this.mobileInputText = '';
    // Restart focus retention
    if (!this.disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
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

  private handleCtrlAlphaCancel() {
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
    if (this.isMobile && this.useDirectKeyboard) {
      // Prevent the event from bubbling and default action
      e.stopPropagation();
      e.preventDefault();

      // Don't do anything - the hidden input should handle all interactions
      // The click on the terminal is actually a click on the hidden input overlay
      return;
    }
  }

  private ensureHiddenInputVisible() {
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }

    // Show quick keys
    this.showQuickKeys = true;

    // The input should already be covering the terminal and be focusable
    // The user's tap on the terminal is actually a tap on the input
  }

  private createHiddenInput() {
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.style.position = 'absolute';
    this.hiddenInput.style.top = '0';
    this.hiddenInput.style.left = '0';
    this.hiddenInput.style.width = '100%';
    this.hiddenInput.style.height = '100%';
    this.hiddenInput.style.opacity = '0'; // Completely transparent
    this.hiddenInput.style.fontSize = '16px'; // Prevent zoom on iOS
    this.hiddenInput.style.zIndex = '10'; // Above terminal content
    this.hiddenInput.style.border = 'none';
    this.hiddenInput.style.outline = 'none';
    this.hiddenInput.style.background = 'transparent';
    this.hiddenInput.style.color = 'transparent';
    this.hiddenInput.style.caretColor = 'transparent'; // Hide the cursor
    this.hiddenInput.style.cursor = 'default'; // Normal cursor
    this.hiddenInput.autocapitalize = 'off';
    this.hiddenInput.autocomplete = 'off';
    this.hiddenInput.setAttribute('autocorrect', 'off');
    this.hiddenInput.setAttribute('spellcheck', 'false');
    this.hiddenInput.setAttribute('aria-hidden', 'true');

    // Make it visible for debugging (comment out in production)
    // this.hiddenInput.style.opacity = '0.1';
    // this.hiddenInput.style.background = 'rgba(255,0,0,0.1)';

    // Prevent click events from propagating to terminal
    this.hiddenInput.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    // Also handle touchstart to ensure mobile taps don't propagate
    this.hiddenInput.addEventListener('touchstart', (e) => {
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
      const _event = e as FocusEvent;

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
        <!-- Session Header -->
        <session-header
          .session=${this.session}
          .showBackButton=${this.showBackButton}
          .showSidebarToggle=${this.showSidebarToggle}
          .sidebarCollapsed=${this.sidebarCollapsed}
          .terminalCols=${this.terminalCols}
          .terminalRows=${this.terminalRows}
          .terminalMaxCols=${this.terminalMaxCols}
          .terminalFontSize=${this.terminalFontSize}
          .customWidth=${this.customWidth}
          .showWidthSelector=${this.showWidthSelector}
          .onBack=${() => this.handleBack()}
          .onSidebarToggle=${() => this.handleSidebarToggle()}
          .onOpenFileBrowser=${() => this.handleOpenFileBrowser()}
          .onMaxWidthToggle=${() => this.handleMaxWidthToggle()}
          .onWidthSelect=${(width: number) => this.handleWidthSelect(width)}
          .onFontSizeChange=${(size: number) => this.handleFontSizeChange(size)}
          @close-width-selector=${() => {
            this.showWidthSelector = false;
            this.customWidth = '';
          }}
        ></session-header>

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
            .disableClick=${this.isMobile && this.useDirectKeyboard}
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
                  class="bg-dark-bg-secondary border border-dark-border text-status-warning font-medium text-sm tracking-wide px-4 py-2 rounded-lg shadow-lg"
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

        <!-- Mobile Input Overlay -->
        <mobile-input-overlay
          .visible=${this.isMobile && this.showMobileInput}
          .mobileInputText=${this.mobileInputText}
          .keyboardHeight=${this.keyboardHeight}
          .touchStartX=${this.touchStartX}
          .touchStartY=${this.touchStartY}
          .onSend=${(_text: string) => this.handleMobileInputSendOnly()}
          .onSendWithEnter=${(_text: string) => this.handleMobileInputSend()}
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

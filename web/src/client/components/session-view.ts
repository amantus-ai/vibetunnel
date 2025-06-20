import { LitElement, PropertyValues, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from './session-list.js';
import './terminal.js';
import type { Terminal } from './terminal.js';
import { CastConverter } from '../utils/cast-converter.js';
import { themes } from '../themes.js';

@customElement('session-view')
export class SessionView extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @state() private connected = false;
  @state() private terminal: Terminal | null = null;
  @state() private streamConnection: { eventSource: EventSource; disconnect: () => void } | null =
    null;
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
  @state() private reconnectCount = 0;
  @state() private ctrlSequence: string[] = [];
  @state() private selectedTheme = 'VibeTunnel';
  @state() private showThemeSelector = false;

  private loadingInterval: number | null = null;
  private keyboardListenerAdded = false;
  private touchListenersAdded = false;
  private resizeTimeout: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  private keyboardHandler = (e: KeyboardEvent) => {
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

  connectedCallback() {
    super.connectedCallback();
    this.connected = true;

    // Load saved theme from localStorage
    try {
      const savedTheme = localStorage.getItem('vibetunnel-theme');
      // Handle migration from old theme names
      if (savedTheme === 'github_light') {
        this.selectedTheme = 'light';
        localStorage.setItem('vibetunnel-theme', 'light');
      } else if (savedTheme && themes[savedTheme]) {
        this.selectedTheme = savedTheme;
      }
    } catch (e) {
      console.error('Failed to load theme from localStorage:', e);
    }

    // Make session-view focusable
    this.tabIndex = 0;
    this.addEventListener('click', () => this.focus());

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
    if (this.streamConnection) {
      this.streamConnection.disconnect();
      this.streamConnection = null;
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

    // Stop loading and create terminal when session becomes available
    if (changedProperties.has('session') && this.session && this.loading) {
      this.stopLoading();
      this.setupTerminal();
    }

    // Initialize terminal after first render when terminal element exists
    if (!this.terminal && this.session && !this.loading) {
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
    if (!terminalElement || !this.session) return;

    this.terminal = terminalElement;

    // Configure terminal for interactive session
    this.terminal.cols = 80;
    this.terminal.rows = 24;
    this.terminal.fontSize = 14;

    // Apply saved theme
    const terminal = terminalElement as Terminal & {
      applyTheme?: (themeName: string) => void;
    };
    if (terminal.applyTheme && this.selectedTheme) {
      terminal.applyTheme(this.selectedTheme);
    }

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
    this.connectToStream();
  }

  private connectToStream() {
    if (!this.terminal || !this.session) return;

    // Clean up existing connection
    if (this.streamConnection) {
      this.streamConnection.disconnect();
      this.streamConnection = null;
    }

    const streamUrl = `/api/sessions/${this.session.id}/stream`;

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

      console.log(`Stream error #${this.reconnectCount} for session ${this.session?.id}`);

      // If we've had too many reconnects, mark session as exited
      if (this.reconnectCount >= reconnectThreshold) {
        console.log(`Session ${this.session?.id} marked as exited due to excessive reconnections`);

        if (this.session && this.session.status !== 'exited') {
          this.session = { ...this.session, status: 'exited' };
          this.requestUpdate();

          // Disconnect the stream and load final snapshot
          connection.disconnect();
          this.streamConnection = null;

          // Load final snapshot
          requestAnimationFrame(() => {
            this.loadSessionSnapshot();
          });
        }
      }
    };

    // Override the error handler
    originalEventSource.addEventListener('error', handleError);

    this.streamConnection = connection;
  }

  private async handleKeyboardInput(e: KeyboardEvent) {
    if (!this.session) return;

    // Don't send input to exited sessions
    if (this.session.status === 'exited') {
      console.log('Ignoring keyboard input - session has exited');
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
      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: inputText }),
      });

      if (!response.ok) {
        if (response.status === 400) {
          console.log('Session no longer accepting input (likely exited)');
          // Update session status to exited if we get 400 error
          if (this.session && (this.session.status as string) !== 'exited') {
            this.session = { ...this.session, status: 'exited' };
            this.requestUpdate();
          }
        } else {
          console.error('Failed to send input to session:', response.status);
        }
      }
    } catch (error) {
      console.error('Error sending input:', error);
    }
  }

  private handleBack() {
    window.location.search = '';
  }

  private handleSessionExit(e: Event) {
    const customEvent = e as CustomEvent;
    console.log('Session exit event received:', customEvent.detail);

    if (this.session && customEvent.detail.sessionId === this.session.id) {
      // Update session status to exited
      this.session = { ...this.session, status: 'exited' };
      this.requestUpdate();

      // Switch to snapshot mode - disconnect stream and load final snapshot
      if (this.streamConnection) {
        this.streamConnection.disconnect();
        this.streamConnection = null;
      }
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
      console.error('Failed to load session snapshot:', error);
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
        console.log(`Skipping redundant resize request: ${cols}x${rows}`);
        return;
      }

      // Send resize request to backend if session is active
      if (this.session && this.session.status !== 'exited') {
        try {
          console.log(
            `Sending resize request: ${cols}x${rows} (was ${this.lastResizeWidth}x${this.lastResizeHeight})`
          );

          const response = await fetch(`/api/sessions/${this.session.id}/resize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols: cols, rows: rows }),
          });

          if (response.ok) {
            // Cache the successfully sent dimensions
            this.lastResizeWidth = cols;
            this.lastResizeHeight = rows;
          } else {
            console.warn(`Failed to resize session: ${response.status}`);
          }
        } catch (error) {
          console.warn('Failed to send resize request:', error);
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
      console.error('Error sending mobile input:', error);
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
      console.error('Error sending mobile input:', error);
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

  private handleThemeToggle() {
    this.showThemeSelector = !this.showThemeSelector;
  }

  private handleThemeSelect(themeName: string) {
    this.selectedTheme = themeName;
    this.showThemeSelector = false;

    // Save to localStorage
    try {
      localStorage.setItem('vibetunnel-theme', themeName);
    } catch (e) {
      console.error('Failed to save theme to localStorage:', e);
    }

    // Apply theme to terminal
    const terminal = this.querySelector('vibe-terminal') as Terminal & {
      applyTheme?: (themeName: string) => void;
    };
    if (terminal && terminal.applyTheme) {
      terminal.applyTheme(themeName);
    }
  }

  private getThemeColors() {
    const theme = themes[this.selectedTheme] || themes.VibeTunnel;
    return {
      text: theme.foreground,
      background: theme.background,
      border: theme.brightBlack || '#444',
      accent: theme.blue || '#569cd6',
      success: theme.green || '#23d18b',
      warning: theme.yellow || '#d19a66',
      error: theme.red || '#f14c4c',
    };
  }

  private async sendInputText(text: string) {
    if (!this.session) return;

    try {
      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        console.error('Failed to send input to session');
      }
    } catch (error) {
      console.error('Error sending input:', error);
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
    if ('waiting' in this.session && this.session.waiting) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (!this.session) return '';
    const colors = this.getThemeColors();
    if ('waiting' in this.session && this.session.waiting) {
      return '';
    }
    return this.session.status === 'running' ? colors.success : colors.warning;
  }

  private getStatusDotColor(): string {
    if (!this.session) return '';
    const colors = this.getThemeColors();
    if ('waiting' in this.session && this.session.waiting) {
      return colors.border;
    }
    return this.session.status === 'running' ? colors.success : colors.warning;
  }

  render() {
    if (!this.session) {
      return html`
        <div class="fixed inset-0 bg-black flex items-center justify-center">
          <div class="text-vs-text font-mono text-center">
            <div class="text-2xl mb-2">${this.getLoadingText()}</div>
            <div class="text-sm text-vs-muted">Waiting for session...</div>
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
          outline: 2px solid #007acc !important;
          outline-offset: -2px;
        }
      </style>
      <div
        class="flex flex-col bg-vs-bg font-mono"
        style="height: 100vh; height: 100dvh; outline: none !important; box-shadow: none !important;"
      >
        <!-- Compact Header -->
        <div
          class="flex items-center justify-between px-3 py-2 border-b text-sm min-w-0"
          style="background: ${this.getThemeColors()
            .background}; border-color: ${this.getThemeColors().border};"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <button
              class="font-mono px-2 py-1 rounded transition-colors text-xs flex-shrink-0"
              style="background: ${this.getThemeColors().background}; color: ${this.getThemeColors()
                .text}; border: 1px solid ${this.getThemeColors().accent};"
              @click=${this.handleBack}
              @mouseover=${(e: Event) => {
                const btn = e.target as HTMLElement;
                btn.style.background = this.getThemeColors().accent;
                btn.style.color = this.getThemeColors().background;
              }}
              @mouseout=${(e: Event) => {
                const btn = e.target as HTMLElement;
                btn.style.background = this.getThemeColors().background;
                btn.style.color = this.getThemeColors().text;
              }}
            >
              BACK
            </button>

            <!-- Theme Settings Button -->
            <div class="relative">
              <button
                class="font-mono px-2 py-1 rounded transition-colors text-xs flex-shrink-0"
                style="background: ${this.getThemeColors()
                  .background}; color: ${this.getThemeColors()
                  .text}; border: 1px solid ${this.getThemeColors().border}; font-size: 16px;"
                @click=${this.handleThemeToggle}
                @mouseover=${(e: Event) => {
                  const btn = e.target as HTMLElement;
                  btn.style.background = this.getThemeColors().border;
                  btn.style.color = this.getThemeColors().background;
                }}
                @mouseout=${(e: Event) => {
                  const btn = e.target as HTMLElement;
                  btn.style.background = this.getThemeColors().background;
                  btn.style.color = this.getThemeColors().text;
                }}
                title="Theme Settings"
              >
                ⚙
              </button>

              <!-- Theme Selector Dropdown -->
              ${this.showThemeSelector
                ? html`
                    <div
                      class="absolute top-full left-0 mt-1 z-50"
                      style="background: ${this.getThemeColors()
                        .background}; border: 1px solid ${this.getThemeColors()
                        .accent}; border-radius: 4px; min-width: 200px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);"
                    >
                      ${Object.keys(themes).map(
                        (themeName) => html`
                          <div
                            class="px-3 py-2 cursor-pointer transition-colors text-xs font-mono flex items-center gap-2"
                            style="background: ${this.selectedTheme === themeName
                              ? this.getThemeColors().accent
                              : this.getThemeColors().background}; color: ${this.selectedTheme ===
                            themeName
                              ? this.getThemeColors().background
                              : this.getThemeColors()
                                  .text}; border-bottom: 1px solid ${this.getThemeColors().border};"
                            @click=${() => this.handleThemeSelect(themeName)}
                            @mouseover=${(e: Event) => {
                              const div = e.currentTarget as HTMLElement;
                              if (this.selectedTheme !== themeName) {
                                div.style.background = this.getThemeColors().border;
                                div.style.color = this.getThemeColors().background;
                              }
                            }}
                            @mouseout=${(e: Event) => {
                              const div = e.currentTarget as HTMLElement;
                              if (this.selectedTheme !== themeName) {
                                div.style.background = this.getThemeColors().background;
                                div.style.color = this.getThemeColors().text;
                              }
                            }}
                          >
                            <span
                              style="color: ${this.selectedTheme === themeName
                                ? this.getThemeColors().success
                                : 'transparent'}; width: 16px;"
                              >✓</span
                            >
                            ${themeName === 'solarized_dark'
                              ? 'Solarized Dark'
                              : themeName === 'light'
                                ? 'Light'
                                : themeName === 'dracula'
                                  ? 'Dracula'
                                  : 'VibeTunnel'}
                          </div>
                        `
                      )}
                    </div>
                  `
                : ''}
            </div>

            <div class="text-vs-text min-w-0 flex-1 overflow-hidden">
              <div
                class="text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
                style="color: ${this.getThemeColors().text};"
                title="${this.session.name || this.session.command}"
              >
                ${this.session.name || this.session.command}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-xs flex-shrink-0 ml-2">
            <div class="flex flex-col items-end gap-0">
              <span
                class="text-xs flex items-center gap-1"
                style="color: ${this.getStatusColor()};"
              >
                <div
                  class="w-2 h-2 rounded-full"
                  style="background-color: ${this.getStatusDotColor()};"
                ></div>
                ${this.getStatusText().toUpperCase()}
              </span>
              ${this.terminalCols > 0 && this.terminalRows > 0
                ? html`
                    <span
                      class="text-xs opacity-60"
                      style="font-size: 10px; line-height: 1; color: ${this.getThemeColors()
                        .border};"
                    >
                      ${this.terminalCols}×${this.terminalRows}
                    </span>
                  `
                : ''}
            </div>
          </div>
        </div>

        <!-- Terminal Container -->
        <div
          class="flex-1 bg-black overflow-hidden min-h-0 relative"
          id="terminal-container"
          style="max-width: 100vw; height: 100%;"
        >
          ${this.loading
            ? html`
                <!-- Loading overlay -->
                <div
                  class="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-10"
                >
                  <div class="text-vs-text font-mono text-center">
                    <div class="text-2xl mb-2">${this.getLoadingText()}</div>
                    <div class="text-sm text-vs-muted">Connecting to session...</div>
                  </div>
                </div>
              `
            : ''}
          <!-- Terminal Component -->
          <vibe-terminal
            .sessionId=${this.session?.id || ''}
            .cols=${80}
            .rows=${24}
            .fontSize=${14}
            .themeName=${this.selectedTheme}
            class="w-full h-full"
          ></vibe-terminal>
        </div>

        <!-- Mobile Input Controls -->
        ${this.isMobile && !this.showMobileInput
          ? html`
              <div class="flex-shrink-0 p-4" style="background: black;">
                <!-- First row: Arrow keys -->
                <div class="flex gap-2 mb-2">
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                    @click=${() => this.handleSpecialKey('arrow_up')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">↑</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                    @click=${() => this.handleSpecialKey('arrow_down')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">↓</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                    @click=${() => this.handleSpecialKey('arrow_left')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">←</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                    @click=${() => this.handleSpecialKey('arrow_right')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">→</span>
                  </button>
                </div>

                <!-- Second row: Special keys -->
                <div class="flex gap-2">
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16"
                    @click=${() => this.handleSpecialKey('escape')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 8px 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    ESC
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16"
                    @click=${() => this.handleSpecialKey('\t')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 8px 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">⇥</span>
                  </button>
                  <button
                    class="flex-1 font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                    @click=${this.handleMobileInputToggle}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    ABC123
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16"
                    @click=${this.handleCtrlAlphaToggle}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 8px 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    CTRL
                  </button>
                  <button
                    class="font-mono text-sm transition-all cursor-pointer w-16"
                    @click=${() => this.handleSpecialKey('enter')}
                    style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 8px 4px;"
                    @mouseover=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.9)';
                      btn.style.borderColor = '#666';
                    }}
                    @mouseout=${(e: Event) => {
                      const btn = e.target as HTMLElement;
                      btn.style.background = 'rgba(0, 0, 0, 0.8)';
                      btn.style.borderColor = '#444';
                    }}
                  >
                    <span class="text-xl">⏎</span>
                  </button>
                </div>
              </div>
            `
          : ''}

        <!-- Full-Screen Input Overlay (only when opened) -->
        ${this.isMobile && this.showMobileInput
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
                      class="font-mono px-3 py-2 text-xs transition-colors"
                      @click=${() => (this.showMobileInput = false)}
                      style="background: black; color: #d4d4d4; border: 1px solid #888; border-radius: 4px;"
                      @mouseover=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        btn.style.background = '#888';
                        btn.style.color = 'black';
                      }}
                      @mouseout=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        btn.style.background = 'black';
                        btn.style.color = '#d4d4d4';
                      }}
                    >
                      CANCEL
                    </button>
                    <button
                      class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      @click=${this.handleMobileInputSendOnly}
                      ?disabled=${!this.mobileInputText.trim()}
                      style="background: black; color: #d4d4d4; border: 1px solid #888; border-radius: 4px;"
                      @mouseover=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        if (!btn.hasAttribute('disabled')) {
                          btn.style.background = '#888';
                          btn.style.color = 'black';
                        }
                      }}
                      @mouseout=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        if (!btn.hasAttribute('disabled')) {
                          btn.style.background = 'black';
                          btn.style.color = '#d4d4d4';
                        }
                      }}
                    >
                      SEND
                    </button>
                    <button
                      class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      @click=${this.handleMobileInputSend}
                      ?disabled=${!this.mobileInputText.trim()}
                      style="background: black; color: #d4d4d4; border: 1px solid #569cd6; border-radius: 4px;"
                      @mouseover=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        if (!btn.hasAttribute('disabled')) {
                          btn.style.background = '#569cd6';
                          btn.style.color = 'black';
                        }
                      }}
                      @mouseout=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        if (!btn.hasAttribute('disabled')) {
                          btn.style.background = 'black';
                          btn.style.color = '#d4d4d4';
                        }
                      }}
                    >
                      SEND + ⏎
                    </button>
                  </div>
                </div>
              </div>
            `
          : ''}

        <!-- Ctrl+Alpha Overlay -->
        ${this.isMobile && this.showCtrlAlpha
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
                  ${this.ctrlSequence.length > 0
                    ? html`
                        <div class="text-center mb-4 p-2 border border-vs-muted rounded bg-vs-bg">
                          <div class="text-xs text-vs-muted mb-1">Current sequence:</div>
                          <div class="text-sm text-vs-accent font-bold">
                            ${this.ctrlSequence.map((letter) => `Ctrl+${letter}`).join(' ')}
                          </div>
                        </div>
                      `
                    : ''}

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
                          class="font-mono text-xs transition-all cursor-pointer aspect-square flex items-center justify-center"
                          style="background: rgba(0, 0, 0, 0.8); color: #d4d4d4; border: 1px solid #444; border-radius: 4px;"
                          @click=${() => this.handleCtrlKey(letter)}
                          @mouseover=${(e: Event) => {
                            const btn = e.target as HTMLElement;
                            btn.style.background = '#569cd6';
                            btn.style.color = 'black';
                          }}
                          @mouseout=${(e: Event) => {
                            const btn = e.target as HTMLElement;
                            btn.style.background = 'rgba(0, 0, 0, 0.8)';
                            btn.style.color = '#d4d4d4';
                          }}
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
                      class="font-mono px-4 py-2 text-sm transition-all cursor-pointer"
                      style="background: black; color: #d4d4d4; border: 1px solid #888; border-radius: 4px;"
                      @click=${() => (this.showCtrlAlpha = false)}
                      @mouseover=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        btn.style.background = '#888';
                        btn.style.color = 'black';
                      }}
                      @mouseout=${(e: Event) => {
                        const btn = e.target as HTMLElement;
                        btn.style.background = 'black';
                        btn.style.color = '#d4d4d4';
                      }}
                    >
                      CANCEL
                    </button>
                    ${this.ctrlSequence.length > 0
                      ? html`
                          <button
                            class="font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                            style="background: black; color: #d4d4d4; border: 1px solid #888; border-radius: 4px;"
                            @click=${this.handleClearCtrlSequence}
                            @mouseover=${(e: Event) => {
                              const btn = e.target as HTMLElement;
                              btn.style.background = '#888';
                              btn.style.color = 'black';
                            }}
                            @mouseout=${(e: Event) => {
                              const btn = e.target as HTMLElement;
                              btn.style.background = 'black';
                              btn.style.color = '#d4d4d4';
                            }}
                          >
                            CLEAR
                          </button>
                          <button
                            class="font-mono px-3 py-2 text-sm transition-all cursor-pointer"
                            style="background: black; color: #d4d4d4; border: 1px solid #569cd6; border-radius: 4px;"
                            @click=${this.handleSendCtrlSequence}
                            @mouseover=${(e: Event) => {
                              const btn = e.target as HTMLElement;
                              btn.style.background = '#569cd6';
                              btn.style.color = 'black';
                            }}
                            @mouseout=${(e: Event) => {
                              const btn = e.target as HTMLElement;
                              btn.style.background = 'black';
                              btn.style.color = '#d4d4d4';
                            }}
                          >
                            SEND
                          </button>
                        `
                      : ''}
                  </div>
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

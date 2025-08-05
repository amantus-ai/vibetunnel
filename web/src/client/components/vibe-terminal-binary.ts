/**
 * VibeTunnel Interactive Binary Terminal Component
 *
 * Extends the read-only terminal buffer component to support interactive text input
 * using the efficient binary WebSocket protocol. Maintains the same UI appearance
 * as the standard terminal component while using the lightweight buffer rendering.
 *
 * @fires terminal-ready - When terminal is initialized and ready
 * @fires terminal-input - When user types (detail: string)
 * @fires terminal-resize - When terminal is resized (detail: { cols: number, rows: number })
 * @fires url-clicked - When a URL is clicked (detail: string)
 */
import { html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { HttpMethod } from '../../shared/types.js';
import { authClient } from '../services/auth-client.js';
import { calculateCursorPosition } from '../utils/cursor-position.js';
import { consumeEvent } from '../utils/event-utils.js';
import { createLogger } from '../utils/logger.js';
import { TERMINAL_IDS } from '../utils/terminal-constants.js';
import { TerminalPreferencesManager } from '../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';
import { getCurrentTheme } from '../utils/theme-utils.js';
import { VibeTerminalBuffer } from './vibe-terminal-buffer.js';

const logger = createLogger('vibe-terminal-binary');

@customElement('vibe-terminal-binary')
export class VibeTerminalBinary extends VibeTerminalBuffer {
  @property({ type: String }) sessionStatus = 'running'; // Track session status for cursor control
  @property({ type: Boolean }) fitHorizontally = false;
  @property({ type: Number }) maxCols = 0; // 0 means no limit
  @property({ type: Boolean }) disableClick = false; // Disable click handling (for mobile direct keyboard)
  @property({ type: Boolean }) hideScrollButton = false; // Hide scroll-to-bottom button
  @property({ type: Number }) initialCols = 0; // Initial terminal width from session creation
  @property({ type: Number }) initialRows = 0; // Initial terminal height from session creation

  @property({ type: Number }) cols = 80;
  @property({ type: Number }) rows = 24;
  @property({ type: Number }) fontSize = 14;

  userOverrideWidth = false; // Track if user manually selected a width (public for session-view access)

  @state() private showScrollToBottomButton = false;
  @state() private currentCols = 80;
  @state() private currentRows = 24;

  @query('#terminal-container') private terminalContainer?: HTMLElement;
  @query('.terminal-scroll-container') private scrollContainer?: HTMLElement;

  private terminalResizeObserver: ResizeObserver | null = null;
  private preferencesManager = TerminalPreferencesManager.getInstance();
  private isScrolledToBottom = true;
  private hiddenInput?: HTMLInputElement;

  connectedCallback() {
    super.connectedCallback();

    // Load preferences
    this.fontSize = this.preferencesManager.getFontSize();
    this.theme = this.preferencesManager.getTheme();

    // Initialize dimensions
    this.currentCols = this.cols;
    this.currentRows = this.rows;

    // Listen for font size changes
    window.addEventListener('terminal-font-size-changed', this.handleFontSizeChange);

    // Listen for theme changes
    window.addEventListener('terminal-theme-changed', this.handleThemeChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up event listeners
    window.removeEventListener('terminal-font-size-changed', this.handleFontSizeChange);
    window.removeEventListener('terminal-theme-changed', this.handleThemeChange);

    // Clean up hidden input
    if (this.hiddenInput) {
      this.hiddenInput.removeEventListener('input', this.handleInput);
      this.hiddenInput.removeEventListener('keydown', this.handleKeydown);
      this.hiddenInput.remove();
      this.hiddenInput = undefined;
    }

    // Clean up resize observer
    if (this.terminalResizeObserver) {
      this.terminalResizeObserver.disconnect();
      this.terminalResizeObserver = null;
    }
  }

  firstUpdated() {
    // CRITICAL: Call parent's firstUpdated to enable WebSocket subscription
    super.firstUpdated();

    // Initialize input handling
    if (this.terminalContainer && !this.disableClick) {
      this.setupInputHandling();
    }

    // Set up resize observer
    this.setupResizeObserver();

    // Set up scroll tracking
    this.setupScrollTracking();

    // Dispatch terminal-ready event
    this.dispatchEvent(new CustomEvent('terminal-ready'));

    // Update terminal size after initialization
    this.updateTerminalSize();
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties as Map<string, unknown>);

    // Handle font size changes
    if (changedProperties.has('fontSize')) {
      this.updateTerminalSize();
    }

    // Handle dimension changes
    if (changedProperties.has('cols') || changedProperties.has('rows')) {
      this.currentCols = this.cols;
      this.currentRows = this.rows;
      this.updateTerminalSize();
    }
  }

  render() {
    const baseTheme = this.theme === 'auto' ? getCurrentTheme() : this.theme;
    const lineHeight = this.fontSize * 1.2;

    return html`
      <style>
        /* Override parent's dynamic font sizing with fixed font size */
        vibe-terminal-binary .terminal-container {
          font-size: ${this.fontSize}px !important;
          line-height: ${lineHeight}px !important;
        }

        vibe-terminal-binary .terminal-line {
          height: ${lineHeight}px !important;
          line-height: ${lineHeight}px !important;
        }
        
        /* Hide parent's font size styles */
        vibe-terminal-buffer .terminal-container {
          font-size: ${this.fontSize}px !important;
          line-height: ${lineHeight}px !important;
        }

        vibe-terminal-buffer .terminal-line {
          height: ${lineHeight}px !important;
          line-height: ${lineHeight}px !important;
        }
      </style>
      <div class="relative h-full flex flex-col">
        <!-- Terminal container -->
        <div 
          id="terminal-container"
          class="terminal-scroll-container flex-1 overflow-auto ${baseTheme}"
          style="font-size: ${this.fontSize}px;"
        >
          <!-- Use parent's render for buffer content -->
          ${super.render()}
        </div>
        
        <!-- Scroll to bottom button -->
        ${
          !this.hideScrollButton && this.showScrollToBottomButton
            ? html`
          <button
            @click=${() => this.scrollToBottom()}
            class="absolute bottom-4 right-4 bg-bg-secondary border border-border rounded-full p-2 shadow-md hover:bg-bg-tertiary transition-all duration-200"
            title="Scroll to bottom"
          >
            <svg class="w-5 h-5 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        `
            : ''
        }
      </div>
    `;
  }

  private setupResizeObserver() {
    if (!this.terminalContainer) return;

    this.terminalResizeObserver = new ResizeObserver(() => {
      this.updateTerminalSize();
    });

    this.terminalResizeObserver.observe(this.terminalContainer);
  }

  private setupScrollTracking() {
    if (!this.scrollContainer) return;

    this.scrollContainer.addEventListener('scroll', () => {
      const container = this.scrollContainer;
      const scrollTop = container?.scrollTop || 0;
      const scrollHeight = container?.scrollHeight || 0;
      const clientHeight = container?.clientHeight || 0;

      // Check if scrolled to bottom (with 10px tolerance)
      this.isScrolledToBottom = scrollTop + clientHeight >= scrollHeight - 10;
      this.showScrollToBottomButton = !this.isScrolledToBottom && scrollHeight > clientHeight;
    });
  }

  private updateTerminalSize() {
    if (!this.terminalContainer) return;

    const rect = this.terminalContainer.getBoundingClientRect();
    const charWidth = this.fontSize * 0.6; // Approximate character width
    const lineHeight = this.fontSize * 1.5; // Approximate line height

    let newCols = Math.floor(rect.width / charWidth);
    const newRows = Math.floor(rect.height / lineHeight);

    // Apply fitHorizontally logic (same as ASCII terminal)
    if (!this.fitHorizontally && !this.userOverrideWidth) {
      // If not fitting to window and no user override, use initial cols or default
      newCols = this.initialCols || 80;
    } else {
      // Apply max columns constraint if set
      if (this.maxCols > 0 && newCols > this.maxCols) {
        newCols = this.maxCols;
      }
    }

    // Only resize if dimensions actually changed
    if (newCols !== this.currentCols || newRows !== this.currentRows) {
      this.currentCols = newCols;
      this.currentRows = newRows;

      // Dispatch resize event
      this.dispatchEvent(
        new CustomEvent('terminal-resize', {
          detail: { cols: newCols, rows: newRows },
        })
      );
    }
  }

  private handleFontSizeChange = (event: Event) => {
    const customEvent = event as CustomEvent<number>;
    this.fontSize = customEvent.detail;
  };

  private handleThemeChange = (event: Event) => {
    const customEvent = event as CustomEvent<TerminalThemeId>;
    this.theme = customEvent.detail;
  };

  private setupInputHandling() {
    // Create hidden input for capturing keyboard input
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.style.position = 'absolute';
    this.hiddenInput.style.left = '-9999px';
    this.hiddenInput.style.width = '1px';
    this.hiddenInput.style.height = '1px';
    this.hiddenInput.style.opacity = '0';
    this.hiddenInput.autocapitalize = 'off';
    this.hiddenInput.setAttribute('autocorrect', 'off');
    this.hiddenInput.autocomplete = 'off';
    this.hiddenInput.spellcheck = false;

    this.terminalContainer?.appendChild(this.hiddenInput);

    // Handle input events
    this.hiddenInput.addEventListener('input', this.handleInput);
    this.hiddenInput.addEventListener('keydown', this.handleKeydown);

    // Focus on click
    this.terminalContainer?.addEventListener('click', () => {
      if (!this.disableClick) {
        this.focus();
      }
    });
  }

  private handleInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const text = input.value;

    if (text) {
      // Send input text
      this.sendInputText(text);

      // Clear the input
      input.value = '';
    }
  };

  private handleKeydown = (event: KeyboardEvent) => {
    const { key, ctrlKey } = event;

    // Handle special keys
    let specialKey = '';

    if (key === 'Enter') {
      specialKey = '\r';
    } else if (key === 'Tab') {
      specialKey = '\t';
    } else if (key === 'Backspace') {
      specialKey = '\x7f';
    } else if (key === 'Escape') {
      specialKey = '\x1b';
    } else if (key === 'ArrowUp') {
      specialKey = '\x1b[A';
    } else if (key === 'ArrowDown') {
      specialKey = '\x1b[B';
    } else if (key === 'ArrowRight') {
      specialKey = '\x1b[C';
    } else if (key === 'ArrowLeft') {
      specialKey = '\x1b[D';
    } else if (ctrlKey && key.length === 1) {
      // Handle Ctrl+key combinations
      const code = key.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) {
        specialKey = String.fromCharCode(code);
      }
    }

    if (specialKey) {
      consumeEvent(event);
      this.sendInputText(specialKey);
    }
  };

  private async sendInputText(text: string) {
    if (!this.sessionId) return;

    try {
      const user = authClient.getCurrentUser();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (user?.token) {
        headers.Authorization = `Bearer ${user.token}`;
      }

      await fetch(`/api/sessions/${this.sessionId}/input`, {
        method: HttpMethod.POST,
        headers,
        body: JSON.stringify({ text }),
      });

      // Dispatch terminal-input event for consistency
      this.dispatchEvent(new CustomEvent('terminal-input', { detail: text }));
    } catch (error) {
      logger.error('Failed to send input:', error);
    }
  }

  // Public methods for compatibility with standard terminal component
  focus() {
    this.hiddenInput?.focus();
  }

  blur() {
    this.hiddenInput?.blur();
  }

  clear() {
    // Binary mode doesn't support clear directly
    logger.warn('Clear not supported in binary mode');
  }

  write(data: string) {
    // Binary mode doesn't support direct write
    logger.warn('Direct write not supported in binary mode', data);
  }

  setUserOverrideWidth(value: boolean) {
    this.userOverrideWidth = value;
  }

  handleFitToggle() {
    // Binary mode doesn't support fit toggle
    logger.warn('Fit toggle not supported in binary mode');
  }

  fitTerminal() {
    // Trigger size update
    this.updateTerminalSize();
  }

  scrollToBottom() {
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
    }
  }

  /**
   * Get cursor position information for IME input positioning
   * Returns null if buffer is not available or session is not running
   */
  getCursorInfo(): { x: number; y: number } | null {
    if (!this.buffer) {
      return null;
    }

    // Get cursor position from buffer data
    const cursorX = this.buffer.cursorX;
    const cursorY = this.buffer.cursorY;

    // Find the terminal container element
    const container = this.querySelector(`#${TERMINAL_IDS.BUFFER_CONTAINER}`);
    if (!container) {
      return null;
    }

    // Use shared cursor position calculation
    return calculateCursorPosition(cursorX, cursorY, this.fontSize, container, this.sessionStatus);
  }
}

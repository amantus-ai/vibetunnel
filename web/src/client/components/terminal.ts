/**
 * Terminal Component
 *
 * Full terminal implementation with xterm.js for rendering and input handling.
 * Supports copy/paste, URL highlighting, custom scrolling, and responsive sizing.
 *
 * @fires terminal-ready - When terminal is initialized and ready
 * @fires terminal-input - When user types (detail: string)
 * @fires terminal-resize - When terminal is resized (detail: { cols: number, rows: number })
 * @fires url-clicked - When a URL is clicked (detail: string)
 */

import { type IBufferCell, type IBufferLine, Terminal as XtermTerminal } from '@xterm/headless';
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { calculateCursorPosition } from '../utils/cursor-position.js';
import { processKeyboardShortcuts } from '../utils/keyboard-shortcut-highlighter.js';
import { createLogger } from '../utils/logger.js';
import { TERMINAL_IDS } from '../utils/terminal-constants.js';
import { TerminalPreferencesManager } from '../utils/terminal-preferences.js';
import { TERMINAL_THEMES, type TerminalThemeId } from '../utils/terminal-themes.js';
import { getCurrentTheme } from '../utils/theme-utils.js';
import { UrlHighlighter } from '../utils/url-highlighter';

const logger = createLogger('terminal');

@customElement('vibe-terminal')
export class Terminal extends LitElement {
  // Disable shadow DOM for Tailwind compatibility and native text selection
  createRenderRoot() {
    return this as unknown as HTMLElement;
  }

  @property({ type: String }) sessionId = '';
  @property({ type: String }) sessionStatus = 'running'; // Track session status for cursor control
  @property({ type: Number }) cols = 80;
  @property({ type: Number }) rows = 24;
  @property({ type: Number }) fontSize = 14;
  @property({ type: Boolean }) fitHorizontally = false;
  @property({ type: Number }) maxCols = 0; // 0 means no limit
  @property({ type: String }) theme: TerminalThemeId = 'auto';
  @property({ type: Boolean }) disableClick = false; // Disable click handling (for mobile direct keyboard)
  @property({ type: Boolean }) hideScrollButton = false; // Hide scroll-to-bottom button
  @property({ type: Number }) initialCols = 0; // Initial terminal width from session creation
  @property({ type: Number }) initialRows = 0; // Initial terminal height from session creation

  private originalFontSize: number = 14;
  userOverrideWidth = false; // Track if user manually selected a width (public for session-view access)

  @state() private terminal: XtermTerminal | null = null;
  private _viewportY = 0; // Current scroll position in pixels
  @state() private followCursorEnabled = true; // Whether to follow cursor on writes
  private programmaticScroll = false; // Flag to prevent state updates during programmatic scrolling

  // Debug performance tracking
  private debugMode = false;
  private renderCount = 0;
  private totalRenderTime = 0;
  private _lastFitTime?: number;
  private lastRenderTime = 0;

  get viewportY() {
    return this._viewportY;
  }

  set viewportY(value: number) {
    this._viewportY = value;
  }
  @state() private actualRows = 24; // Rows that fit in viewport
  @state() private cursorVisible = true; // Track cursor visibility state

  private container: HTMLElement | null = null;
  private explicitSizeSet = false; // Flag to prevent auto-resize when size is explicitly set

  // Virtual scrolling optimization
  private renderPending = false;
  private momentumVelocityY = 0;
  private momentumVelocityX = 0;
  private momentumAnimation: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mobileWidthResizeComplete = false;
  private pendingResize: number | null = null;
  private lastCols = 0;
  private lastRows = 0;
  private isMobile = false;
  private mobileInitialResizeTimeout: NodeJS.Timeout | null = null;

  // Operation queue for batching buffer modifications
  private operationQueue: (() => void | Promise<void>)[] = [];

  private queueRenderOperation(operation: () => void | Promise<void>) {
    this.operationQueue.push(operation);

    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.processOperationQueue().then(() => {
          // Only clear renderPending when queue is truly empty
          if (this.operationQueue.length === 0) {
            this.renderPending = false;
          }
        });
      });
    }
  }

  private requestRenderBuffer() {
    logger.debug('Requesting render buffer update');
    this.queueRenderOperation(() => {
      logger.debug('Executing render operation');
      this.renderBuffer();
    });
  }

  private async processOperationQueue(): Promise<void> {
    const startTime = performance.now();
    const MAX_FRAME_TIME = 8; // Target ~120fps, yield more frequently for better touch responsiveness

    // Process queued operations, but yield periodically
    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (operation) {
        await operation();
      }

      // Check if we've been running too long
      if (performance.now() - startTime > MAX_FRAME_TIME && this.operationQueue.length > 0) {
        // Still have more operations, yield control and continue in next frame
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            this.processOperationQueue().then(resolve);
          });
        });
        return; // Exit early to let browser process events
      }
    }

    // All operations complete, render the buffer
    this.renderBuffer();

    // Clear renderPending flag when truly done
    if (this.operationQueue.length === 0) {
      this.renderPending = false;
    }
  }

  private themeObserver?: MutationObserver;

  connectedCallback() {
    const prefs = TerminalPreferencesManager.getInstance();
    this.theme = prefs.getTheme();
    super.connectedCallback();

    // Check for debug mode
    this.debugMode = new URLSearchParams(window.location.search).has('debug');

    // Watch for theme changes (only when using auto theme)
    this.themeObserver = new MutationObserver(() => {
      if (this.terminal && this.theme === 'auto') {
        logger.debug('Auto theme detected system change, updating terminal');
        this.terminal.options.theme = this.getTerminalTheme();
        this.updateTerminalColorProperties(this.getTerminalTheme());
        this.requestRenderBuffer();
      } else if (this.theme !== 'auto') {
        logger.debug('Ignoring system theme change - explicit theme selected:', this.theme);
      }
    });

    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Restore user override preference if we have a sessionId
    if (this.sessionId) {
      try {
        const stored = localStorage.getItem(`terminal-width-override-${this.sessionId}`);
        if (stored !== null) {
          this.userOverrideWidth = stored === 'true';
        }
      } catch (error) {
        // localStorage might be unavailable (e.g., private browsing mode)
        logger.warn('Failed to load terminal width preference from localStorage:', error);
      }
    }
  }

  updated(changedProperties: PropertyValues) {
    // Load user width override preference when sessionId changes
    if (changedProperties.has('sessionId') && this.sessionId) {
      try {
        const stored = localStorage.getItem(`terminal-width-override-${this.sessionId}`);
        if (stored !== null) {
          this.userOverrideWidth = stored === 'true';
          // Apply the loaded preference immediately
          if (this.container) {
            this.requestResize('property-change');
          }
        }
      } catch (error) {
        // localStorage might be unavailable (e.g., private browsing mode)
        logger.warn('Failed to load terminal width preference from localStorage:', error);
      }
    }

    if (changedProperties.has('cols') || changedProperties.has('rows')) {
      if (this.terminal && !this.explicitSizeSet) {
        this.reinitializeTerminal();
      }
      // Reset the flag after processing
      this.explicitSizeSet = false;
    }
    if (changedProperties.has('fontSize')) {
      // Store original font size when it changes (but not during horizontal fitting)
      if (!this.fitHorizontally) {
        this.originalFontSize = this.fontSize;
      }
      // Recalculate terminal dimensions when font size changes
      if (this.terminal && this.container) {
        this.requestResize('property-change');
      }
    }
    if (changedProperties.has('fitHorizontally')) {
      if (!this.fitHorizontally) {
        // Restore original font size when turning off horizontal fitting
        this.fontSize = this.originalFontSize;
      }
      this.requestResize('property-change');
    }
    // If maxCols changed, trigger a resize
    if (changedProperties.has('maxCols')) {
      if (this.terminal && this.container) {
        this.requestResize('property-change');
      }
    }

    if (changedProperties.has('theme')) {
      logger.debug('Terminal theme changed to:', this.theme);
      if (this.terminal?.options) {
        const resolvedTheme = this.getTerminalTheme();
        logger.debug('Applying terminal theme:', this.theme);
        this.terminal.options.theme = resolvedTheme;

        // Update CSS custom properties for terminal colors
        this.updateTerminalColorProperties(resolvedTheme);

        // Force complete HTML regeneration to pick up new colors
        if (this.container) {
          // Clear the container first
          this.container.innerHTML = '';
        }

        // Force immediate buffer re-render with new colors
        this.requestRenderBuffer();
      } else {
        logger.warn('No terminal instance found for theme update');
      }
    }
  }

  disconnectedCallback() {
    this.cleanup();
    if (this.themeObserver) {
      this.themeObserver.disconnect();
    }
    super.disconnectedCallback();
  }

  // Method to set user override when width is manually selected
  setUserOverrideWidth(override: boolean) {
    this.userOverrideWidth = override;

    // Reset mobile width resize complete flag when user manually changes width
    // This allows the new width to be applied
    if (this.isMobile && override) {
      this.mobileWidthResizeComplete = false;
      logger.debug('[Terminal] Mobile: Resetting width resize block for user-initiated change');
    }

    // Persist the preference
    if (this.sessionId) {
      try {
        localStorage.setItem(`terminal-width-override-${this.sessionId}`, String(override));
      } catch (error) {
        // localStorage might be unavailable or quota exceeded
        logger.warn('Failed to save terminal width preference to localStorage:', error);
      }
    }
    // Trigger a resize to apply the new setting
    if (this.container) {
      this.requestResize('property-change');
    }
  }

  private cleanup() {
    // Stop momentum animation
    if (this.momentumAnimation) {
      cancelAnimationFrame(this.momentumAnimation);
      this.momentumAnimation = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.pendingResize) {
      cancelAnimationFrame(this.pendingResize);
      this.pendingResize = null;
    }

    if (this.mobileInitialResizeTimeout) {
      clearTimeout(this.mobileInitialResizeTimeout);
      this.mobileInitialResizeTimeout = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }
  }

  firstUpdated() {
    // Store the initial font size as original
    this.originalFontSize = this.fontSize;

    // Initialize terminal immediately

    this.initializeTerminal();
  }

  private requestResize(source: string) {
    // Update mobile state using window width for consistency with app.ts
    // This ensures Chrome mobile simulation works correctly
    const MOBILE_BREAKPOINT = 768; // Same as BREAKPOINTS.MOBILE
    this.isMobile = window.innerWidth < MOBILE_BREAKPOINT;

    logger.debug(
      `[Terminal] Resize requested from ${source} (mobile: ${this.isMobile}, width: ${window.innerWidth})`
    );

    // Cancel any pending resize
    if (this.pendingResize) {
      cancelAnimationFrame(this.pendingResize);
    }

    // Schedule resize for next animation frame
    this.pendingResize = requestAnimationFrame(() => {
      this.fitTerminal(source);
      this.pendingResize = null;
    });
  }

  private shouldResize(cols: number, rows: number): boolean {
    // On mobile, prevent WIDTH changes after initial setup, but allow HEIGHT changes
    // Exception: Allow width changes when user has manually selected a width through settings
    if (this.isMobile && this.mobileWidthResizeComplete && !this.userOverrideWidth) {
      // Check if only height changed (allow keyboard resizes)
      const widthChanged = this.lastCols !== cols;
      const heightChanged = this.lastRows !== rows;

      if (widthChanged) {
        logger.debug(`[Terminal] Preventing WIDTH resize on mobile (width already set)`);
        return false;
      }

      if (heightChanged) {
        logger.debug(
          `[Terminal] Allowing HEIGHT resize on mobile: ${this.lastRows} → ${rows} rows`
        );
        this.lastRows = rows;
        return true;
      }

      return false;
    }

    // Check if dimensions actually changed
    const changed = this.lastCols !== cols || this.lastRows !== rows;

    if (changed) {
      logger.debug(
        `[Terminal] Dimensions changed: ${this.lastCols}x${this.lastRows} → ${cols}x${rows}`
      );
      this.lastCols = cols;
      this.lastRows = rows;

      // Mark mobile WIDTH resize as complete after first resize
      if (this.isMobile && !this.mobileWidthResizeComplete) {
        this.mobileWidthResizeComplete = true;
        logger.debug(`[Terminal] Mobile WIDTH resize complete - blocking future width changes`);
      }
    }

    return changed;
  }

  private getTerminalTheme() {
    let themeId = this.theme;

    if (themeId === 'auto') {
      themeId = getCurrentTheme();
    }

    const preset = TERMINAL_THEMES.find((t) => t.id === themeId) || TERMINAL_THEMES[0];
    return { ...preset.colors };
  }

  /**
   * Updates CSS custom properties for terminal colors based on theme
   * This allows the already-rendered HTML to immediately pick up new colors
   */
  private updateTerminalColorProperties(themeColors: Record<string, string>) {
    logger.debug('Updating terminal CSS color properties');

    // Standard 16 colors mapping from XTerm.js theme to CSS custom properties
    const colorMapping = {
      black: 0,
      red: 1,
      green: 2,
      yellow: 3,
      blue: 4,
      magenta: 5,
      cyan: 6,
      white: 7,
      brightBlack: 8,
      brightRed: 9,
      brightGreen: 10,
      brightYellow: 11,
      brightBlue: 12,
      brightMagenta: 13,
      brightCyan: 14,
      brightWhite: 15,
    };

    // Update the CSS custom properties
    Object.entries(colorMapping).forEach(([colorName, colorIndex]) => {
      if (themeColors[colorName]) {
        const cssProperty = `--terminal-color-${colorIndex}`;
        document.documentElement.style.setProperty(cssProperty, themeColors[colorName]);
        logger.debug(`Set CSS property ${cssProperty}:`, themeColors[colorName]);
      }
    });

    // Update main terminal foreground and background colors
    if (themeColors.foreground) {
      document.documentElement.style.setProperty('--terminal-foreground', themeColors.foreground);
      logger.debug('Set terminal foreground color:', themeColors.foreground);
    }
    if (themeColors.background) {
      document.documentElement.style.setProperty('--terminal-background', themeColors.background);
      logger.debug('Set terminal background color:', themeColors.background);
    }

    logger.debug('CSS terminal color properties updated');
  }

  private async initializeTerminal() {
    try {
      logger.debug('initializeTerminal starting');
      this.requestUpdate();

      this.container = this.querySelector(`#${TERMINAL_IDS.TERMINAL_CONTAINER}`) as HTMLElement;

      if (!this.container) {
        const error = new Error('Terminal container not found');
        logger.error('terminal container not found', error);
        throw error;
      }

      logger.debug('Terminal container found, proceeding with setup');

      await this.setupTerminal();
      this.setupResize();
      this.setupScrolling();

      // Ensure terminal starts at the top
      this.viewportY = 0;
      if (this.terminal) {
        this.terminal.scrollToTop();
      }

      this.requestUpdate();
    } catch (error: unknown) {
      logger.error('failed to initialize terminal:', error);
      this.requestUpdate();
    }
  }

  private async reinitializeTerminal() {
    if (this.terminal) {
      // Force layout/reflow so container gets its proper height
      if (this.container) {
        // Force layout reflow by accessing offsetHeight
        void this.container.offsetHeight;
      }

      // Ensure cols and rows are valid numbers before resizing
      const safeCols = Number.isFinite(this.cols) ? Math.floor(this.cols) : 80;
      const safeRows = Number.isFinite(this.rows) ? Math.floor(this.rows) : 24;
      this.terminal.resize(safeCols, safeRows);
      this.requestResize('property-change');
    }
  }

  private async setupTerminal() {
    try {
      // Create regular terminal but don't call .open() to make it headless
      this.terminal = new XtermTerminal({
        cursorBlink: true,
        cursorStyle: 'block',
        cursorWidth: 1,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 10000,
        allowProposedApi: true,
        allowTransparency: false,
        convertEol: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 1,
        macOptionIsMeta: true,
        altClickMovesCursor: true,
        rightClickSelectsWord: false,
        wordSeparator: ' ()[]{}\'"`',
        theme: this.getTerminalTheme(),
      });

      // Set terminal size - don't call .open() to keep it headless
      this.terminal.resize(this.cols, this.rows);

      // Force initial render of the buffer
      this.requestRenderBuffer();
    } catch (error) {
      logger.error('failed to create terminal:', error);
      throw error;
    }
  }

  private measureCharacterWidth(): number {
    if (!this.container) return 8;

    // Create temporary element with same styles as terminal content, attached to container
    const measureEl = document.createElement('div');
    measureEl.className = 'terminal-line';
    measureEl.style.position = 'absolute';
    measureEl.style.visibility = 'hidden';
    measureEl.style.top = '0';
    measureEl.style.left = '0';
    measureEl.style.fontSize = `${this.fontSize}px`;
    measureEl.style.fontFamily = 'Hack Nerd Font Mono, Fira Code, monospace';

    // Use a mix of characters that represent typical terminal content
    const testString =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const repeatCount = Math.ceil(this.cols / testString.length);
    const testContent = testString.repeat(repeatCount).substring(0, this.cols);
    measureEl.textContent = testContent;

    // Attach to container so it inherits all the proper CSS context
    this.container.appendChild(measureEl);
    const measureRect = measureEl.getBoundingClientRect();
    const actualCharWidth = measureRect.width / this.cols;
    this.container.removeChild(measureEl);

    // Ensure we return a valid number
    return Number.isFinite(actualCharWidth) && actualCharWidth > 0 ? actualCharWidth : 8;
  }

  private fitTerminal(source?: string) {
    if (!this.terminal || !this.container) {
      logger.warn('[Terminal] Cannot fit terminal: terminal or container not initialized');
      return;
    }

    const timestamp = Date.now();
    const timeSinceLastFit = this._lastFitTime ? timestamp - this._lastFitTime : 0;
    this._lastFitTime = timestamp;

    logger.debug(`[Terminal] 📱 fitTerminal called`, {
      source: source || 'unknown',
      isMobile: this.isMobile,
      windowWidth: window.innerWidth,
      timeSinceLastFit,
      cols: this.cols,
      rows: this.rows,
      actualRows: this.actualRows,
      bufferLength: this.terminal.buffer.active.length,
    });

    // Use the class property instead of rechecking
    if (this.isMobile) {
      logger.debug(
        `[Terminal] Mobile detected in fitTerminal - source: ${source}, userAgent: ${navigator.userAgent}`
      );
    }

    const _oldActualRows = this.actualRows;
    const oldLineHeight = this.fontSize * 1.2;
    const wasAtBottom = this.isScrolledToBottom();

    // Calculate current scroll position in terms of content lines (before any changes)
    const currentScrollLines = oldLineHeight > 0 ? this.viewportY / oldLineHeight : 0;

    if (this.fitHorizontally) {
      // Horizontal fitting: calculate fontSize to fit this.cols characters in container width
      const containerWidth = this.container.clientWidth;
      const containerHeight = this.container.clientHeight;
      const targetCharWidth = containerWidth / this.cols;

      // Calculate fontSize needed for target character width
      // Use current font size as starting point and measure actual character width
      const currentCharWidth = this.measureCharacterWidth();
      const scaleFactor = targetCharWidth / currentCharWidth;
      const calculatedFontSize = this.fontSize * scaleFactor;
      const newFontSize = Math.max(4, Math.min(32, calculatedFontSize));

      this.fontSize = newFontSize;

      // Also fit rows to use full container height with the new font size
      const lineHeight = this.fontSize * 1.2;
      const fittedRows = Math.max(1, Math.floor(containerHeight / lineHeight));

      // Update both actualRows and the terminal's actual row count
      this.actualRows = fittedRows;
      this.rows = fittedRows;

      // Resize the terminal to the new dimensions
      if (this.terminal) {
        // Ensure cols and rows are valid numbers before resizing
        const safeCols = Number.isFinite(this.cols) ? Math.floor(this.cols) : 80;
        const safeRows = Number.isFinite(this.rows) ? Math.floor(this.rows) : 24;

        // Save old dimensions before shouldResize updates them
        const oldCols = this.lastCols;
        const oldRows = this.lastRows;

        // Use resize coordinator to check if we should actually resize
        if (this.shouldResize(safeCols, safeRows)) {
          logger.debug(`Resizing terminal (${source || 'unknown'}): ${safeCols}x${safeRows}`);
          this.terminal.resize(safeCols, safeRows);

          // Dispatch resize event for backend synchronization
          // Include mobile flag and whether this is height-only change
          const isWidthChange = safeCols !== oldCols;
          const isHeightOnlyChange = !isWidthChange && safeRows !== oldRows;

          this.dispatchEvent(
            new CustomEvent('terminal-resize', {
              detail: {
                cols: safeCols,
                rows: safeRows,
                isMobile: this.isMobile,
                isHeightOnlyChange,
                source: source || 'unknown',
              },
              bubbles: true,
            })
          );
        } else {
          logger.debug(`Skipping resize (${source || 'unknown'}): dimensions unchanged`);
        }
      }
    } else {
      // Normal mode: calculate both cols and rows based on container size
      const containerWidth = this.container.clientWidth || 800; // Default width if container not ready
      const containerHeight = this.container.clientHeight || 600; // Default height if container not ready
      const lineHeight = this.fontSize * 1.2;
      const charWidth = this.measureCharacterWidth();

      // Ensure charWidth is valid before division
      const safeCharWidth = Number.isFinite(charWidth) && charWidth > 0 ? charWidth : 8; // Default char width
      // Subtract 1 to prevent horizontal scrollbar due to rounding/border issues
      const calculatedCols = Math.max(20, Math.floor(containerWidth / safeCharWidth)) - 1;

      // Apply constraints in order of priority:
      // 1. If user has manually selected a specific width (maxCols > 0), use that as the limit
      // 2. If user has explicitly selected "unlimited" (maxCols = 0 with userOverrideWidth), use full width
      // 3. For tunneled sessions (fwd_*), if we have initial dimensions and no user override, limit to initial width
      // 4. Otherwise, use calculated width (unlimited)

      // Check if this is a tunneled session (from vt command)
      const isTunneledSession = this.sessionId.startsWith('fwd_');

      if (this.maxCols > 0) {
        // User has manually selected a specific width limit
        this.cols = Math.min(calculatedCols, this.maxCols);
      } else if (this.userOverrideWidth) {
        // User has explicitly selected "unlimited" - use full width
        this.cols = calculatedCols;
      } else if (this.initialCols > 0 && isTunneledSession) {
        // Only apply initial width restriction for tunneled sessions
        this.cols = Math.min(calculatedCols, this.initialCols);
      } else {
        // No constraints - use full width (for frontend-created sessions or sessions without initial dimensions)
        this.cols = calculatedCols;
      }
      this.rows = Math.max(6, Math.floor(containerHeight / lineHeight));
      this.actualRows = this.rows;

      // Resize the terminal to the new dimensions
      if (this.terminal) {
        // Ensure cols and rows are valid numbers before resizing
        const safeCols = Number.isFinite(this.cols) ? Math.floor(this.cols) : 80;
        const safeRows = Number.isFinite(this.rows) ? Math.floor(this.rows) : 24;

        // Save old dimensions before shouldResize updates them
        const oldCols = this.lastCols;
        const oldRows = this.lastRows;

        // Use resize coordinator to check if we should actually resize
        if (this.shouldResize(safeCols, safeRows)) {
          logger.debug(`Resizing terminal (${source || 'unknown'}): ${safeCols}x${safeRows}`);
          this.terminal.resize(safeCols, safeRows);

          // Dispatch resize event for backend synchronization
          // Include mobile flag and whether this is height-only change
          const isWidthChange = safeCols !== oldCols;
          const isHeightOnlyChange = !isWidthChange && safeRows !== oldRows;

          this.dispatchEvent(
            new CustomEvent('terminal-resize', {
              detail: {
                cols: safeCols,
                rows: safeRows,
                isMobile: this.isMobile,
                isHeightOnlyChange,
                source: source || 'unknown',
              },
              bubbles: true,
            })
          );
        } else {
          logger.debug(`Skipping resize (${source || 'unknown'}): dimensions unchanged`);
        }
      }
    }

    // Recalculate viewportY based on new lineHeight and actualRows
    if (this.terminal) {
      const buffer = this.terminal.buffer.active;
      const newLineHeight = this.fontSize * 1.2;
      const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * newLineHeight);

      if (wasAtBottom) {
        // If we were at bottom, stay at bottom with new constraints
        this.viewportY = maxScrollPixels;
      } else {
        // Convert the scroll position from old lineHeight to new lineHeight
        const newViewportY = currentScrollLines * newLineHeight;
        const clampedY = Math.max(0, Math.min(maxScrollPixels, newViewportY));
        this.viewportY = clampedY;
      }
    }

    // Always trigger a render after fit changes
    this.requestRenderBuffer();
    this.requestUpdate();
  }

  private setupResize() {
    if (!this.container) return;

    // Set the class property using window width for consistency with app.ts
    const MOBILE_BREAKPOINT = 768; // Same as BREAKPOINTS.MOBILE
    this.isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    logger.debug(
      `[Terminal] Setting up resize - isMobile: ${this.isMobile}, width: ${window.innerWidth}, userAgent: ${navigator.userAgent}`
    );

    if (this.isMobile) {
      // On mobile: Do initial resize to set width, then allow HEIGHT changes only (for keyboard)
      logger.debug('[Terminal] Mobile detected - scheduling initial resize in 200ms');
      this.mobileInitialResizeTimeout = setTimeout(() => {
        logger.debug('[Terminal] Mobile: Executing initial resize');
        this.fitTerminal('initial-mobile-only');
        // That's it - no observers, no event listeners, nothing
        logger.debug(
          '[Terminal] Mobile: Initial width set, future WIDTH resizes blocked (height allowed for keyboard)'
        );
        this.mobileInitialResizeTimeout = null; // Clear reference after execution
      }, 200);
    } else {
      // Desktop: Normal resize handling with observers
      logger.debug('[Terminal] Desktop detected - setting up resize observers');
      this.resizeObserver = new ResizeObserver(() => {
        logger.debug('[Terminal] ResizeObserver triggered');
        this.requestResize('ResizeObserver');
      });
      this.resizeObserver.observe(this.container);

      window.addEventListener('resize', () => {
        logger.debug('[Terminal] Window resize event triggered');
        this.requestResize('window-resize');
      });

      // Desktop: immediate initial resize
      logger.debug('[Terminal] Desktop: Requesting initial resize');
      this.requestResize('initial-desktop');
    }
  }

  private setupScrolling() {
    if (!this.container) return;

    // Handle wheel events with pixel-based scrolling (both vertical and horizontal)
    this.container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();

        const lineHeight = this.fontSize * 1.2;
        let deltaPixelsY = 0;
        let deltaPixelsX = 0;

        // Convert wheel deltas to pixels based on deltaMode
        switch (e.deltaMode) {
          case WheelEvent.DOM_DELTA_PIXEL:
            // Already in pixels
            deltaPixelsY = e.deltaY;
            deltaPixelsX = e.deltaX;
            break;
          case WheelEvent.DOM_DELTA_LINE:
            // Convert lines to pixels
            deltaPixelsY = e.deltaY * lineHeight;
            deltaPixelsX = e.deltaX * lineHeight;
            break;
          case WheelEvent.DOM_DELTA_PAGE:
            // Convert pages to pixels (assume page = viewport height)
            deltaPixelsY = e.deltaY * (this.actualRows * lineHeight);
            deltaPixelsX = e.deltaX * (this.actualRows * lineHeight);
            break;
        }

        // Apply scaling for comfortable scrolling speed
        const scrollScale = 0.5;
        deltaPixelsY *= scrollScale;
        deltaPixelsX *= scrollScale;

        // Apply vertical scrolling (our custom pixel-based)
        if (Math.abs(deltaPixelsY) > 0) {
          this.scrollViewportPixels(deltaPixelsY);
        }

        // Apply horizontal scrolling (native browser scrollLeft) - only if not in horizontal fit mode
        if (Math.abs(deltaPixelsX) > 0 && !this.fitHorizontally && this.container) {
          this.container.scrollLeft += deltaPixelsX;
        }
      },
      { passive: false }
    );

    // Touch scrolling with momentum
    let isScrolling = false;
    let lastY = 0;
    let lastX = 0;
    let touchHistory: Array<{ y: number; x: number; time: number }> = [];

    const handlePointerDown = (e: PointerEvent) => {
      // Only handle touch pointers, not mouse
      if (e.pointerType !== 'touch' || !e.isPrimary) return;

      // Stop any existing momentum
      if (this.momentumAnimation) {
        cancelAnimationFrame(this.momentumAnimation);
        this.momentumAnimation = null;
      }

      isScrolling = false;
      lastY = e.clientY;
      lastX = e.clientX;

      // Initialize touch tracking
      touchHistory = [{ y: e.clientY, x: e.clientX, time: performance.now() }];

      // Capture the pointer so we continue to receive events even if DOM rebuilds
      this.container?.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Only handle touch pointers that we have captured
      if (e.pointerType !== 'touch' || !this.container?.hasPointerCapture(e.pointerId)) return;

      const currentY = e.clientY;
      const currentX = e.clientX;
      const deltaY = lastY - currentY; // Positive = scroll down, negative = scroll up
      const deltaX = lastX - currentX; // Positive = scroll right, negative = scroll left

      // Track touch history for velocity calculation (keep last 5 points)
      const now = performance.now();
      touchHistory.push({ y: currentY, x: currentX, time: now });
      if (touchHistory.length > 5) {
        touchHistory.shift();
      }

      // Start scrolling if we've moved more than a few pixels
      if (!isScrolling && (Math.abs(deltaY) > 5 || Math.abs(deltaX) > 5)) {
        isScrolling = true;
      }

      if (!isScrolling) return;

      // Vertical scrolling (our custom pixel-based)
      if (Math.abs(deltaY) > 0) {
        this.scrollViewportPixels(deltaY);
        lastY = currentY;
      }

      // Horizontal scrolling (native browser scrollLeft) - only if not in horizontal fit mode
      if (Math.abs(deltaX) > 0 && !this.fitHorizontally) {
        this.container.scrollLeft += deltaX;
        lastX = currentX;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      // Only handle touch pointers
      if (e.pointerType !== 'touch') return;

      // Calculate momentum if we were scrolling
      if (isScrolling && touchHistory.length >= 2) {
        const now = performance.now();
        const recent = touchHistory[touchHistory.length - 1];
        const older = touchHistory[touchHistory.length - 2];

        const timeDiff = now - older.time;
        const distanceY = recent.y - older.y;
        const distanceX = recent.x - older.x;

        // Calculate velocity in pixels per millisecond
        const velocityY = timeDiff > 0 ? -distanceY / timeDiff : 0; // Negative for scroll direction
        const velocityX = timeDiff > 0 ? -distanceX / timeDiff : 0;

        // Start momentum if velocity is above threshold
        const minVelocity = 0.3; // pixels per ms
        if (Math.abs(velocityY) > minVelocity || Math.abs(velocityX) > minVelocity) {
          this.startMomentum(velocityY, velocityX);
        }
      }

      // Release pointer capture
      this.container?.releasePointerCapture(e.pointerId);
    };

    const handlePointerCancel = (e: PointerEvent) => {
      // Only handle touch pointers
      if (e.pointerType !== 'touch') return;

      // Release pointer capture
      this.container?.releasePointerCapture(e.pointerId);
    };

    // Attach pointer events to the container (touch only)
    this.container.addEventListener('pointerdown', handlePointerDown);
    this.container.addEventListener('pointermove', handlePointerMove);
    this.container.addEventListener('pointerup', handlePointerUp);
    this.container.addEventListener('pointercancel', handlePointerCancel);
  }

  private scrollViewportPixels(deltaPixels: number) {
    if (!this.terminal) return;

    const buffer = this.terminal.buffer.active;
    const lineHeight = this.fontSize * 1.2;
    const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * lineHeight);

    const newViewportY = Math.max(0, Math.min(maxScrollPixels, this.viewportY + deltaPixels));

    // Only render if we actually moved
    if (newViewportY !== this.viewportY) {
      this.viewportY = newViewportY;

      // Update follow cursor state based on scroll position
      this.updateFollowCursorState();
      this.requestRenderBuffer();
    }
  }

  private startMomentum(velocityY: number, velocityX: number) {
    // Store momentum velocities
    this.momentumVelocityY = velocityY * 16; // Convert from pixels/ms to pixels/frame (assuming 60fps)
    this.momentumVelocityX = velocityX * 16;

    // Cancel any existing momentum
    if (this.momentumAnimation) {
      cancelAnimationFrame(this.momentumAnimation);
    }

    // Start momentum animation
    this.animateMomentum();
  }

  private animateMomentum() {
    const minVelocity = 0.1; // Stop when velocity gets very small
    const decayFactor = 0.92; // Exponential decay per frame

    // Apply current velocity to scroll position
    const deltaY = this.momentumVelocityY;
    const deltaX = this.momentumVelocityX;

    let scrolled = false;

    // Apply vertical momentum
    if (Math.abs(deltaY) > minVelocity) {
      const buffer = this.terminal?.buffer.active;
      if (buffer) {
        const lineHeight = this.fontSize * 1.2;
        const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * lineHeight);
        const newViewportY = Math.max(0, Math.min(maxScrollPixels, this.viewportY + deltaY));

        if (newViewportY !== this.viewportY) {
          this.viewportY = newViewportY;
          scrolled = true;

          // Update follow cursor state for momentum scrolling too
          this.updateFollowCursorState();
        } else {
          // Hit boundary, stop vertical momentum
          this.momentumVelocityY = 0;
        }
      }
    }

    // Apply horizontal momentum (only if not in horizontal fit mode)
    if (Math.abs(deltaX) > minVelocity && !this.fitHorizontally && this.container) {
      const newScrollLeft = this.container.scrollLeft + deltaX;
      this.container.scrollLeft = newScrollLeft;
      scrolled = true;
    }

    // Decay velocities
    this.momentumVelocityY *= decayFactor;
    this.momentumVelocityX *= decayFactor;

    // Continue animation if velocities are still significant
    if (
      Math.abs(this.momentumVelocityY) > minVelocity ||
      Math.abs(this.momentumVelocityX) > minVelocity
    ) {
      this.momentumAnimation = requestAnimationFrame(() => {
        this.animateMomentum();
      });

      // Render if we scrolled - use direct call during momentum to avoid RAF conflicts
      if (scrolled) {
        this.renderBuffer();
      }
    } else {
      // Momentum finished
      this.momentumAnimation = null;
      this.momentumVelocityY = 0;
      this.momentumVelocityX = 0;
    }
  }

  private renderBuffer() {
    if (!this.terminal || !this.container) {
      logger.warn('renderBuffer called but missing terminal or container', {
        hasTerminal: !!this.terminal,
        hasContainer: !!this.container,
      });
      return;
    }

    logger.debug('renderBuffer executing');

    const startTime = this.debugMode ? performance.now() : 0;

    // Increment render count immediately
    if (this.debugMode) {
      this.renderCount++;
    }

    const buffer = this.terminal.buffer.active;
    const bufferLength = buffer.length;
    const lineHeight = this.fontSize * 1.2;

    // Convert pixel scroll position to fractional line position
    const startRowFloat = this.viewportY / lineHeight;
    const startRow = Math.floor(startRowFloat);
    const pixelOffset = (startRowFloat - startRow) * lineHeight;

    // Build complete innerHTML string
    let html = '';
    const cell = buffer.getNullCell();

    // Get cursor position
    const cursorX = this.terminal.buffer.active.cursorX;
    const cursorY = this.terminal.buffer.active.cursorY + this.terminal.buffer.active.viewportY;

    // Render exactly actualRows
    for (let i = 0; i < this.actualRows; i++) {
      const row = startRow + i;

      // Apply pixel offset to ALL lines for smooth scrolling
      const style = pixelOffset > 0 ? ` style="transform: translateY(-${pixelOffset}px);"` : '';

      if (row >= bufferLength) {
        html += `<div class="terminal-line"${style}></div>`;
        continue;
      }

      const line = buffer.getLine(row);
      if (!line) {
        html += `<div class="terminal-line"${style}></div>`;
        continue;
      }

      // Check if cursor is on this line (relative to viewport)
      const isCursorLine = row === cursorY;
      const lineContent = this.renderLine(
        line,
        cell,
        isCursorLine && this.cursorVisible ? cursorX : -1
      );

      html += `<div class="terminal-line"${style}>${lineContent || ''}</div>`;
    }

    // Set the complete innerHTML at once
    this.container.innerHTML = html;

    // Process links after rendering
    UrlHighlighter.processLinks(this.container);

    // Process keyboard shortcuts after rendering
    processKeyboardShortcuts(this.container, this.handleShortcutClick);

    // Track render performance in debug mode
    if (this.debugMode) {
      const endTime = performance.now();
      this.lastRenderTime = endTime - startTime;
      this.totalRenderTime += this.lastRenderTime;

      // Force component re-render to update debug overlay
      this.requestUpdate();
    }
  }

  private renderLine(line: IBufferLine, cell: IBufferCell, cursorCol: number = -1): string {
    let html = '';
    let currentChars = '';
    let currentClasses = '';
    let currentStyle = '';

    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const flushGroup = () => {
      if (currentChars) {
        const escapedChars = escapeHtml(currentChars);
        html += `<span class="${currentClasses}"${currentStyle ? ` style="${currentStyle}"` : ''}>${escapedChars}</span>`;
        currentChars = '';
      }
    };

    // Process each cell in the line
    for (let col = 0; col < line.length; col++) {
      line.getCell(col, cell);
      if (!cell) continue;

      // XTerm.js cell API - use || ' ' to ensure we get a space for empty cells
      const char = cell.getChars() || ' ';
      const width = cell.getWidth();

      // Skip zero-width cells (part of wide characters)
      if (width === 0) continue;

      // Get styling attributes
      let classes = 'terminal-char';
      let style = '';

      // Check if this is the cursor position
      const isCursor = col === cursorCol;
      if (isCursor) {
        classes += ' cursor';
      }

      // Get foreground color
      const fg = cell.getFgColor();
      if (fg !== undefined) {
        if (typeof fg === 'number' && fg >= 0 && fg <= 255) {
          // Standard palette color (0-255)
          style += `color: var(--terminal-color-${fg});`;
        } else if (typeof fg === 'number' && fg > 255) {
          // 24-bit RGB color - convert to CSS hex
          const r = (fg >> 16) & 0xff;
          const g = (fg >> 8) & 0xff;
          const b = fg & 0xff;
          style += `color: rgb(${r}, ${g}, ${b});`;
        }
      }

      // Get background color
      const bg = cell.getBgColor();
      if (bg !== undefined) {
        if (typeof bg === 'number' && bg >= 0 && bg <= 255) {
          // Standard palette color (0-255)
          style += `background-color: var(--terminal-color-${bg});`;
        } else if (typeof bg === 'number' && bg > 255) {
          // 24-bit RGB color - convert to CSS hex
          const r = (bg >> 16) & 0xff;
          const g = (bg >> 8) & 0xff;
          const b = bg & 0xff;
          style += `background-color: rgb(${r}, ${g}, ${b});`;
        }
      }

      // Get text attributes/flags
      const isBold = cell.isBold();
      const isItalic = cell.isItalic();
      const isUnderline = cell.isUnderline();
      const isDim = cell.isDim();
      const isInverse = cell.isInverse();
      const isInvisible = cell.isInvisible();
      const isStrikethrough = cell.isStrikethrough();
      const isOverline = cell.isOverline();

      if (isBold) classes += ' bold';
      if (isItalic) classes += ' italic';
      if (isUnderline) classes += ' underline';
      if (isDim) classes += ' dim';
      if (isStrikethrough) classes += ' strikethrough';
      if (isOverline) classes += ' overline';

      // Handle inverse colors
      if (isInverse) {
        // Swap foreground and background colors
        const tempFg = style.match(/color: ([^;]+);/)?.[1];
        const tempBg = style.match(/background-color: ([^;]+);/)?.[1];

        // Use theme colors as defaults
        const defaultFg = 'var(--terminal-foreground, #e4e4e4)';
        const defaultBg = 'var(--terminal-background, #0a0a0a)';

        // Determine actual foreground and background
        const actualFg = tempFg || defaultFg;
        const actualBg = tempBg || defaultBg;

        // Clear existing style and rebuild with swapped colors
        style = '';

        // Set swapped colors
        style += `color: ${actualBg};`;
        style += `background-color: ${actualFg};`;
      }

      // Apply cursor styling after inverse to ensure it takes precedence
      if (isCursor) {
        style += `background-color: rgb(var(--color-primary));`;
      }

      // Handle invisible text
      if (isInvisible) {
        style += 'opacity: 0;';
      }

      // Check if styling changed - if so, flush current group
      if (classes !== currentClasses || style !== currentStyle) {
        flushGroup();
        currentClasses = classes;
        currentStyle = style;
      }

      // Add character to current group
      currentChars += char;
    }

    // Flush final group
    flushGroup();

    return html;
  }

  /**
   * DOM Terminal Public API
   *
   * This component provides a DOM-based terminal renderer with XTerm.js backend.
   * All buffer-modifying operations are queued and executed in requestAnimationFrame
   * to ensure optimal batching and rendering performance.
   */

  // === BUFFER MODIFICATION METHODS (Queued) ===

  /**
   * Write data to the terminal buffer.
   * @param data - String data to write (supports ANSI escape sequences)
   * @param followCursor - If true, automatically scroll to keep cursor visible (default: true)
   */
  public write(data: string, followCursor: boolean = true) {
    if (!this.terminal) {
      logger.warn('Terminal.write called but no terminal instance exists');
      return;
    }

    // Only log significant writes on mobile
    if (this.isMobile && data.length > 100) {
      logger.debug(`[Terminal] 📱 Large write to terminal`, {
        sessionId: this.sessionId,
        dataLength: data.length,
        followCursor,
        bufferLength: this.terminal.buffer.active.length,
        scrollPosition: this._viewportY,
      });
    }

    // Check for cursor visibility sequences
    if (data.includes('\x1b[?25l')) {
      this.cursorVisible = false;
    }
    if (data.includes('\x1b[?25h')) {
      this.cursorVisible = true;
    }

    this.queueRenderOperation(async () => {
      if (!this.terminal) return;

      // XTerm.write() is async, wait for it to complete
      await new Promise<void>((resolve) => {
        if (this.terminal) {
          this.terminal.write(data, resolve);
        } else {
          resolve();
        }
      });

      // Follow cursor if requested
      if (followCursor && this.followCursorEnabled) {
        this.followCursor();
      }
    });
  }

  /**
   * Clear the terminal buffer and reset scroll position.
   */
  public clear() {
    if (!this.terminal) return;

    this.queueRenderOperation(() => {
      if (!this.terminal) return;

      this.terminal.clear();
      this.viewportY = 0;
    });
  }

  /**
   * Resize the terminal to specified dimensions.
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  public setTerminalSize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;

    if (!this.terminal) {
      // Don't set explicitSizeSet if terminal isn't ready
      // This allows reinitializeTerminal to run later when terminal is available
      return;
    }

    // Set flag to prevent auto-resize in updated() lifecycle
    // Only set this AFTER confirming terminal exists
    this.explicitSizeSet = true;

    this.queueRenderOperation(() => {
      if (!this.terminal) return;

      this.terminal.resize(cols, rows);
      // Don't call fitTerminal here - when explicitly setting size,
      // we shouldn't recalculate based on container dimensions
      this.requestUpdate();
    });
  }

  // === SCROLL CONTROL METHODS (Queued) ===

  /**
   * Scroll to the bottom of the buffer.
   */
  public scrollToBottom() {
    if (!this.terminal) return;

    this.queueRenderOperation(() => {
      if (!this.terminal) return;

      this.requestResize('property-change');

      const buffer = this.terminal.buffer.active;
      const lineHeight = this.fontSize * 1.2;
      // Use the same maxScrollPixels calculation as scrollViewportPixels
      const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * lineHeight);

      // Set programmatic scroll flag
      this.programmaticScroll = true;
      this.viewportY = maxScrollPixels;
      this.programmaticScroll = false;
    });
  }

  /**
   * Scroll to a specific position in the buffer.
   * @param position - Line position (0 = top, max = bottom)
   */
  public scrollToPosition(position: number) {
    if (!this.terminal) return;

    this.queueRenderOperation(() => {
      if (!this.terminal) return;

      const buffer = this.terminal.buffer.active;
      const lineHeight = this.fontSize * 1.2;
      const maxScrollLines = Math.max(0, buffer.length - this.actualRows);

      // Set programmatic scroll flag
      this.programmaticScroll = true;
      this.viewportY = Math.max(0, Math.min(maxScrollLines, position)) * lineHeight;
      this.programmaticScroll = false;
    });
  }

  /**
   * Queue a custom operation to be executed after the next render is complete.
   * Useful for actions that need to happen after terminal state is fully updated.
   * @param callback - Function to execute after render
   */
  public queueCallback(callback: () => void) {
    this.queueRenderOperation(callback);
  }

  // === QUERY METHODS (Immediate) ===
  // Note: These methods return current state immediately but may return stale data
  // if operations are pending in the RAF queue. For guaranteed fresh data, call
  // these methods inside queueCallback() to ensure they run after all operations complete.

  /**
   * Get terminal dimensions.
   * @returns Object with cols and rows
   * @note May return stale data if operations are pending. Use queueCallback() for fresh data.
   */
  public getTerminalSize(): { cols: number; rows: number } {
    return {
      cols: this.cols,
      rows: this.rows,
    };
  }

  /**
   * Get number of visible rows in the current viewport.
   * @returns Number of rows that fit in the viewport
   * @note May return stale data if operations are pending. Use queueCallback() for fresh data.
   */
  public getVisibleRows(): number {
    return this.actualRows;
  }

  /**
   * Get total number of lines in the scrollback buffer.
   * @returns Total lines in buffer
   * @note May return stale data if operations are pending. Use queueCallback() for fresh data.
   */
  public getBufferSize(): number {
    if (!this.terminal) return 0;
    return this.terminal.buffer.active.length;
  }

  /**
   * Get current scroll position.
   * @returns Current scroll position (0 = top)
   * @note May return stale data if operations are pending. Use queueCallback() for fresh data.
   */
  public getScrollPosition(): number {
    const lineHeight = this.fontSize * 1.2;
    return Math.round(this.viewportY / lineHeight);
  }

  /**
   * Get maximum possible scroll position.
   * @returns Maximum scroll position
   * @note May return stale data if operations are pending. Use queueCallback() for fresh data.
   */
  public getMaxScrollPosition(): number {
    if (!this.terminal) return 0;
    const buffer = this.terminal.buffer.active;
    return Math.max(0, buffer.length - this.actualRows);
  }

  /**
   * Check if the terminal is currently scrolled to the bottom.
   * @returns True if at bottom, false otherwise
   */
  private isScrolledToBottom(): boolean {
    if (!this.terminal) return true;

    const buffer = this.terminal.buffer.active;
    const lineHeight = this.fontSize * 1.2;
    const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * lineHeight);

    // Consider "at bottom" if within one line height of the bottom
    return this.viewportY >= maxScrollPixels - lineHeight;
  }

  /**
   * Update follow cursor state based on current scroll position.
   * Disable follow cursor when user scrolls away from bottom.
   * Re-enable when user scrolls back to bottom.
   */
  private updateFollowCursorState(): void {
    // Don't update state during programmatic scrolling
    if (this.programmaticScroll) return;

    const wasAtBottom = this.isScrolledToBottom();

    if (wasAtBottom && !this.followCursorEnabled) {
      // User scrolled back to bottom - re-enable follow cursor
      this.followCursorEnabled = true;
    } else if (!wasAtBottom && this.followCursorEnabled) {
      // User scrolled away from bottom - disable follow cursor
      this.followCursorEnabled = false;
    }
  }

  /**
   * Scroll the viewport to follow the cursor position.
   * This ensures the cursor stays visible during text input or playback.
   */
  private followCursor() {
    if (!this.terminal) return;

    const buffer = this.terminal.buffer.active;
    const cursorY = buffer.cursorY + buffer.viewportY; // Absolute cursor position in buffer
    const lineHeight = this.fontSize * 1.2;

    // Calculate what line the cursor is on
    const cursorLine = cursorY;

    // Calculate current viewport range in lines
    const viewportStartLine = Math.floor(this.viewportY / lineHeight);
    const viewportEndLine = viewportStartLine + this.actualRows - 1;

    // Set programmatic scroll flag to prevent state updates
    this.programmaticScroll = true;

    // If cursor is outside viewport, scroll to keep it visible
    if (cursorLine < viewportStartLine) {
      // Cursor is above viewport - scroll up
      this.viewportY = cursorLine * lineHeight;
    } else if (cursorLine > viewportEndLine) {
      // Cursor is below viewport - scroll down to show cursor at bottom of viewport
      this.viewportY = Math.max(0, (cursorLine - this.actualRows + 1) * lineHeight);
    }

    // Ensure we don't scroll past the buffer
    const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * lineHeight);
    this.viewportY = Math.min(this.viewportY, maxScrollPixels);

    // Clear programmatic scroll flag
    this.programmaticScroll = false;
  }

  /**
   * Handle click on scroll-to-bottom indicator
   */
  private handleScrollToBottom = () => {
    // Immediately enable follow cursor to hide the indicator
    this.followCursorEnabled = true;
    this.scrollToBottom();
    this.requestUpdate();
  };

  /**
   * Handle fit to width toggle
   */
  public handleFitToggle = () => {
    if (!this.terminal || !this.container) {
      this.fitHorizontally = !this.fitHorizontally;
      this.requestUpdate();
      return;
    }

    // Store current logical scroll position before toggling
    const buffer = this.terminal.buffer.active;
    const currentLineHeight = this.fontSize * 1.2;
    const currentScrollLines = currentLineHeight > 0 ? this.viewportY / currentLineHeight : 0;
    const wasAtBottom = this.isScrolledToBottom();

    // Store original font size when entering fit mode
    if (!this.fitHorizontally) {
      this.originalFontSize = this.fontSize;
    }

    // Toggle the mode
    this.fitHorizontally = !this.fitHorizontally;

    // Restore original font size when exiting fit mode
    if (!this.fitHorizontally) {
      this.fontSize = this.originalFontSize;
    }

    // Recalculate fit
    this.requestResize('fit-mode-change');

    // Restore scroll position - prioritize staying at bottom if we were there
    if (wasAtBottom) {
      // Force scroll to bottom with new dimensions
      this.scrollToBottom();
    } else {
      // Restore logical scroll position for non-bottom positions
      const newLineHeight = this.fontSize * 1.2;
      const maxScrollPixels = Math.max(0, (buffer.length - this.actualRows) * newLineHeight);
      const newViewportY = currentScrollLines * newLineHeight;
      this.viewportY = Math.max(0, Math.min(maxScrollPixels, newViewportY));
    }

    this.requestUpdate();
  };

  private handlePaste = async (e: ClipboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let clipboardData = e.clipboardData?.getData('text/plain');

    if (!clipboardData && navigator.clipboard) {
      try {
        clipboardData = await navigator.clipboard.readText();
      } catch (error) {
        logger.error('Failed to read clipboard via navigator API', error);
      }
    }

    if (clipboardData) {
      // Dispatch a custom event with the pasted text
      this.dispatchEvent(
        new CustomEvent('terminal-paste', {
          detail: { text: clipboardData },
          bubbles: true,
        })
      );
    }
  };

  private handleClick = () => {
    // Don't handle clicks if disabled (e.g., for mobile direct keyboard mode)
    if (this.disableClick) {
      return;
    }

    // Focus the terminal container so it can receive paste events
    if (this.container) {
      this.container.focus();
    }
  };

  private handleShortcutClick = (keySequence: string) => {
    // Dispatch a custom event with the keyboard shortcut
    this.dispatchEvent(
      new CustomEvent('terminal-input', {
        detail: { text: keySequence },
        bubbles: true,
      })
    );
  };

  render() {
    const terminalTheme = this.getTerminalTheme();
    const containerStyle = `
      view-transition-name: session-${this.sessionId};
      background-color: ${terminalTheme.background || 'var(--terminal-background, #0a0a0a)'};
      color: ${terminalTheme.foreground || 'var(--terminal-foreground, #e4e4e4)'};
    `;

    return html`
      <style>
        /* Dynamic terminal sizing */
        .terminal-container {
          font-size: ${this.fontSize}px;
          line-height: ${this.fontSize * 1.2}px;
          touch-action: none !important;
        }

        .terminal-line {
          height: ${this.fontSize * 1.2}px;
          line-height: ${this.fontSize * 1.2}px;
        }
      </style>
      <div class="relative w-full h-full p-0 m-0">
        <div
          id="${TERMINAL_IDS.TERMINAL_CONTAINER}"
          class="terminal-container w-full h-full overflow-hidden p-0 m-0"
          tabindex="0"
          contenteditable="false"
          style="${containerStyle}"
          @paste=${this.handlePaste}
          @click=${this.handleClick}
          data-testid="terminal-container"
        ></div>
        ${
          !this.followCursorEnabled && !this.hideScrollButton
            ? html`
              <div
                class="scroll-to-bottom"
                @click=${this.handleScrollToBottom}
                title="Scroll to bottom"
              >
                ↓
              </div>
            `
            : ''
        }
        ${
          this.debugMode
            ? html`
              <div class="debug-overlay">
                <div class="metric">
                  <span class="metric-label">Renders:</span>
                  <span class="metric-value">${this.renderCount}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">Avg:</span>
                  <span class="metric-value"
                    >${
                      this.renderCount > 0
                        ? (this.totalRenderTime / this.renderCount).toFixed(2)
                        : '0.00'
                    }ms</span
                  >
                </div>
                <div class="metric">
                  <span class="metric-label">Last:</span>
                  <span class="metric-value">${this.lastRenderTime.toFixed(2)}ms</span>
                </div>
              </div>
            `
            : ''
        }
      </div>
    `;
  }

  /**
   * Get cursor position information for IME input positioning
   * Returns null if terminal is not available or cursor is not visible
   */
  getCursorInfo(): { x: number; y: number } | null {
    if (!this.terminal) {
      return null;
    }

    // Get cursor position from xterm.js
    const buffer = this.terminal.buffer.active;
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY;

    // Find the terminal container element
    const container = this.querySelector(`#${TERMINAL_IDS.TERMINAL_CONTAINER}`);
    if (!container) {
      return null;
    }

    // Use shared cursor position calculation
    return calculateCursorPosition(cursorX, cursorY, this.fontSize, container, this.sessionStatus);
  }
}

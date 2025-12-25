/**
 * Terminal Component
 *
 * Browser terminal rendering + input via ghostty-web (WASM + canvas).
 *
 * @fires terminal-ready - When terminal is initialized and ready
 * @fires terminal-input - When user types (detail: { text: string })
 * @fires terminal-resize - When terminal is resized (detail: { cols: number, rows: number, isMobile: boolean, isHeightOnlyChange: boolean, source: string })
 */

import { FitAddon, Ghostty, Terminal as GhosttyTerminal } from 'ghostty-web';
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';
import { TERMINAL_FONT_FAMILY, TERMINAL_IDS } from '../utils/terminal-constants.js';
import { TerminalPreferencesManager } from '../utils/terminal-preferences.js';
import { TERMINAL_THEMES, type TerminalThemeId } from '../utils/terminal-themes.js';
import { getCurrentTheme } from '../utils/theme-utils.js';

const logger = createLogger('terminal');

let ghosttyPromise: Promise<Ghostty> | null = null;
async function ensureGhostty(): Promise<Ghostty> {
  if (!ghosttyPromise) ghosttyPromise = Ghostty.load('/ghostty-vt.wasm');
  return ghosttyPromise;
}

type TerminalResizeDetail = {
  cols: number;
  rows: number;
  isMobile: boolean;
  isHeightOnlyChange: boolean;
  source: string;
};

@customElement('vibe-terminal')
export class Terminal extends LitElement {
  createRenderRoot() {
    return this as unknown as HTMLElement;
  }

  @property({ type: String }) sessionId = '';
  @property({ type: String }) sessionStatus = 'running';
  @property({ type: Number }) cols = 80;
  @property({ type: Number }) rows = 24;
  @property({ type: Number }) fontSize = 14;
  @property({ type: Boolean }) fitHorizontally = false;
  @property({ type: Number }) maxCols = 0; // 0 = unlimited
  @property({ type: String }) theme: TerminalThemeId = 'auto';
  @property({ type: Boolean }) disableClick = false;
  @property({ type: Boolean }) hideScrollButton = false;
  @property({ type: Number }) initialCols = 0;
  @property({ type: Number }) initialRows = 0;

  private originalFontSize = 14;
  userOverrideWidth = false;

  @state() private followCursorEnabled = true;

  private container: HTMLElement | null = null;
  private terminal: GhosttyTerminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private pasteInput: HTMLTextAreaElement | null = null;
  private pendingOutput = '';
  private pendingFollowCursor = true;

  private isMobile = false;
  private mobileWidthResizeComplete = false;
  private lastCols = 0;
  private lastRows = 0;

  private pendingResizeSource: string | null = null;
  private pendingResizePrev: { cols: number; rows: number } | null = null;

  connectedCallback() {
    const prefs = TerminalPreferencesManager.getInstance();
    this.theme = prefs.getTheme();
    super.connectedCallback();

    this.originalFontSize = this.fontSize;
    // Make host focusable so browser shortcuts (Cmd/Ctrl+V) have a target.
    if (this.tabIndex < 0) this.tabIndex = 0;

    // Restore user override preference
    if (this.sessionId) {
      this.restoreUserOverrideWidthFromStorage(this.sessionId);
    }

    // Watch for system theme changes (only when using auto theme)
    this.themeObserver = new MutationObserver(() => {
      if (this.terminal && this.theme === 'auto') {
        this.applyTheme();
      }
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  disconnectedCallback() {
    this.cleanup();
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    super.disconnectedCallback();
  }

  firstUpdated() {
    this.pasteInput = this.querySelector('.terminal-paste-input') as HTMLTextAreaElement | null;
    this.initializeTerminal();
  }

  updated(changed: PropertyValues) {
    if (changed.has('sessionId') && this.sessionId) {
      this.restoreUserOverrideWidthFromStorage(this.sessionId);
      this.requestResize('session-id-change');
    }

    if (changed.has('fontSize')) {
      if (!this.fitHorizontally) this.originalFontSize = this.fontSize;
      this.applyFontSize();
      this.requestResize('font-size-change');
    }

    if (changed.has('fitHorizontally')) {
      if (!this.fitHorizontally) this.fontSize = this.originalFontSize;
      this.requestResize('fit-mode-change');
    }

    if (changed.has('maxCols') || changed.has('initialCols') || changed.has('disableClick')) {
      this.requestResize('property-change');
    }

    if (changed.has('theme')) {
      this.applyTheme();
    }
  }

  setUserOverrideWidth(override: boolean) {
    this.userOverrideWidth = override;
    if (this.isMobile && override) this.mobileWidthResizeComplete = false;

    if (this.sessionId) {
      try {
        localStorage.setItem(`terminal-width-override-${this.sessionId}`, String(override));
      } catch (error) {
        logger.warn('Failed to save terminal width preference to localStorage:', error);
      }
    }

    this.requestResize('user-override-width');
  }

  public handleFitToggle = () => {
    if (!this.fitHorizontally) this.originalFontSize = this.fontSize;
    this.fitHorizontally = !this.fitHorizontally;
    if (!this.fitHorizontally) this.fontSize = this.originalFontSize;
    this.requestResize('fit-toggle');
  };

  public write(data: string, followCursor = true) {
    if (!this.terminal) {
      this.pendingOutput += data;
      this.pendingFollowCursor = this.pendingFollowCursor && followCursor;
      return;
    }

    this.terminal.write(data, () => {
      if (followCursor && this.followCursorEnabled) {
        this.terminal?.scrollToBottom();
      }
    });
  }

  public clear() {
    this.terminal?.clear();
    this.followCursorEnabled = true;
  }

  public setTerminalSize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;

    if (!this.terminal) return;
    this.requestResizeMeta('explicit-set-size');
    this.terminal.resize(cols, rows);
  }

  public scrollToBottom() {
    this.terminal?.scrollToBottom();
  }

  public scrollToPosition(position: number) {
    if (!this.terminal) return;
    const max = this.getMaxScrollPosition();
    const clamped = Math.max(0, Math.min(max, Math.floor(position)));
    this.terminal.scrollToLine(clamped);
  }

  public queueCallback(callback: () => void) {
    requestAnimationFrame(() => callback());
  }

  public getTerminalSize(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  public getVisibleRows(): number {
    return this.rows;
  }

  public getBufferSize(): number {
    if (!this.terminal) return 0;
    return this.terminal.buffer.active.length;
  }

  public getMaxScrollPosition(): number {
    if (!this.terminal) return 0;
    return Math.max(0, this.terminal.buffer.active.length - this.terminal.rows);
  }

  public getScrollPosition(): number {
    if (!this.terminal) return 0;
    const max = this.getMaxScrollPosition();
    const viewportFromBottom = this.terminal.getViewportY();
    return Math.round(Math.max(0, Math.min(max, max - viewportFromBottom)));
  }

  // e2e-only debug API (canvas has no textContent)
  public getDebugText(options?: { maxLines?: number; trimRight?: boolean }): string {
    if (!this.terminal) return '';
    const maxLines = options?.maxLines ?? 250;
    const trimRight = options?.trimRight ?? true;

    const buffer = this.terminal.buffer.active;
    const end = buffer.length;
    const start = Math.max(0, end - maxLines);
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const line = buffer.getLine(i);
      lines.push(line ? line.translateToString(trimRight) : '');
    }
    return lines.join('\n');
  }

  private restoreUserOverrideWidthFromStorage(sessionId: string) {
    try {
      const stored = localStorage.getItem(`terminal-width-override-${sessionId}`);
      if (stored !== null) this.userOverrideWidth = stored === 'true';
    } catch (error) {
      logger.warn('Failed to load terminal width preference from localStorage:', error);
    }
  }

  private cleanup() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this.container = null;
    this.pasteInput = null;
  }

  private requestResize(source: string) {
    requestAnimationFrame(() => this.fitTerminal(source));
  }

  private requestResizeMeta(source: string) {
    this.pendingResizeSource = source;
    this.pendingResizePrev = { cols: this.lastCols || this.cols, rows: this.lastRows || this.rows };
  }

  private applyFontSize() {
    if (!this.terminal) return;
    this.terminal.options.fontSize = this.fontSize;
  }

  private getResolvedTheme() {
    const effectiveTheme = this.theme === 'auto' ? getCurrentTheme() : this.theme;
    const themeId: TerminalThemeId = effectiveTheme === 'dark' ? 'dark' : 'light';

    const selected =
      this.theme === 'auto'
        ? TERMINAL_THEMES.find((t) => t.id === themeId)
        : TERMINAL_THEMES.find((t) => t.id === this.theme);

    return selected?.colors ?? {};
  }

  private applyTheme() {
    if (!this.terminal) return;
    this.terminal.options.theme = this.getResolvedTheme();
  }

  private detectMobile() {
    const MOBILE_BREAKPOINT = 768;
    this.isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  }

  private applyHorizontalFit() {
    if (!this.terminal || !this.container) return;
    const renderer = this.terminal.renderer;
    if (!renderer) return;

    const metrics = renderer.getMetrics();
    const charWidth = metrics?.width || renderer.charWidth || 8;
    const containerWidth = this.container.clientWidth || 0;
    if (containerWidth <= 0 || charWidth <= 0 || this.cols <= 0) return;

    const targetCharWidth = containerWidth / this.cols;
    const scale = targetCharWidth / charWidth;
    const newFontSize = Math.max(8, Math.min(32, this.fontSize * scale));
    if (!Number.isFinite(newFontSize)) return;
    this.fontSize = newFontSize;
    this.terminal.options.fontSize = newFontSize;
  }

  private computeConstrainedCols(proposedCols: number): number {
    const calculatedCols = Math.max(20, Math.floor(proposedCols));
    const isTunneledSession = this.sessionId.startsWith('fwd_');

    if (this.maxCols > 0) return Math.min(calculatedCols, this.maxCols);
    if (this.userOverrideWidth) return calculatedCols;
    if (this.initialCols > 0 && isTunneledSession)
      return Math.min(calculatedCols, this.initialCols);
    return calculatedCols;
  }

  public fitTerminal(source = 'unknown') {
    if (!this.terminal || !this.fitAddon) return;
    this.detectMobile();

    if (this.fitHorizontally) {
      this.applyHorizontalFit();
    }

    const proposed = this.fitAddon.proposeDimensions();
    if (!proposed) return;

    let cols = this.computeConstrainedCols(proposed.cols);
    const rows = Math.max(6, Math.floor(proposed.rows));

    if (
      this.isMobile &&
      this.mobileWidthResizeComplete &&
      !this.userOverrideWidth &&
      this.lastCols
    ) {
      cols = this.lastCols;
    }

    const prevCols = this.lastCols || this.terminal.cols;
    const prevRows = this.lastRows || this.terminal.rows;

    if (cols === prevCols && rows === prevRows) return;

    this.requestResizeMeta(source);
    this.terminal.resize(cols, rows);

    if (this.isMobile) this.mobileWidthResizeComplete = true;
  }

  private async initializeTerminal() {
    if (this.terminal) return;

    this.container = this.querySelector(
      `#${TERMINAL_IDS.TERMINAL_CONTAINER}`
    ) as HTMLElement | null;
    if (!this.container) return;

    try {
      const ghostty = await ensureGhostty();

      const term = new GhosttyTerminal({
        cols: this.cols,
        rows: this.rows,
        fontSize: this.fontSize,
        fontFamily: TERMINAL_FONT_FAMILY,
        theme: this.getResolvedTheme(),
        cursorBlink: true,
        smoothScrollDuration: 120,
        disableStdin: true,
        ghostty,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.onData((text) => {
        this.dispatchEvent(new CustomEvent('terminal-input', { detail: { text }, bubbles: true }));
      });

      term.onResize(({ cols, rows }) => {
        const prev = this.pendingResizePrev ?? {
          cols: this.lastCols || cols,
          rows: this.lastRows || rows,
        };
        const source = this.pendingResizeSource ?? 'unknown';
        this.pendingResizePrev = null;
        this.pendingResizeSource = null;

        const isHeightOnlyChange = cols === prev.cols && rows !== prev.rows;

        this.lastCols = cols;
        this.lastRows = rows;
        this.cols = cols;
        this.rows = rows;

        const detail: TerminalResizeDetail = {
          cols,
          rows,
          isMobile: this.isMobile,
          isHeightOnlyChange,
          source,
        };

        this.dispatchEvent(new CustomEvent('terminal-resize', { detail, bubbles: true }));
      });

      term.onScroll(() => {
        const viewportFromBottom = term.getViewportY();
        this.followCursorEnabled = viewportFromBottom <= 0.5;
      });

      // Fresh mount
      this.container.innerHTML = '';
      term.open(this.container);

      this.terminal = term;
      this.fitAddon = fitAddon;

      if (this.pendingOutput) {
        const pending = this.pendingOutput;
        const followCursor = this.pendingFollowCursor;
        this.pendingOutput = '';
        this.pendingFollowCursor = true;
        this.terminal.write(pending, () => {
          if (followCursor && this.followCursorEnabled) {
            this.terminal?.scrollToBottom();
          }
        });
      }

      this.setAttribute('data-ready', 'true');

      // Initial fit after open
      this.requestResize('initial');

      this.dispatchEvent(new CustomEvent('terminal-ready', { bubbles: true }));

      // Observe container resizes
      this.resizeObserver = new ResizeObserver(() => this.requestResize('resize-observer'));
      this.resizeObserver.observe(this.container);
    } catch (error) {
      logger.error('failed to initialize ghostty terminal', error);
    }
  }

  private handleScrollToBottom = () => {
    this.followCursorEnabled = true;
    this.scrollToBottom();
  };

  private handleClick = () => {
    if (this.disableClick) return;
    this.focus();
    this.pasteInput?.focus();
    this.pasteInput?.select();
  };

  private handlePaste = (e: ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) return; // let file/image paste handlers run

    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();

    // Clear hidden textarea so it doesn't accumulate text
    if (this.pasteInput) this.pasteInput.value = '';

    this.dispatchEvent(new CustomEvent('terminal-paste', { detail: { text }, bubbles: true }));
  };

  render() {
    return html`
      <style>
        vibe-terminal {
          display: block;
          width: 100%;
          height: 100%;
        }
        .terminal-root {
          position: relative;
          width: 100%;
          height: 100%;
        }
        .terminal-container {
          width: 100%;
          height: 100%;
          overflow: hidden;
          font-family: ${TERMINAL_FONT_FAMILY};
        }
        .terminal-paste-input {
          position: absolute;
          left: -9999px;
          top: 0;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        }
        .scroll-to-bottom {
          position: absolute;
          right: 12px;
          bottom: 12px;
          z-index: 20;
        }
        .scroll-to-bottom button {
          font-family: ${TERMINAL_FONT_FAMILY};
          background: rgba(0, 0, 0, 0.55);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 10px;
          padding: 6px 10px;
        }
      </style>

      <div class="terminal-root" @click=${this.handleClick} @paste=${this.handlePaste}>
        <textarea
          class="terminal-paste-input"
          aria-hidden="true"
          tabindex="-1"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          @paste=${this.handlePaste}
        ></textarea>
        <div
          id=${TERMINAL_IDS.TERMINAL_CONTAINER}
          class="terminal-container"
          style="view-transition-name: session-${this.sessionId};"
        ></div>

        ${
          !this.hideScrollButton && !this.followCursorEnabled
            ? html`
              <div class="scroll-to-bottom">
                <button type="button" @click=${this.handleScrollToBottom}>Scroll</button>
              </div>
            `
            : null
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vibe-terminal': Terminal;
  }
}

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

interface TerminalLine {
  id: string;
  content: string;
  timestamp: number;
  type?: 'stdout' | 'stderr' | 'system';
}

/**
 * Virtual scrolling terminal output component for efficient rendering of large outputs.
 * Only renders visible lines plus a buffer for smooth scrolling.
 */
@customElement('virtual-terminal-output')
export class VirtualTerminalOutput extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--terminal-bg, #000);
      color: var(--terminal-fg, #0f0);
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.5;
    }

    .scroll-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .virtual-spacer {
      position: relative;
    }

    .viewport {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    }

    .terminal-line {
      height: 21px; /* line-height * font-size */
      padding: 0 8px;
      white-space: pre-wrap;
      word-break: break-all;
      position: absolute;
      width: 100%;
      box-sizing: border-box;
    }

    .terminal-line.stderr {
      color: var(--terminal-error, #f44);
    }

    .terminal-line.system {
      color: var(--terminal-system, #888);
      font-style: italic;
    }

    .terminal-line:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    /* Scrollbar styling */
    .scroll-container::-webkit-scrollbar {
      width: 12px;
    }

    .scroll-container::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
    }

    .scroll-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 6px;
    }

    .scroll-container::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Auto-scroll indicator */
    .auto-scroll-indicator {
      position: absolute;
      bottom: 16px;
      right: 16px;
      background: var(--accent);
      color: white;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .auto-scroll-indicator.hidden {
      opacity: 0;
    }
  `;

  @property({ type: Array })
  lines: TerminalLine[] = [];

  @property({ type: Number })
  maxLines = 10000;

  @property({ type: Boolean })
  autoScroll = true;

  @property({ type: Number })
  lineHeight = 21;

  @state()
  private _visibleStartIndex = 0;

  @state()
  private _visibleEndIndex = 50;

  @state()
  private _isAutoScrolling = true;

  @query('.scroll-container')
  private _scrollContainer!: HTMLDivElement;

  private _scrollTimeout?: number;
  private _resizeObserver?: ResizeObserver;
  private _overscan = 10; // Number of lines to render outside viewport

  override connectedCallback() {
    super.connectedCallback();
    
    // Set up resize observer to recalculate visible lines
    this._resizeObserver = new ResizeObserver(() => {
      this._calculateVisibleLines();
    });
  }

  override firstUpdated() {
    if (this._scrollContainer) {
      this._resizeObserver?.observe(this._scrollContainer);
      this._calculateVisibleLines();
      
      // Scroll to bottom if autoScroll is enabled
      if (this.autoScroll) {
        this._scrollToBottom();
      }
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    if (this._scrollTimeout) {
      clearTimeout(this._scrollTimeout);
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('lines') && this._isAutoScrolling && this.autoScroll) {
      // Use requestAnimationFrame for smooth auto-scrolling
      requestAnimationFrame(() => {
        this._scrollToBottom();
      });
    }
  }

  private _calculateVisibleLines() {
    if (!this._scrollContainer) return;

    const scrollTop = this._scrollContainer.scrollTop;
    const containerHeight = this._scrollContainer.clientHeight;
    
    // Calculate which lines are visible
    const startIndex = Math.max(0, Math.floor(scrollTop / this.lineHeight) - this._overscan);
    const endIndex = Math.min(
      this.lines.length,
      Math.ceil((scrollTop + containerHeight) / this.lineHeight) + this._overscan
    );
    
    this._visibleStartIndex = startIndex;
    this._visibleEndIndex = endIndex;
  }

  private _handleScroll() {
    // Debounce scroll events for performance
    if (this._scrollTimeout) {
      clearTimeout(this._scrollTimeout);
    }
    
    this._scrollTimeout = window.setTimeout(() => {
      this._calculateVisibleLines();
      
      // Check if user has scrolled away from bottom
      const isAtBottom = this._isScrolledToBottom();
      this._isAutoScrolling = isAtBottom;
    }, 10);
  }

  private _isScrolledToBottom(): boolean {
    if (!this._scrollContainer) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = this._scrollContainer;
    return scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
  }

  private _scrollToBottom() {
    if (!this._scrollContainer) return;
    
    this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
    this._isAutoScrolling = true;
  }

  private _renderLine(line: TerminalLine, index: number) {
    const styles = {
      transform: `translateY(${index * this.lineHeight}px)`
    };
    
    return html`
      <div 
        class="terminal-line ${line.type || ''}"
        style=${styleMap(styles)}
        data-line-id=${line.id}
      >
        ${line.content}
      </div>
    `;
  }

  override render() {
    const totalHeight = this.lines.length * this.lineHeight;
    const visibleLines = this.lines.slice(this._visibleStartIndex, this._visibleEndIndex);
    
    return html`
      <div 
        class="scroll-container"
        @scroll=${this._handleScroll}
      >
        <div 
          class="virtual-spacer"
          style="height: ${totalHeight}px"
        >
          <div class="viewport">
            ${repeat(
              visibleLines,
              (line) => line.id,
              (line, index) => this._renderLine(line, this._visibleStartIndex + index)
            )}
          </div>
        </div>
      </div>
      
      ${this.autoScroll && !this._isAutoScrolling ? html`
        <div class="auto-scroll-indicator">
          Auto-scroll paused
        </div>
      ` : nothing}
    `;
  }

  // Public methods
  appendLine(content: string, type?: TerminalLine['type']) {
    const newLine: TerminalLine = {
      id: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      timestamp: Date.now(),
      type
    };
    
    // Apply max lines limit
    let newLines = [...this.lines, newLine];
    if (newLines.length > this.maxLines) {
      newLines = newLines.slice(-this.maxLines);
    }
    
    this.lines = newLines;
  }

  clear() {
    this.lines = [];
    this._visibleStartIndex = 0;
    this._visibleEndIndex = 50;
  }

  scrollToTop() {
    if (this._scrollContainer) {
      this._scrollContainer.scrollTop = 0;
      this._isAutoScrolling = false;
    }
  }

  scrollToBottom() {
    this._scrollToBottom();
  }

  scrollToLine(lineIndex: number) {
    if (this._scrollContainer && lineIndex >= 0 && lineIndex < this.lines.length) {
      this._scrollContainer.scrollTop = lineIndex * this.lineHeight;
      this._isAutoScrolling = false;
    }
  }
}
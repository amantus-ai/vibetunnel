import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { TerminalRenderer, type BufferCell } from '../utils/terminal-renderer.js';

interface BufferSnapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

@customElement('vibe-terminal-buffer')
export class VibeTerminalBuffer extends LitElement {
  // Disable shadow DOM for Tailwind compatibility
  createRenderRoot() {
    return this as unknown as HTMLElement;
  }

  @property({ type: String }) sessionId = '';
  @property({ type: Number }) pollInterval = 1000; // Poll interval in ms

  @state() private buffer: BufferSnapshot | null = null;
  @state() private error: string | null = null;
  @state() private loading = false;
  @state() private actualRows = 0;
  @state() private displayedFontSize = 14;

  private container: HTMLElement | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastModified: string | null = null;

  // Moved to render() method above

  disconnectedCallback() {
    this.stopPolling();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    super.disconnectedCallback();
  }

  firstUpdated() {
    this.container = this.querySelector('#buffer-container') as HTMLElement;
    if (this.container) {
      this.setupResize();
      this.fetchBuffer();
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('sessionId')) {
      this.buffer = null;
      this.error = null;
      this.lastModified = null;
      if (this.sessionId) {
        this.fetchBuffer();
      }
    }
    if (changedProperties.has('pollInterval')) {
      this.stopPolling();
      this.startPolling();
    }

    // Update buffer content after any render
    if (this.container && this.buffer) {
      this.updateBufferContent();
    }
  }

  private setupResize() {
    if (!this.container) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.calculateDimensions();
    });
    this.resizeObserver.observe(this.container);
  }

  private calculateDimensions() {
    if (!this.container) return;

    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;

    // Always fit horizontally
    // Step 1: Measure container width
    // Step 2: Divide by cols to get target character width
    const cols = this.buffer?.cols || 80;
    const targetCharWidth = containerWidth / cols;

    // Step 3: Scale font size so we can fit cols characters into the container width
    // Estimate font size needed (assuming monospace font with ~0.6 char/font ratio)
    const calculatedFontSize = targetCharWidth / 0.6;
    this.displayedFontSize = Math.max(4, Math.min(32, Math.floor(calculatedFontSize)));

    // Step 4: Calculate how many lines are visible based on scaled font size
    const lineHeight = this.displayedFontSize * 1.2;
    const newActualRows = Math.max(1, Math.floor(containerHeight / lineHeight));

    if (newActualRows !== this.actualRows) {
      this.actualRows = newActualRows;
      this.fetchBuffer();
    } else if (this.buffer) {
      // If rows didn't change but we have a buffer, just update the display
      this.requestUpdate();
    }
  }

  private startPolling() {
    if (this.pollInterval > 0) {
      this.pollTimer = setInterval(() => {
        if (!this.loading) {
          this.fetchBuffer();
        }
      }, this.pollInterval);
    }
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchBuffer() {
    if (!this.sessionId || this.actualRows === 0) return;

    try {
      this.loading = true;

      // First fetch stats to check if we need to update
      const statsResponse = await fetch(`/api/sessions/${this.sessionId}/buffer/stats`);
      if (!statsResponse.ok) {
        throw new Error(`Failed to fetch buffer stats: ${statsResponse.statusText}`);
      }
      const stats = await statsResponse.json();

      // Check if buffer changed
      if (this.lastModified && this.lastModified === stats.lastModified) {
        this.loading = false;
        return; // No changes
      }

      // Fetch buffer data - request enough lines for display
      const lines = Math.max(this.actualRows, stats.rows);
      const response = await fetch(`/api/sessions/${this.sessionId}/buffer?lines=${lines}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch buffer: ${response.statusText}`);
      }

      // Decode binary buffer
      const arrayBuffer = await response.arrayBuffer();
      this.buffer = TerminalRenderer.decodeBinaryBuffer(arrayBuffer);
      this.lastModified = stats.lastModified;
      this.error = null;

      // Recalculate dimensions now that we have the actual cols
      this.calculateDimensions();

      // Request update which will trigger updated() lifecycle
      this.requestUpdate();
    } catch (error) {
      console.error('Error fetching buffer:', error);
      this.error = error instanceof Error ? error.message : 'Failed to fetch buffer';
    } finally {
      this.loading = false;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.startPolling();
  }

  render() {
    const lineHeight = this.displayedFontSize * 1.2;

    return html`
      <style>
        /* Dynamic terminal sizing for this instance */
        vibe-terminal-buffer .terminal-container {
          font-size: ${this.displayedFontSize}px;
          line-height: ${lineHeight}px;
        }

        vibe-terminal-buffer .terminal-line {
          height: ${lineHeight}px;
          line-height: ${lineHeight}px;
        }
      </style>
      <div class="relative w-full h-full overflow-hidden bg-black">
        ${this.error
          ? html`
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="text-red-500 text-sm">${this.error}</div>
              </div>
            `
          : html`
              <div
                id="buffer-container"
                class="terminal-container w-full h-full overflow-x-auto overflow-y-hidden font-mono antialiased"
              ></div>
            `}
      </div>
    `;
  }

  private updateBufferContent() {
    if (!this.container || !this.buffer) return;

    const lineHeight = this.displayedFontSize * 1.2;
    let html = '';

    // Step 5: Draw the bottom n lines
    let cellsToRender: BufferCell[][];
    let startIndex = 0;

    if (this.buffer.cells.length <= this.actualRows) {
      // All content fits
      cellsToRender = this.buffer.cells;
    } else {
      // Content exceeds viewport, show bottom portion
      startIndex = this.buffer.cells.length - this.actualRows;
      cellsToRender = this.buffer.cells.slice(startIndex);
    }

    cellsToRender.forEach((row, index) => {
      const actualIndex = startIndex + index;
      const isCursorLine = this.buffer && actualIndex === this.buffer.cursorY;
      const cursorCol = isCursorLine && this.buffer ? this.buffer.cursorX : -1;
      const lineContent = TerminalRenderer.renderLineFromCells(row, cursorCol);

      html += `<div class="terminal-line" style="height: ${lineHeight}px; line-height: ${lineHeight}px;">${lineContent}</div>`;
    });

    // Set innerHTML directly like terminal.ts does
    this.container.innerHTML = html;
  }

  /**
   * Public method to fetch buffer on demand
   */
  async refresh() {
    await this.fetchBuffer();
  }
}

import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';

// Import required components
import './session-view.js';
import './session-create-form.js';

const logger = createLogger('layout-manager');

interface LayoutPane {
  id: string;
  sessionId?: string;
  x: number; // Grid position (0-based)
  y: number; // Grid position (0-based)
  width: number; // Span in grid units
  height: number; // Span in grid units
}

interface Layout {
  gridCols: number; // Total grid columns (can be fine-grained)
  gridRows: number; // Total grid rows (can be fine-grained)
  panes: LayoutPane[];
}

@customElement('layout-manager')
export class LayoutManager extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100vh;
      background: #000000;
      font-family: 'Hack Nerd Font Mono', 'Fira Code', ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
    }

    .layout-container {
      width: 100%;
      height: 100%;
      display: grid;
      gap: 1px;
      background: #2a2a2a;
      position: relative;
      grid-template-columns: repeat(12, 1fr);
      grid-template-rows: repeat(12, 1fr);
    }

    .pane {
      background: #000000;
      border: 2px solid #2a2a2a;
      overflow: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .pane.focused {
      border-color: #00ff88;
    }

    .pane-header {
      background: #1a1a1a;
      color: #9e9e9e;
      padding: 4px 8px;
      font-size: 11px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
    }

    .pane.focused .pane-header {
      background: #00ff88;
      color: #000000;
      font-weight: 600;
    }

    .pane-content {
      flex: 1;
      overflow: hidden;
      position: relative;
      min-height: 0;
    }

    .empty-pane {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #666666;
      gap: 12px;
      padding: 16px;
    }

    .session-selector {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 4px;
      padding: 8px;
      color: #e4e4e4;
      font-family: inherit;
      font-size: 12px;
      max-width: 200px;
    }

    .session-selector:focus {
      outline: none;
      border-color: #00ff88;
    }

    .create-session-btn {
      background: #00ff88;
      color: #000000;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      font-weight: 600;
    }

    .create-session-btn:hover {
      background: #23d18b;
    }

    .close-btn {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 2px 6px;
      opacity: 0.7;
      margin-left: auto;
    }

    .close-btn:hover {
      background: #f14c4c;
      color: white;
      opacity: 1;
    }

    .controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 100;
      background: rgba(0, 0, 0, 0.9);
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #2a2a2a;
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .control-label {
      color: #9e9e9e;
      font-size: 11px;
    }

    .control-input {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      color: #e4e4e4;
      padding: 4px;
      width: 40px;
      font-size: 11px;
      border-radius: 2px;
    }

    .control-btn {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      color: #e4e4e4;
      padding: 4px 8px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 11px;
    }

    .control-btn:hover {
      border-color: #00ff88;
    }

    .control-btn.primary {
      background: #00ff88;
      color: #000000;
      border-color: #00ff88;
    }

    /* Hotkey help overlay */
    .hotkey-help {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #666;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      pointer-events: none;
      border: 1px solid #2a2a2a;
    }

    .hotkey-item {
      margin: 2px 0;
      font-family: inherit;
    }

    /* Prefix mode indicator */
    .prefix-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 255, 136, 0.95);
      color: #000000;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1000;
      pointer-events: none;
      border: 2px solid #00ff88;
      box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
    }

    .prefix-title {
      font-weight: bold;
      text-align: center;
      margin-bottom: 8px;
      font-size: 16px;
    }

    .prefix-commands {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 12px;
      font-family: inherit;
    }

    /* Resize handles */
    .resize-handle {
      position: absolute;
      background: transparent;
      z-index: 10;
    }

    .resize-handle:hover {
      background: rgba(0, 255, 136, 0.3);
    }

    .resize-handle.vertical {
      width: 6px;
      height: 100%;
      right: -3px;
      top: 0;
      cursor: col-resize;
    }

    .resize-handle.horizontal {
      width: 100%;
      height: 6px;
      bottom: -3px;
      left: 0;
      cursor: row-resize;
    }

    /* Grid layouts */
    .grid-1x1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
    .grid-1x2 { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
    .grid-1x3 { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr 1fr; }
    .grid-1x4 { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr 1fr 1fr; }
    
    .grid-2x1 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
    .grid-2x2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .grid-2x3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
    .grid-2x4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr 1fr; }
    
    .grid-3x1 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr; }
    .grid-3x2 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .grid-3x3 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
    .grid-3x4 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr 1fr; }
    
    .grid-4x1 { grid-template-columns: 1fr 1fr 1fr 1fr; grid-template-rows: 1fr; }
    .grid-4x2 { grid-template-columns: 1fr 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .grid-4x3 { grid-template-columns: 1fr 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
    .grid-4x4 { grid-template-columns: 1fr 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr 1fr; }

    /* Special 3-pane layout: 2 panes on top, 1 spanning full width below */
    .grid-3pane-special { 
      grid-template-columns: 1fr 1fr; 
      grid-template-rows: 1fr 1fr;
      grid-template-areas: "pane1 pane2" "pane3 pane3";
    }
    .grid-3pane-special .pane:nth-child(1) { grid-area: pane1; }
    .grid-3pane-special .pane:nth-child(2) { grid-area: pane2; }
    .grid-3pane-special .pane:nth-child(3) { grid-area: pane3; }
  `;

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Object }) authClient!: AuthClient;

  @state() private layout: Layout = this.createDefaultLayout();
  @state() private focusedPaneId: string | null = null;
  @state() private showCreateModal = false;
  @state() private pendingPaneId: string | null = null;
  @state() private prefixMode = false;
  @state() private resizing = false;
  @state() private resizeStartPos = { x: 0, y: 0 };
  @state() private resizeTarget: { paneId: string; direction: 'horizontal' | 'vertical' } | null =
    null;

  private createDefaultLayout(): Layout {
    return {
      gridCols: 12, // Use 12-column grid for flexibility
      gridRows: 12, // Use 12-row grid for flexibility
      panes: [
        {
          id: '1',
          x: 0,
          y: 0,
          width: 12,
          height: 12,
        },
      ],
    };
  }

  connectedCallback() {
    super.connectedCallback();
    // Load saved layout
    this.loadLayout();
    // Set initial focus
    if (this.layout.panes.length > 0) {
      this.focusedPaneId = this.layout.panes[0].id;
    }
    // Add global keyboard listener for tmux hotkeys
    document.addEventListener('keydown', this.handleGlobalKeyDown);

    // Add window resize listener
    window.addEventListener('resize', this.handleWindowResize);

    // Add mouse event listeners for resize handles
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove global keyboard listener
    document.removeEventListener('keydown', this.handleGlobalKeyDown);
    // Remove window resize listener
    window.removeEventListener('resize', this.handleWindowResize);
    // Remove mouse event listeners
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    // Clear timeouts
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    if (this.prefixTimeout) {
      clearTimeout(this.prefixTimeout);
    }
  }

  private handleWindowResize = () => {
    // Debounce resize events with 2 second delay
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    this.resizeTimeout = window.setTimeout(() => {
      console.log('Window resize: Triggering delayed resize (2s delay)');
      this.resizeAllSessions();
    }, 2000);
  };

  private resizeTimeout: number | null = null;
  private prefixTimeout: number | null = null;

  private handleResizeStart = (
    e: MouseEvent,
    paneId: string,
    direction: 'horizontal' | 'vertical'
  ) => {
    e.preventDefault();
    this.resizing = true;
    this.resizeStartPos = { x: e.clientX, y: e.clientY };
    this.resizeTarget = { paneId, direction };
    document.body.style.cursor = direction === 'horizontal' ? 'row-resize' : 'col-resize';
    console.log(`Started resizing pane ${paneId} in ${direction} direction`);
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.resizing || !this.resizeTarget) return;

    e.preventDefault();

    const pane = this.layout.panes.find(p => p.id === this.resizeTarget.paneId);
    if (!pane) return;

    const dx = e.clientX - this.resizeStartPos.x;
    const dy = e.clientY - this.resizeStartPos.y;

    const containerRect = this.shadowRoot.querySelector('.layout-container').getBoundingClientRect();
    const gridCellWidth = containerRect.width / this.layout.gridCols;
    const gridCellHeight = containerRect.height / this.layout.gridRows;

    if (this.resizeTarget.direction === 'vertical') {
      const widthChange = Math.round(dx / gridCellWidth);
      if (widthChange !== 0) {
        this.resizePane(pane, 'width', widthChange);
        this.resizeStartPos.x = e.clientX;
      }
    } else {
      const heightChange = Math.round(dy / gridCellHeight);
      if (heightChange !== 0) {
        this.resizePane(pane, 'height', heightChange);
        this.resizeStartPos.y = e.clientY;
      }
    }
  };

  private resizePane(pane: LayoutPane, dimension: 'width' | 'height', delta: number) {
    if (dimension === 'width') {
      const newWidth = pane.width + delta;
      if (newWidth < 1) return;

      // Find neighbor to the right
      const neighbor = this.layout.panes.find(p => p.x === pane.x + pane.width && p.y === pane.y);
      if (neighbor) {
        const newNeighborWidth = neighbor.width - delta;
        if (newNeighborWidth < 1) return;
        neighbor.width = newNeighborWidth;
        neighbor.x = neighbor.x + delta;
      }
      pane.width = newWidth;

    } else {
      const newHeight = pane.height + delta;
      if (newHeight < 1) return;

      // Find neighbor below
      const neighbor = this.layout.panes.find(p => p.y === pane.y + pane.height && p.x === pane.x);
      if (neighbor) {
        const newNeighborHeight = neighbor.height - delta;
        if (newNeighborHeight < 1) return;
        neighbor.height = newNeighborHeight;
        neighbor.y = neighbor.y + delta;
      }
      pane.height = newHeight;
    }

    this.saveLayout();
    this.requestUpdate();
    this.resizeAllSessions();
  }

  private handleMouseUp = (e: MouseEvent) => {
    if (!this.resizing) return;

    this.resizing = false;
    this.resizeTarget = null;
    document.body.style.cursor = '';
    console.log('Resize ended');
    this.resizeAllSessions();
  };

  private handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Check if we're in a form field or modal is open
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      this.showCreateModal
    ) {
      return;
    }

    console.log('Layout manager key:', e.key, 'ctrl:', e.ctrlKey, 'prefix:', this.prefixMode);

    // Handle Ctrl+B to enter prefix mode
    if (e.ctrlKey && e.key === 'b' && !this.prefixMode) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Entering prefix mode');
      this.prefixMode = true;

      // Clear any existing timeout
      if (this.prefixTimeout) {
        clearTimeout(this.prefixTimeout);
      }

      // Set timeout to exit prefix mode after 5 seconds
      this.prefixTimeout = window.setTimeout(() => {
        console.log('Prefix mode timeout');
        this.prefixMode = false;
        this.requestUpdate();
      }, 5000);

      this.requestUpdate();
      return;
    }

    // Handle commands in prefix mode
    if (this.prefixMode) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Prefix command:', e.key);

      // Clear prefix mode
      this.prefixMode = false;
      if (this.prefixTimeout) {
        clearTimeout(this.prefixTimeout);
        this.prefixTimeout = null;
      }

      switch (e.key) {
        case 'v':
        case '%':
          // Vertical split - create smart layout
          console.log('Vertical split');
          this.createSmartSplit('vertical');
          break;
        case 's':
        case '"':
          // Horizontal split - create smart layout
          console.log('Horizontal split');
          this.createSmartSplit('horizontal');
          break;
        case 'c':
          // Create new session in current pane
          console.log('Create session in pane:', this.focusedPaneId);
          if (this.focusedPaneId) {
            this.handleOpenCreateModal(this.focusedPaneId);
          }
          break;
        case 'x':
          // Close current pane (remove session)
          console.log('Close pane:', this.focusedPaneId);
          if (this.focusedPaneId) {
            this.handleSessionSelect(this.focusedPaneId, '');
          }
          break;
        case 'h':
        case 'ArrowLeft':
          // Move focus left
          this.moveFocus('left');
          break;
        case 'l':
        case 'ArrowRight':
          // Move focus right
          this.moveFocus('right');
          break;
        case 'j':
        case 'ArrowDown':
          // Move focus down
          this.moveFocus('down');
          break;
        case 'k':
        case 'ArrowUp':
          // Move focus up
          this.moveFocus('up');
          break;
        case 'r':
          // Reset to 1x1 layout
          console.log('Reset layout');
          this.layout = this.createDefaultLayout();
          this.focusedPaneId = this.layout.panes[0]?.id || null;
          this.saveLayout();
          this.requestUpdate();
          break;
        case 'Escape':
          // Exit prefix mode without doing anything
          console.log('Cancelled prefix mode');
          break;
        default:
          console.log('Unknown prefix command:', e.key);
      }

      this.requestUpdate();
      return;
    }
  };

  private moveFocus(direction: 'left' | 'right' | 'up' | 'down') {
    if (!this.focusedPaneId) return;

    const currentPane = this.layout.panes.find(p => p.id === this.focusedPaneId);
    if (!currentPane) return;

    // Find the pane in the specified direction
    let targetPane: LayoutPane | undefined;
    
    switch (direction) {
      case 'left':
        // Find pane with rightmost edge touching current pane's left edge
        targetPane = this.layout.panes
          .filter(p => p.id !== this.focusedPaneId && 
                      p.x + p.width === currentPane.x &&
                      p.y < currentPane.y + currentPane.height &&
                      p.y + p.height > currentPane.y)
          .sort((a, b) => Math.abs(a.y - currentPane.y) - Math.abs(b.y - currentPane.y))[0];
        break;
      case 'right':
        // Find pane with leftmost edge touching current pane's right edge  
        targetPane = this.layout.panes
          .filter(p => p.id !== this.focusedPaneId &&
                      p.x === currentPane.x + currentPane.width &&
                      p.y < currentPane.y + currentPane.height &&
                      p.y + p.height > currentPane.y)
          .sort((a, b) => Math.abs(a.y - currentPane.y) - Math.abs(b.y - currentPane.y))[0];
        break;
      case 'up':
        // Find pane with bottom edge touching current pane's top edge
        targetPane = this.layout.panes
          .filter(p => p.id !== this.focusedPaneId &&
                      p.y + p.height === currentPane.y &&
                      p.x < currentPane.x + currentPane.width &&
                      p.x + p.width > currentPane.x)
          .sort((a, b) => Math.abs(a.x - currentPane.x) - Math.abs(b.x - currentPane.x))[0];
        break;
      case 'down':
        // Find pane with top edge touching current pane's bottom edge
        targetPane = this.layout.panes
          .filter(p => p.id !== this.focusedPaneId &&
                      p.y === currentPane.y + currentPane.height &&
                      p.x < currentPane.x + currentPane.width &&
                      p.x + p.width > currentPane.x)
          .sort((a, b) => Math.abs(a.x - currentPane.x) - Math.abs(b.x - currentPane.x))[0];
        break;
    }

    if (targetPane) {
      this.focusedPaneId = targetPane.id;
    }
  }

  private createSmartSplit(direction: 'vertical' | 'horizontal') {
    if (!this.focusedPaneId) {
      console.log('No focused pane to split');
      return;
    }

    const focusedPane = this.layout.panes.find((p) => p.id === this.focusedPaneId);
    if (!focusedPane) {
      console.log('Focused pane not found');
      return;
    }

    console.log(`Splitting pane ${this.focusedPaneId} ${direction}ly`);

    // Generate new pane ID
    const newPaneId = String(Math.max(...this.layout.panes.map((p) => Number.parseInt(p.id))) + 1);

    if (direction === 'vertical') {
      // Split the focused pane vertically (left/right)
      // Original pane takes left half, new pane takes right half
      const originalWidth = focusedPane.width;
      const newWidth = Math.floor(originalWidth / 2);
      const remainingWidth = originalWidth - newWidth;

      // Update focused pane to left half
      focusedPane.width = newWidth;

      // Create new pane for right half
      const newPane: LayoutPane = {
        id: newPaneId,
        x: focusedPane.x + newWidth,
        y: focusedPane.y,
        width: remainingWidth,
        height: focusedPane.height,
      };

      this.layout.panes.push(newPane);
    } else {
      // Split the focused pane horizontally (top/bottom)
      // Original pane takes top half, new pane takes bottom half
      const originalHeight = focusedPane.height;
      const newHeight = Math.floor(originalHeight / 2);
      const remainingHeight = originalHeight - newHeight;

      // Update focused pane to top half
      focusedPane.height = newHeight;

      // Create new pane for bottom half
      const newPane: LayoutPane = {
        id: newPaneId,
        x: focusedPane.x,
        y: focusedPane.y + newHeight,
        width: focusedPane.width,
        height: remainingHeight,
      };

      this.layout.panes.push(newPane);
    }

    // Focus the new pane
    this.focusedPaneId = newPaneId;

    // Save layout and trigger resize
    this.saveLayout();
    this.requestUpdate();

    setTimeout(() => {
      console.log('Delayed resize after split (2s delay)');
      this.resizeAllSessions();
    }, 2000);
  }


  private handlePaneClick(paneId: string) {
    this.focusedPaneId = paneId;
  }

  private handleSessionSelect(paneId: string, sessionId: string) {
    this.layout = {
      ...this.layout,
      panes: this.layout.panes.map((pane) =>
        pane.id === paneId ? { ...pane, sessionId: sessionId || undefined } : pane
      ),
    };

    // Focus the pane and send resize event after DOM updates
    this.focusedPaneId = paneId;
    if (sessionId) {
      setTimeout(() => {
        console.log('Delayed resize for session assignment (2s delay)');
        this.resizeAllSessions();
      }, 2000);
    }

    // Save layout after session assignment
    this.saveLayout();
  }

  

  

  

  private resizeAllSessions() {
    this.layout.panes.forEach((pane) => {
      if (pane.sessionId) {
        const sessionView = this.shadowRoot?.querySelector(
          `[data-pane-id='${pane.id}'] session-view`
        ) as import('./session-view.js').SessionView;
        if (sessionView) {
          sessionView.resize();
        }
      }
    });
  }

  private handleOpenCreateModal(paneId: string) {
    this.pendingPaneId = paneId;
    this.showCreateModal = true;
  }

  private handleCreateModalClose() {
    this.showCreateModal = false;
    this.pendingPaneId = null;
  }

  private async saveLayout() {
    try {
      const headers = this.authClient.getAuthHeader();
      await fetch('/api/layouts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(this.layout),
      });
    } catch (error) {
      logger.error('Failed to save layout:', error);
    }
  }

  private async loadLayout() {
    try {
      const headers = this.authClient.getAuthHeader();
      const response = await fetch('/api/layouts', { headers });
      if (response.ok) {
        const savedLayout = await response.json();
        if (savedLayout) {
          this.layout = savedLayout;
          // Set focus to first pane if available
          if (this.layout.panes.length > 0) {
            this.focusedPaneId = this.layout.panes[0].id;
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load layout:', error);
    }
  }

  private async handleSessionCreated(e: CustomEvent) {
    const { sessionId } = e.detail;
    console.log('Session created:', sessionId, 'for pane:', this.pendingPaneId);

    if (sessionId && this.pendingPaneId) {
      this.handleSessionSelect(this.pendingPaneId, sessionId);

      // Wait 2 seconds for the DOM to fully render, then resize
      setTimeout(() => {
        if (this.pendingPaneId) {
          console.log('Delayed resize for newly created session (2s delay)');
          this.resizeAllSessions();
        }
      }, 2000);

      // Refresh sessions list
      this.dispatchEvent(new CustomEvent('refresh-sessions', { bubbles: true }));
    }

    this.handleCreateModalClose();
  }

  private getSessionForPane(pane: LayoutPane): Session | undefined {
    return pane.sessionId ? this.sessions.find((s) => s.id === pane.sessionId) : undefined;
  }

  private getAvailableSessions(): Session[] {
    // Return sessions that aren't already assigned to a pane
    return this.sessions.filter((s) => !this.layout.panes.some((p) => p.sessionId === s.id));
  }

  private renderPane(pane: LayoutPane) {
    const session = this.getSessionForPane(pane);
    const availableSessions = this.getAvailableSessions();
    const isFocused = this.focusedPaneId === pane.id;

    // Check if pane can be resized (not at edges)
    const canResizeRight = pane.x + pane.width < this.layout.gridCols;
    const canResizeBottom = pane.y + pane.height < this.layout.gridRows;

    // CSS Grid positioning
    const gridStyle = `
      grid-column: ${pane.x + 1} / ${pane.x + pane.width + 1};
      grid-row: ${pane.y + 1} / ${pane.y + pane.height + 1};
    `;

    return html`
      <div 
        class="pane ${session ? 'has-session' : 'empty'} ${isFocused ? 'focused' : ''}"
        data-pane-id="${pane.id}"
        style="${gridStyle}"
        @click=${() => this.handlePaneClick(pane.id)}
      >
        <div class="pane-header">
          <span>${session?.name || `[${pane.id}]`}</span>
          <button 
            class="close-btn"
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              this.handleSessionSelect(pane.id, '');
            }}
            title="Remove session"
          >
            ✕
          </button>
        </div>
        
        <div class="pane-content">
          ${
            session
              ? html`
            <session-view
              .session=${session}
              .isMultiplexerPane=${true}
              .focused=${isFocused}
              .paneId=${pane.id}
              @navigate-to-list=${() => {}}
            ></session-view>
          `
              : html`
            <div class="empty-pane">
              ${
                availableSessions.length > 0
                  ? html`
                <select 
                  class="session-selector"
                  @change=${(e: Event) => {
                    const target = e.target as HTMLSelectElement;
                    this.handleSessionSelect(pane.id, target.value);
                  }}
                >
                  <option value="">Select session...</option>
                  ${availableSessions.map(
                    (session) => html`
                    <option value=${session.id}>
                      ${session.name || (Array.isArray(session.command) ? session.command.join(' ') : session.command)}
                    </option>
                  `
                  )}
                </select>
              `
                  : html`
                <div>No available sessions</div>
              `
              }
              
              <button 
                class="create-session-btn"
                @click=${() => this.handleOpenCreateModal(pane.id)}
              >
                New Session
              </button>
            </div>
          `
          }
        </div>

        <!-- Resize handles -->
        ${
          canResizeRight
            ? html`
            <div 
              class="resize-handle vertical"
              @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, pane.id, 'vertical')}
            ></div>
          `
            : ''
        }
        ${
          canResizeBottom
            ? html`
            <div 
              class="resize-handle horizontal"
              @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, pane.id, 'horizontal')}
            ></div>
          `
            : ''
        }
      </div>
    `;
  }

  render() {
    // Use special 3-pane layout when we have 3 panes in a 2x2 grid
    const useSpecial3Pane = false; // Disable special 3-pane layout for now
    const gridClass = useSpecial3Pane ? 'grid-3pane-special' : '';

    return html`
      <div class="layout-container ${gridClass}">
        ${this.layout.panes.map((pane) => this.renderPane(pane))}
        
        <!-- Prefix mode indicator and help -->
        ${
          this.prefixMode
            ? html`
            <div class="prefix-indicator">
              <div class="prefix-title">PREFIX MODE</div>
              <div class="prefix-commands">
                <div>v/% = vsplit</div>
                <div>s/" = hsplit</div>
                <div>c = create</div>
                <div>x = close</div>
                <div>hjkl = navigate</div>
                <div>r = reset</div>
                <div>ESC = cancel</div>
              </div>
            </div>
          `
            : html`
            <div class="hotkey-help">
              <div class="hotkey-item">Ctrl+B to start</div>
            </div>
          `
        }
      </div>

      <div class="controls">
        <button 
          class="control-btn primary"
          @click=${() => this.dispatchEvent(new CustomEvent('navigate-to-list', { bubbles: true }))}
        >
          Back
        </button>
      </div>

      <session-create-form
        .visible=${this.showCreateModal}
        .authClient=${this.authClient}
        @session-created=${this.handleSessionCreated}
        @cancel=${this.handleCreateModalClose}
        @error=${(e: CustomEvent) =>
          this.dispatchEvent(new CustomEvent('error', { detail: e.detail, bubbles: true }))}
      ></session-create-form>
    `;
  }
}

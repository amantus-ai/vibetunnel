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
}

interface Layout {
  cols: number;
  rows: number;
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

  private createDefaultLayout(): Layout {
    return {
      cols: 1,
      rows: 1,
      panes: [{ id: '1' }],
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
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove global keyboard listener
    document.removeEventListener('keydown', this.handleGlobalKeyDown);
    // Remove window resize listener
    window.removeEventListener('resize', this.handleWindowResize);
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
          this.updateGrid(1, 1);
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

    const currentPaneIndex = this.layout.panes.findIndex((p) => p.id === this.focusedPaneId);
    if (currentPaneIndex === -1) return;

    // Calculate current row and column
    const currentRow = Math.floor(currentPaneIndex / this.layout.cols);
    const currentCol = currentPaneIndex % this.layout.cols;

    let newRow = currentRow;
    let newCol = currentCol;

    switch (direction) {
      case 'left':
        newCol = Math.max(0, currentCol - 1);
        break;
      case 'right':
        newCol = Math.min(this.layout.cols - 1, currentCol + 1);
        break;
      case 'up':
        newRow = Math.max(0, currentRow - 1);
        break;
      case 'down':
        newRow = Math.min(this.layout.rows - 1, currentRow + 1);
        break;
    }

    const newPaneIndex = newRow * this.layout.cols + newCol;
    if (newPaneIndex < this.layout.panes.length && newPaneIndex >= 0) {
      this.focusedPaneId = this.layout.panes[newPaneIndex].id;
    }
  }

  private createSmartSplit(direction: 'vertical' | 'horizontal') {
    const currentPaneCount = this.layout.panes.length;

    console.log(`Creating ${direction} split with ${currentPaneCount} panes`);

    // Tmux-like progression:
    // 1 pane: vertical split = [1][2], horizontal split = [1] over [2]
    // 2 panes horizontal [1][2]: horizontal split = [1][2] over [3] (3 spans full width)
    // 2 panes vertical [1]/[2]: vertical split = [1][3] over [2]
    // 3 panes: fill to 2x2 grid = [1][2] over [3][4]

    if (currentPaneCount === 1) {
      if (direction === 'vertical') {
        // [1] -> [1][2]
        this.updateGrid(2, 1);
      } else {
        // [1] -> [1] over [2]
        this.updateGrid(1, 2);
      }
    } else if (currentPaneCount === 2) {
      if (this.layout.cols === 2 && this.layout.rows === 1) {
        // Current: [1][2] -> add horizontal split below
        // Result: [1][2] over [3] (3 spans full width)
        // We need special CSS for this, but for now use 2x2 with 3 panes
        console.log('2 horizontal panes -> adding pane below');
        this.updateGrid(2, 2, 3);
      } else if (this.layout.cols === 1 && this.layout.rows === 2) {
        // Current: [1] over [2] -> add vertical split
        // Result: [1][3] over [2]
        console.log('2 vertical panes -> adding pane to side');
        this.updateGrid(2, 2, 3);
      } else {
        // Fallback: add pane
        this.updateGrid(2, 2, 3);
      }
    } else if (currentPaneCount === 3) {
      // 3 panes -> 4 panes (complete 2x2 grid)
      console.log('3 panes -> completing 2x2 grid');
      this.updateGrid(2, 2, 4);
    } else {
      // For 4+ panes, expand grid
      if (direction === 'vertical' && this.layout.cols < 4) {
        console.log('Expanding columns');
        this.updateGrid(this.layout.cols + 1, this.layout.rows);
      } else if (direction === 'horizontal' && this.layout.rows < 4) {
        console.log('Expanding rows');
        this.updateGrid(this.layout.cols, this.layout.rows + 1);
      } else {
        console.log('Grid at max size, no more splits');
      }
    }
  }

  private updateGrid(cols: number, rows: number, paneCount?: number) {
    // If paneCount is specified, only create that many panes (for special layouts)
    const totalPanes = paneCount || cols * rows;
    const newPanes: LayoutPane[] = [];

    // Keep existing panes and their sessions
    for (let i = 0; i < totalPanes; i++) {
      const existingPane = this.layout.panes[i];
      newPanes.push({
        id: `${i + 1}`,
        sessionId: existingPane?.sessionId,
      });
    }

    this.layout = {
      cols,
      rows,
      panes: newPanes,
    };

    // Save layout after changes
    this.saveLayout();

    // Resize all sessions to fit new layout after DOM updates
    setTimeout(() => {
      console.log('Delayed resize after layout change (2s delay)');
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
        this.resizeSessionToPane(paneId);
      }, 2000);
    }

    // Save layout after session assignment
    this.saveLayout();
  }

  private getCharacterDimensions(): { width: number; height: number } {
    // Create a temporary element to measure character dimensions
    const testElement = document.createElement('div');
    testElement.style.position = 'absolute';
    testElement.style.visibility = 'hidden';
    testElement.style.fontFamily =
      "'Hack Nerd Font Mono', 'Fira Code', ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace";
    testElement.style.fontSize = '14px';
    testElement.style.lineHeight = '1.2';
    testElement.style.whiteSpace = 'pre';
    testElement.textContent = 'M'; // Use 'M' as it's typically the widest character

    document.body.appendChild(testElement);
    const rect = testElement.getBoundingClientRect();
    const charWidth = rect.width;
    const charHeight = rect.height;
    document.body.removeChild(testElement);

    console.log(`Measured character dimensions: ${charWidth}x${charHeight}`);
    return { width: charWidth, height: charHeight };
  }

  private async resizeSessionToPane(paneId: string) {
    const pane = this.layout.panes.find((p) => p.id === paneId);
    if (!pane?.sessionId) return;

    // Wait for DOM to be fully rendered and elements to be properly sized
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const paneElement = this.querySelector(`[data-pane-id="${paneId}"]`) as HTMLElement;
    if (!paneElement) {
      console.log(`Pane element not found for ${paneId}`);
      return;
    }

    // Wait for session-view to be fully loaded and sized
    const sessionView = paneElement.querySelector('session-view') as HTMLElement;
    if (!sessionView) {
      console.log(`Session-view not found in pane ${paneId}`);
      return;
    }

    // Wait for session-view to have non-zero dimensions
    let attempts = 0;
    while (attempts < 10) {
      const sessionRect = sessionView.getBoundingClientRect();
      if (sessionRect.height > 100) {
        // Wait for reasonable height
        console.log(`Session-view has good size: ${sessionRect.width}x${sessionRect.height}`);
        break;
      }
      console.log(
        `Waiting for session-view to size properly (attempt ${attempts + 1}): ${sessionRect.width}x${sessionRect.height}`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    // Get accurate character dimensions by measuring
    const charDims = this.getCharacterDimensions();
    const paneRect = paneElement.getBoundingClientRect();

    // Find terminal container specifically - this is what we need to size to
    const terminalContainer = sessionView.querySelector('#terminal-container') as HTMLElement;
    const terminalContainerRect = terminalContainer?.getBoundingClientRect();

    console.log('=== RESIZE DEBUGGING ===');
    console.log(`Pane element: ${paneRect.width}x${paneRect.height}`);
    console.log(
      `Session-view element: ${sessionView.getBoundingClientRect().width}x${sessionView.getBoundingClientRect().height}`
    );
    console.log(
      `Terminal container: ${terminalContainerRect?.width}x${terminalContainerRect?.height}`
    );
    console.log(`Character dimensions: ${charDims.width}x${charDims.height}`);

    // Use the terminal container dimensions - this is the actual space available
    let targetWidth = sessionView.getBoundingClientRect().width;
    let targetHeight = sessionView.getBoundingClientRect().height;

    if (
      terminalContainerRect &&
      terminalContainerRect.width > 0 &&
      terminalContainerRect.height > 0
    ) {
      targetWidth = terminalContainerRect.width;
      targetHeight = terminalContainerRect.height;
      console.log('Using terminal-container dimensions (most accurate)');
    } else {
      console.log('Using session-view dimensions (fallback)');
    }

    // Minimal padding since we're using the actual terminal container
    const paddingWidth = 8;
    const paddingHeight = 8;

    const availableWidth = Math.max(0, targetWidth - paddingWidth);
    const availableHeight = Math.max(0, targetHeight - paddingHeight);

    const cols = Math.floor(availableWidth / charDims.width);
    const rows = Math.floor(availableHeight / charDims.height);

    console.log(
      `Final calc: ${targetWidth}x${targetHeight} - ${paddingWidth}x${paddingHeight} = ${availableWidth}x${availableHeight} → ${cols}x${rows}`
    );
    console.log('========================');

    this.sendResizeToSession(pane.sessionId, Math.max(20, cols), Math.max(5, rows));
  }

  private async sendResizeToSession(sessionId: string, cols: number, rows: number) {
    try {
      const headers = this.authClient.getAuthHeader();
      console.log(`Resizing session ${sessionId} to ${cols}x${rows}`);
      await fetch(`/api/sessions/${sessionId}/resize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ cols, rows }),
      });
    } catch (error) {
      logger.error('Failed to resize session:', error);
    }
  }

  private async resizeAllSessions() {
    // Resize all sessions in the layout to fit their panes with delay
    console.log('resizeAllSessions: Starting with additional 2s delay per pane');
    for (const pane of this.layout.panes) {
      if (pane.sessionId) {
        setTimeout(() => {
          console.log(`resizeAllSessions: Delayed resize for pane ${pane.id}`);
          this.resizeSessionToPane(pane.id);
        }, 2000);
      }
    }
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
          this.resizeSessionToPane(this.pendingPaneId);
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

    // Calculate if this pane should have resize handles
    const paneIndex = this.layout.panes.findIndex((p) => p.id === pane.id);
    const row = Math.floor(paneIndex / this.layout.cols);
    const col = paneIndex % this.layout.cols;
    const showVerticalHandle = col < this.layout.cols - 1;
    const showHorizontalHandle = row < this.layout.rows - 1;

    return html`
      <div 
        class="pane ${session ? 'has-session' : 'empty'} ${isFocused ? 'focused' : ''}"
        data-pane-id="${pane.id}"
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
          showVerticalHandle
            ? html`
            <div class="resize-handle vertical"></div>
          `
            : ''
        }
        ${
          showHorizontalHandle
            ? html`
            <div class="resize-handle horizontal"></div>
          `
            : ''
        }
      </div>
    `;
  }

  render() {
    // Use special 3-pane layout when we have 3 panes in a 2x2 grid
    const useSpecial3Pane =
      this.layout.panes.length === 3 && this.layout.cols === 2 && this.layout.rows === 2;
    const gridClass = useSpecial3Pane
      ? 'grid-3pane-special'
      : `grid-${this.layout.cols}x${this.layout.rows}`;

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

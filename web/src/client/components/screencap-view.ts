import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-view');

interface WindowInfo {
  cgWindowID: number;
  app: string;
  title: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
  id: number;
}

interface DisplayInfo {
  width: number;
  height: number;
  scaleFactor: number;
  physicalWidth: number;
  physicalHeight: number;
  boundsWidth: number;
  boundsHeight: number;
}

@customElement('screencap-view')
export class ScreencapView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--dark-bg);
      color: var(--dark-text);
      font-family: var(--font-mono);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: between;
      padding: 1rem;
      background: var(--dark-bg-elevated);
      border-bottom: 1px solid var(--dark-border);
      gap: 1rem;
    }

    .header h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--accent-primary);
    }

    .header-actions {
      display: flex;
      gap: 0.5rem;
      margin-left: auto;
    }

    .btn {
      padding: 0.5rem 1rem;
      border: 1px solid var(--dark-border);
      border-radius: 0.5rem;
      background: var(--dark-bg-elevated);
      color: var(--dark-text);
      cursor: pointer;
      transition: all 0.2s;
      font-family: var(--font-mono);
      font-size: 0.875rem;
    }

    .btn:hover {
      background: var(--dark-surface-hover);
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }

    .btn.primary {
      background: var(--accent-primary);
      color: var(--dark-bg);
      border-color: var(--accent-primary);
    }

    .btn.primary:hover {
      background: var(--accent-secondary);
      border-color: var(--accent-secondary);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .main-content {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 300px;
      background: var(--dark-bg-elevated);
      border-right: 1px solid var(--dark-border);
      overflow-y: auto;
    }

    .sidebar-section {
      padding: 1rem;
      border-bottom: 1px solid var(--dark-border);
    }

    .sidebar-section h3 {
      margin: 0 0 0.5rem 0;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--dark-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .window-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .window-item {
      padding: 0.5rem;
      border: 1px solid var(--dark-border);
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.2s;
      background: var(--dark-bg);
    }

    .window-item:hover {
      background: var(--dark-surface-hover);
      border-color: var(--accent-primary);
    }

    .window-item.selected {
      background: var(--accent-primary);
      color: var(--dark-bg);
      border-color: var(--accent-primary);
    }

    .window-name {
      font-weight: 600;
      font-size: 0.875rem;
      margin-bottom: 0.25rem;
    }

    .window-app {
      font-size: 0.75rem;
      opacity: 0.7;
    }

    .window-size {
      font-size: 0.75rem;
      opacity: 0.7;
      margin-top: 0.25rem;
    }

    .capture-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      background: var(--dark-bg);
    }

    .capture-preview {
      max-width: 100%;
      max-height: 100%;
      border: 1px solid var(--dark-border);
      border-radius: 0.5rem;
      background: var(--dark-bg-elevated);
    }

    .capture-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }

    .status-message {
      color: var(--dark-text);
      text-align: center;
      font-size: 1.125rem;
    }

    .loading {
      color: var(--accent-primary);
    }

    .error {
      color: var(--status-error);
    }

    .success {
      color: var(--status-success);
    }

    .capture-controls {
      position: absolute;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem;
      background: var(--dark-bg-elevated);
      border: 1px solid var(--dark-border);
      border-radius: 0.5rem;
    }

    .fps-indicator {
      position: absolute;
      top: 1rem;
      right: 1rem;
      padding: 0.25rem 0.5rem;
      background: var(--dark-bg-elevated);
      border: 1px solid var(--dark-border);
      border-radius: 0.25rem;
      font-size: 0.75rem;
      color: var(--dark-text-muted);
    }

    @media (max-width: 768px) {
      .main-content {
        flex-direction: column;
      }
      
      .sidebar {
        width: 100%;
        height: 200px;
      }
    }
  `;

  @state() private windows: WindowInfo[] = [];
  @state() private selectedWindow: WindowInfo | null = null;
  @state() private displayInfo: DisplayInfo | null = null;
  @state() private isCapturing = false;
  @state() private captureMode: 'desktop' | 'window' = 'desktop';
  @state() private frameUrl = '';
  @state() private status = 'idle';
  @state() private error = '';
  @state() private fps = 0;

  private frameInterval: number | null = null;
  private frameCounter = 0;
  private lastFpsUpdate = 0;

  connectedCallback() {
    super.connectedCallback();
    this.loadInitialData();
    this.setupKeyboardHandler();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCapture();
    this.removeKeyboardHandler();
  }

  private async loadInitialData() {
    try {
      logger.log('🔄 Starting initial data load...');
      this.status = 'loading';
      await Promise.all([this.loadWindows(), this.loadDisplayInfo()]);
      logger.log('✅ Initial data loaded successfully');
      this.status = 'ready';
    } catch (error) {
      logger.error('❌ Failed to load initial data:', error);
      this.error = `Failed to load screen capture data: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.status = 'error';
    }
  }

  private async loadWindows() {
    logger.log('Loading windows...');
    const response = await fetch('/api/screencap/windows');
    if (!response.ok) {
      logger.error(`Failed to load windows: ${response.status} ${response.statusText}`);
      throw new Error('Failed to load windows');
    }
    const windows = await response.json();
    logger.log(`Loaded ${windows.length} windows:`, windows);
    this.windows = windows;
  }

  private async loadDisplayInfo() {
    logger.log('Loading display info...');
    const response = await fetch('/api/screencap/display');
    if (!response.ok) {
      logger.error(`Failed to load display: ${response.status} ${response.statusText}`);
      throw new Error('Failed to load display info');
    }
    const displayInfo = await response.json();
    logger.log('Loaded display info:', displayInfo);
    this.displayInfo = displayInfo;
  }

  private async startCapture() {
    try {
      this.status = 'starting';
      logger.log(`🚀 Starting ${this.captureMode} capture...`);

      let response: Response;
      let endpoint: string;
      let captureData: any;
      
      if (this.captureMode === 'desktop') {
        // Desktop capture using /capture endpoint
        endpoint = '/api/screencap/capture';
        captureData = {
          type: 0, // Desktop
          index: 0,
          vp9: false, // Use standard MJPEG for now
        };
        logger.log(`📺 Desktop capture data:`, captureData);
      } else {
        // Window capture using /capture-window endpoint
        if (!this.selectedWindow) {
          throw new Error('No window selected for capture');
        }
        
        endpoint = '/api/screencap/capture-window';
        captureData = {
          cgWindowID: this.selectedWindow.cgWindowID,
          vp9: false, // Use standard MJPEG for now
        };
        logger.log(`🪟 Window capture data:`, captureData);
        logger.log(`🎯 Selected window:`, this.selectedWindow);
      }

      logger.log(`📡 Making request to ${endpoint}`);
      
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(captureData),
      });

      logger.log(`📨 Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`❌ Response error text:`, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const responseData = await response.json();
      logger.log(`✅ Capture started successfully:`, responseData);

      this.isCapturing = true;
      this.status = 'capturing';
      this.startFrameUpdates();

      logger.log(`🎬 Started ${this.captureMode} capture successfully`);
    } catch (error) {
      logger.error('❌ Failed to start capture:', error);
      
      // More detailed error logging
      if (error instanceof TypeError && error.message.includes('fetch')) {
        logger.error('🌐 Network error - server might be down or unreachable');
      } else if (error instanceof Error) {
        logger.error(`🔍 Error details: ${error.message}`);
        logger.error(`📋 Error stack:`, error.stack);
      }
      
      this.error = `Failed to start screen capture: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.status = 'error';
    }
  }

  private async stopCapture() {
    try {
      if (this.frameInterval) {
        clearInterval(this.frameInterval);
        this.frameInterval = null;
      }

      if (this.isCapturing) {
        await fetch('/api/screencap/stop', { method: 'POST' });
      }

      this.isCapturing = false;
      this.frameUrl = '';
      this.fps = 0;
      this.status = 'ready';

      logger.log('Stopped capture');
    } catch (error) {
      logger.error('Failed to stop capture:', error);
    }
  }

  private startFrameUpdates() {
    this.frameInterval = window.setInterval(() => {
      this.updateFrame();
    }, 100); // 10 FPS updates
  }

  private async updateFrame() {
    try {
      const timestamp = Date.now();
      this.frameUrl = `/api/screencap/frame?t=${timestamp}`;

      // Update FPS counter
      this.frameCounter++;
      if (timestamp - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCounter;
        this.frameCounter = 0;
        this.lastFpsUpdate = timestamp;
      }
    } catch (error) {
      logger.error('Failed to update frame:', error);
    }
  }

  private async selectWindow(window: WindowInfo) {
    this.selectedWindow = window;
    this.captureMode = 'window';
    
    // Auto-start capture when selecting a window
    if (!this.isCapturing) {
      logger.log(`🎯 Auto-starting capture for window: ${window.title}`);
      await this.startCapture();
    }
  }

  private async selectDesktop() {
    this.selectedWindow = null;
    this.captureMode = 'desktop';
    
    // Auto-start capture when selecting desktop
    if (!this.isCapturing) {
      logger.log('🖥️ Auto-starting desktop capture');
      await this.startCapture();
    }
  }

  private async handleClick(event: MouseEvent) {
    if (!this.isCapturing) return;

    const img = event.target as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    
    // Calculate click position relative to the image element's displayed size
    const imageClickX = event.clientX - rect.left;
    const imageClickY = event.clientY - rect.top;
    
    // Clamp to image bounds to prevent out-of-bounds clicks
    const clampedX = Math.max(0, Math.min(imageClickX, rect.width));
    const clampedY = Math.max(0, Math.min(imageClickY, rect.height));
    
    // Convert to normalized coordinates (0.0 to 1.0) within the displayed image
    const relativeX = clampedX / rect.width;
    const relativeY = clampedY / rect.height;
    
    // Send as 0-1000 range for precision (matches original node-sharer implementation)
    const x = Math.round(relativeX * 1000);
    const y = Math.round(relativeY * 1000);

    try {
      await fetch('/api/screencap/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });

      logger.log(`🖱️ Clicked at relative coordinates: ${relativeX.toFixed(3)}, ${relativeY.toFixed(3)} (sent as ${x}, ${y})`);
    } catch (error) {
      logger.error('Failed to send click:', error);
    }
  }

  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  private setupKeyboardHandler() {
    // Add global keyboard event listener when component is connected
    document.addEventListener('keydown', this.boundHandleKeyDown);
    logger.log('🎹 Keyboard handler setup complete');
  }

  private removeKeyboardHandler() {
    // Remove global keyboard event listener when component is disconnected
    document.removeEventListener('keydown', this.boundHandleKeyDown);
    logger.log('🎹 Keyboard handler removed');
  }

  private async handleKeyDown(event: KeyboardEvent) {
    // Skip if focused on input elements
    if (event.target instanceof HTMLElement) {
      const tagName = event.target.tagName.toUpperCase();
      if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
        return;
      }
    }

    // Only process keys when capturing
    if (!this.isCapturing) return;

    // Prevent default browser behavior
    event.preventDefault();

    try {
      let endpoint: string;
      let body: any;

      if (this.captureMode === 'desktop') {
        // Desktop key input
        endpoint = '/api/screencap/key';
        body = {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        };
      } else {
        // Window-specific key input
        endpoint = '/api/screencap/key-window';
        body = {
          key: event.key,
          cgWindowID: this.selectedWindow?.cgWindowID || 0,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        };
      }

      logger.log(`⌨️ Sending key: ${event.key} (modifiers: ${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Cmd+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''})`);

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      logger.log(`✅ Key sent successfully: ${event.key}`);
    } catch (error) {
      logger.error('❌ Failed to send key:', error);
    }
  }

  render() {
    return html`
      <div class="header">
        <h1>🖥️ Screen Capture</h1>
        <div class="header-actions">
          <button 
            class="btn" 
            @click=${this.loadWindows}
            ?disabled=${this.status === 'loading'}
          >
            🔄 Refresh
          </button>
          ${
            this.isCapturing
              ? html`<button class="btn" @click=${this.stopCapture}>⏹️ Stop</button>`
              : html`<button class="btn primary" @click=${this.startCapture} ?disabled=${this.status === 'loading'}>▶️ Start</button>`
          }
        </div>
      </div>

      <div class="main-content">
        <div class="sidebar">
          <div class="sidebar-section">
            <h3>Capture Mode</h3>
            <div class="window-list">
              <div 
                class="window-item ${this.captureMode === 'desktop' ? 'selected' : ''}"
                @click=${this.selectDesktop}
              >
                <div class="window-name">🖥️ Full Desktop</div>
                <div class="window-size">
                  ${this.displayInfo ? `${this.displayInfo.width}×${this.displayInfo.height}` : 'Loading...'}
                </div>
              </div>
            </div>
          </div>

          <div class="sidebar-section">
            <h3>Windows (${this.windows.length})</h3>
            <div class="window-list">
              ${this.windows.map(
                (window) => html`
                <div 
                  class="window-item ${this.selectedWindow === window ? 'selected' : ''}"
                  @click=${() => this.selectWindow(window)}
                >
                  <div class="window-name">${window.title || 'Untitled'}</div>
                  <div class="window-app">${window.app}</div>
                  <div class="window-size">
                    ${window.size.width}×${window.size.height}
                  </div>
                </div>
              `
              )}
            </div>
          </div>
        </div>

        <div class="capture-area">
          ${
            this.frameUrl && this.isCapturing
              ? html`
            <img 
              src="${this.frameUrl}" 
              class="capture-preview"
              @click=${this.handleClick}
              alt="Screen capture"
            />
            <div class="fps-indicator">📺 ${this.fps} FPS</div>
            <div class="capture-controls">
              <span>Click on the image to control the screen</span>
            </div>
          `
              : html`
            <div class="capture-overlay">
              <div class="status-message ${this.status}">
                ${
                  this.status === 'loading'
                    ? '🔄 Loading...'
                    : this.status === 'starting'
                      ? '🚀 Starting capture...'
                      : this.status === 'error'
                        ? `❌ ${this.error}`
                        : this.status === 'ready'
                          ? '▶️ Click Start to begin screen capture'
                          : '⏸️ Capture stopped'
                }
              </div>
              ${
                this.status === 'ready'
                  ? html`
                <button class="btn primary" @click=${this.startCapture}>
                  ▶️ Start ${this.captureMode === 'desktop' ? 'Desktop' : 'Window'} Capture
                </button>
              `
                  : ''
              }
            </div>
          `
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'screencap-view': ScreencapView;
  }
}

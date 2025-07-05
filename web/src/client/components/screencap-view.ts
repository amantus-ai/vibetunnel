import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ScreencapWebSocketClient } from '../services/screencap-websocket-client.js';
import { type StreamStats, WebRTCHandler } from '../services/webrtc-handler.js';
import type { DisplayInfo, ProcessGroup, WindowInfo } from '../types/screencap.js';
import { createLogger } from '../utils/logger.js';
import './screencap-sidebar.js';
import './screencap-stats.js';

interface ProcessesResponse {
  processes: ProcessGroup[];
}

interface DisplaysResponse {
  displays: DisplayInfo[];
}

interface CaptureResponse {
  sessionId?: string;
}

interface FrameResponse {
  frame?: string;
}

const logger = createLogger('screencap-view');

@customElement('screencap-view')
export class ScreencapView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #0a0a0a;
      color: #e4e4e4;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(to right, #141414, #1f1f1f);
      border-bottom: 1px solid #2a2a2a;
      gap: 1rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    .header h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #10B981;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .header-actions {
      display: flex;
      gap: 0.5rem;
      margin-left: auto;
    }

    .btn {
      padding: 0.5rem 1rem;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      background: transparent;
      color: #e4e4e4;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      font-size: 0.875rem;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      user-select: none;
    }

    .btn:hover {
      border-color: #10B981;
      color: #10B981;
    }

    .btn.primary {
      background: #10B981;
      color: #0a0a0a;
      border-color: #10B981;
      font-weight: 500;
    }

    .btn.primary:hover {
      background: #0D9668;
      border-color: #0D9668;
    }

    .btn.danger {
      background: #EF4444;
      color: white;
      border-color: #EF4444;
    }

    .btn.danger:hover {
      background: #DC2626;
      border-color: #DC2626;
    }

    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 320px;
      transition: width 0.3s ease;
      overflow: hidden;
      flex-shrink: 0;
    }

    .sidebar.collapsed {
      width: 0;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .capture-area {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0a;
      overflow: hidden;
    }

    .capture-preview {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      display: block;
      cursor: crosshair;
      user-select: none;
    }

    .capture-preview.fit-contain {
      object-fit: contain;
    }

    .capture-preview.fit-cover {
      object-fit: cover;
      width: 100%;
      height: 100%;
    }

    video.capture-preview {
      background: #000;
    }

    .capture-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2rem;
      padding: 2rem;
      text-align: center;
    }

    .status-message {
      font-size: 1.125rem;
      color: #a3a3a3;
      max-width: 500px;
    }

    .status-message.error {
      color: #EF4444;
    }

    .status-message.loading,
    .status-message.starting {
      color: #F59E0B;
    }

    .fps-indicator {
      position: absolute;
      bottom: 1rem;
      left: 1rem;
      background: rgba(15, 15, 15, 0.8);
      backdrop-filter: blur(10px);
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #10B981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .toggle-btn {
      background: none;
      border: none;
      color: #a3a3a3;
      cursor: pointer;
      padding: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }

    .toggle-btn:hover {
      color: #e4e4e4;
    }

    .toggle-btn.active {
      color: #10B981;
    }
  `;

  @state() private processGroups: ProcessGroup[] = [];
  @state() private displays: DisplayInfo[] = [];
  @state() private selectedWindow: WindowInfo | null = null;
  @state() private selectedWindowProcess: ProcessGroup | null = null;
  @state() private selectedDisplay: DisplayInfo | null = null;
  @state() private allDisplaysSelected = false;
  @state() private isCapturing = false;
  @state() private captureMode: 'desktop' | 'window' = 'desktop';
  @state() private frameUrl = '';
  @state() private status: 'idle' | 'ready' | 'loading' | 'starting' | 'capturing' | 'error' =
    'idle';
  @state() private error = '';
  @state() private fps = 0;
  @state() private showStats = false;
  @state() private streamStats: StreamStats | null = null;
  @state() private useWebRTC = true;
  @state() private sidebarCollapsed = false;
  @state() private fitMode: 'contain' | 'cover' = 'cover';
  @state() private frameCounter = 0;

  @query('video') private videoElement?: HTMLVideoElement;

  private wsClient: ScreencapWebSocketClient | null = null;
  private webrtcHandler: WebRTCHandler | null = null;
  private frameUpdateInterval: number | null = null;
  private localAuthToken?: string;

  connectedCallback() {
    super.connectedCallback();
    this.loadSidebarState();
    this.localAuthToken = this.getAttribute('local-auth-token') || undefined;
    this.initializeWebSocketClient();
    this.loadInitialData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanupWebSocketClient();
    if (this.frameUpdateInterval) {
      clearInterval(this.frameUpdateInterval);
    }
  }

  private loadSidebarState() {
    const saved = localStorage.getItem('screencap-sidebar-collapsed');
    if (saved === 'true') {
      this.sidebarCollapsed = true;
    }
  }

  private saveSidebarState() {
    localStorage.setItem('screencap-sidebar-collapsed', this.sidebarCollapsed.toString());
  }

  private initializeWebSocketClient() {
    if (!this.wsClient) {
      this.wsClient = new ScreencapWebSocketClient(
        `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/screencap-signal`
      );

      this.wsClient.onReady = () => {
        logger.log('WebSocket ready');
        this.status = 'ready';
      };

      this.wsClient.onError = (error: string) => {
        logger.error('WebSocket error:', error);
        this.error = error;
        this.status = 'error';
      };

      // Initialize WebRTC handler
      this.webrtcHandler = new WebRTCHandler(this.wsClient);
    }
  }

  private cleanupWebSocketClient() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    if (this.webrtcHandler) {
      this.webrtcHandler.stopCapture();
      this.webrtcHandler = null;
    }
  }

  private toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.saveSidebarState();
  }

  private toggleStats() {
    this.showStats = !this.showStats;
  }

  private toggleFitMode() {
    this.fitMode = this.fitMode === 'contain' ? 'cover' : 'contain';
  }

  private async handleRefresh() {
    await this.loadInitialData();
  }

  private async loadInitialData() {
    this.status = 'loading';

    try {
      await Promise.all([this.loadWindows(), this.loadDisplays()]);

      // Auto-select first display in desktop mode
      if (this.captureMode === 'desktop' && this.displays.length > 0 && !this.selectedDisplay) {
        this.selectedDisplay = this.displays[0];
      }

      this.status = 'ready';
    } catch (error) {
      logger.error('Failed to load initial data:', error);
      this.error = 'Failed to load capture sources';
      this.status = 'error';
    }
  }

  private async loadWindows() {
    if (!this.wsClient) return;

    try {
      const response = await this.wsClient.request<ProcessesResponse>('GET', '/processes');
      this.processGroups = response.processes || [];
      logger.log(`Loaded ${this.processGroups.length} process groups`);
    } catch (error) {
      logger.error('Failed to load windows:', error);
      throw error;
    }
  }

  private async loadDisplays() {
    if (!this.wsClient) return;

    try {
      const response = await this.wsClient.request<DisplaysResponse>('GET', '/displays');
      this.displays = response.displays || [];
      logger.log(`Loaded ${this.displays.length} displays`);
    } catch (error) {
      logger.error('Failed to load displays:', error);
      throw error;
    }
  }

  private async handleWindowSelect(event: CustomEvent) {
    const { window, process } = event.detail;
    this.selectedWindow = window;
    this.selectedWindowProcess = process;
    this.selectedDisplay = null;
    this.allDisplaysSelected = false;
    this.captureMode = 'window';

    if (this.isCapturing) {
      await this.stopCapture();
      await this.startCapture();
    }
  }

  private async handleDisplaySelect(event: CustomEvent) {
    this.selectedDisplay = event.detail;
    this.selectedWindow = null;
    this.selectedWindowProcess = null;
    this.allDisplaysSelected = false;
    this.captureMode = 'desktop';

    if (this.isCapturing) {
      await this.stopCapture();
      await this.startCapture();
    }
  }

  private async handleAllDisplaysSelect() {
    this.allDisplaysSelected = true;
    this.selectedDisplay = null;
    this.selectedWindow = null;
    this.selectedWindowProcess = null;
    this.captureMode = 'desktop';

    if (this.isCapturing) {
      await this.stopCapture();
      await this.startCapture();
    }
  }

  private async startCapture() {
    if (!this.wsClient) {
      this.error = 'WebSocket not connected';
      return;
    }

    this.status = 'starting';
    this.error = '';
    this.frameCounter = 0;

    try {
      if (this.useWebRTC) {
        await this.startWebRTCCapture();
      } else {
        await this.startJPEGCapture();
      }

      this.isCapturing = true;
      this.status = 'capturing';
    } catch (error) {
      logger.error('Failed to start capture:', error);
      this.error = error instanceof Error ? error.message : 'Failed to start capture';
      this.status = 'error';
      this.isCapturing = false;
    }
  }

  private async startWebRTCCapture() {
    if (!this.webrtcHandler) return;

    const callbacks = {
      onStreamReady: (stream: MediaStream) => {
        if (this.videoElement) {
          this.videoElement.srcObject = stream;
          this.videoElement.play().catch((error) => {
            logger.error('Failed to play video:', error);
          });
        }
      },
      onStatsUpdate: (stats: StreamStats) => {
        this.streamStats = stats;
        this.frameCounter++;
      },
      onError: (error: Error) => {
        logger.error('WebRTC error:', error);
        this.error = error.message;
        this.status = 'error';
      },
    };

    if (this.captureMode === 'desktop') {
      const displayIndex = this.allDisplaysSelected
        ? -1
        : this.selectedDisplay
          ? Number.parseInt(this.selectedDisplay.id)
          : 0;
      await this.webrtcHandler.startCapture('desktop', displayIndex, undefined, callbacks);
    } else if (this.captureMode === 'window' && this.selectedWindow) {
      await this.webrtcHandler.startCapture(
        'window',
        undefined,
        this.selectedWindow.cgWindowID,
        callbacks
      );
    }
  }

  private async startJPEGCapture() {
    if (!this.wsClient) return;

    let response: CaptureResponse | undefined;
    if (this.captureMode === 'desktop') {
      const displayIndex = this.allDisplaysSelected
        ? -1
        : this.selectedDisplay
          ? Number.parseInt(this.selectedDisplay.id)
          : 0;
      response = await this.wsClient.request<CaptureResponse>('POST', '/start-capture', {
        type: 'desktop',
        index: displayIndex,
        useWebRTC: false,
      });
    } else if (this.captureMode === 'window' && this.selectedWindow) {
      response = await this.wsClient.request<CaptureResponse>('POST', '/start-capture-window', {
        cgWindowID: this.selectedWindow.cgWindowID,
        useWebRTC: false,
      });
    }

    if (response?.sessionId) {
      logger.log('Capture started with session:', response.sessionId);
      this.startFrameUpdates();
    }
  }

  private async stopCapture() {
    this.isCapturing = false;
    this.status = 'ready';

    if (this.frameUpdateInterval) {
      clearInterval(this.frameUpdateInterval);
      this.frameUpdateInterval = null;
    }

    if (this.useWebRTC && this.webrtcHandler) {
      await this.webrtcHandler.stopCapture();
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
    } else if (this.wsClient) {
      try {
        await this.wsClient.request('POST', '/stop-capture');
      } catch (error) {
        logger.error('Failed to stop capture:', error);
      }
    }

    this.frameUrl = '';
    this.fps = 0;
    this.streamStats = null;
  }

  private startFrameUpdates() {
    if (this.frameUpdateInterval) {
      clearInterval(this.frameUpdateInterval);
    }

    let lastFrameTime = Date.now();
    this.frameUpdateInterval = window.setInterval(() => {
      this.updateFrame();

      // Calculate FPS
      const now = Date.now();
      const timeDiff = now - lastFrameTime;
      if (timeDiff > 0) {
        this.fps = Math.round(1000 / timeDiff);
      }
      lastFrameTime = now;
    }, 33); // ~30 FPS
  }

  private async updateFrame() {
    if (!this.wsClient || !this.isCapturing || this.useWebRTC) return;

    try {
      const response = await this.wsClient.request<FrameResponse>('GET', '/frame');
      if (response.frame) {
        this.frameUrl = `data:image/jpeg;base64,${response.frame}`;
        this.frameCounter++;
      }
    } catch (error) {
      logger.error('Failed to update frame:', error);
    }
  }

  render() {
    return html`
      <div class="header">
        <h1>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 3H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h4v2h8v-2h4c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 14H4V5h16v12z"/>
            <path d="M6 8.25h8v1.5H6zm10.5 1.5H18v-1.5h-1.5zm0 2.25H18V14h-1.5zm0-6H18V4.5h-1.5zM6 12.25h8v1.5H6z"/>
          </svg>
          Screen Capture
        </h1>

        <div class="header-actions">
          <button 
            class="toggle-btn ${this.sidebarCollapsed ? '' : 'active'}"
            @click=${this.toggleSidebar}
            title="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          </button>

          ${
            this.isCapturing
              ? html`
            <button 
              class="toggle-btn ${this.showStats ? 'active' : ''}"
              @click=${this.toggleStats}
              title="Toggle statistics"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
              </svg>
            </button>

            <button 
              class="toggle-btn"
              @click=${this.toggleFitMode}
              title="Toggle fit mode (${this.fitMode})"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                ${
                  this.fitMode === 'contain'
                    ? html`
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
                  <path d="M15 9l-3-3v2H8v2h4v2l3-3z"/>
                `
                    : html`
                  <path d="M7 9V7c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v2c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2h-2c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2v-6c0-1.1.9-2 2-2zm0 2v6h6v-6H7zm2-2h6V7H9v2zm0 0v2h2V9H9zm6 2v2h2v-2h-2zm0 0V9h-2v2h2z"/>
                `
                }
              </svg>
            </button>

            <button class="btn danger" @click=${this.stopCapture}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12"/>
              </svg>
              Stop
            </button>
          `
              : html`
            <button 
              class="btn primary" 
              @click=${this.startCapture}
              ?disabled=${this.status !== 'ready' || (!this.selectedDisplay && !this.selectedWindow && !this.allDisplaysSelected)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Start
            </button>
          `
          }
        </div>
      </div>

      <div class="main-container">
        <div class="sidebar ${this.sidebarCollapsed ? 'collapsed' : ''}">
          <screencap-sidebar
            .captureMode=${this.captureMode}
            .processGroups=${this.processGroups}
            .displays=${this.displays}
            .selectedWindow=${this.selectedWindow}
            .selectedDisplay=${this.selectedDisplay}
            .allDisplaysSelected=${this.allDisplaysSelected}
            @refresh-request=${this.handleRefresh}
            @window-select=${this.handleWindowSelect}
            @display-select=${this.handleDisplaySelect}
            @all-displays-select=${this.handleAllDisplaysSelect}
          ></screencap-sidebar>
        </div>

        <div class="content">
          <div class="capture-area">
            ${this.renderCaptureContent()}
          </div>
        </div>
      </div>
    `;
  }

  private renderCaptureContent() {
    // WebRTC mode - show video element
    if (this.useWebRTC && this.isCapturing) {
      return html`
        <video 
          class="capture-preview fit-${this.fitMode}"
          autoplay
          playsinline
          muted
        ></video>
        ${
          this.showStats
            ? html`
          <screencap-stats
            .stats=${this.streamStats}
            .frameCounter=${this.frameCounter}
          ></screencap-stats>
        `
            : ''
        }
      `;
    }

    // JPEG mode - show image element
    if (this.frameUrl && this.isCapturing && !this.useWebRTC) {
      return html`
        <img 
          src="${this.frameUrl}" 
          class="capture-preview fit-${this.fitMode}"
          alt="Screen capture"
        />
        <div class="fps-indicator">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1h-3v2h2a1 1 0 110 2H5a1 1 0 110-2h2v-2H4a1 1 0 01-1-1V4zm2 1v6h10V5H5z"/>
          </svg>
          ${this.fps} FPS
        </div>
      `;
    }

    // Show overlay when not capturing or waiting to start
    return html`
      <div class="capture-overlay">
        <div class="status-message ${this.status}">
          ${
            this.status === 'loading'
              ? 'Loading...'
              : this.status === 'starting'
                ? 'Starting capture...'
                : this.status === 'error'
                  ? this.error
                  : this.status === 'ready'
                    ? this.captureMode === 'desktop'
                      ? this.selectedDisplay || this.allDisplaysSelected
                        ? 'Click Start to begin screen capture'
                        : 'Select a display to capture'
                      : this.selectedWindow
                        ? 'Click Start to begin window capture'
                        : 'Select a window to capture'
                    : 'Initializing...'
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

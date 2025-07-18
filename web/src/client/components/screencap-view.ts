import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { isScreencapError, ScreencapErrorCode } from '../../shared/screencap-errors.js';
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
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: rgb(var(--color-bg));
      color: rgb(var(--color-text));
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
      overflow: hidden;
      
      /* Honor safe areas on mobile devices */
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }

    .header {
      display: flex;
      align-items: center;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(to right, rgb(var(--color-bg-secondary)), rgb(var(--color-bg-tertiary)));
      border-bottom: 1px solid rgb(var(--color-border));
      gap: 1rem;
      box-shadow: 0 1px 3px rgb(var(--color-bg-base) / 0.3);
    }

    .header h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: rgb(var(--color-primary));
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
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.5rem;
      background: transparent;
      color: rgb(var(--color-text));
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
      border-color: rgb(var(--color-primary));
      color: rgb(var(--color-primary));
    }

    .btn.primary {
      background: rgb(var(--color-primary));
      color: rgb(var(--color-bg));
      border-color: rgb(var(--color-primary));
      font-weight: 500;
    }

    .btn.primary:hover {
      background: rgb(var(--color-primary-hover));
      border-color: rgb(var(--color-primary-hover));
    }

    .btn.danger {
      background: rgb(var(--color-status-error));
      color: rgb(var(--color-text-bright));
      border-color: rgb(var(--color-status-error));
    }

    .btn.danger:hover {
      background: rgb(var(--color-status-error));
      border-color: rgb(var(--color-status-error));
    }

    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0; /* Critical for flexbox children to shrink */
    }

    .sidebar {
      width: 320px;
      transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), margin-left 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      overflow-y: auto;
      overflow-x: hidden;
      flex-shrink: 0;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .sidebar.collapsed {
      transform: translateX(-100%);
      margin-left: -320px;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0; /* Allow content to shrink below its minimum content size */
      min-height: 0; /* Allow content to shrink below its minimum content size */
    }

    .capture-area {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgb(var(--color-bg));
      overflow: hidden;
      padding: 1rem;
    }

    .capture-preview {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      display: block;
      cursor: crosshair;
      user-select: none;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
      /* Let the natural aspect ratio determine dimensions */
      object-fit: scale-down;
    }
    
    /* For window capture, ensure the window fills available space while maintaining aspect ratio */
    .capture-preview.window-mode {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: rgb(var(--color-bg));
    }

    :host(:focus) {
      outline: 2px solid rgb(var(--color-status-info));
      outline-offset: -2px;
    }

    /* Desktop capture modes */
    .capture-preview.fit-contain {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .capture-preview.fit-cover {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    /* Override fit mode for window capture to always use contain */
    .capture-preview.window-mode {
      object-fit: contain !important;
    }

    video.capture-preview {
      background: rgb(var(--color-bg));
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
      color: rgb(var(--color-text-muted));
      max-width: 500px;
    }

    .status-message.error {
      color: rgb(var(--color-status-error));
      font-weight: 500;
      background: rgb(var(--color-status-error) / 0.1);
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(var(--color-status-error) / 0.3);
      line-height: 1.6;
    }

    .status-message.loading,
    .status-message.starting {
      color: rgb(var(--color-status-warning));
    }

    .fps-indicator {
      position: absolute;
      bottom: calc(1rem + env(safe-area-inset-bottom));
      left: calc(1rem + env(safe-area-inset-left));
      background: rgba(15, 15, 15, 0.8);
      backdrop-filter: blur(10px);
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: rgb(var(--color-primary));
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .back-btn {
      background: none;
      border: none;
      color: rgb(var(--color-text-muted));
      cursor: pointer;
      padding: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
      margin-right: 0.5rem;
    }

    .back-btn:hover {
      color: rgb(var(--color-primary));
    }

    .toggle-btn {
      background: none;
      border: none;
      color: rgb(var(--color-text-muted));
      cursor: pointer;
      padding: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
      margin-right: 0.5rem;
    }

    .toggle-btn:hover {
      color: rgb(var(--color-text));
    }

    .toggle-btn.active {
      color: rgb(var(--color-primary));
    }

    .status-log {
      position: absolute;
      bottom: calc(3rem + env(safe-area-inset-bottom));
      left: max(1rem, env(safe-area-inset-left));
      right: max(1rem, env(safe-area-inset-right));
      max-width: 600px;
      max-height: 200px;
      overflow-y: auto;
      background: rgb(var(--color-bg-elevated) / 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid rgb(var(--color-border) / 0.3);
      border-radius: 0.5rem;
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      line-height: 1.5;
      color: rgb(var(--color-text-muted));
    }

    .status-log-entry {
      margin-bottom: 0.5rem;
      display: flex;
      gap: 0.5rem;
    }

    .status-log-time {
      color: rgb(var(--color-text-dim));
      flex-shrink: 0;
    }

    .status-log-message {
      flex: 1;
    }

    .status-log-entry.info { color: rgb(var(--color-status-info)); }
    .status-log-entry.success { color: rgb(var(--color-status-success)); }
    .status-log-entry.warning { color: rgb(var(--color-status-warning)); }
    .status-log-entry.error { color: rgb(var(--color-status-error)); }

    .switch {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }

    .switch input {
      appearance: none;
      width: 36px;
      height: 20px;
      border-radius: 10px;
      background: rgb(var(--color-surface-hover));
      position: relative;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .switch input::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgb(var(--color-text-bright));
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
    }

    .switch input:checked {
      background-color: rgb(var(--color-primary));
    }

    .switch input:checked::before {
      transform: translateX(16px);
    }

    .control-hint {
      position: absolute;
      bottom: calc(1rem + env(safe-area-inset-bottom));
      left: 50%;
      transform: translateX(-50%);
      background: rgb(var(--color-bg-base) / 0.8);
      color: rgb(var(--color-text-muted));
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      pointer-events: none;
      transition: opacity 0.2s;
    }

    :host(:focus) .control-hint {
      opacity: 0;
    }

    .keyboard-button {
      position: fixed;
      bottom: calc(20px + env(safe-area-inset-bottom));
      right: calc(20px + env(safe-area-inset-right));
      width: 60px;
      height: 60px;
      background: rgb(var(--color-primary));
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 6px rgb(var(--color-bg-base) / 0.3);
      z-index: 1000;
      cursor: pointer;
      transition: all 0.2s;
    }

    .keyboard-button:hover {
      background: rgb(var(--color-primary-hover));
      transform: scale(1.1);
    }

    .keyboard-button svg {
      width: 28px;
      height: 28px;
      color: rgb(var(--color-text-bright));
    }

    .mobile-keyboard-input {
      position: fixed;
      left: -9999px;
      top: -9999px;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
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
  @state() private showLog = false;
  @state() private streamStats: StreamStats | null = null;
  @state() private useWebRTC = true;
  @state() private use8k = false;
  @state() private sidebarCollapsed = false;
  @state() private fitMode: 'contain' | 'cover' = 'contain';
  @state() private frameCounter = 0;
  @state() private showMobileKeyboard = false;
  @state() private isMobile = false;
  @state() private isDragging = false;
  @state() private dragStartCoords: { x: number; y: number } | null = null;
  @state() private statusLog: Array<{
    time: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
  }> = [];

  // Auto-scroll state (not reactive to avoid re-renders)
  private isLogScrolledToBottom = true;

  @query('video') private videoElement?: HTMLVideoElement;

  private wsClient: ScreencapWebSocketClient | null = null;
  private webrtcHandler: WebRTCHandler | null = null;
  private frameUpdateInterval: number | null = null;
  private localAuthToken?: string;
  private boundHandleKeyDown: ((event: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadSidebarState();
    this.localAuthToken = this.getAttribute('local-auth-token') || undefined;
    this.initializeWebSocketClient();

    // Add keyboard listener to the whole component
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.addEventListener('keydown', this.boundHandleKeyDown);
    // Make the component focusable
    this.tabIndex = 0;

    // Detect if this is a touch device
    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanupWebSocketClient();
    if (this.frameUpdateInterval) {
      clearInterval(this.frameUpdateInterval);
    }

    // Remove keyboard listener
    if (this.boundHandleKeyDown) {
      this.removeEventListener('keydown', this.boundHandleKeyDown);
      this.boundHandleKeyDown = null;
    }
    if (this.mouseMoveThrottleTimeout) {
      clearTimeout(this.mouseMoveThrottleTimeout);
    }
  }

  private handleLogScroll(event: Event) {
    const logElement = event.target as HTMLDivElement;
    if (!logElement) return;

    // Check if user is scrolled to bottom (with a small threshold)
    const threshold = 10; // pixels
    const isAtBottom =
      logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight < threshold;

    this.isLogScrolledToBottom = isAtBottom;
  }

  private logStatus(type: 'info' | 'success' | 'warning' | 'error', message: string) {
    const now = new Date();
    const time =
      now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) +
      '.' +
      now.getMilliseconds().toString().padStart(3, '0');

    this.statusLog = [...this.statusLog, { time, type, message }];

    // Keep only last 50 entries
    if (this.statusLog.length > 50) {
      this.statusLog = this.statusLog.slice(-50);
    }

    // Auto-scroll status log to bottom after update (only if already at bottom)
    this.updateComplete.then(() => {
      const logElement = this.shadowRoot?.querySelector('.status-log');
      if (logElement && this.isLogScrolledToBottom) {
        logElement.scrollTop = logElement.scrollHeight;
      }
    });
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
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
        window.location.host
      }/ws/screencap-signal`;

      this.logStatus('info', `Initializing WebSocket connection to: ${wsUrl}`);
      logger.log(`🚀 Creating ScreencapWebSocketClient with URL: ${wsUrl}`);

      this.wsClient = new ScreencapWebSocketClient(wsUrl);

      this.wsClient.onReady = () => {
        logger.log('✅ WebSocket ready callback fired');
        this.logStatus('success', 'WebSocket connection established');
        this.logStatus('info', 'Mac app connected - loading capture sources...');
        this.status = 'ready';
        // Load data again after connection is established to ensure fresh state
        // The first loadInitialData() call below triggers the WebSocket connection,
        // this second call refreshes the data once we're properly connected
        this.loadInitialData();
      };

      this.wsClient.onError = (error: string) => {
        logger.error('❌ WebSocket error callback fired:', error);
        this.logStatus('error', `WebSocket error: ${error}`);
        this.error = error;
        this.status = 'error';
      };

      // Initialize WebRTC handler
      this.webrtcHandler = new WebRTCHandler(this.wsClient);

      // Trigger initial connection by loading data
      // This first call to loadInitialData() is crucial - it triggers the WebSocket connection
      // by making API requests (loadWindows/loadDisplays) that call wsClient.request(),
      // which in turn calls connect(). Without this, the WebSocket would never connect.
      logger.log('🔄 Triggering initial data load to establish WebSocket connection');
      this.loadInitialData();
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

  private toggleLog() {
    this.showLog = !this.showLog;
  }

  private handleWebRTCToggle(e: Event) {
    this.useWebRTC = (e.target as HTMLInputElement).checked;
  }

  private handle8kToggle(e: Event) {
    this.use8k = (e.target as HTMLInputElement).checked;
  }

  private async handleRefresh() {
    await this.loadInitialData();
  }

  private async loadInitialData() {
    logger.log('📊 loadInitialData called');
    this.logStatus('info', 'Loading capture sources...');
    this.status = 'loading';

    try {
      logger.log('🔄 Starting parallel load of windows and displays');
      await Promise.all([this.loadWindows(), this.loadDisplays()]);
      logger.log('✅ Successfully loaded initial data');

      // Auto-select first display in desktop mode
      if (this.captureMode === 'desktop' && this.displays.length > 0 && !this.selectedDisplay) {
        this.selectedDisplay = this.displays[0];
        logger.log(`🖥️ Auto-selected first display: ${this.selectedDisplay.name}`);
      }

      this.status = 'ready';
      this.logStatus('success', 'Capture sources loaded successfully');
    } catch (error) {
      logger.error('❌ Failed to load initial data:', error);

      // Check if error message already contains permission instructions
      if (this.error?.includes('Screen Recording permission')) {
        // Permission error was already set by loadWindows or loadDisplays
        this.logStatus('warning', 'Please follow the instructions above to grant permissions');
      } else if (isScreencapError(error) && error.code === ScreencapErrorCode.PERMISSION_DENIED) {
        this.error =
          'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
        this.logStatus('error', 'Screen Recording permission denied');
      } else {
        // Fallback check for permission errors in string format
        const errorStr = String(error).toLowerCase();
        if (
          errorStr.includes('permission') ||
          errorStr.includes('denied') ||
          errorStr.includes('not authorized')
        ) {
          this.error =
            'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
          this.logStatus('error', 'Screen Recording permission denied');
        } else {
          this.logStatus('error', `Failed to load capture sources: ${error}`);
          this.error = 'Failed to load capture sources';
        }
      }

      this.status = 'error';
    }
  }

  private async loadWindows() {
    logger.log('🪟 loadWindows called');

    if (!this.wsClient) {
      logger.error('❌ No WebSocket client available in loadWindows');
      return;
    }

    try {
      logger.log('📤 Requesting process groups...');
      const response = await this.wsClient.request<ProcessesResponse>('GET', '/processes');
      logger.log('📥 Process groups response:', response);
      this.processGroups = response.processes || [];
      logger.log(`✅ Loaded ${this.processGroups.length} process groups`);
      this.logStatus('info', `Loaded ${this.processGroups.length} process groups`);
    } catch (error) {
      logger.error('❌ Failed to load windows:', error);

      // Check if this is a permission error
      if (isScreencapError(error) && error.code === ScreencapErrorCode.PERMISSION_DENIED) {
        this.logStatus('error', 'Screen Recording permission denied');
        this.error =
          'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
      } else {
        // Fallback check for permission errors in string format
        const errorStr = String(error).toLowerCase();
        if (
          errorStr.includes('permission') ||
          errorStr.includes('denied') ||
          errorStr.includes('not authorized')
        ) {
          this.logStatus('error', 'Screen Recording permission denied');
          this.error =
            'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
        } else {
          this.logStatus('error', `Failed to load windows: ${error}`);
        }
      }

      throw error;
    }
  }

  private async loadDisplays() {
    logger.log('🖥️ loadDisplays called');

    if (!this.wsClient) {
      logger.error('❌ No WebSocket client available in loadDisplays');
      return;
    }

    try {
      logger.log('📤 Requesting displays...');
      const response = await this.wsClient.request<DisplaysResponse>('GET', '/displays');
      logger.log('📥 Displays response:', response);
      this.displays = response.displays || [];
      logger.log(`✅ Loaded ${this.displays.length} displays`);
      this.logStatus('info', `Loaded ${this.displays.length} displays`);
    } catch (error) {
      logger.error('❌ Failed to load displays:', error);

      // Check if this is a permission error
      if (isScreencapError(error) && error.code === ScreencapErrorCode.PERMISSION_DENIED) {
        this.logStatus('error', 'Screen Recording permission denied');
        this.error =
          'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
      } else {
        // Fallback check for permission errors in string format
        const errorStr = String(error).toLowerCase();
        if (
          errorStr.includes('permission') ||
          errorStr.includes('denied') ||
          errorStr.includes('not authorized')
        ) {
          this.logStatus('error', 'Screen Recording permission denied');
          this.error =
            'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
        } else {
          this.logStatus('error', `Failed to load displays: ${error}`);
        }
      }

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
      this.logStatus('error', 'Cannot start capture: WebSocket not connected');
      return;
    }

    this.status = 'starting';
    this.error = '';
    this.frameCounter = 0;
    this.statusLog = []; // Clear previous logs
    this.showLog = false; // Hide log on new capture

    this.logStatus('info', 'Starting capture process...');

    try {
      if (this.useWebRTC) {
        this.logStatus('info', 'Using WebRTC mode for high-quality streaming');
        await this.startWebRTCCapture();
      } else {
        this.logStatus('info', 'Using JPEG mode for compatibility');
        await this.startJPEGCapture();
      }

      this.isCapturing = true;
      this.status = 'capturing';
      this.logStatus('success', 'Capture started successfully');
    } catch (error) {
      logger.error('Failed to start capture:', error);

      // Extract error message from various error types
      let errorMessage = 'Failed to start capture';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        // Handle error objects from API responses
        if ('message' in error) {
          errorMessage = String(error.message);
        } else if ('error' in error) {
          errorMessage = String(error.error);
        } else if ('details' in error) {
          errorMessage = String(error.details);
        } else {
          // Last resort - try to stringify the object
          try {
            errorMessage = JSON.stringify(error);
          } catch {
            errorMessage = 'Unknown error (could not serialize)';
          }
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Check if this is a permission error and provide helpful instructions
      if (isScreencapError(error) && error.code === ScreencapErrorCode.PERMISSION_DENIED) {
        this.error =
          'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
        this.logStatus('error', 'Screen Recording permission denied - see instructions above');
      } else {
        // Fallback check for permission errors in string format
        const errorStr = errorMessage.toLowerCase();
        if (
          errorStr.includes('permission') ||
          errorStr.includes('denied') ||
          errorStr.includes('not authorized') ||
          errorStr.includes('cgwindowlistcreate')
        ) {
          this.error =
            'Screen Recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording, then restart VibeTunnel.';
          this.logStatus('error', 'Screen Recording permission denied - see instructions above');
        } else {
          this.error = errorMessage;
          this.logStatus('error', `Failed to start capture: ${errorMessage}`);
        }
      }

      this.status = 'error';
      this.isCapturing = false;
    }
  }

  private async startWebRTCCapture() {
    if (!this.webrtcHandler || !this.wsClient) return;

    const callbacks = {
      onStreamReady: async (stream: MediaStream) => {
        this.logStatus('success', 'WebRTC stream ready, connecting to video element...');
        await this.updateComplete;
        if (this.videoElement) {
          this.videoElement.srcObject = stream;
          this.videoElement.play().catch((error) => {
            logger.error('Failed to play video:', error);
            this.logStatus('error', `Failed to start video playback: ${error}`);
          });
        }
      },
      onStatsUpdate: (stats: StreamStats) => {
        this.streamStats = stats;
        this.frameCounter++;
      },
      onError: (error: Error) => {
        logger.error('WebRTC error:', error);
        this.logStatus('error', `WebRTC error: ${error.message}`);
        this.error = error.message;
        this.status = 'error';
      },
      onStatusUpdate: (type: 'info' | 'success' | 'warning' | 'error', message: string) => {
        this.logStatus(type, message);
      },
    };

    // First send the actual capture request to start screen capture with WebRTC enabled
    let captureResponse: CaptureResponse | undefined;

    if (this.captureMode === 'desktop') {
      const displayIndex = this.allDisplaysSelected
        ? -1
        : this.selectedDisplay
          ? Number.parseInt(this.selectedDisplay.id.replace('NSScreen-', ''))
          : 0;

      if (this.allDisplaysSelected) {
        this.logStatus('info', 'Requesting capture of all displays');
      } else {
        this.logStatus('info', `Requesting capture of display ${displayIndex}`);
      }

      this.logStatus('info', 'Sending screen capture request to Mac app...');
      captureResponse = (await this.wsClient.startCapture({
        type: 'desktop',
        index: displayIndex,
        webrtc: true,
        use8k: this.use8k,
      })) as CaptureResponse;

      if (captureResponse?.sessionId) {
        this.logStatus(
          'success',
          `Screen capture started with session: ${captureResponse.sessionId.substring(0, 8)}...`
        );
      }

      // Then start WebRTC connection
      this.logStatus('info', 'Initiating WebRTC connection...');
      await this.webrtcHandler.startCapture('desktop', displayIndex, undefined, callbacks);
    } else if (this.captureMode === 'window' && this.selectedWindow) {
      this.logStatus(
        'info',
        `Requesting capture of window: ${this.selectedWindow.title || 'Untitled'}`
      );

      this.logStatus('info', 'Sending window capture request to Mac app...');
      captureResponse = (await this.wsClient.captureWindow({
        cgWindowID: this.selectedWindow.cgWindowID,
        webrtc: true,
        use8k: this.use8k,
      })) as CaptureResponse;

      if (captureResponse?.sessionId) {
        this.logStatus(
          'success',
          `Window capture started with session: ${captureResponse.sessionId.substring(0, 8)}...`
        );
      }

      // Then start WebRTC connection
      this.logStatus('info', 'Initiating WebRTC connection...');
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

    this.logStatus('info', 'Requesting capture in JPEG mode...');

    let response: CaptureResponse | undefined;
    if (this.captureMode === 'desktop') {
      const displayIndex = this.allDisplaysSelected
        ? -1
        : this.selectedDisplay
          ? Number.parseInt(this.selectedDisplay.id.replace('NSScreen-', ''))
          : 0;

      if (this.allDisplaysSelected) {
        this.logStatus('info', 'Requesting capture of all displays (JPEG mode)');
      } else {
        this.logStatus('info', `Requesting capture of display ${displayIndex} (JPEG mode)`);
      }

      response = (await this.wsClient.startCapture({
        type: 'desktop',
        index: displayIndex,
        webrtc: false, // Explicitly set to false for JPEG
      })) as CaptureResponse;
    } else if (this.captureMode === 'window' && this.selectedWindow) {
      this.logStatus(
        'info',
        `Requesting capture of window: ${this.selectedWindow.title || 'Untitled'} (JPEG mode)`
      );
      response = (await this.wsClient.captureWindow({
        cgWindowID: this.selectedWindow.cgWindowID,
        webrtc: false, // Explicitly set to false for JPEG
      })) as CaptureResponse;
    }

    if (response?.sessionId) {
      this.logStatus(
        'success',
        `JPEG capture started with session: ${response.sessionId.substring(0, 8)}...`
      );
      this.startFrameUpdates();
    } else {
      // This case might indicate an error from the backend
      throw new Error('Failed to get a session ID for JPEG capture.');
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
        await this.wsClient.stopCapture();
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
      <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
        <div class="header">
        <button 
          class="back-btn"
          @click=${() => {
            window.location.href = '/';
          }}
          title="Back to sessions"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"/>
          </svg>
        </button>
        
        <button 
          class="toggle-btn ${this.sidebarCollapsed ? '' : 'active'}"
          @click=${this.toggleSidebar}
          title="Toggle sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
        
        <h1>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 3H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h4v2h8v-2h4c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 14H4V5h16v12z"/>
            <path d="M6 8.25h8v1.5H6zm10.5 1.5H18v-1.5h-1.5zm0 2.25H18V14h-1.5zm0-6H18V4.5h-1.5zM6 12.25h8v1.5H6z"/>
          </svg>
          Screen Capture
        </h1>

        <div class="header-actions">
          <button
            class="toggle-btn ${this.showLog ? 'active' : ''}"
            @click=${this.toggleLog}
            title="Toggle Log"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
          </button>

          <!-- Temporarily disabled until fully implemented
          <div class="switch" title="Toggle between WebRTC and JPEG stream">
            <span>JPEG</span>
            <input type="checkbox" .checked=${this.useWebRTC} @change=${this.handleWebRTCToggle}>
            <span>WebRTC</span>
          </div>

          <div class="switch" title="Toggle 8K quality (WebRTC only)">
            <span>4K</span>
            <input type="checkbox" .checked=${this.use8k} @change=${this.handle8kToggle} ?disabled=${!this.useWebRTC}>
            <span>8K</span>
          </div>
          -->

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
      </div>
    `;
  }

  private renderCaptureContent() {
    // WebRTC mode - show video element
    if (this.useWebRTC && this.isCapturing) {
      return html`
        <video 
          class="capture-preview fit-${this.fitMode} ${this.captureMode === 'window' ? 'window-mode' : ''}"
          autoplay
          playsinline
          muted
          @mousedown=${this.handleMouseDown}
          @mouseup=${this.handleMouseUp}
          @mousemove=${this.handleMouseMove}
          @click=${this.handleClick}
          @contextmenu=${this.handleContextMenu}
          @touchstart=${this.handleTouchStart}
          @touchmove=${this.handleTouchMove}
          @touchend=${this.handleTouchEnd}
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
        ${this.showLog ? this.renderStatusLog() : ''}
      `;
    }

    // JPEG mode - show image element
    if (this.frameUrl && this.isCapturing && !this.useWebRTC) {
      // Create a mock stats object for JPEG mode
      const jpegStats: StreamStats = {
        codec: 'JPEG',
        codecImplementation: 'N/A',
        resolution: `${this.shadowRoot?.querySelector('img')?.naturalWidth || 0}x${this.shadowRoot?.querySelector('img')?.naturalHeight || 0}`,
        fps: this.fps,
        bitrate: 0, // Not applicable for JPEG polling
        latency: 0, // Not applicable
        packetsLost: 0,
        packetLossRate: 0,
        jitter: 0,
        timestamp: Date.now(),
      };

      return html`
        <img 
          src="${this.frameUrl}" 
          class="capture-preview fit-${this.fitMode} ${this.captureMode === 'window' ? 'window-mode' : ''}"
          alt="Screen capture"
          @mousedown=${this.handleMouseDown}
          @mouseup=${this.handleMouseUp}
          @mousemove=${this.handleMouseMove}
          @click=${this.handleClick}
          @contextmenu=${this.handleContextMenu}
          @touchstart=${this.handleTouchStart}
          @touchmove=${this.handleTouchMove}
          @touchend=${this.handleTouchEnd}
        />
        <div class="fps-indicator">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1h-3v2h2a1 1 0 110 2H5a1 1 0 110-2h2v-2H4a1 1 0 01-1-1V4zm2 1v6h10V5H5z"/>
          </svg>
          ${this.fps} FPS
        </div>
        ${
          this.showStats
            ? html`
          <screencap-stats
            .stats=${jpegStats}
            .frameCounter=${this.frameCounter}
          ></screencap-stats>
        `
            : ''
        }
        ${this.showLog ? this.renderStatusLog() : ''}
        
        <!-- Mobile Keyboard Button -->
        ${
          this.isMobile && this.isCapturing
            ? html`
              <div
                class="keyboard-button"
                @click=${this.handleKeyboardButtonClick}
                title="Show keyboard"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/>
                </svg>
              </div>
              
              <!-- Hidden input for mobile keyboard -->
              <input
                type="text"
                class="mobile-keyboard-input"
                id="mobile-keyboard-input"
                @input=${this.handleMobileKeyboardInput}
                @keydown=${this.handleMobileKeyboardKeydown}
              />
            `
            : ''
        }
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
        ${this.showLog || this.status !== 'capturing' ? this.renderStatusLog() : ''}
      </div>
    `;
  }

  private renderStatusLog() {
    if (this.statusLog.length === 0) return '';

    return html`
      <div class="status-log" @scroll=${this.handleLogScroll}>
        ${this.statusLog.map(
          (entry) => html`
          <div class="status-log-entry ${entry.type}">
            <span class="status-log-time">${entry.time}</span>
            <span class="status-log-message">${entry.message}</span>
          </div>
        `
        )}
      </div>
    `;
  }

  // Mouse and keyboard event handling
  private getNormalizedCoordinates(event: MouseEvent | Touch): { x: number; y: number } | null {
    const element = (event instanceof Touch ? event.target : event.target) as HTMLElement;
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Normalize to 0-1000 range
    const normalizedX = Math.round((x / rect.width) * 1000);
    const normalizedY = Math.round((y / rect.height) * 1000);

    // Clamp values to valid range
    return {
      x: Math.max(0, Math.min(1000, normalizedX)),
      y: Math.max(0, Math.min(1000, normalizedY)),
    };
  }

  private async handleClick(event: MouseEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing) return;

    const coords = this.getNormalizedCoordinates(event);
    if (!coords) return;

    try {
      await this.wsClient.sendClick(coords.x, coords.y);
    } catch (error) {
      console.error('Failed to send click:', error);
    }
  }

  private async handleMouseDown(event: MouseEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing) return;

    const coords = this.getNormalizedCoordinates(event);
    if (!coords) return;

    try {
      await this.wsClient.sendMouseDown(coords.x, coords.y);
    } catch (error) {
      console.error('Failed to send mouse down:', error);
    }
  }

  private async handleMouseUp(event: MouseEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing) return;

    const coords = this.getNormalizedCoordinates(event);
    if (!coords) return;

    try {
      await this.wsClient.sendMouseUp(coords.x, coords.y);
    } catch (error) {
      console.error('Failed to send mouse up:', error);
    }
  }

  private async handleMouseMove(event: MouseEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing) return;

    // Throttle mouse move events
    if (this.mouseMoveThrottleTimeout) return;

    this.mouseMoveThrottleTimeout = window.setTimeout(() => {
      this.mouseMoveThrottleTimeout = null;
    }, 16); // ~60fps

    const coords = this.getNormalizedCoordinates(event);
    if (!coords) return;

    try {
      await this.wsClient.sendMouseMove(coords.x, coords.y);
    } catch (error) {
      console.error('Failed to send mouse move:', error);
    }
  }

  private handleContextMenu(event: MouseEvent) {
    event.preventDefault(); // Prevent context menu from showing
  }

  private async handleKeyDown(event: KeyboardEvent) {
    if (!this.wsClient || !this.isCapturing) return;

    // Don't capture if user is typing in an input field
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    event.preventDefault();

    try {
      await this.wsClient.sendKey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
    } catch (error) {
      console.error('Failed to send key:', error);
    }
  }

  private mouseMoveThrottleTimeout: number | null = null;

  // Touch event handlers
  private handleTouchStart(event: TouchEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const coords = this.getNormalizedCoordinates(touch);
    if (!coords) return;

    this.isDragging = true;
    this.dragStartCoords = coords;

    // Send mouse down event
    this.wsClient.sendMouseDown(coords.x, coords.y).catch((error) => {
      console.error('Failed to send touch start:', error);
    });
  }

  private handleTouchMove(event: TouchEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing || !this.isDragging || event.touches.length !== 1)
      return;

    const touch = event.touches[0];
    const coords = this.getNormalizedCoordinates(touch);
    if (!coords) return;

    // Send mouse move event
    this.wsClient.sendMouseMove(coords.x, coords.y).catch((error) => {
      console.error('Failed to send touch move:', error);
    });
  }

  private handleTouchEnd(event: TouchEvent) {
    event.preventDefault();
    if (!this.wsClient || !this.isCapturing || !this.isDragging) return;

    // Use the last touch position
    if (event.changedTouches.length > 0) {
      const touch = event.changedTouches[0];
      const coords = this.getNormalizedCoordinates(touch);
      if (coords) {
        // Send mouse up event
        this.wsClient.sendMouseUp(coords.x, coords.y).catch((error) => {
          console.error('Failed to send touch end:', error);
        });

        // If it was a tap (not a drag), send a click
        if (
          this.dragStartCoords &&
          Math.abs(coords.x - this.dragStartCoords.x) < 10 &&
          Math.abs(coords.y - this.dragStartCoords.y) < 10
        ) {
          this.wsClient.sendClick(coords.x, coords.y).catch((error) => {
            console.error('Failed to send tap:', error);
          });
        }
      }
    }

    this.isDragging = false;
    this.dragStartCoords = null;
  }

  // Mobile keyboard handlers
  private handleKeyboardButtonClick() {
    const input = this.shadowRoot?.getElementById('mobile-keyboard-input') as HTMLInputElement;
    if (input) {
      this.showMobileKeyboard = true;
      input.style.pointerEvents = 'auto';
      input.style.position = 'fixed';
      input.style.left = '0';
      input.style.top = '0';
      input.style.width = '1px';
      input.style.height = '1px';
      input.style.opacity = '0';
      input.focus();
    }
  }

  private handleMobileKeyboardInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value;

    if (value && this.wsClient && this.isCapturing) {
      // Send each character
      const lastChar = value[value.length - 1];
      this.wsClient
        .sendKey({
          key: lastChar,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        })
        .catch((error) => {
          console.error('Failed to send key:', error);
        });
    }
  }

  private handleMobileKeyboardKeydown(event: KeyboardEvent) {
    if (!this.wsClient || !this.isCapturing) return;

    // Handle special keys
    if (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Tab') {
      event.preventDefault();

      this.wsClient
        .sendKey({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        })
        .catch((error) => {
          console.error('Failed to send special key:', error);
        });

      // Clear input on Enter
      if (event.key === 'Enter') {
        const input = event.target as HTMLInputElement;
        input.value = '';
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'screencap-view': ScreencapView;
  }
}

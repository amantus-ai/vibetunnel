import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ScreencapApiClient } from '../services/screencap-api-client.js';
import type { ProcessGroup, WindowInfo } from '../types/screencap.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-view');

interface DisplayInfo {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
  x: number;
  y: number;
  name?: string;
  physicalWidth?: number;
  physicalHeight?: number;
  boundsWidth?: number;
  boundsHeight?: number;
}

interface StreamStats {
  codec: string;
  codecImplementation: string;
  resolution: string;
  fps: number;
  bitrate: number;
  latency: number;
  packetsLost: number;
  packetLossRate: number;
  jitter: number;
  timestamp: number;
}

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ready';
  data?: RTCSessionDescriptionInit | RTCIceCandidateInit | string;
}

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
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
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
    }

    .btn.primary:hover {
      background: #059669;
      border-color: #059669;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn.active {
      background: #2a2a2a;
      border-color: #10B981;
      color: #10B981;
    }

    .btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    .main-content {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 320px;
      background: #141414;
      border-right: 1px solid #2a2a2a;
      overflow-y: auto;
      transition: width 0.3s ease, opacity 0.3s ease;
    }

    .sidebar.collapsed {
      width: 0;
      opacity: 0;
      overflow: hidden;
    }

    .sidebar-toggle {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 10;
      padding: 0.5rem 0.25rem;
      background: #262626;
      border: 1px solid #2a2a2a;
      border-left: none;
      border-radius: 0 0.375rem 0.375rem 0;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sidebar-toggle:hover {
      background: #2a2a2a;
      border-color: #10B981;
    }

    .sidebar-toggle svg {
      width: 16px;
      height: 16px;
      fill: #a3a3a3;
      transition: transform 0.3s ease;
    }

    .sidebar-toggle:hover svg {
      fill: #10B981;
    }

    .sidebar-toggle.collapsed {
      left: 0;
    }

    .sidebar-toggle.collapsed svg {
      transform: rotate(180deg);
    }

    .sidebar-section {
      padding: 1rem;
      border-bottom: 1px solid #2a2a2a;
    }

    .sidebar-section h3 {
      margin: 0 0 0.75rem 0;
      font-size: 0.75rem;
      font-weight: 600;
      color: #a3a3a3;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .window-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .process-group {
      border: 1px solid #2a2a2a;
      border-radius: 0.375rem;
      background: #1a1a1a;
      overflow: hidden;
      transition: all 0.2s;
    }

    .process-header {
      display: flex;
      align-items: center;
      padding: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
      gap: 0.5rem;
    }

    .process-header:hover {
      background: #2a2a2a;
    }

    .process-icon {
      width: 24px;
      height: 24px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .process-icon-placeholder {
      width: 24px;
      height: 24px;
      background: #2a2a2a;
      border-radius: 0.25rem;
      flex-shrink: 0;
    }

    .process-name {
      flex: 1;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .window-count {
      font-size: 0.75rem;
      padding: 0.125rem 0.375rem;
      background: #2a2a2a;
      border-radius: 0.25rem;
      color: #a3a3a3;
    }

    .expand-icon {
      font-size: 0.75rem;
      color: #a3a3a3;
      transition: transform 0.2s;
    }

    .process-group.expanded .expand-icon {
      transform: rotate(90deg);
    }

    .window-items {
      padding: 0 0.5rem 0.5rem 2.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .window-item {
      padding: 0.5rem 0.75rem;
      border: 1px solid #2a2a2a;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.2s;
      background: #141414;
    }

    .window-item:hover {
      background: #2a2a2a;
      border-color: #10B981;
    }

    .window-item.selected {
      background: #10B981;
      color: #0a0a0a;
      border-color: #10B981;
    }

    .window-name {
      font-weight: 500;
      font-size: 0.8125rem;
      margin-bottom: 0.125rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .window-size {
      font-size: 0.6875rem;
      opacity: 0.6;
    }

    .capture-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      background: #0a0a0a;
    }

    .capture-preview {
      width: 100%;
      height: 100%;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      background: #262626;
      cursor: crosshair;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    
    .capture-preview.fit-contain {
      object-fit: contain;
    }
    
    .capture-preview.fit-cover {
      object-fit: cover;
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
      color: #e4e4e4;
      text-align: center;
      font-size: 1.125rem;
    }

    .loading {
      color: #10B981;
    }

    .error {
      color: #EF4444;
    }

    .success {
      color: #10B981;
    }

    .capture-controls {
      position: absolute;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: #262626;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      color: #a3a3a3;
      font-size: 0.875rem;
    }

    .fps-indicator {
      position: absolute;
      top: 1rem;
      right: 1rem;
      padding: 0.25rem 0.5rem;
      background: #262626;
      border: 1px solid #2a2a2a;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      color: #10B981;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .video-preview {
      width: 100%;
      height: 100%;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      background: #262626;
      cursor: crosshair;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    
    .video-preview.fit-contain {
      object-fit: contain;
    }
    
    .video-preview.fit-cover {
      object-fit: cover;
    }

    .stats-panel {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(38, 38, 38, 0.95);
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      padding: 1rem;
      min-width: 250px;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .stats-panel h4 {
      margin: 0 0 0.75rem 0;
      font-size: 0.875rem;
      color: #e4e4e4;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
    }

    .stat-label {
      color: #a3a3a3;
    }

    .stat-value {
      color: #e4e4e4;
      font-weight: 500;
    }

    .stat-value.codec-hevc {
      color: #a78bfa;
    }

    .stat-value.codec-h264 {
      color: #60a5fa;
    }

    .stat-value.codec-vp9 {
      color: #34d399;
    }

    .stat-value.codec-av1 {
      color: #fbbf24;
    }

    .stat-value.latency-good {
      color: #10b981;
    }

    .stat-value.latency-warning {
      color: #f59e0b;
    }

    .stat-value.latency-bad {
      color: #ef4444;
    }


    .capture-area {
      transition: margin-left 0.3s ease;
    }

    @media (max-width: 768px) {
      .main-content {
        flex-direction: column;
      }
      
      .sidebar {
        width: 100%;
        height: 200px;
      }
      
      .sidebar-toggle {
        display: none;
      }
    }
  `;

  @state() private processGroups: ProcessGroup[] = [];
  @state() private expandedProcesses = new Set<number>();
  @state() private selectedWindow: WindowInfo | null = null;
  @state() private selectedWindowProcess: ProcessGroup | null = null;
  @state() private displays: DisplayInfo[] = [];
  @state() private selectedDisplay: DisplayInfo | null = null;
  @state() private isCapturing = false;
  @state() private captureMode: 'desktop' | 'window' = 'desktop';
  @state() private frameUrl = '';
  @state() private status = 'idle';
  @state() private error = '';
  @state() private fps = 0;
  @state() private showStats = false;
  @state() private streamStats: StreamStats | null = null;
  @state() private useWebRTC = true; // Default to WebRTC, fallback to JPEG
  @state() private sidebarCollapsed = false;
  @state() private fitMode: 'contain' | 'cover' = 'cover'; // Default to cover to show full screen

  private frameInterval: number | null = null;
  private frameCounter = 0;
  private readonly SIDEBAR_COLLAPSED_KEY = 'screencap-sidebar-collapsed';
  private lastFpsUpdate = 0;

  // WebRTC properties
  private peerConnection: RTCPeerConnection | null = null;
  private signalSocket: WebSocket | null = null;
  private statsInterval: number | null = null;
  private lastBytesReceived = 0;
  private lastStatsTimestamp = 0;

  // API client for screencap operations
  private apiClient: ScreencapApiClient | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.initializeApiClient();
    this.loadInitialData();
    this.setupKeyboardHandler();
    this.loadSidebarState();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCapture();
    this.removeKeyboardHandler();
    this.cleanupWebRTC();
    this.cleanupApiClient();
  }

  private loadSidebarState() {
    const savedState = localStorage.getItem(this.SIDEBAR_COLLAPSED_KEY);
    if (savedState !== null) {
      this.sidebarCollapsed = savedState === 'true';
    }
  }

  private saveSidebarState() {
    localStorage.setItem(this.SIDEBAR_COLLAPSED_KEY, this.sidebarCollapsed.toString());
  }

  private initializeApiClient() {
    // Construct WebSocket URL for API client
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/screencap-signal`;
    this.apiClient = new ScreencapApiClient(wsUrl);
    logger.log('API client initialized with URL:', wsUrl);
  }

  private cleanupApiClient() {
    if (this.apiClient) {
      this.apiClient.close();
      this.apiClient = null;
    }
  }

  private toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.saveSidebarState();
  }

  private toggleStats = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    logger.log('Stats button clicked, current showStats:', this.showStats);
    this.showStats = !this.showStats;
    logger.log('Stats toggled to:', this.showStats, 'streamStats:', this.streamStats);
    // Force a re-render in Safari
    this.requestUpdate();
  };

  private toggleFitMode = () => {
    this.fitMode = this.fitMode === 'contain' ? 'cover' : 'contain';
    logger.log('Fit mode toggled to:', this.fitMode);
  };

  private async handleRefresh() {
    await this.loadWindows();
    await this.loadDisplays();
  }

  private async toggleMode() {
    const wasCapturing = this.isCapturing;

    // Stop current capture if active
    if (wasCapturing) {
      await this.stopCapture();
    }

    // Toggle the mode
    this.useWebRTC = !this.useWebRTC;
    logger.log(`Switched to ${this.useWebRTC ? 'WebRTC' : 'JPEG'} mode`);

    // Restart capture if it was active
    if (wasCapturing) {
      await this.startCapture();
    }
  }

  private async loadInitialData() {
    try {
      logger.log('🔄 Starting initial data load...');
      this.status = 'loading';
      await Promise.all([this.loadWindows(), this.loadDisplays()]);
      // Don't select any display by default - let user choose
      logger.log('✅ Initial data loaded successfully');
      this.status = 'ready';
    } catch (error) {
      logger.error('❌ Failed to load initial data:', error);
      this.error = `Failed to load screen capture data: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.status = 'error';
    }
  }

  private async loadWindows() {
    logger.log('Loading process groups...');
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }
    try {
      const groups = (await this.apiClient.getProcessGroups()) as ProcessGroup[];
      const totalWindows = groups.reduce((sum, g) => sum + g.windows.length, 0);
      logger.log(`Loaded ${groups.length} processes with ${totalWindows} windows:`, groups);
      this.processGroups = groups;

      // Auto-expand processes with few windows
      groups.forEach((group) => {
        if (group.windows.length <= 3) {
          this.expandedProcesses.add(group.pid);
        }
      });
    } catch (error) {
      logger.error('Failed to load process groups:', error);
      throw new Error('Failed to load process groups');
    }
  }

  private async loadDisplays() {
    logger.log('Loading displays...');
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }
    try {
      const displays = (await this.apiClient.getDisplays()) as DisplayInfo[];
      logger.debug(`Loaded ${displays.length} displays`);
      this.displays = displays;
    } catch (error) {
      logger.error('Failed to load displays:', error);
      throw new Error('Failed to load displays info');
    }
  }

  private async startCapture() {
    try {
      this.status = 'starting';
      logger.log(`🚀 Starting ${this.captureMode} capture...`);

      // Check if WebRTC is supported and enabled
      if (this.useWebRTC && 'RTCPeerConnection' in window) {
        logger.log('🎥 Using WebRTC for capture');
        await this.startWebRTCCapture();
        return;
      }

      // Fallback to JPEG mode
      logger.log('📸 Using WebSocket API mode');

      if (!this.apiClient) {
        throw new Error('API client not initialized');
      }

      // Log current session state before capture
      logger.log(`📋 Current session ID before capture: ${this.apiClient.sessionId || 'none'}`);

      let result: unknown;
      if (this.captureMode === 'desktop') {
        logger.log(`🖥️ Starting desktop capture for display ${this.selectedDisplay?.id || '0'}`);
        result = await this.apiClient.startCapture({
          type: 'desktop',
          index: this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : 0,
          webrtc: this.useWebRTC,
        });
      } else {
        logger.log(`🪟 Starting window capture for window ${this.selectedWindow?.cgWindowID}`);
        result = await this.apiClient.captureWindow({
          cgWindowID: this.selectedWindow?.cgWindowID as number,
          webrtc: this.useWebRTC,
        });
      }

      logger.log(`✅ Capture started successfully:`, result);
      logger.log(`📋 Session ID after capture: ${this.apiClient.sessionId}`);

      this.isCapturing = true;
      this.status = 'capturing';
      logger.log(`Capture state: isCapturing=${this.isCapturing}, status=${this.status}`);
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
      // Stop frame updates for JPEG mode
      if (this.frameInterval) {
        clearInterval(this.frameInterval);
        this.frameInterval = null;
      }

      // Stop statistics collection
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }

      // Clean up WebRTC if active
      if (this.peerConnection) {
        this.cleanupWebRTC();
      }

      // Stop server-side capture
      if (this.isCapturing && this.apiClient) {
        await this.apiClient.stopCapture();
      }

      this.isCapturing = false;
      this.frameUrl = '';
      this.fps = 0;
      this.frameCounter = 0;
      this.status = 'ready';
      this.streamStats = null;
      this.lastBytesReceived = 0;
      this.lastStatsTimestamp = 0;

      logger.log('Stopped capture');
    } catch (error) {
      logger.error('Failed to stop capture:', error);
    }
  }

  private startFrameUpdates() {
    logger.log('🎥 Starting frame updates...');
    // Update immediately
    this.updateFrame();

    this.frameInterval = window.setInterval(() => {
      this.updateFrame();
    }, 50); // 20 FPS updates for smoother experience
  }

  private async updateFrame() {
    try {
      const timestamp = Date.now();
      const newFrameUrl = `/api/screencap/frame?t=${timestamp}`;
      logger.debug(`Updating frame URL to: ${newFrameUrl}`);
      this.frameUrl = newFrameUrl;

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

  private async selectWindow(window: WindowInfo, process: ProcessGroup) {
    this.selectedWindow = window;
    this.selectedWindowProcess = process;
    this.captureMode = 'window';

    // Auto-start capture when selecting a window
    if (!this.isCapturing) {
      logger.log(`🎯 Auto-starting capture for window: ${window.title}`);
      await this.startCapture();
    }
  }

  private toggleProcess(pid: number) {
    if (this.expandedProcesses.has(pid)) {
      this.expandedProcesses.delete(pid);
    } else {
      this.expandedProcesses.add(pid);
    }
    this.requestUpdate();
  }

  private async selectDisplay(display: DisplayInfo) {
    this.selectedDisplay = display;
    this.selectedWindow = null;
    this.captureMode = 'desktop';

    // Auto-start capture when selecting desktop
    if (!this.isCapturing) {
      logger.log(`🖥️ Auto-starting capture for display: ${display.name || display.id}`);
      await this.startCapture();
    }
  }

  private async selectAllDisplays() {
    this.selectedDisplay = null;
    this.selectedWindow = null;
    this.captureMode = 'desktop';

    // Auto-start capture when selecting all displays
    if (!this.isCapturing) {
      logger.log(`🖥️ Auto-starting capture for all displays`);
      await this.startCapture();
    }
  }

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  private async handleMouseDown(event: MouseEvent) {
    if (!this.isCapturing) return;

    // Calculate actual content position accounting for object-fit: contain
    const coords = this.calculateContentCoordinates(event);
    if (!coords) return;

    // Store drag start position
    this.isDragging = true;
    this.dragStartX = coords.x;
    this.dragStartY = coords.y;

    // Send mouse down event
    try {
      if (this.apiClient) {
        await this.apiClient.sendMouseDown(coords.x, coords.y);
      }

      logger.log(
        `🖱️ Mouse down at: ${(coords.x / 1000).toFixed(3)}, ${(coords.y / 1000).toFixed(3)} (sent as ${coords.x}, ${coords.y})`
      );
    } catch (error) {
      logger.error('Failed to send mouse down:', error);
    }
  }

  private async handleMouseMove(event: MouseEvent) {
    if (!this.isCapturing || !this.isDragging) return;

    const coords = this.calculateContentCoordinates(event);
    if (!coords) return;

    try {
      if (this.apiClient) {
        await this.apiClient.sendMouseMove(coords.x, coords.y);
      }
    } catch (error) {
      logger.error('Failed to send mouse move:', error);
    }
  }

  private async handleMouseUp(event: MouseEvent) {
    if (!this.isCapturing) return;

    const coords = this.calculateContentCoordinates(event);
    if (!coords) return;

    try {
      if (this.isDragging) {
        // Send mouse up event
        if (this.apiClient) {
          await this.apiClient.sendMouseUp(coords.x, coords.y);
        }

        logger.log(
          `🖱️ Mouse up at: ${(coords.x / 1000).toFixed(3)}, ${(coords.y / 1000).toFixed(3)} (sent as ${coords.x}, ${coords.y})`
        );
      } else {
        // If no drag occurred, treat as a click
        if (this.apiClient) {
          await this.apiClient.sendClick(coords.x, coords.y);
        }

        logger.log(
          `🖱️ Clicked at: ${(coords.x / 1000).toFixed(3)}, ${(coords.y / 1000).toFixed(3)} (sent as ${coords.x}, ${coords.y})`
        );
      }
    } catch (error) {
      logger.error('Failed to send mouse event:', error);
    }

    this.isDragging = false;
  }

  // Legacy method for backwards compatibility
  private async handleClick(event: MouseEvent) {
    // Prevent default click behavior as we're handling it in mouseup
    event.preventDefault();
  }

  /**
   * Calculate mouse coordinates accounting for object-fit: contain
   * This handles the case where the content is centered with gaps
   */
  private calculateContentCoordinates(event: MouseEvent): { x: number; y: number } | null {
    const element = event.target as HTMLElement;
    const rect = element.getBoundingClientRect();

    // Get the natural dimensions of the content
    let naturalWidth: number;
    let naturalHeight: number;

    if (element instanceof HTMLVideoElement) {
      naturalWidth = element.videoWidth;
      naturalHeight = element.videoHeight;
    } else if (element instanceof HTMLImageElement) {
      naturalWidth = element.naturalWidth;
      naturalHeight = element.naturalHeight;
    } else {
      return null;
    }

    if (!naturalWidth || !naturalHeight) {
      return null;
    }

    // Calculate the scale factor to fit content within container
    const containerAspect = rect.width / rect.height;
    const contentAspect = naturalWidth / naturalHeight;

    let scale: number;
    let offsetX = 0;
    let offsetY = 0;
    let scaledWidth: number;
    let scaledHeight: number;

    if (contentAspect > containerAspect) {
      // Content is wider - scale based on width (letterboxing - gaps top/bottom)
      scale = rect.width / naturalWidth;
      scaledWidth = rect.width;
      scaledHeight = naturalHeight * scale;
      offsetY = (rect.height - scaledHeight) / 2;
    } else {
      // Content is taller - scale based on height (pillarboxing - gaps left/right)
      scale = rect.height / naturalHeight;
      scaledHeight = rect.height;
      scaledWidth = naturalWidth * scale;
      offsetX = (rect.width - scaledWidth) / 2;
    }

    // Calculate click position relative to the container
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Check if click is within the actual content area
    if (
      clickX < offsetX ||
      clickX > offsetX + scaledWidth ||
      clickY < offsetY ||
      clickY > offsetY + scaledHeight
    ) {
      // Click is in the letterbox/pillarbox area, clamp to content bounds
      const clampedX = Math.max(offsetX, Math.min(clickX, offsetX + scaledWidth));
      const clampedY = Math.max(offsetY, Math.min(clickY, offsetY + scaledHeight));

      // Calculate relative position within the content
      const relativeX = (clampedX - offsetX) / scaledWidth;
      const relativeY = (clampedY - offsetY) / scaledHeight;

      return {
        x: Math.round(relativeX * 1000),
        y: Math.round(relativeY * 1000),
      };
    }

    // Calculate relative position within the actual content
    const relativeX = (clickX - offsetX) / scaledWidth;
    const relativeY = (clickY - offsetY) / scaledHeight;

    // Convert to 0-1000 range
    return {
      x: Math.round(relativeX * 1000),
      y: Math.round(relativeY * 1000),
    };
  }

  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  private setupKeyboardHandler() {
    // Add global keyboard event listener when component is connected
    document.addEventListener('keydown', this.boundHandleKeyDown);
    logger.debug('🎹 Keyboard handler setup');
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
      logger.log(
        `⌨️ Sending key: ${event.key} (modifiers: ${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Cmd+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''})`
      );

      if (this.apiClient) {
        await this.apiClient.sendKey({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        });
      }

      logger.log(`✅ Key sent successfully: ${event.key}`);
    } catch (error) {
      logger.error('❌ Failed to send key:', error);
    }
  }

  // WebRTC Methods
  private async startWebRTCCapture() {
    try {
      logger.log('🚀 Starting WebRTC capture...');

      // First, send request to start capture on Mac app with WebRTC enabled
      if (!this.apiClient) {
        throw new Error('API client not initialized');
      }

      let result: unknown;
      if (this.captureMode === 'desktop') {
        result = await this.apiClient.startCapture({
          type: 'desktop',
          index: this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : -1,
          webrtc: true,
        });
      } else {
        result = await this.apiClient.captureWindow({
          cgWindowID: this.selectedWindow?.cgWindowID as number,
          webrtc: true,
        });
      }
      logger.log(`✅ Mac app capture started:`, result);

      // Wait a moment for Mac app to connect to signaling server
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Configure codec preferences for Safari
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (isSafari) {
        logger.log('🎥 Configuring H.265 preference for Safari');
      }

      // Store the stream first, then update state to render video element
      let pendingStream: MediaStream | null = null;

      // Set up event handlers
      this.peerConnection.ontrack = (event) => {
        logger.log('📹 Received video track:', event);
        logger.log('Track details:', {
          kind: event.track.kind,
          enabled: event.track.enabled,
          readyState: event.track.readyState,
          streams: event.streams.length,
        });

        if (event.streams[0]) {
          pendingStream = event.streams[0];

          // Update state to show video element
          this.isCapturing = true;
          this.status = 'capturing';

          // Force render and then set the stream
          this.requestUpdate();

          // Wait for the render to complete, then set the video source
          this.updateComplete.then(() => {
            const videoElement = this.shadowRoot?.querySelector('video');
            if (videoElement && pendingStream) {
              videoElement.srcObject = pendingStream;
              logger.log(
                '✅ Video element configured, isCapturing:',
                this.isCapturing,
                'useWebRTC:',
                this.useWebRTC
              );

              // Start collecting statistics
              logger.log('Starting stats collection for WebRTC stream');
              this.startStatsCollection();

              // Configure bitrate parameters after connection
              this.configureBitrateParameters();
            } else {
              logger.error(
                'Failed to set video stream after render - videoElement:',
                !!videoElement
              );
            }
          });
        } else {
          logger.error('No streams in track event');
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.signalSocket?.readyState === WebSocket.OPEN) {
          this.signalSocket.send(
            JSON.stringify({
              type: 'ice-candidate',
              data: event.candidate,
            })
          );
        }
      };

      // Connect to signaling server
      await this.connectSignaling();
    } catch (error) {
      logger.error('Failed to start WebRTC capture:', error);
      this.error = 'Failed to start WebRTC capture. Falling back to JPEG mode.';
      this.useWebRTC = false;
      // Retry with JPEG mode
      await this.startCapture();
    }
  }

  private async connectSignaling() {
    return new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/screencap-signal`;

      logger.log('📡 Connecting to signaling server:', wsUrl);
      this.signalSocket = new WebSocket(wsUrl);

      this.signalSocket.onopen = () => {
        logger.log('✅ Connected to signaling server');
        // Send capture request with browser info
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const safariVersion = this.getSafariVersion();
        const preferH265 = isSafari && safariVersion >= 18; // Only Safari 18.0+ has stable H.265

        // Generate session ID if not already present
        if (this.apiClient && !this.apiClient.sessionId) {
          this.apiClient.sessionId =
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          logger.log(`🆕 Generated new session ID: ${this.apiClient.sessionId}`);
        } else {
          logger.log(`📋 Using existing session ID: ${this.apiClient?.sessionId}`);
        }

        const startCaptureMessage = {
          type: 'start-capture',
          sessionId: this.apiClient?.sessionId,
          mode: this.captureMode,
          windowId: this.selectedWindow?.cgWindowID,
          displayIndex: this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : -1,
          browser: isSafari ? 'safari' : 'other',
          browserVersion: safariVersion,
          preferH265: preferH265,
          codecSupport: {
            h265:
              'RTCRtpReceiver' in window && RTCRtpReceiver.getCapabilities
                ? (RTCRtpReceiver.getCapabilities('video')?.codecs || []).some(
                    (c) =>
                      c.mimeType?.toLowerCase().includes('h265') ||
                      c.mimeType?.toLowerCase().includes('hevc')
                  )
                : false,
            h264: true, // H.264 is always supported
          },
        };

        logger.log(
          `📤 Sending start-capture message with session: ${startCaptureMessage.sessionId}`
        );
        this.signalSocket?.send(JSON.stringify(startCaptureMessage));
        resolve();
      };

      this.signalSocket.onmessage = async (event) => {
        const message: SignalMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'offer':
            logger.log('📥 Received offer');
            await this.handleOffer(message.data as RTCSessionDescriptionInit);
            break;

          case 'ice-candidate':
            logger.log('🧊 Received ICE candidate');
            if (this.peerConnection && message.data) {
              await this.peerConnection.addIceCandidate(message.data as RTCIceCandidateInit);
            }
            break;

          case 'error':
            logger.error('❌ Signaling error:', message.data);
            reject(new Error(message.data as string));
            break;
        }
      };

      this.signalSocket.onerror = (error) => {
        logger.error('❌ WebSocket error:', error);
        reject(error);
      };

      this.signalSocket.onclose = () => {
        logger.log('📡 Signaling connection closed');
      };
    });
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;

    try {
      // Modify SDP to add bandwidth constraint before setting
      const modifiedOffer = {
        ...offer,
        sdp: this.addBandwidthToSdp(offer.sdp || ''),
      };

      await this.peerConnection.setRemoteDescription(modifiedOffer);

      // Configure codec preferences for Safari to prefer H.265
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const safariVersion = this.getSafariVersion();

      // Only prefer H.265 for Safari 18.0+ as earlier versions have issues
      const preferH265 = isSafari && safariVersion >= 18;

      logger.log(
        `🌐 Browser: ${isSafari ? 'Safari' : 'Other'}, Version: ${safariVersion}, H.265 preference: ${preferH265}`
      );

      if (this.peerConnection.getTransceivers) {
        const transceivers = this.peerConnection.getTransceivers();
        for (const transceiver of transceivers) {
          if (transceiver.receiver.track?.kind === 'video' && transceiver.setCodecPreferences) {
            const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];

            // Log available codecs with details
            logger.log('📹 Available video codecs:');
            const h265Codecs = codecs.filter(
              (c) =>
                c.mimeType?.toLowerCase().includes('h265') ||
                c.mimeType?.toLowerCase().includes('hevc')
            );
            const h264Codecs = codecs.filter((c) => c.mimeType?.toLowerCase().includes('h264'));

            if (h265Codecs.length > 0) {
              logger.log(`  ✅ H.265/HEVC codecs available: ${h265Codecs.length}`);
              h265Codecs.forEach((c) =>
                logger.log(`    - ${c.mimeType} (${c.sdpFmtpLine || 'no params'})`)
              );
            } else {
              logger.log('  ❌ No H.265/HEVC codecs available');
            }

            if (h264Codecs.length > 0) {
              logger.log(`  ✅ H.264 codecs available: ${h264Codecs.length}`);
            }

            // Sort codecs based on preference
            const sortedCodecs = codecs.sort((a, b) => {
              const aIsH265 =
                a.mimeType?.toLowerCase().includes('h265') ||
                a.mimeType?.toLowerCase().includes('hevc');
              const bIsH265 =
                b.mimeType?.toLowerCase().includes('h265') ||
                b.mimeType?.toLowerCase().includes('hevc');
              const aIsH264 = a.mimeType?.toLowerCase().includes('h264');
              const bIsH264 = b.mimeType?.toLowerCase().includes('h264');

              if (preferH265) {
                // Prefer H.265 for Safari 18.0+
                if (aIsH265 && !bIsH265) return -1;
                if (!aIsH265 && bIsH265) return 1;

                // Then H.264 as fallback
                if (aIsH264 && !bIsH264) return -1;
                if (!aIsH264 && bIsH264) return 1;
              } else {
                // Prefer H.264 for older Safari or other browsers
                if (aIsH264 && !bIsH264) return -1;
                if (!aIsH264 && bIsH264) return 1;

                // H.265 as secondary option
                if (aIsH265 && !bIsH265) return -1;
                if (!aIsH265 && bIsH265) return 1;
              }

              return 0;
            });

            if (sortedCodecs.length > 0) {
              try {
                transceiver.setCodecPreferences(sortedCodecs);
                const primaryCodec =
                  sortedCodecs[0].mimeType?.includes('h265') ||
                  sortedCodecs[0].mimeType?.includes('hevc')
                    ? 'H.265'
                    : 'H.264';
                logger.log(`✅ Configured codec preferences with ${primaryCodec} priority`);
              } catch (e) {
                logger.warn('Could not set codec preferences:', e);
              }
            }
          }
        }
      }

      const answer = await this.peerConnection.createAnswer();

      // Modify answer SDP to include bandwidth
      const modifiedAnswer = {
        ...answer,
        sdp: this.addBandwidthToSdp(answer.sdp || ''),
      };

      await this.peerConnection.setLocalDescription(modifiedAnswer);

      if (this.signalSocket?.readyState === WebSocket.OPEN) {
        this.signalSocket.send(
          JSON.stringify({
            type: 'answer',
            data: modifiedAnswer,
          })
        );
      }
    } catch (error) {
      logger.error('Failed to handle offer:', error);
    }
  }

  private cleanupWebRTC() {
    if (this.signalSocket) {
      this.signalSocket.close();
      this.signalSocket = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Clear video element
    const videoElement = this.shadowRoot?.querySelector('video');
    if (videoElement) {
      videoElement.srcObject = null;
    }
  }

  private getSafariVersion(): number {
    const userAgent = navigator.userAgent;
    const safariMatch = userAgent.match(/Version\/(\d+)\.(\d+)/);
    if (safariMatch) {
      return Number.parseInt(safariMatch[1], 10);
    }
    return 0;
  }

  private startStatsCollection() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    // Reset stats timestamp for fresh collection
    this.lastStatsTimestamp = Date.now();
    this.frameCounter = 0;

    this.statsInterval = window.setInterval(() => {
      this.collectStats();
    }, 1000); // Update stats every second
  }

  private async collectStats() {
    if (!this.peerConnection) {
      logger.warn('No peer connection available for stats collection');
      return;
    }

    try {
      const stats = await this.peerConnection.getStats();
      logger.debug('Collecting stats, stats size:', stats.size);

      // Increment frame counter
      this.frameCounter++;

      // Also look for codec info in codec stats
      let codecInfo: { name: string; implementation: string } | null = null;

      // Log all stats types once for debugging
      if (this.frameCounter === 1) {
        const statTypes = new Set<string>();
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        logger.log('Browser info - Safari:', isSafari, 'UserAgent:', navigator.userAgent);

        stats.forEach((stat) => {
          statTypes.add(stat.type);
          // Safari may use 'kind' instead of 'mediaType'
          const mediaType = stat.mediaType || stat.kind;
          if (stat.type === 'inbound-rtp' && mediaType === 'video') {
            logger.log('Found video RTP stats:', stat);
          }
        });
        logger.log('Available WebRTC stat types:', Array.from(statTypes));
      }

      stats.forEach((stat) => {
        // First check codec stats
        if (stat.type === 'codec') {
          const mimeType = stat.mimeType || '';
          let codecName = 'Unknown';

          // More comprehensive codec detection
          if (mimeType.includes('H264') || mimeType.includes('h264')) {
            codecName = 'H.264 (AVC)';
          } else if (
            mimeType.includes('H265') ||
            mimeType.includes('h265') ||
            mimeType.includes('HEVC') ||
            mimeType.includes('hevc')
          ) {
            codecName = 'H.265 (HEVC)';
          } else if (mimeType.includes('VP9') || mimeType.includes('vp9')) {
            codecName = 'VP9';
          } else if (mimeType.includes('VP8') || mimeType.includes('vp8')) {
            codecName = 'VP8';
          } else if (mimeType.includes('AV1') || mimeType.includes('av01')) {
            codecName = 'AV1';
          }

          // Store codec info from codec stats
          if (codecName !== 'Unknown' && !codecInfo) {
            codecInfo = {
              name: codecName,
              implementation: stat.implementation || 'unknown',
            };
          }
        }

        // Safari may use 'kind' instead of 'mediaType'
        const mediaType = stat.mediaType || stat.kind;
        if (stat.type === 'inbound-rtp' && mediaType === 'video') {
          const currentTimestamp = Date.now();
          const timeDiff = (currentTimestamp - this.lastStatsTimestamp) / 1000;

          // Calculate bitrate
          let bitrate = 0;
          const bytesReceived = stat.bytesReceived || 0;
          if (this.lastBytesReceived > 0 && timeDiff > 0) {
            const bytesDiff = bytesReceived - this.lastBytesReceived;
            bitrate = (bytesDiff * 8) / timeDiff; // bits per second
          }

          // Log stat details in Safari for debugging
          const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
          if (isSafari && this.frameCounter % 5 === 0) {
            logger.debug('Safari video stats:', {
              bytesReceived,
              frameWidth: stat.frameWidth,
              frameHeight: stat.frameHeight,
              framesPerSecond: stat.framesPerSecond,
              codecId: stat.codecId,
              mimeType: stat.mimeType,
            });
          }

          // Try to get codec from RTP stats first, fallback to codec stats
          let codecName = 'Unknown';
          let codecImplementation = 'unknown';

          // Check RTP stats for codec info
          if (stat.codecId) {
            // If we have a codecId, try to find the corresponding codec stat
            stats.forEach((codecStat) => {
              if (codecStat.type === 'codec' && codecStat.id === stat.codecId) {
                const mimeType = codecStat.mimeType || '';
                if (mimeType.includes('H264') || mimeType.includes('h264')) {
                  codecName = 'H.264 (AVC)';
                } else if (
                  mimeType.includes('H265') ||
                  mimeType.includes('h265') ||
                  mimeType.includes('HEVC') ||
                  mimeType.includes('hevc')
                ) {
                  codecName = 'H.265 (HEVC)';
                } else if (mimeType.includes('VP9') || mimeType.includes('vp9')) {
                  codecName = 'VP9';
                } else if (mimeType.includes('VP8') || mimeType.includes('vp8')) {
                  codecName = 'VP8';
                } else if (mimeType.includes('AV1') || mimeType.includes('av01')) {
                  codecName = 'AV1';
                }
                codecImplementation = codecStat.implementation || 'unknown';
              }
            });
          }

          // Fallback to mimeType from RTP stats
          if (codecName === 'Unknown' && stat.mimeType) {
            const mimeType = stat.mimeType;
            if (mimeType.includes('H264') || mimeType.includes('h264')) {
              codecName = 'H.264 (AVC)';
            } else if (
              mimeType.includes('H265') ||
              mimeType.includes('h265') ||
              mimeType.includes('HEVC') ||
              mimeType.includes('hevc')
            ) {
              codecName = 'H.265 (HEVC)';
            } else if (mimeType.includes('VP9') || mimeType.includes('vp9')) {
              codecName = 'VP9';
            } else if (mimeType.includes('VP8') || mimeType.includes('vp8')) {
              codecName = 'VP8';
            } else if (mimeType.includes('AV1') || mimeType.includes('av01')) {
              codecName = 'AV1';
            }
          }

          // Final fallback to codec info collected earlier
          if (codecName === 'Unknown' && codecInfo) {
            codecName = codecInfo.name;
            codecImplementation = codecInfo.implementation;
          }

          // Determine implementation type
          if (stat.decoderImplementation) {
            codecImplementation = stat.decoderImplementation;
          }

          // Check if hardware accelerated based on implementation string
          const implLower = codecImplementation.toLowerCase();
          if (
            implLower.includes('hardware') ||
            implLower.includes('videotoolbox') ||
            implLower.includes('vaapi') ||
            implLower.includes('nvdec') ||
            implLower.includes('qsv') ||
            implLower.includes('d3d11') ||
            implLower.includes('dxva')
          ) {
            codecImplementation = 'Hardware';
          } else if (
            implLower.includes('software') ||
            implLower.includes('libvpx') ||
            implLower.includes('ffmpeg') ||
            implLower.includes('openh264')
          ) {
            codecImplementation = 'Software';
          } else if (implLower === 'unknown') {
            // On macOS, if using H.264/H.265, it's likely hardware accelerated
            if (
              (codecName.includes('H.264') || codecName.includes('H.265')) &&
              navigator.platform.includes('Mac')
            ) {
              codecImplementation = 'Hardware (VideoToolbox)';
            }
          }

          // Adjust bitrate based on quality metrics
          if (this.streamStats && this.frameCounter % 30 === 0) {
            this.adjustBitrateBasedOnQuality();
          }

          // Safari might use different property names
          const frameWidth = stat.frameWidth || stat.width || 0;
          const frameHeight = stat.frameHeight || stat.height || 0;
          const framesPerSecond = stat.framesPerSecond || stat.framerate || 0;
          const packetsReceived = stat.packetsReceived || 0;
          const packetsLost = stat.packetsLost || 0;

          this.streamStats = {
            codec: codecName,
            codecImplementation: codecImplementation,
            resolution: `${frameWidth}x${frameHeight}`,
            fps: Math.round(framesPerSecond),
            bitrate: bitrate,
            // jitterBufferDelay is typically in seconds, but we should also check for reasonable values
            // If the value is already in milliseconds (> 1), use it directly
            latency: stat.jitterBufferDelay
              ? stat.jitterBufferDelay > 1
                ? Math.round(stat.jitterBufferDelay) // Already in ms
                : Math.round(stat.jitterBufferDelay * 1000) // Convert from seconds to ms
              : 0,
            packetsLost: packetsLost,
            packetLossRate: packetsReceived > 0 ? (packetsLost / packetsReceived) * 100 : 0,
            jitter: Math.round((stat.jitter || 0) * 1000),
            timestamp: currentTimestamp,
          };

          // Log when stats are updated
          if (this.frameCounter % 10 === 0) {
            logger.debug('Stats updated:', this.streamStats);
          }

          this.lastBytesReceived = bytesReceived;
          this.lastStatsTimestamp = currentTimestamp;

          // Log codec info for debugging
          if (codecName !== 'Unknown' && this.frameCounter % 30 === 0) {
            logger.debug(`Codec: ${codecName} (${codecImplementation})`);
          }

          // Force update in Safari by requesting update
          this.requestUpdate();
        }
      });
    } catch (error) {
      logger.error('Failed to collect stats:', error);
    }
  }

  private getCodecClass(): string {
    if (!this.streamStats) return '';

    const codec = this.streamStats.codec.toLowerCase();
    if (codec.includes('h.265') || codec.includes('hevc')) return 'codec-hevc';
    if (codec.includes('h.264') || codec.includes('avc')) return 'codec-h264';
    if (codec.includes('vp9')) return 'codec-vp9';
    if (codec.includes('av1')) return 'codec-av1';
    return '';
  }

  private getLatencyClass(): string {
    if (!this.streamStats) return '';

    const latency = this.streamStats.latency;
    if (latency < 50) return 'latency-good';
    if (latency < 150) return 'latency-warning';
    return 'latency-bad';
  }

  private formatBitrate(bitrate: number): string {
    if (bitrate < 1000) return `${Math.round(bitrate)} bps`;
    if (bitrate < 1000000) return `${(bitrate / 1000).toFixed(1)} Kbps`;
    return `${(bitrate / 1000000).toFixed(2)} Mbps`;
  }

  private async configureBitrateParameters() {
    if (!this.peerConnection) return;

    // Get all video senders
    const senders = this.peerConnection.getSenders();
    const videoSender = senders.find((sender) => sender.track?.kind === 'video');

    if (videoSender) {
      const params = videoSender.getParameters();

      // Ensure we have encodings array
      if (!params.encodings) {
        params.encodings = [{}];
      }

      // Set bitrate parameters for the first encoding
      if (params.encodings[0]) {
        // Set max bitrate to 50 Mbps for 4K@60fps
        params.encodings[0].maxBitrate = 50000000; // 50 Mbps

        // Set initial bitrate to 20 Mbps
        // Note: initialBitrate is not in the standard type definition but is supported by some browsers
        const encoding = params.encodings[0] as RTCRtpEncodingParameters & {
          initialBitrate?: number;
        };
        if ('initialBitrate' in encoding) {
          encoding.initialBitrate = 20000000; // 20 Mbps
        }

        // Enable network adaptation
        params.encodings[0].networkPriority = 'high';

        // Set scale resolution down factor to 1 (no downscaling)
        params.encodings[0].scaleResolutionDownBy = 1;

        try {
          await videoSender.setParameters(params);
          logger.log('✅ Configured video bitrate parameters for 4K@60fps:', {
            maxBitrate: '50 Mbps',
            initialBitrate: '20 Mbps',
            networkPriority: 'high',
            scaleResolutionDownBy: 1,
          });
        } catch (error) {
          logger.error('Failed to set video parameters:', error);
        }
      }
    } else {
      // For incoming video, we might need to configure receiver parameters
      const receivers = this.peerConnection.getReceivers();
      const videoReceiver = receivers.find((receiver) => receiver.track?.kind === 'video');

      if (videoReceiver) {
        logger.log('📹 Found video receiver, bitrate will be controlled by sender');
      }
    }
  }

  private addBandwidthToSdp(sdp: string): string {
    const lines = sdp.split('\n');
    const modifiedLines: string[] = [];
    for (const line of lines) {
      modifiedLines.push(line);

      // Check if we're entering video m-line
      if (line.startsWith('m=video')) {
        // Add bandwidth constraint after video m-line
        modifiedLines.push('b=AS:50000'); // 50 Mbps for 4K@60fps
        logger.log('📈 Added bandwidth constraint to SDP: 50 Mbps for 4K@60fps');
      }
    }

    return modifiedLines.join('\n');
  }

  private getQualityIndicator(): string {
    if (!this.streamStats) return 'N/A';

    const { packetLossRate, latency, fps } = this.streamStats;

    if (packetLossRate < 0.5 && latency < 50 && fps >= 25) return '🟢 Excellent';
    if (packetLossRate < 2 && latency < 150 && fps >= 20) return '🟡 Good';
    return '🔴 Poor';
  }

  private async adjustBitrateBasedOnQuality() {
    if (!this.peerConnection || !this.streamStats) return;

    const { packetLossRate, latency, bitrate } = this.streamStats;
    const videoSender = this.peerConnection.getSenders().find((s) => s.track?.kind === 'video');

    if (!videoSender) return;

    const params = videoSender.getParameters();
    if (!params.encodings?.[0]) return;

    let targetBitrate = params.encodings[0].maxBitrate || 50000000;

    // Adjust bitrate based on network conditions
    if (packetLossRate > 5) {
      // High packet loss - reduce bitrate by 20%
      targetBitrate = Math.max(10000000, targetBitrate * 0.8); // Min 10 Mbps for 4K
      logger.warn(
        `📉 High packet loss (${packetLossRate.toFixed(1)}%), reducing bitrate to ${(targetBitrate / 1000000).toFixed(1)} Mbps`
      );
    } else if (packetLossRate < 0.5 && latency < 50 && bitrate < targetBitrate * 0.8) {
      // Good conditions and we're using less than 80% of target - increase bitrate by 10%
      targetBitrate = Math.min(50000000, targetBitrate * 1.1); // Max 50 Mbps
      logger.log(
        `📈 Good network conditions, increasing bitrate to ${(targetBitrate / 1000000).toFixed(1)} Mbps`
      );
    }

    // Only update if significantly different (> 10% change)
    if (Math.abs(targetBitrate - (params.encodings[0].maxBitrate || 0)) > targetBitrate * 0.1) {
      params.encodings[0].maxBitrate = Math.round(targetBitrate);

      try {
        await videoSender.setParameters(params);
        logger.log(`✅ Adjusted bitrate to ${(targetBitrate / 1000000).toFixed(1)} Mbps`);
      } catch (error) {
        logger.error('Failed to adjust bitrate:', error);
      }
    }
  }

  render() {
    return html`
      <div class="header">
        <button 
          class="btn"
          @click=${() => {
            window.location.href = '/';
          }}
          title="Back to main page"
          style="margin-right: 1rem;"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M5 12l7 7M5 12l7-7"/>
          </svg>
          Back
        </button>
        <h1>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/>
          </svg>
          Screen Capture
        </h1>
        <div class="header-actions">
          <button 
            class="btn" 
            @click=${this.handleRefresh}
            ?disabled=${this.status === 'loading'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            Refresh
          </button>
          <button
            class="btn ${this.useWebRTC ? 'active' : ''}"
            @click=${this.toggleMode}
            title="Toggle between WebRTC (HD) and JPEG modes"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="7" width="18" height="10" rx="2"/>
              <path d="M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
            ${this.useWebRTC ? 'WebRTC' : 'JPEG'}
          </button>
          ${
            this.isCapturing && this.useWebRTC
              ? html`
            <button 
              class="btn ${this.showStats ? 'active' : ''}" 
              @click=${this.toggleStats}
              @touchstart=${this.toggleStats}
              title="Toggle statistics"
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              Stats
            </button>
          `
              : ''
          }
          ${
            this.isCapturing
              ? html`
            <button 
              class="btn" 
              @click=${this.toggleFitMode}
              title="${this.fitMode === 'contain' ? 'Switch to fill mode (may crop edges)' : 'Switch to fit mode (may show bars)'}"
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${
                  this.fitMode === 'contain'
                    ? html`
                    <rect x="3" y="6" width="18" height="12" rx="2"/>
                    <path d="M7 10h10M7 14h10"/>
                  `
                    : html`
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
                  `
                }
              </svg>
              ${this.fitMode === 'contain' ? 'Fit' : 'Fill'}
            </button>
          `
              : ''
          }
          ${
            this.isCapturing
              ? html`<button class="btn" @click=${this.stopCapture}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                  </svg>
                  Stop
                </button>`
              : html`<button class="btn primary" @click=${this.startCapture} ?disabled=${this.status === 'loading'}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Start
                </button>`
          }
        </div>
      </div>

      <div class="main-content">
        <button
          class="sidebar-toggle ${this.sidebarCollapsed ? 'collapsed' : ''}"
          @click=${this.toggleSidebar}
          title="${this.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}"
          style="left: ${this.sidebarCollapsed ? '0' : '320px'}"
        >
          <svg viewBox="0 0 16 16">
            <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
        </button>
        <div class="sidebar ${this.sidebarCollapsed ? 'collapsed' : ''}">
          <div class="sidebar-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2 0v10h12V5H4z"/>
              </svg>
              Capture Mode
            </h3>
            <div class="window-list">
              ${
                this.displays.length > 1
                  ? html`
                <div 
                  class="window-item ${this.captureMode === 'desktop' && this.selectedDisplay === null ? 'selected' : ''}"
                  @click=${() => this.selectAllDisplays()}
                >
                  <div class="window-name">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="display: inline-block; margin-right: 0.5rem;">
                      <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2h-5v2h3a1 1 0 110 2H6a1 1 0 110-2h3v-2H4a2 2 0 01-2-2V5zm2 0v6h12V5H4z"/>
                    </svg>
                    All Displays
                  </div>
                  <div class="window-size">
                    Combined view
                  </div>
                </div>
              `
                  : ''
              }
              ${this.displays.map(
                (display, index) => html`
                <div 
                  class="window-item ${this.captureMode === 'desktop' && this.selectedDisplay?.id === display.id ? 'selected' : ''}"
                  @click=${() => this.selectDisplay(display)}
                >
                  <div class="window-name">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="display: inline-block; margin-right: 0.5rem;">
                      <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2h-5v2h3a1 1 0 110 2H6a1 1 0 110-2h3v-2H4a2 2 0 01-2-2V5zm2 0v6h12V5H4z"/>
                    </svg>
                    ${display.name || `Display ${index + 1}`}
                  </div>
                  <div class="window-size">
                    ${display.width}×${display.height}
                  </div>
                </div>
              `
              )}
            </div>
          </div>

          <div class="sidebar-section">
            <h3>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2V4a2 2 0 00-2-2h-1zM4 3a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2V5a2 2 0 00-2-2H4zM16 3a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2V5a2 2 0 00-2-2h-1zM10 8a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2h-1zM4 9a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2H4zM16 9a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2h-1zM10 14a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2h-1zM4 15a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2H4zM16 15a2 2 0 00-2 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 00-2-2h-1z"/>
              </svg>
              Processes (${this.processGroups.length})</h3>
            <div class="window-list">
              ${this.processGroups.map(
                (process) => html`
                <div class="process-group ${this.expandedProcesses.has(process.pid) ? 'expanded' : ''}">
                  <div class="process-header" @click=${() => this.toggleProcess(process.pid)}>
                    ${
                      process.iconData
                        ? html`<img class="process-icon" src="data:image/png;base64,${process.iconData}" alt="${process.processName} icon" />`
                        : html`<div class="process-icon-placeholder"></div>`
                    }
                    <span class="process-name">${process.processName}</span>
                    <span class="window-count">${process.windows.length}</span>
                    <span class="expand-icon">▶</span>
                  </div>
                  ${
                    this.expandedProcesses.has(process.pid)
                      ? html`
                    <div class="window-items">
                      ${process.windows.map(
                        (window) => html`
                        <div 
                          class="window-item ${this.selectedWindow?.cgWindowID === window.cgWindowID ? 'selected' : ''}"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.selectWindow(window, process);
                          }}
                        >
                          <div class="window-name">${window.title || 'Untitled'}</div>
                          <div class="window-size">${Math.round(window.width)}×${Math.round(window.height)}</div>
                        </div>
                      `
                      )}
                    </div>
                  `
                      : ''
                  }
                </div>
              `
              )}
            </div>
          </div>
        </div>

        <div class="capture-area" style="margin-left: ${this.sidebarCollapsed ? '0' : '0'}">
          ${(() => {
            // WebRTC mode - show video element
            if (this.isCapturing && this.useWebRTC) {
              return html`
                <video 
                  class="video-preview fit-${this.fitMode}"
                  autoplay
                  playsinline
                  @mousedown=${this.handleMouseDown}
                  @mousemove=${this.handleMouseMove}
                  @mouseup=${this.handleMouseUp}
                  @click=${this.handleClick}
                  @loadedmetadata=${(e: Event) => {
                    const video = e.target as HTMLVideoElement;
                    logger.log(
                      `Video stream ready - size: ${video.videoWidth}x${video.videoHeight}`
                    );
                  }}
                  @error=${(e: Event) => {
                    logger.error('Video element error:', e);
                  }}
                ></video>
                ${
                  this.showStats
                    ? html`
                  <div class="stats-panel">
                    <h4>📊 Stream Statistics</h4>
                    ${
                      this.streamStats
                        ? html`
                    <div class="stat-row">
                      <span class="stat-label">Codec:</span>
                      <span class="stat-value ${this.getCodecClass()}">${this.streamStats.codec}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Hardware:</span>
                      <span class="stat-value">${this.streamStats.codecImplementation}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Resolution:</span>
                      <span class="stat-value">${this.streamStats.resolution} @ ${this.streamStats.fps} FPS</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Bitrate:</span>
                      <span class="stat-value">${this.formatBitrate(this.streamStats.bitrate)}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Latency:</span>
                      <span class="stat-value ${this.getLatencyClass()}">${this.streamStats.latency}ms</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Packet Loss:</span>
                      <span class="stat-value">${this.streamStats.packetLossRate.toFixed(2)}%</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-label">Quality:</span>
                      <span class="stat-value">${this.getQualityIndicator()}</span>
                    </div>
                    `
                        : html`
                    <div style="color: #a3a3a3; text-align: center; padding: 1rem;">
                      <div>Collecting statistics...</div>
                      <div style="font-size: 0.75rem; margin-top: 0.5rem;">
                        ${this.frameCounter > 0 ? `Frames: ${this.frameCounter}` : ''}
                      </div>
                    </div>
                    `
                    }
                  </div>
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
                  @mousedown=${this.handleMouseDown}
                  @mousemove=${this.handleMouseMove}
                  @mouseup=${this.handleMouseUp}
                  @click=${this.handleClick}
                  @load=${(e: Event) => {
                    const img = e.target as HTMLImageElement;
                    logger.log(
                      `Frame loaded successfully - size: ${img.naturalWidth}x${img.naturalHeight}`
                    );
                  }}
                  @error=${(e: Event) => {
                    const img = e.target as HTMLImageElement;
                    logger.error(`Failed to load frame from URL: ${img.src}`, e);
                    this.error = 'Failed to load capture frame';
                  }}
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
                      : this.status === 'capturing' && !this.frameUrl
                        ? 'Waiting for first frame...'
                        : this.status === 'error'
                          ? this.error
                          : this.status === 'ready'
                            ? 'Click Start to begin screen capture'
                            : 'Capture stopped'
                }
              </div>
              ${
                this.status === 'ready'
                  ? html`
                <button class="btn primary" @click=${this.startCapture}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Start ${this.captureMode === 'desktop' ? 'Desktop' : 'Window'} Capture
                </button>
              `
                  : ''
              }
            </div>
          `;
          })()}
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

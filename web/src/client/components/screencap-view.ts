import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-view');

interface WindowInfo {
  cgWindowID: number;
  title?: string;
  ownerName?: string;
  ownerPID: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isOnScreen: boolean;
}

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

    .window-item {
      padding: 0.5rem;
      border: 1px solid #2a2a2a;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.2s;
      background: #1a1a1a;
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
      background: #0a0a0a;
    }

    .capture-preview {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      background: #262626;
      cursor: crosshair;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
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
      object-fit: contain;
      border: 1px solid #2a2a2a;
      border-radius: 0.5rem;
      background: #262626;
      cursor: crosshair;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
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

    .mode-toggle {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 0.25rem;
      color: #a3a3a3;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mode-toggle:hover {
      background: #262626;
      color: #e4e4e4;
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

  @state() private windows: WindowInfo[] = [];
  @state() private selectedWindow: WindowInfo | null = null;
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

  connectedCallback() {
    super.connectedCallback();
    this.loadInitialData();
    this.setupKeyboardHandler();
    this.loadSidebarState();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCapture();
    this.removeKeyboardHandler();
    this.cleanupWebRTC();
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

  private toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.saveSidebarState();
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

  private async loadDisplays() {
    logger.log('Loading displays...');
    const response = await fetch('/api/screencap/displays');
    if (!response.ok) {
      logger.error(`Failed to load displays: ${response.status} ${response.statusText}`);
      throw new Error('Failed to load displays info');
    }
    const displays = await response.json();
    logger.debug(`Loaded ${displays.length} displays`);
    this.displays = displays;
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
      logger.log('📸 Using JPEG fallback mode');
      let response: Response;
      let endpoint: string;
      let captureData: Record<string, unknown>;

      if (this.captureMode === 'desktop') {
        // Desktop capture using /capture endpoint
        endpoint = '/api/screencap/capture';
        const displayIndex = this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : 0;
        captureData = {
          type: 'desktop', // Desktop
          index: displayIndex,
          vp9: false, // Use standard MJPEG for now
          webrtc: this.useWebRTC,
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
          webrtc: this.useWebRTC,
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
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
            if (errorData.details) {
              errorMessage += ` - ${errorData.details}`;
            }
          }
        } catch {
          // If JSON parsing fails, try to get text
          const errorText = await response.text();
          if (errorText) {
            errorMessage = `HTTP ${response.status}: ${errorText}`;
          }
        }
        logger.error(`❌ Response error:`, errorMessage);
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      logger.log(`✅ Capture started successfully:`, responseData);

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
      if (this.isCapturing) {
        await fetch('/api/screencap/stop', { method: 'POST' });
      }

      this.isCapturing = false;
      this.frameUrl = '';
      this.fps = 0;
      this.status = 'ready';
      this.streamStats = null;

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
    }, 100); // 10 FPS updates
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

  private async selectWindow(window: WindowInfo) {
    this.selectedWindow = window;
    this.captureMode = 'window';

    // Auto-start capture when selecting a window
    if (!this.isCapturing) {
      logger.log(`🎯 Auto-starting capture for window: ${window.title}`);
      await this.startCapture();
    }
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

    // Handle both video and image elements
    const element = event.target as HTMLElement;
    const rect = element.getBoundingClientRect();

    // Calculate position relative to the element's displayed size
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Clamp to bounds to prevent out-of-bounds clicks
    const clampedX = Math.max(0, Math.min(clickX, rect.width));
    const clampedY = Math.max(0, Math.min(clickY, rect.height));

    // Convert to normalized coordinates (0.0 to 1.0) within the displayed element
    const relativeX = clampedX / rect.width;
    const relativeY = clampedY / rect.height;

    // Store drag start position
    this.isDragging = true;
    this.dragStartX = relativeX * 1000;
    this.dragStartY = relativeY * 1000;

    // Send mouse down event
    try {
      await fetch('/api/screencap/mousedown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.dragStartX, y: this.dragStartY }),
      });

      logger.log(
        `🖱️ Mouse down at: ${relativeX.toFixed(3)}, ${relativeY.toFixed(3)} (sent as ${this.dragStartX}, ${this.dragStartY})`
      );
    } catch (error) {
      logger.error('Failed to send mouse down:', error);
    }
  }

  private async handleMouseMove(event: MouseEvent) {
    if (!this.isCapturing || !this.isDragging) return;

    const element = event.target as HTMLElement;
    const rect = element.getBoundingClientRect();

    const moveX = event.clientX - rect.left;
    const moveY = event.clientY - rect.top;

    const clampedX = Math.max(0, Math.min(moveX, rect.width));
    const clampedY = Math.max(0, Math.min(moveY, rect.height));

    const relativeX = clampedX / rect.width;
    const relativeY = clampedY / rect.height;

    const x = Math.round(relativeX * 1000);
    const y = Math.round(relativeY * 1000);

    try {
      await fetch('/api/screencap/mousemove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
    } catch (error) {
      logger.error('Failed to send mouse move:', error);
    }
  }

  private async handleMouseUp(event: MouseEvent) {
    if (!this.isCapturing) return;

    const element = event.target as HTMLElement;
    const rect = element.getBoundingClientRect();

    const upX = event.clientX - rect.left;
    const upY = event.clientY - rect.top;

    const clampedX = Math.max(0, Math.min(upX, rect.width));
    const clampedY = Math.max(0, Math.min(upY, rect.height));

    const relativeX = clampedX / rect.width;
    const relativeY = clampedY / rect.height;

    const x = Math.round(relativeX * 1000);
    const y = Math.round(relativeY * 1000);

    try {
      if (this.isDragging) {
        // Send mouse up event
        await fetch('/api/screencap/mouseup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x, y }),
        });

        logger.log(
          `🖱️ Mouse up at: ${relativeX.toFixed(3)}, ${relativeY.toFixed(3)} (sent as ${x}, ${y})`
        );
      } else {
        // If no drag occurred, treat as a click
        await fetch('/api/screencap/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x, y }),
        });

        logger.log(
          `🖱️ Clicked at: ${relativeX.toFixed(3)}, ${relativeY.toFixed(3)} (sent as ${x}, ${y})`
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
      let endpoint: string;
      let body: Record<string, unknown>;

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

      logger.log(
        `⌨️ Sending key: ${event.key} (modifiers: ${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Cmd+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''})`
      );

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

  // WebRTC Methods
  private async startWebRTCCapture() {
    try {
      logger.log('🚀 Starting WebRTC capture...');

      // First, send HTTP request to start capture on Mac app with WebRTC enabled
      let endpoint: string;
      let captureData: Record<string, unknown>;

      if (this.captureMode === 'desktop') {
        endpoint = '/api/screencap/capture';
        const displayIndex = this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : -1;
        captureData = {
          type: 'desktop',
          index: displayIndex,
          webrtc: true, // Enable WebRTC
        };
        logger.log(`📺 Starting desktop capture with WebRTC:`, captureData);
      } else {
        if (!this.selectedWindow) {
          throw new Error('No window selected for capture');
        }
        endpoint = '/api/screencap/capture-window';
        captureData = {
          cgWindowID: this.selectedWindow.cgWindowID,
          webrtc: true, // Enable WebRTC
        };
        logger.log(`🪟 Starting window capture with WebRTC:`, captureData);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(captureData),
      });

      if (!response.ok) {
        throw new Error(`Failed to start capture: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();
      logger.log(`✅ Mac app capture started:`, responseData);

      // Wait a moment for Mac app to connect to signaling server
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

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
              this.startStatsCollection();
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
        // Send capture request
        this.signalSocket?.send(
          JSON.stringify({
            type: 'start-capture',
            mode: this.captureMode,
            windowId: this.selectedWindow?.cgWindowID,
            displayIndex: this.selectedDisplay ? Number.parseInt(this.selectedDisplay.id) : -1,
          })
        );
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
      await this.peerConnection.setRemoteDescription(offer);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      if (this.signalSocket?.readyState === WebSocket.OPEN) {
        this.signalSocket.send(
          JSON.stringify({
            type: 'answer',
            data: answer,
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

  private startStatsCollection() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = window.setInterval(() => {
      this.collectStats();
    }, 1000); // Update stats every second
  }

  private async collectStats() {
    if (!this.peerConnection) return;

    try {
      const stats = await this.peerConnection.getStats();

      // Also look for codec info in codec stats
      let codecInfo: { name: string; implementation: string } | null = null;

      // Log all stats types once for debugging
      if (this.frameCounter === 1) {
        const statTypes = new Set<string>();
        stats.forEach((stat) => {
          statTypes.add(stat.type);
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

        if (stat.type === 'inbound-rtp' && stat.mediaType === 'video') {
          const currentTimestamp = Date.now();
          const timeDiff = (currentTimestamp - this.lastStatsTimestamp) / 1000;

          // Calculate bitrate
          let bitrate = 0;
          if (this.lastBytesReceived > 0 && timeDiff > 0) {
            const bytesDiff = stat.bytesReceived - this.lastBytesReceived;
            bitrate = (bytesDiff * 8) / timeDiff; // bits per second
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

          this.streamStats = {
            codec: codecName,
            codecImplementation: codecImplementation,
            resolution: `${stat.frameWidth || 0}x${stat.frameHeight || 0}`,
            fps: Math.round(stat.framesPerSecond || 0),
            bitrate: bitrate,
            latency: stat.jitterBufferDelay ? Math.round(stat.jitterBufferDelay * 1000) : 0,
            packetsLost: stat.packetsLost || 0,
            packetLossRate:
              stat.packetsReceived > 0 ? ((stat.packetsLost || 0) / stat.packetsReceived) * 100 : 0,
            jitter: Math.round((stat.jitter || 0) * 1000),
            timestamp: currentTimestamp,
          };

          this.lastBytesReceived = stat.bytesReceived;
          this.lastStatsTimestamp = currentTimestamp;

          // Log codec info for debugging
          if (codecName !== 'Unknown' && this.frameCounter % 30 === 0) {
            logger.debug(`Codec: ${codecName} (${codecImplementation})`);
          }
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

  private getQualityIndicator(): string {
    if (!this.streamStats) return 'N/A';

    const { packetLossRate, latency, fps } = this.streamStats;

    if (packetLossRate < 0.5 && latency < 50 && fps >= 25) return '🟢 Excellent';
    if (packetLossRate < 2 && latency < 150 && fps >= 20) return '🟡 Good';
    return '🔴 Poor';
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
            @click=${async () => {
              await this.loadWindows();
              await this.loadDisplays();
            }}
            ?disabled=${this.status === 'loading'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            Refresh
          </button>
          ${
            this.isCapturing && this.useWebRTC
              ? html`
            <button 
              class="btn ${this.showStats ? 'active' : ''}" 
              @click=${() => {
                this.showStats = !this.showStats;
              }}
              title="Toggle statistics"
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
            !this.useWebRTC && this.isCapturing
              ? html`
            <button 
              class="mode-toggle" 
              @click=${async () => {
                this.useWebRTC = true;
                await this.stopCapture();
                await this.startCapture();
              }}
              title="Switch to WebRTC mode"
            >
              Switch to HD
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
              Windows (${this.windows.length})</h3>
            <div class="window-list">
              ${this.windows.map(
                (window) => html`
                <div 
                  class="window-item ${this.selectedWindow === window ? 'selected' : ''}"
                  @click=${() => this.selectWindow(window)}
                >
                  <div class="window-name">${window.title || window.ownerName || 'Untitled'}</div>
                  <div class="window-app">${window.ownerName || ''}</div>
                  <div class="window-size">
                    ${window.width}×${window.height}
                  </div>
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
                  class="video-preview"
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
                  this.showStats && this.streamStats
                    ? html`
                  <div class="stats-panel">
                    <h4>📊 Stream Statistics</h4>
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
                  class="capture-preview"
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

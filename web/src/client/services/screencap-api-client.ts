import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-api-client');

interface ApiRequest {
  type: 'api-request';
  requestId: string;
  method: string;
  endpoint: string;
  params?: unknown;
  sessionId?: string;
}

interface ApiResponse {
  type: 'api-response';
  requestId: string;
  result?: unknown;
  error?: string;
}

export class ScreencapApiClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  public sessionId: string | null = null;

  constructor(private wsUrl: string) {}

  private async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          logger.log('WebSocket connected');
          this.isConnected = true;
          // The server will send a 'ready' message when connected
          // We don't need to send anything special to identify as a browser peer
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as ApiResponse;
            logger.log('📥 Received WebSocket message:', message);
            if (message.type === 'api-response' && message.requestId) {
              const pending = this.pendingRequests.get(message.requestId);
              if (pending) {
                this.pendingRequests.delete(message.requestId);
                if (message.error) {
                  pending.reject(new Error(message.error));
                } else {
                  pending.resolve(message.result);
                }
              }
            }
          } catch (error) {
            logger.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          logger.error('WebSocket error:', error);
          this.isConnected = false;
          reject(error);
        };

        this.ws.onclose = (event) => {
          logger.log(`WebSocket closed - code: ${event.code}, reason: ${event.reason}`);
          this.isConnected = false;
          this.connectionPromise = null;
          // Reject all pending requests
          this.pendingRequests.forEach((pending) => {
            pending.reject(new Error('WebSocket connection closed'));
          });
          this.pendingRequests.clear();
        };
      } catch (error) {
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  async request<T = unknown>(method: string, endpoint: string, params?: unknown): Promise<T> {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error(
        `WebSocket not ready - state: ${this.ws?.readyState}, isConnected: ${this.isConnected}`
      );
      throw new Error('WebSocket not connected');
    }

    // Use crypto.randomUUID if available, otherwise fallback
    const requestId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const request: ApiRequest = {
      type: 'api-request',
      requestId,
      method,
      endpoint,
      params,
    };

    // Add sessionId for control operations and capture operations
    if (
      this.sessionId &&
      (this.isControlOperation(method, endpoint) || this.isCaptureOperation(method, endpoint))
    ) {
      request.sessionId = this.sessionId;
      logger.log(`📤 Including session ID in ${method} ${endpoint}: ${this.sessionId}`);
    } else if (
      this.isControlOperation(method, endpoint) ||
      this.isCaptureOperation(method, endpoint)
    ) {
      logger.warn(`⚠️ No session ID available for ${method} ${endpoint}`);
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      logger.log(`📤 Sending WebSocket message:`, request);
      if (this.ws) {
        logger.log(
          `WebSocket state: ${this.ws.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`
        );
        this.ws.send(JSON.stringify(request));
      } else {
        logger.error('WebSocket is null!');
        reject(new Error('WebSocket not initialized'));
      }

      // Add timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${method} ${endpoint}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  private isControlOperation(method: string, endpoint: string): boolean {
    const controlEndpoints = ['/click', '/mousedown', '/mousemove', '/mouseup', '/key'];
    return method === 'POST' && controlEndpoints.includes(endpoint);
  }

  private isCaptureOperation(method: string, endpoint: string): boolean {
    const captureEndpoints = ['/capture', '/capture-window', '/stop'];
    return method === 'POST' && captureEndpoints.includes(endpoint);
  }

  // Convenience methods matching the HTTP API
  async getProcessGroups() {
    return this.request('GET', '/processes');
  }

  async getDisplays() {
    return this.request('GET', '/displays');
  }

  async startCapture(params: { type: string; index: number; webrtc?: boolean }) {
    // Generate a session ID for this capture session
    if (!this.sessionId) {
      this.sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      logger.log(`Generated session ID: ${this.sessionId}`);
    }
    return this.request('POST', '/capture', params);
  }

  async captureWindow(params: { cgWindowID: number; webrtc?: boolean }) {
    // Generate a session ID for this capture session
    if (!this.sessionId) {
      this.sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      logger.log(`Generated session ID: ${this.sessionId}`);
    }
    return this.request('POST', '/capture-window', params);
  }

  async stopCapture() {
    const result = await this.request('POST', '/stop');
    // Clear session ID after stopping capture
    this.sessionId = null;
    return result;
  }

  async sendClick(x: number, y: number) {
    return this.request('POST', '/click', { x, y });
  }

  async sendMouseDown(x: number, y: number) {
    return this.request('POST', '/mousedown', { x, y });
  }

  async sendMouseMove(x: number, y: number) {
    return this.request('POST', '/mousemove', { x, y });
  }

  async sendMouseUp(x: number, y: number) {
    return this.request('POST', '/mouseup', { x, y });
  }

  async sendKey(params: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  }) {
    return this.request('POST', '/key', params);
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.connectionPromise = null;
  }
}

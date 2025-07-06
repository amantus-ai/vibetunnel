import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-websocket');

interface ApiRequest {
  type: 'api-request';
  requestId: string;
  method: string;
  endpoint: string;
  params?: unknown;
  sessionId?: string;
}

interface SignalMessage {
  type:
    | 'start-capture'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'error'
    | 'ready'
    | 'api-response'
    | 'bitrate-adjustment';
  data?: unknown;
  requestId?: string;
  result?: unknown;
  error?: string;
  sessionId?: string;
  mode?: string;
  windowId?: number;
  displayIndex?: number;
  browser?: string;
  browserVersion?: number;
  preferH265?: boolean;
  codecSupport?: {
    h265: boolean;
    h264: boolean;
  };
}

type WebSocketMessage = ApiRequest | SignalMessage;

export class ScreencapWebSocketClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  public sessionId: string | null = null;

  // Event handlers for WebRTC signaling
  public onOffer?: (data: RTCSessionDescriptionInit) => void;
  public onAnswer?: (data: RTCSessionDescriptionInit) => void;
  public onIceCandidate?: (data: RTCIceCandidateInit) => void;
  public onError?: (error: string) => void;
  public onReady?: () => void;

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
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            logger.log('📥 Received message:', message);
            this.handleMessage(message);
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

  private handleMessage(message: WebSocketMessage) {
    switch (message.type) {
      case 'ready':
        logger.log('Server ready');
        if (this.onReady) this.onReady();
        break;

      case 'offer':
        if (this.onOffer && message.data) {
          this.onOffer(message.data as RTCSessionDescriptionInit);
        }
        break;

      case 'answer':
        if (this.onAnswer && message.data) {
          this.onAnswer(message.data as RTCSessionDescriptionInit);
        }
        break;

      case 'ice-candidate':
        if (this.onIceCandidate && message.data) {
          this.onIceCandidate(message.data as RTCIceCandidateInit);
        }
        break;

      case 'error':
        if (this.onError && typeof message.data === 'string') {
          this.onError(message.data);
        }
        break;

      case 'api-response':
        if (message.requestId) {
          const pending = this.pendingRequests.get(message.requestId);
          if (pending) {
            this.pendingRequests.delete(message.requestId);
            if (message.error) {
              // Handle error objects properly
              let errorMessage = 'Unknown error';
              if (typeof message.error === 'string') {
                errorMessage = message.error;
              } else if (typeof message.error === 'object' && message.error !== null) {
                // Cast to unknown then check for message property
                const err = message.error as unknown as {
                  message?: string;
                  error?: string;
                  code?: string;
                };
                // Extract message from error object
                if (err.message) {
                  errorMessage = String(err.message);
                } else if ('error' in err) {
                  errorMessage = String(err.error);
                } else if ('code' in err) {
                  errorMessage = `Error code: ${err.code}`;
                } else {
                  // Try to stringify the error object for debugging
                  try {
                    errorMessage = JSON.stringify(err);
                  } catch {
                    errorMessage = 'Unknown error (could not serialize)';
                  }
                }
              }
              pending.reject(new Error(errorMessage));
            } else {
              pending.resolve(message.result);
            }
          }
        }
        break;
    }
  }

  async request<T = unknown>(method: string, endpoint: string, params?: unknown): Promise<T> {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error(`WebSocket not ready - state: ${this.ws?.readyState}`);
      throw new Error('WebSocket not connected');
    }

    // Generate request ID
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const request: ApiRequest = {
      type: 'api-request',
      requestId,
      method,
      endpoint,
      params,
      sessionId: this.sessionId || undefined,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      logger.log(`📤 Sending API request:`, request);
      this.ws?.send(JSON.stringify(request));

      // Add timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${method} ${endpoint}`));
        }
      }, 60000); // 60 second timeout - allow more time for loading process icons
    });
  }

  async sendSignal(message: Partial<SignalMessage>) {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Add session ID to signaling messages if available
    if (this.sessionId && !message.sessionId) {
      message.sessionId = this.sessionId;
    }

    logger.log(`📤 Sending signal:`, message);
    this.ws.send(JSON.stringify(message));
  }

  // Convenience methods for API requests
  async getProcessGroups() {
    return this.request('GET', '/processes');
  }

  async getDisplays() {
    return this.request('GET', '/displays');
  }

  async startCapture(params: { type: string; index: number; webrtc?: boolean; use8k?: boolean }) {
    // Generate a session ID for this capture session if not present
    if (!this.sessionId) {
      this.sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      logger.log(`Generated session ID: ${this.sessionId}`);
    }
    return this.request('POST', '/capture', params);
  }

  async captureWindow(params: { cgWindowID: number; webrtc?: boolean; use8k?: boolean }) {
    // Generate a session ID for this capture session if not present
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
    try {
      const result = await this.request('POST', '/stop');
      // Clear session ID only after successful stop
      this.sessionId = null;
      return result;
    } catch (error) {
      // If stop fails, don't clear the session ID
      logger.error('Failed to stop capture, preserving session ID:', error);
      throw error;
    }
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

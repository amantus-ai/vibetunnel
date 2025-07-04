import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-api-client');

interface ApiRequest {
  type: 'api-request';
  requestId: string;
  method: string;
  endpoint: string;
  params?: unknown;
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
            const message = JSON.parse(event.data) as ApiResponse;
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

        this.ws.onclose = () => {
          logger.log('WebSocket closed');
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
      throw new Error('WebSocket not connected');
    }

    const requestId = crypto.randomUUID();
    const request: ApiRequest = {
      type: 'api-request',
      requestId,
      method,
      endpoint,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.ws?.send(JSON.stringify(request));

      // Add timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${method} ${endpoint}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  // Convenience methods matching the HTTP API
  async getWindows() {
    return this.request('GET', '/windows');
  }

  async getDisplays() {
    return this.request('GET', '/displays');
  }

  async startCapture(params: { type: string; index: number; webrtc?: boolean }) {
    return this.request('POST', '/capture', params);
  }

  async captureWindow(params: { cgWindowID: number; webrtc?: boolean }) {
    return this.request('POST', '/capture-window', params);
  }

  async stopCapture() {
    return this.request('POST', '/stop');
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

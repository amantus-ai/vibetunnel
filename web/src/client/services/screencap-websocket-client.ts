import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-websocket');

// This interface should align with the backend's ControlMessage protocol
interface ControlMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  category: 'screencap';
  action: string;
  payload?: unknown;
  sessionId?: string;
  userId?: string;
  error?: string;
}

export class ScreencapWebSocketClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  public sessionId: string;

  // Event handlers for WebRTC signaling
  public onOffer?: (data: RTCSessionDescriptionInit) => void;
  public onAnswer?: (data: RTCSessionDescriptionInit) => void;
  public onIceCandidate?: (data: RTCIceCandidateInit) => void;
  public onError?: (error: string) => void;
  public onReady?: () => void;

  constructor(private wsUrl: string) {
    // Generate session ID immediately for all requests
    this.sessionId = crypto.randomUUID();
    logger.log(
      `📡 ScreencapWebSocketClient created with URL: ${wsUrl}, sessionId: ${this.sessionId}`
    );
  }

  private async connect(): Promise<void> {
    logger.log(
      `🔌 Connect called - isConnected: ${this.isConnected}, hasPromise: ${!!this.connectionPromise}`
    );

    if (this.isConnected) {
      logger.log('✅ Already connected, returning');
      return;
    }
    if (this.connectionPromise) {
      logger.log('⏳ Connection already in progress, returning existing promise');
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        logger.log(`🚀 Creating new WebSocket connection to: ${this.wsUrl}`);
        this.ws = new WebSocket(this.wsUrl);

        logger.log(`📊 WebSocket readyState after creation: ${this.ws.readyState}`);
        logger.log('📊 WebSocket readyState values: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');

        this.ws.onopen = () => {
          logger.log('✅ WebSocket onopen fired - connection established');
          logger.log(`📊 WebSocket readyState in onopen: ${this.ws?.readyState}`);
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          logger.log(`📨 WebSocket message received, data length: ${event.data.length}`);
          try {
            const message = JSON.parse(event.data) as ControlMessage;
            logger.log('📥 Parsed message:', message);
            this.handleMessage(message);
          } catch (error) {
            logger.error('❌ Failed to parse WebSocket message:', error);
            logger.error('📄 Raw message data:', event.data);
          }
        };

        this.ws.onerror = (error) => {
          logger.error('❌ WebSocket error event fired:', error);
          logger.error(`📊 WebSocket readyState on error: ${this.ws?.readyState}`);
          this.isConnected = false;
          reject(error);
        };

        this.ws.onclose = (event) => {
          logger.log(
            `🔒 WebSocket closed - code: ${event.code}, reason: ${event.reason || '(no reason)'}`
          );
          logger.log('📊 Close codes: 1000=Normal, 1001=Going Away, 1006=Abnormal');
          logger.log(`📊 WebSocket readyState on close: ${this.ws?.readyState}`);
          this.isConnected = false;
          this.connectionPromise = null;
          // Reject all pending requests
          logger.log(`🗑️ Clearing ${this.pendingRequests.size} pending requests`);
          this.pendingRequests.forEach((pending) => {
            pending.reject(new Error(`WebSocket closed: ${event.code} ${event.reason || ''}`));
          });
          this.pendingRequests.clear();
        };

        logger.log('✅ WebSocket event handlers attached, waiting for connection...');
      } catch (error) {
        logger.error('❌ Exception while creating WebSocket:', error);
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  private handleMessage(message: ControlMessage) {
    // Handle event messages from server
    if (message.type === 'event') {
      switch (message.action) {
        case 'ready':
          logger.log('Server ready');
          if (this.onReady) this.onReady();
          break;

        case 'offer':
          if (this.onOffer && typeof message.payload === 'string') {
            try {
              const decodedPayload = JSON.parse(atob(message.payload));
              const offerData = decodedPayload.data as RTCSessionDescriptionInit;
              if (offerData?.type && offerData.sdp) {
                this.onOffer(offerData);
              } else {
                logger.error('Invalid offer payload structure after decoding:', decodedPayload);
              }
            } catch (e) {
              logger.error(
                'Failed to decode or parse offer payload:',
                e,
                'Payload was:',
                message.payload
              );
            }
          }
          break;

        case 'answer':
          if (this.onAnswer && typeof message.payload === 'string') {
            try {
              const decodedPayload = JSON.parse(atob(message.payload));
              const answerData = decodedPayload.data as RTCSessionDescriptionInit;
              if (answerData?.type && answerData.sdp) {
                this.onAnswer(answerData);
              } else {
                logger.error('Invalid answer payload structure after decoding:', decodedPayload);
              }
            } catch (e) {
              logger.error(
                'Failed to decode or parse answer payload:',
                e,
                'Payload was:',
                message.payload
              );
            }
          }
          break;

        case 'ice-candidate':
          if (this.onIceCandidate && typeof message.payload === 'string') {
            try {
              const decodedPayload = JSON.parse(atob(message.payload));
              const candidateData = decodedPayload.data as RTCIceCandidateInit;
              if (candidateData) {
                this.onIceCandidate(candidateData);
              } else {
                logger.error(
                  'Invalid ICE candidate payload structure after decoding:',
                  decodedPayload
                );
              }
            } catch (e) {
              logger.error(
                'Failed to decode or parse ICE candidate payload:',
                e,
                'Payload was:',
                message.payload
              );
            }
          }
          break;

        case 'error':
          if (this.onError && message.payload) {
            this.onError(String(message.payload));
          }
          break;
      }
    }

    // Handle response messages
    if (message.type === 'response' && message.id) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          // Handle error as a string
          pending.reject(new Error(message.error));
        } else {
          // Handle payload - it might be base64 encoded if it's from Swift ControlProtocol
          let payload = message.payload;

          // Check if payload is a base64-encoded string (from Swift ControlProtocol)
          if (typeof payload === 'string') {
            try {
              // Try to decode base64
              const decoded = atob(payload);
              payload = JSON.parse(decoded);
              logger.log('📦 Decoded base64 payload:', payload);
            } catch {
              // Not base64 or not JSON, use as-is
              logger.log('📦 Payload is plain string, not base64');
            }
          }

          logger.log('📦 Resolving request with payload:', payload);
          logger.log('📦 Payload type:', typeof payload);
          logger.log('📦 Payload keys:', payload ? Object.keys(payload) : 'null');
          pending.resolve(payload);
        }
      }
    }
  }

  async request<T = unknown>(method: string, endpoint: string, params?: unknown): Promise<T> {
    logger.log(`📤 Request called: ${method} ${endpoint}`, params);

    try {
      logger.log('🔌 Ensuring WebSocket connection...');
      await this.connect();
      logger.log('✅ Connection ensured');
    } catch (error) {
      logger.error('❌ Failed to connect:', error);
      throw error;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error(`❌ WebSocket not ready - state: ${this.ws?.readyState}`);
      logger.error(`📊 WebSocket object exists: ${!!this.ws}`);
      throw new Error('WebSocket not connected');
    }

    logger.log(`✅ WebSocket is open and ready`);

    // Generate request ID
    const requestId = crypto.randomUUID();

    const request: ControlMessage = {
      id: requestId,
      type: 'request',
      category: 'screencap',
      action: 'api-request',
      payload: {
        method,
        endpoint,
        params,
        requestId, // Include original requestId in payload for mac-side compatibility
        sessionId: this.sessionId, // Include sessionId in payload as expected by ScreenCaptureApiRequest
      },
      sessionId: this.sessionId,
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

  async sendSignal(action: string, data?: unknown) {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message: ControlMessage = {
      id: crypto.randomUUID(),
      type: 'event',
      category: 'screencap',
      action,
      payload: data,
      sessionId: this.sessionId,
    };

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
    // Session ID is already generated in constructor
    logger.log(`Starting capture with session ID: ${this.sessionId}`);
    return this.request('POST', '/capture', params);
  }

  async captureWindow(params: { cgWindowID: number; webrtc?: boolean; use8k?: boolean }) {
    // Session ID is already generated in constructor
    logger.log(`Capturing window with session ID: ${this.sessionId}`);
    return this.request('POST', '/capture-window', params);
  }

  async stopCapture() {
    try {
      const result = await this.request('POST', '/stop');
      // Generate new session ID after successful stop
      this.sessionId = crypto.randomUUID();
      logger.log(`Generated new session ID after stop: ${this.sessionId}`);
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

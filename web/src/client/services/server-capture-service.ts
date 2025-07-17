import { createLogger } from '../utils/logger.js';

const logger = createLogger('server-capture-service');

export interface ServerCaptureOptions {
  mode: 'server' | 'browser';
  displayIndex?: number;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  width?: number;
  height?: number;
  framerate?: number;
}

export interface DisplayServerInfo {
  type?: string;
  display?: string;
  captureMethod?: string;
}

interface ServerCaptureSession {
  sessionId: string;
  mode: 'server' | 'browser';
  streamUrl?: string;
  displayServer?: DisplayServerInfo;
}

export interface ServerCaptureCapabilities {
  serverCapture: {
    available: boolean;
    displayServer?: DisplayServerInfo;
    codecs: string[];
    screens: Array<{
      id: number;
      width: number;
      height: number;
      isPrimary?: boolean;
    }>;
    requiresAuth: boolean;
  };
  browserCapture: {
    available: boolean;
    requiresAuth: boolean;
  };
}

/**
 * Service for handling server-side Linux desktop capture
 */
export class ServerCaptureService {
  private baseUrl = '/api/server-screencap';
  private currentSession?: ServerCaptureSession;
  private mediaSource?: MediaSource;
  private sourceBuffer?: SourceBuffer;
  private videoElement?: HTMLVideoElement;
  private webSocket?: WebSocket;

  /**
   * Get server capture capabilities
   */
  async getCapabilities(): Promise<ServerCaptureCapabilities> {
    try {
      const response = await fetch(`${this.baseUrl}/capabilities`);
      if (!response.ok) {
        throw new Error(`Failed to get capabilities: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Failed to get server capabilities:', error);
      throw error;
    }
  }

  /**
   * Check if server capture is available
   */
  async isServerCaptureAvailable(): Promise<boolean> {
    try {
      const capabilities = await this.getCapabilities();
      return capabilities.serverCapture.available;
    } catch {
      return false;
    }
  }

  /**
   * Start server capture session
   */
  async startCapture(options: ServerCaptureOptions): Promise<MediaStream> {
    logger.log('Starting server capture with options:', options);

    try {
      // Get auth token if needed
      const auth = this.getAuthToken();

      // Start capture session
      const response = await fetch(`${this.baseUrl}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...options,
          auth,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start capture');
      }

      this.currentSession = await response.json();
      logger.log('Started capture session:', this.currentSession);

      // Create MediaStream from server capture
      if (this.currentSession?.mode === 'server') {
        return await this.createStreamFromServer();
      } else {
        // Browser mode - use regular getDisplayMedia
        return await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: options.framerate,
            width: options.width,
            height: options.height,
          },
          audio: false,
        });
      }
    } catch (error) {
      logger.error('Failed to start server capture:', error);
      throw error;
    }
  }

  /**
   * Create MediaStream from server capture
   */
  private async createStreamFromServer(): Promise<MediaStream> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    // Option 1: Use WebSocket for streaming
    if (this.supportsWebSocketStreaming()) {
      return await this.createWebSocketStream();
    }

    // Option 2: Use HTTP streaming with video element
    return await this.createHTTPStream();
  }

  /**
   * Create stream using WebSocket
   */
  private async createWebSocketStream(): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      if (!this.currentSession) {
        reject(new Error('No active capture session'));
        return;
      }
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/server-capture?sessionId=${this.currentSession.sessionId}`;

      logger.log('Connecting to WebSocket:', wsUrl);
      this.webSocket = new WebSocket(wsUrl);
      this.webSocket.binaryType = 'arraybuffer';

      // Create MediaSource for streaming
      this.mediaSource = new MediaSource();
      this.videoElement = document.createElement('video');
      this.videoElement.src = URL.createObjectURL(this.mediaSource);
      this.videoElement.muted = true;

      this.mediaSource.addEventListener('sourceopen', () => {
        logger.log('MediaSource opened');

        // Add source buffer for VP8 video
        try {
          if (!this.mediaSource) {
            throw new Error('MediaSource not initialized');
          }
          this.sourceBuffer = this.mediaSource.addSourceBuffer('video/webm; codecs="vp8"');
          this.sourceBuffer.mode = 'sequence';

          this.sourceBuffer.addEventListener('error', (e) => {
            logger.error('SourceBuffer error:', e);
          });
        } catch (error) {
          logger.error('Failed to add source buffer:', error);
          reject(error);
        }
      });

      let _streamStarted = false;

      this.webSocket.onopen = () => {
        logger.log('WebSocket connected');
      };

      this.webSocket.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary video data
          if (this.sourceBuffer && !this.sourceBuffer.updating) {
            try {
              this.sourceBuffer.appendBuffer(event.data);
            } catch (error) {
              logger.error('Failed to append buffer:', error);
            }
          }
        } else {
          // JSON control message
          try {
            const message = JSON.parse(event.data);

            switch (message.type) {
              case 'stream-start':
                logger.log('Stream started:', message);
                _streamStarted = true;

                // Play video once we have data
                if (this.videoElement) {
                  this.videoElement
                    .play()
                    .then(() => {
                      // Capture stream from video element
                      const videoElem = this.videoElement as HTMLVideoElement & {
                        captureStream(): MediaStream;
                      };
                      const stream = videoElem.captureStream();
                      resolve(stream);
                    })
                    .catch(reject);
                } else {
                  reject(new Error('Video element not initialized'));
                }
                break;

              case 'stream-end':
                logger.log('Stream ended');
                this.cleanup();
                break;

              case 'stream-error':
                logger.error('Stream error:', message.error);
                reject(new Error(message.error));
                break;
            }
          } catch (error) {
            logger.error('Failed to parse WebSocket message:', error);
          }
        }
      };

      this.webSocket.onerror = (error) => {
        logger.error('WebSocket error:', error);
        reject(error);
      };

      this.webSocket.onclose = () => {
        logger.log('WebSocket closed');
        this.cleanup();
      };
    });
  }

  /**
   * Create stream using HTTP streaming
   */
  private async createHTTPStream(): Promise<MediaStream> {
    if (!this.currentSession || !this.currentSession.streamUrl) {
      throw new Error('No stream URL available');
    }

    // Create video element with HTTP stream
    this.videoElement = document.createElement('video');
    this.videoElement.src = this.currentSession.streamUrl;
    this.videoElement.muted = true;
    this.videoElement.autoplay = true;

    // Wait for video to load
    await new Promise<void>((resolve, reject) => {
      if (this.videoElement) {
        this.videoElement.onloadedmetadata = () => resolve();
        this.videoElement.onerror = () => reject(new Error('Failed to load video stream'));
      } else {
        reject(new Error('Video element not initialized'));
      }
    });

    // Play and capture stream
    if (!this.videoElement) {
      throw new Error('Video element not initialized');
    }
    await this.videoElement.play();
    const videoElem = this.videoElement as HTMLVideoElement & { captureStream(): MediaStream };
    const stream = videoElem.captureStream();

    return stream;
  }

  /**
   * Stop current capture session
   */
  async stopCapture(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    logger.log('Stopping capture session:', this.currentSession.sessionId);

    try {
      await fetch(`${this.baseUrl}/stop/${this.currentSession.sessionId}`, {
        method: 'POST',
      });
    } catch (error) {
      logger.error('Failed to stop capture:', error);
    }

    this.cleanup();
    this.currentSession = undefined;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = undefined;
    }

    if (this.sourceBuffer) {
      try {
        this.mediaSource?.removeSourceBuffer(this.sourceBuffer);
      } catch {}
      this.sourceBuffer = undefined;
    }

    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
        }
      } catch {}
      this.mediaSource = undefined;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = undefined;
    }
  }

  /**
   * Get auth token for server capture
   */
  private getAuthToken(): string {
    // TODO: Get actual auth token from auth service
    return 'dummy-token';
  }

  /**
   * Check if browser supports WebSocket streaming
   */
  private supportsWebSocketStreaming(): boolean {
    return (
      'MediaSource' in window &&
      'WebSocket' in window &&
      MediaSource.isTypeSupported('video/webm; codecs="vp8"')
    );
  }

  /**
   * Get current session info
   */
  getCurrentSession(): ServerCaptureSession | undefined {
    return this.currentSession;
  }
}

// Export singleton instance
export const serverCaptureService = new ServerCaptureService();

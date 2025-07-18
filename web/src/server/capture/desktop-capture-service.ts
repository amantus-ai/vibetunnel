import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import {
  type CaptureOptions,
  type CaptureStream,
  FFmpegCapture,
} from './capture-providers/ffmpeg-capture.js';
import { type DisplayServerInfo, detectDisplayServer, startXvfb } from './display-detection.js';
import { convertToWebRTC, type ServerMediaStream } from './stream-converter.js';

const logger = createLogger('desktop-capture');

export interface DesktopCaptureOptions extends CaptureOptions {
  displayIndex?: number;
  auth?: string; // Authentication token
}

export interface CaptureSession {
  id: string;
  displayServer?: DisplayServerInfo;
  mediaStream?: ServerMediaStream;
  captureStream?: CaptureStream;
  startTime: number;
  userId?: string;
  stats: CaptureSessionStats;
}

export interface CaptureSessionStats {
  framesEncoded: number;
  bytesWritten: number;
  currentFps: number;
  averageFps: number;
  duration: number;
}

export class DesktopCaptureService extends EventEmitter {
  private sessions = new Map<string, CaptureSession>();
  private ffmpegCapture = new FFmpegCapture();
  private displayServer?: DisplayServerInfo;
  private initialized = false;
  private initializationError?: Error;

  isReady(): boolean {
    return this.initialized && !this.initializationError;
  }

  getInitializationError(): Error | undefined {
    return this.initializationError;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationError) throw this.initializationError;

    try {
      logger.log('Initializing desktop capture service...');

      // Detect display server
      this.displayServer = await detectDisplayServer();
      logger.log('Display server detected:', JSON.stringify(this.displayServer, null, 2));

      // Check FFmpeg availability
      const ffmpegAvailable = await this.ffmpegCapture.checkFFmpegAvailable();
      if (!ffmpegAvailable) {
        const error = new Error(
          'FFmpeg is not available! Please install FFmpeg: sudo apt-get install ffmpeg'
        );
        logger.error(error.message);
        this.initializationError = error;
        this.emit('error', error);
        throw error;
      }

      // Start Xvfb if needed
      if (this.displayServer.requiresXvfb) {
        logger.log('Starting Xvfb for headless capture...');
        try {
          await startXvfb(this.displayServer.display);
        } catch (error) {
          logger.error('Failed to start Xvfb:', error);
          this.initializationError = error as Error;
          this.emit('error', error);
          throw error;
        }
      }

      // Get available codecs
      const codecs = await this.ffmpegCapture.getFFmpegCodecs();
      logger.log('Available codecs:', codecs);

      this.initialized = true;
      this.emit('initialized', {
        displayServer: this.displayServer,
        codecs,
        ffmpegAvailable,
      });
    } catch (error) {
      this.initializationError = error as Error;
      throw error;
    }
  }

  async startCapture(options: DesktopCaptureOptions): Promise<CaptureSession> {
    await this.initialize();

    const sessionId = this.generateSessionId();
    logger.log(`Starting capture session ${sessionId} with options:`, options);

    // Check if server capture is available
    if (!this.displayServer || this.displayServer.type === 'unknown') {
      logger.warn('Server capture requested but no display server available');
      throw new Error('Server capture not available - no display server detected');
    }

    // Validate authentication if required
    if (options.auth && !this.validateAuth(options.auth)) {
      throw new Error('Invalid authentication token');
    }

    // Create session
    const session: CaptureSession = {
      id: sessionId,
      displayServer: this.displayServer,
      startTime: Date.now(),
      stats: {
        framesEncoded: 0,
        bytesWritten: 0,
        currentFps: 0,
        averageFps: 0,
        duration: 0,
      },
    };

    try {
      // Start server-side capture
      const captureStream = await this.startServerCapture(options);
      session.captureStream = captureStream;

      logger.log(`Capture stream created for session ${sessionId}`);
      logger.log(
        `Stream readable: ${captureStream.stream.readable}, isPaused: ${captureStream.stream.isPaused?.() ?? 'N/A'}`
      );

      // Stats interval will be created after stream setup
      let statsInterval: NodeJS.Timeout;

      // Monitor stream lifecycle
      captureStream.stream.once('data', () => {
        logger.log(`First data received from capture stream for session ${sessionId}`);
      });

      captureStream.stream.on('end', () => {
        logger.log(`Capture stream ended for session ${sessionId}`);
        if (statsInterval) clearInterval(statsInterval);
      });

      captureStream.stream.on('close', () => {
        logger.log(`Capture stream closed for session ${sessionId}`);
      });

      captureStream.stream.on('error', (error) => {
        logger.error(`Capture stream error for session ${sessionId}:`, error);
      });

      // Only convert to WebRTC format for Mac/Windows
      // Linux uses direct WebSocket streaming
      if (process.platform !== 'linux') {
        const mediaStream = await convertToWebRTC(captureStream);
        session.mediaStream = mediaStream;
      } else {
        // For Linux, ensure the stream starts flowing to prevent FFmpeg from exiting
        // Buffer the stream data temporarily until WebRTC handler takes over
        logger.log('Linux platform detected - buffering stream to keep FFmpeg alive');

        const tempBuffer: Buffer[] = [];
        let bufferSize = 0;
        const maxBufferSize = 10 * 1024 * 1024; // 10MB max buffer

        const dataHandler = (chunk: Buffer) => {
          if (bufferSize < maxBufferSize) {
            tempBuffer.push(chunk);
            bufferSize += chunk.length;
          }
        };

        captureStream.stream.on('data', dataHandler);

        // Store reference to clean up later
        (session as any)._tempDataHandler = dataHandler;
        (session as any)._tempBuffer = tempBuffer;
      }

      // Update stats periodically
      statsInterval = setInterval(() => {
        if (session.captureStream) {
          const stats = session.captureStream.getStats();
          session.stats = {
            ...stats,
            duration: Date.now() - session.startTime,
          };
        }
      }, 1000);

      this.sessions.set(sessionId, session);
      this.emit('capture-started', session);

      return session;
    } catch (error) {
      logger.error('Failed to start capture:', error);
      throw error;
    }
  }

  private async startServerCapture(options: DesktopCaptureOptions): Promise<CaptureStream> {
    if (!this.displayServer) {
      throw new Error('Display server not initialized');
    }

    // Determine which screen to capture
    const screenIndex = options.displayIndex || 0;
    const availableScreens = this.displayServer.availableScreens || [];

    if (screenIndex >= availableScreens.length) {
      logger.warn(`Screen ${screenIndex} not available, using default`);
    }

    // Start FFmpeg capture
    const captureOptions: CaptureOptions = {
      width: options.width,
      height: options.height,
      framerate: options.framerate || 30,
      bitrate: options.bitrate || 2500,
      quality: options.quality || 'medium',
      screen: screenIndex,
      codec: options.codec || 'vp8',
      hardwareAcceleration: options.hardwareAcceleration,
      cursor: options.cursor !== false,
    };

    const captureStream = await this.ffmpegCapture.startCapture(this.displayServer, captureOptions);

    // Listen for FFmpeg exit events to debug early termination
    this.ffmpegCapture.once('exit', ({ code, signal }) => {
      logger.error(`FFmpeg exited during capture: code=${code}, signal=${signal}`);
    });

    this.ffmpegCapture.once('error', (error) => {
      logger.error('FFmpeg error during capture:', error);
    });

    return captureStream;
  }

  async stopCapture(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    logger.log(`Stopping capture session ${sessionId}`);

    try {
      // Stop media stream (not used on Linux)
      if (session.mediaStream) {
        session.mediaStream.stop();
      }

      // Stop capture stream
      if (session.captureStream) {
        await session.captureStream.stop();
      }

      this.sessions.delete(sessionId);
      this.emit('capture-stopped', session);
    } catch (error) {
      logger.error('Error stopping capture:', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<CaptureSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async getAllSessions(): Promise<CaptureSession[]> {
    return Array.from(this.sessions.values());
  }

  async getCapabilities(): Promise<CaptureCapabilities> {
    await this.initialize();

    return {
      serverCapture: {
        available: this.displayServer?.type !== 'unknown',
        displayServer: this.displayServer,
        codecs: await this.ffmpegCapture.getFFmpegCodecs(),
        screens: this.displayServer?.availableScreens || [],
        requiresAuth: true,
      },
    };
  }

  private generateSessionId(): string {
    return `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private validateAuth(token: string): boolean {
    // TODO: Implement proper authentication
    // For now, accept any non-empty token
    return token.length > 0;
  }

  /**
   * Clean up resources on service shutdown
   */
  async shutdown(): Promise<void> {
    logger.log('Shutting down desktop capture service...');

    // Stop all active sessions
    const sessions = Array.from(this.sessions.values());
    await Promise.all(
      sessions.map((session) =>
        this.stopCapture(session.id).catch((e) => {
          logger.error(`Error stopping session ${session.id}:`, e);
        })
      )
    );

    this.initialized = false;
    this.initializationError = undefined;
  }
}

export interface CaptureCapabilities {
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
}

// Singleton instance
export const desktopCaptureService = new DesktopCaptureService();

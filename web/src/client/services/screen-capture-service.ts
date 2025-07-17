import { createLogger } from '../utils/logger.js';

const logger = createLogger('screen-capture-service');

export interface CaptureOptions {
  frameRate?: number;
  width?: number;
  height?: number;
  includeAudio?: boolean;
  captureMode?: 'screen' | 'window' | 'tab';
}

export interface CaptureCapabilities {
  hasNativeApp: boolean;
  hasBrowserAPI: boolean;
  canCaptureAudio: boolean;
  canSelectWindow: boolean;
  canSelectTab: boolean;
}

/**
 * Platform-agnostic screen capture service
 * Handles both native Mac app capture and browser-based capture
 */
export class ScreenCaptureService {
  private browserHandler: BrowserScreenCapture;

  constructor() {
    this.browserHandler = new BrowserScreenCapture();
  }

  /**
   * Start screen capture using the best available method
   */
  async startCapture(options: CaptureOptions = {}): Promise<MediaStream> {
    logger.log('Starting screen capture with options:', options);

    // Use browser API for screen capture
    logger.log('Using browser API capture');
    return this.browserHandler.capture(options);
  }

  /**
   * Get capture capabilities for current platform
   */
  getCapabilities(): CaptureCapabilities {
    return {
      hasNativeApp: false,
      hasBrowserAPI: this.browserHandler.isSupported(),
      canCaptureAudio: this.browserHandler.canCaptureAudio(),
      canSelectWindow: this.browserHandler.canSelectWindow(),
      canSelectTab: this.browserHandler.canSelectTab(),
    };
  }

  /**
   * Check if screen capture is supported
   */
  isSupported(): boolean {
    return this.browserHandler.isSupported();
  }

  /**
   * Get platform-specific capture instructions
   */
  getCaptureInstructions(): string {
    if (this.browserHandler.isSupported()) {
      const platform = this.getPlatform();
      if (platform === 'linux') {
        return 'Screen capture will use your browser. You may need to grant permission to share your screen.';
      }
      return "Screen capture will use your browser's built-in screen sharing.";
    }

    return 'Screen capture is not supported in this browser or platform.';
  }

  private isMacOS(): boolean {
    return navigator.platform.toLowerCase().includes('mac');
  }

  private hasNativeAppSupport(): boolean {
    // Check if we're running in the context of the native Mac app
    // This would be detected by the presence of certain global objects or APIs
    interface WindowWithVibeTunnel extends Window {
      vibeTunnelNative?: unknown;
    }
    return typeof (window as WindowWithVibeTunnel).vibeTunnelNative !== 'undefined';
  }

  private getPlatform(): string {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('linux')) return 'linux';
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('android')) return 'android';
    if (userAgent.includes('ios')) return 'ios';
    return 'unknown';
  }
}

/**
 * Browser-based screen capture using getDisplayMedia API
 */
class BrowserScreenCapture {
  async capture(options: CaptureOptions): Promise<MediaStream> {
    if (!this.isSupported()) {
      throw new Error('Screen capture not supported in this browser');
    }

    const constraints: MediaStreamConstraints = {
      video: {
        frameRate: options.frameRate || 30,
        width: { ideal: options.width || 1920 },
        height: { ideal: options.height || 1080 },
      },
      audio: options.includeAudio || false,
    };

    try {
      logger.log('🎬 BROWSER CAPTURE: Requesting display media with constraints:', constraints);
      logger.log('🎬 BROWSER CAPTURE: Call stack:', new Error().stack);
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

      // Log what we actually got
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        logger.log('Capture started with settings:', settings);
      }

      return stream;
    } catch (error) {
      logger.error('Failed to capture screen:', error);
      throw this.handleCaptureError(error);
    }
  }

  isSupported(): boolean {
    return 'getDisplayMedia' in (navigator.mediaDevices || {});
  }

  canCaptureAudio(): boolean {
    if (!this.isSupported()) return false;

    // Check for known browser limitations
    const userAgent = navigator.userAgent.toLowerCase();
    const isFirefox = userAgent.includes('firefox');

    // Firefox has different audio capabilities
    if (isFirefox) {
      const firefoxMatch = userAgent.match(/firefox\/(\d+)/);
      const firefoxVersion = firefoxMatch ? Number.parseInt(firefoxMatch[1]) : 0;
      return firefoxVersion >= 60;
    }

    // Chrome, Safari, Edge generally support audio capture
    return true;
  }

  canSelectWindow(): boolean {
    // All browsers with getDisplayMedia support window selection
    return this.isSupported();
  }

  canSelectTab(): boolean {
    // All browsers with getDisplayMedia support tab selection
    return this.isSupported();
  }

  private handleCaptureError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        return new Error('Permission denied. Please allow screen sharing and try again.');
      }

      if (error.name === 'NotFoundError') {
        return new Error('No screen sharing source available.');
      }

      if (error.name === 'NotSupportedError') {
        return new Error('Screen sharing is not supported in this browser.');
      }

      if (error.name === 'AbortError') {
        return new Error('Screen sharing was cancelled.');
      }

      return new Error(`Screen capture failed: ${error.message}`);
    }

    return new Error('Screen capture failed: Unknown error');
  }
}

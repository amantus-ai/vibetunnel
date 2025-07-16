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
  private macAppHandler?: MacAppScreenCapture;
  private browserHandler: BrowserScreenCapture;

  constructor() {
    this.browserHandler = new BrowserScreenCapture();

    // Initialize Mac app handler only on macOS and when available
    if (this.isMacOS() && this.hasNativeAppSupport()) {
      this.macAppHandler = new MacAppScreenCapture();
    }
  }

  /**
   * Start screen capture using the best available method
   */
  async startCapture(options: CaptureOptions = {}): Promise<MediaStream> {
    logger.log('Starting screen capture with options:', options);

    // Use Mac app if available and connected
    if (this.macAppHandler?.isAvailable()) {
      logger.log('Using native Mac app capture');
      return this.macAppHandler.capture(options);
    }

    // Fall back to browser API
    logger.log('Using browser API capture');
    return this.browserHandler.capture(options);
  }

  /**
   * Get capture capabilities for current platform
   */
  getCapabilities(): CaptureCapabilities {
    return {
      hasNativeApp: this.macAppHandler?.isAvailable() ?? false,
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
    return this.macAppHandler?.isAvailable() || this.browserHandler.isSupported();
  }

  /**
   * Get platform-specific capture instructions
   */
  getCaptureInstructions(): string {
    if (this.macAppHandler?.isAvailable()) {
      return 'Screen capture will use the native VibeTunnel Mac app for optimal performance.';
    }

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
    return typeof (window as any).vibeTunnelNative !== 'undefined';
  }

  private getPlatform(): string {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('linux')) return 'linux';
    if (platform.includes('win')) return 'windows';
    if (platform.includes('mac')) return 'macos';
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
    // Most browsers support audio capture with screen sharing
    return this.isSupported();
  }

  canSelectWindow(): boolean {
    // All browsers with getDisplayMedia support window selection
    return this.isSupported();
  }

  canSelectTab(): boolean {
    // All browsers with getDisplayMedia support tab selection
    return this.isSupported();
  }

  private handleCaptureError(error: any): Error {
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
}

/**
 * Native Mac app screen capture (placeholder for existing implementation)
 */
class MacAppScreenCapture {
  async capture(options: CaptureOptions): Promise<MediaStream> {
    // This would integrate with the existing Mac app WebSocket implementation
    // For now, throw an error to fall back to browser capture
    throw new Error('Native Mac app capture not yet integrated');
  }

  isAvailable(): boolean {
    // Check if the Mac app is connected and available
    return false; // Placeholder - would check actual connection status
  }
}

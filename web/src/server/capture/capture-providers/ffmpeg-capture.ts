import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { createLogger } from '../../utils/logger.js';
import type { DisplayServerInfo } from '../display-detection.js';

const logger = createLogger('ffmpeg-capture');

export interface CaptureOptions {
  width?: number;
  height?: number;
  framerate?: number;
  bitrate?: number; // in kbps
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  screen?: number; // Screen/monitor index
  codec?: 'vp8' | 'vp9' | 'h264';
  hardwareAcceleration?: boolean;
  cursor?: boolean;
}

export interface CaptureStream {
  stream: Readable;
  stop(): Promise<void>;
  getStats(): CaptureStats;
}

export interface CaptureStats {
  framesEncoded: number;
  bytesWritten: number;
  startTime: number;
  currentFps: number;
  averageFps: number;
}

const QUALITY_PRESETS = {
  low: { bitrate: 1000, crf: 35, preset: 'ultrafast' },
  medium: { bitrate: 2500, crf: 28, preset: 'fast' },
  high: { bitrate: 5000, crf: 23, preset: 'medium' },
  ultra: { bitrate: 10000, crf: 18, preset: 'slow' },
};

export class FFmpegCapture extends EventEmitter {
  private ffmpegProcess?: ChildProcess;
  private stats: CaptureStats = {
    framesEncoded: 0,
    bytesWritten: 0,
    startTime: Date.now(),
    currentFps: 0,
    averageFps: 0,
  };

  async startCapture(
    displayServer: DisplayServerInfo,
    options: CaptureOptions = {}
  ): Promise<CaptureStream> {
    logger.log('Starting FFmpeg capture with options:', options);
    logger.log('Display server info:', displayServer);

    const args = await this.buildFFmpegArgs(displayServer, options);
    logger.log('FFmpeg command:', 'ffmpeg', args.join(' '));

    this.ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr - changed to allow stdin for graceful quit
    });

    logger.log('FFmpeg process spawned, PID:', this.ffmpegProcess.pid);

    // Keep track of when stdout starts emitting
    let firstDataTime: number | null = null;
    if (this.ffmpegProcess.stdout) {
      this.ffmpegProcess.stdout.once('data', () => {
        firstDataTime = Date.now();
        logger.log(`FFmpeg stdout first data after ${firstDataTime - this.stats.startTime}ms`);
      });
    }

    this.stats.startTime = Date.now();

    // Handle FFmpeg stderr for progress/stats
    if (this.ffmpegProcess.stderr) {
      this.ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        this.parseFFmpegOutput(output);

        // Log all FFmpeg output for debugging
        const lines = output.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            if (line.includes('error') || line.includes('Error')) {
              logger.error('FFmpeg error:', line);
            } else if (
              line.includes('Input #') ||
              line.includes('Output #') ||
              line.includes('Stream #')
            ) {
              logger.log('FFmpeg info:', line);
            } else if (line.includes('frame=')) {
              // Log frame info periodically
              if (this.stats.framesEncoded % 30 === 0) {
                logger.log('FFmpeg progress:', line);
              }
            } else {
              // Log all other output for debugging
              logger.log('FFmpeg:', line);
            }
          }
        }
      });
    }

    // Monitor stdout
    if (this.ffmpegProcess.stdout) {
      let bytesReceived = 0;
      this.ffmpegProcess.stdout.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived < 1000 || bytesReceived % 100000 < chunk.length) {
          logger.log(`FFmpeg stdout: received ${bytesReceived} bytes`);
        }
      });
    }

    // Handle process exit
    this.ffmpegProcess.on('exit', (code, signal) => {
      logger.error(`FFmpeg process exited unexpectedly with code ${code}, signal ${signal}`);
      logger.error(`FFmpeg was running for ${(Date.now() - this.stats.startTime) / 1000} seconds`);
      this.emit('exit', { code, signal });
    });

    this.ffmpegProcess.on('error', (error) => {
      logger.error('FFmpeg process error:', error);
      logger.error('Error details:', error.message, error.stack);
      this.emit('error', error);
    });

    // Log process state after a short delay
    setTimeout(() => {
      if (this.ffmpegProcess) {
        logger.log(
          `FFmpeg process check after 500ms: PID ${this.ffmpegProcess.pid}, killed: ${this.ffmpegProcess.killed}, exitCode: ${this.ffmpegProcess.exitCode}`
        );
      }
    }, 500);

    return {
      stream: this.ffmpegProcess.stdout as Readable,
      stop: () => this.stop(),
      getStats: () => ({ ...this.stats }),
    };
  }

  private async buildFFmpegArgs(
    displayServer: DisplayServerInfo,
    options: CaptureOptions
  ): Promise<string[]> {
    const quality = QUALITY_PRESETS[options.quality || 'medium'];
    const codec = options.codec || 'vp8';

    const args: string[] = ['-hide_banner', '-loglevel', 'info', '-stats'];

    // Input configuration based on display server
    const inputArgs = this.getInputArgs(displayServer, options);
    args.push(...inputArgs);

    // Video filter chain
    const filters: string[] = [];

    // Scale if dimensions specified
    if (options.width || options.height) {
      const w = options.width || -1;
      const h = options.height || -1;
      filters.push(`scale=${w}:${h}:flags=lanczos`);
    }

    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }

    // Codec configuration
    args.push(...this.getCodecArgs(codec, quality, options));

    // Output format
    if (codec === 'h264') {
      args.push('-f', 'mpegts'); // MPEG-TS for H.264 streaming
    } else {
      args.push('-f', 'webm'); // WebM for VP8/VP9
    }

    // Output to stdout
    args.push('-');

    return args;
  }

  private getInputArgs(displayServer: DisplayServerInfo, options: CaptureOptions): string[] {
    const args: string[] = [];
    const framerate = options.framerate || 30;

    switch (displayServer.captureMethod) {
      case 'x11grab': {
        const screen = options.screen || 0;
        const screenInfo = displayServer.availableScreens?.[screen] || {
          width: 1920,
          height: 1080,
          x: 0,
          y: 0,
        };

        const inputDisplay = `${displayServer.display}+${screenInfo.x},${screenInfo.y}`;
        logger.log(`X11 capture input: ${inputDisplay} (display type: ${displayServer.type})`);
        
        args.push(
          '-f',
          'x11grab',
          '-framerate',
          framerate.toString(),
          '-video_size',
          `${screenInfo.width}x${screenInfo.height}`,
          '-i',
          inputDisplay,
          '-draw_mouse',
          options.cursor !== false ? '1' : '0'
        );
        break;
      }

      case 'pipewire':
        // Modern FFmpeg with PipeWire support
        args.push('-f', 'lavfi', '-i', 'pipewiregrab', '-framerate', framerate.toString());
        break;

      case 'xvfb':
        // Virtual framebuffer (headless)
        args.push(
          '-f',
          'x11grab',
          '-framerate',
          framerate.toString(),
          '-video_size',
          `${options.width || 1920}x${options.height || 1080}`,
          '-i',
          `${displayServer.display}.0`,
          '-draw_mouse',
          '0' // No cursor in virtual display
        );
        break;
    }

    return args;
  }

  private getCodecArgs(
    codec: string,
    quality: (typeof QUALITY_PRESETS)[keyof typeof QUALITY_PRESETS],
    options: CaptureOptions
  ): string[] {
    const args: string[] = [];
    const bitrate = options.bitrate || quality.bitrate;

    switch (codec) {
      case 'vp8':
        args.push(
          '-c:v',
          'libvpx',
          '-quality',
          'realtime',
          '-speed',
          '6',
          '-b:v',
          `${bitrate}k`,
          '-maxrate',
          `${bitrate * 1.5}k`,
          '-bufsize',
          `${bitrate * 2}k`,
          '-crf',
          quality.crf.toString(),
          '-g',
          '60', // Keyframe interval
          '-deadline',
          'realtime',
          '-cpu-used',
          '4'
        );
        break;

      case 'vp9':
        args.push(
          '-c:v',
          'libvpx-vp9',
          '-quality',
          'realtime',
          '-speed',
          '7',
          '-b:v',
          `${bitrate}k`,
          '-maxrate',
          `${bitrate * 1.5}k`,
          '-bufsize',
          `${bitrate * 2}k`,
          '-crf',
          quality.crf.toString(),
          '-g',
          '60',
          '-deadline',
          'realtime',
          '-row-mt',
          '1'
        );
        break;

      case 'h264':
        // Check for hardware acceleration
        if (options.hardwareAcceleration) {
          // Try to use hardware encoder
          args.push(...this.getHardwareEncoderArgs(bitrate, quality));
        } else {
          args.push(
            '-c:v',
            'libx264',
            '-preset',
            quality.preset,
            '-tune',
            'zerolatency',
            '-b:v',
            `${bitrate}k`,
            '-maxrate',
            `${bitrate * 1.5}k`,
            '-bufsize',
            `${bitrate * 2}k`,
            '-g',
            '60',
            '-profile:v',
            'baseline',
            '-level',
            '3.1'
          );
        }
        break;
    }

    // Common video settings
    args.push(
      '-pix_fmt',
      'yuv420p' // Ensure compatibility
    );

    return args;
  }

  private getHardwareEncoderArgs(
    bitrate: number,
    _quality: (typeof QUALITY_PRESETS)[keyof typeof QUALITY_PRESETS]
  ): string[] {
    // Try VAAPI first (Intel/AMD on Linux)
    // This is simplified - real implementation would detect available encoders
    return [
      '-vaapi_device',
      '/dev/dri/renderD128',
      '-c:v',
      'h264_vaapi',
      '-b:v',
      `${bitrate}k`,
      '-maxrate',
      `${bitrate * 1.5}k`,
      '-bufsize',
      `${bitrate * 2}k`,
      '-g',
      '60',
    ];
  }

  private parseFFmpegOutput(output: string) {
    // Parse FFmpeg stats output
    const fpsMatch = output.match(/fps=\s*(\d+)/);
    if (fpsMatch) {
      this.stats.currentFps = Number.parseInt(fpsMatch[1]);
    }

    const frameMatch = output.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      this.stats.framesEncoded = Number.parseInt(frameMatch[1]);

      // Calculate average FPS
      const elapsed = (Date.now() - this.stats.startTime) / 1000;
      if (elapsed > 0) {
        this.stats.averageFps = this.stats.framesEncoded / elapsed;
      }
    }

    const sizeMatch = output.match(/size=\s*(\d+)kB/);
    if (sizeMatch) {
      this.stats.bytesWritten = Number.parseInt(sizeMatch[1]) * 1024;
    }
  }

  async stop(): Promise<void> {
    if (this.ffmpegProcess) {
      logger.log('Stopping FFmpeg capture');

      // Send 'q' to gracefully quit FFmpeg
      if (this.ffmpegProcess.stdin) {
        this.ffmpegProcess.stdin.write('q');
      }

      // Give it time to cleanup
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if not exited
          if (this.ffmpegProcess) {
            logger.warn('FFmpeg did not exit gracefully, forcing kill');
            this.ffmpegProcess.kill('SIGKILL');
          }
          resolve();
        }, 2000);

        this.ffmpegProcess?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.ffmpegProcess = undefined;
    }
  }

  async checkFFmpegAvailable(): Promise<boolean> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      await execAsync('ffmpeg -version');
      return true;
    } catch {
      return false;
    }
  }

  async getFFmpegCodecs(): Promise<string[]> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('ffmpeg -codecs');
      const codecs: string[] = [];

      if (stdout.includes('libvpx')) codecs.push('vp8');
      if (stdout.includes('libvpx-vp9')) codecs.push('vp9');
      if (stdout.includes('libx264')) codecs.push('h264');

      return codecs;
    } catch {
      return [];
    }
  }
}

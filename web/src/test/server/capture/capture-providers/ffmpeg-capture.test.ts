import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { DisplayServerInfo } from '../../../../server/capture/display-detection.js';

// Hoist mocks to ensure they're set up before module imports
const { mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockLogger };
});

vi.mock('node:child_process');
vi.mock('../../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// Import after mocks are set up
const { FFmpegCapture } = await import(
  '../../../../server/capture/capture-providers/ffmpeg-capture.js'
);

describe('FFmpegCapture', () => {
  let mockSpawn: Mock;
  let ffmpegCapture: FFmpegCapture;
  let mockProcess: childProcess.ChildProcess & {
    stdout: Readable;
    stderr: Readable;
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock process
    mockProcess = new EventEmitter() as unknown as typeof mockProcess;
    mockProcess.stdout = new Readable({ read() {} });
    mockProcess.stderr = new Readable({ read() {} });
    mockProcess.stdin = { end: vi.fn(), write: vi.fn() };
    mockProcess.kill = vi.fn().mockReturnValue(true);
    mockProcess.pid = 12345;

    mockSpawn = vi.mocked(childProcess.spawn);
    mockSpawn.mockReturnValue(mockProcess);

    ffmpegCapture = new FFmpegCapture();
  });

  describe('checkFFmpegAvailable', () => {
    it('should return true when ffmpeg is installed', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementationOnce(
        (_cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          process.nextTick(() => callback(null, 'ffmpeg version 4.4.0', ''));
        }
      );

      const result = await ffmpegCapture.checkFFmpegAvailable();

      expect(result).toBe(true);
    });

    it('should return false when ffmpeg is not installed', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementationOnce(
        (_cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          process.nextTick(() => callback(new Error('Command not found'), '', ''));
        }
      );

      const result = await ffmpegCapture.checkFFmpegAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getFFmpegCodecs', () => {
    it('should return available codecs', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementationOnce(
        (_cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          const codecOutput = `
Codecs:
 DEV.LS h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 DEV.L. vp8                  On2 VP8
 DEV.L. vp9                  Google VP9
`;
          process.nextTick(() => callback(null, codecOutput, ''));
        }
      );

      const codecs = await ffmpegCapture.getFFmpegCodecs();

      expect(codecs).toContain('h264');
      expect(codecs).toContain('vp8');
      expect(codecs).toContain('vp9');
    });
  });

  describe('startCapture', () => {
    it('should start X11 capture with default options', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      const captureStream = await ffmpegCapture.startCapture(displayServer);

      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('-f');
      expect(args).toContain('x11grab');
      expect(args).toContain('-i');
      expect(args).toContain(':0');
      expect(args).toContain('-c:v');
      expect(args).toContain('libvpx');

      expect(captureStream.stream).toBe(mockProcess.stdout);
    });

    it('should start Wayland capture with PipeWire', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'wayland',
        display: 'wayland-0',
        captureMethod: 'pipewire',
      };

      await ffmpegCapture.startCapture(displayServer, {
        width: 1920,
        height: 1080,
        framerate: 60,
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('-f');
      expect(args).toContain('lavfi');
      expect(args).toContain('-i');
      expect(args).toContain('pipewiregrab');
      expect(args).toContain('-r');
      expect(args).toContain('60');
    });

    it('should use hardware acceleration when available', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      await ffmpegCapture.startCapture(displayServer, {
        hardwareAcceleration: true,
        codec: 'h264',
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('-c:v');
      expect(args).toContain('libx264');
    });

    it('should handle FFmpeg process errors', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      await ffmpegCapture.startCapture(displayServer);

      // Simulate stderr error
      mockProcess.stderr.emit('data', Buffer.from('Error: Device not found'));

      expect(mockLogger.error).toHaveBeenCalledWith(
        'FFmpeg error:',
        expect.stringContaining('Error: Device not found')
      );
    });

    it('should handle region capture', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
        availableScreens: [
          {
            id: 0,
            width: 1920,
            height: 1080,
            x: 0,
            y: 0,
          },
        ],
      };

      await ffmpegCapture.startCapture(displayServer, {
        screen: 0,
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('-video_size');
      expect(args).toContain('1920x1080');
    });

    it('should include cursor when requested', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      await ffmpegCapture.startCapture(displayServer, {
        cursor: true,
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('-draw_mouse');
      expect(args).toContain('1');
    });
  });

  describe('stop', () => {
    it('should stop capture stream gracefully', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      await ffmpegCapture.startCapture(displayServer);

      // Simulate process exit
      const exitPromise = ffmpegCapture.stop();
      process.nextTick(() => {
        mockProcess.emit('exit', 0);
      });

      await exitPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should force kill if graceful shutdown fails', async () => {
      const displayServer: DisplayServerInfo = {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      };

      await ffmpegCapture.startCapture(displayServer);

      // Don't emit exit event, let it timeout
      ffmpegCapture.stop();

      // Fast-forward to force kill
      await vi.advanceTimersByTimeAsync(6000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Mock the entire child_process module
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd, callback) => {
    // Default to immediate callback to avoid hanging tests
    if (callback) {
      process.nextTick(() => callback(new Error('Not mocked'), '', ''));
    }
  }),
}));

// Mock promisify to work with our exec mock
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal();
  const childProcess = await import('node:child_process');
  return {
    ...actual,
    promisify: (fn: any) => {
      if (fn === childProcess.exec) {
        return (cmd: string) => {
          return new Promise((resolve, reject) => {
            fn(cmd, (err: any, stdout: string, stderr: string) => {
              if (err) {
                reject(err);
              } else {
                resolve({ stdout, stderr });
              }
            });
          });
        };
      }
      return actual.promisify(fn);
    },
  };
});

vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// Import after mocks are set up
const { detectDisplayServer } = await import('../../../server/capture/display-detection.js');

import * as childProcess from 'node:child_process';

describe('Display Detection', () => {
  let mockExec: vi.MockedFunction<typeof childProcess.exec>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();

    // Save original env
    originalEnv = { ...process.env };

    // Reset env vars
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;

    mockExec = vi.mocked(childProcess.exec);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('detectDisplayServer', () => {
    it('should detect X11 display when DISPLAY is set', async () => {
      process.env.DISPLAY = ':0';

      // Mock xdpyinfo success
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('xdpyinfo -display :0');
          process.nextTick(() => callback(null, 'xdpyinfo output', ''));
        }
      );

      // Mock xrandr success
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('xrandr --query');
          const xrandrOutput =
            'HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 510mm x 287mm';
          process.nextTick(() => callback(null, xrandrOutput, ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result?.type).toBe('x11');
      expect(result?.display).toBe(':0');
      expect(result?.captureMethod).toBe('x11grab');
      expect(result?.availableScreens).toBeDefined();
      expect(result?.availableScreens?.length).toBeGreaterThan(0);
    });

    it('should detect Wayland when WAYLAND_DISPLAY is set', async () => {
      delete process.env.DISPLAY;
      process.env.WAYLAND_DISPLAY = 'wayland-0';

      // Mock FFmpeg pipewire support check
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toContain('ffmpeg');
          process.nextTick(() => callback(null, 'lavfi\npipewiregrab\nother sources', ''));
        }
      );

      // Mock wlr-randr failure (fallback to default screens)
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toContain('wlr-randr');
          process.nextTick(() => callback(new Error('wlr-randr not found'), '', ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result?.type).toBe('wayland');
      expect(result?.display).toBe('wayland-0');
      expect(result?.captureMethod).toBe('pipewire');
      expect(result?.availableScreens).toBeDefined();
    });

    it('should detect Wayland with X11 fallback when pipewire not supported', async () => {
      delete process.env.DISPLAY;
      process.env.WAYLAND_DISPLAY = 'wayland-0';

      // Mock FFmpeg pipewire support check - no pipewire
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toContain('ffmpeg');
          process.nextTick(() => callback(null, 'no pipewire here', ''));
        }
      );

      // Mock wlr-randr failure
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toContain('wlr-randr');
          process.nextTick(() => callback(new Error('wlr-randr not found'), '', ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result?.type).toBe('wayland');
      expect(result?.display).toBe(':0'); // Falls back to default X11 display when DISPLAY is not set
      expect(result?.captureMethod).toBe('x11grab'); // Falls back to x11grab
      expect(result?.availableScreens).toBeDefined();
    });

    it('should detect headless when Xvfb is available', async () => {
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;

      // Mock which Xvfb success
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('which Xvfb');
          process.nextTick(() => callback(null, '/usr/bin/Xvfb', ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result).toEqual({
        type: 'headless',
        display: ':99',
        captureMethod: 'xvfb',
        requiresXvfb: true,
      });
    });

    it('should handle X11 not being accessible despite DISPLAY', async () => {
      process.env.DISPLAY = ':0';
      // Mock xdpyinfo failure
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('xdpyinfo -display :0');
          process.nextTick(() => callback(new Error('Cannot open display'), '', ''));
        }
      );

      // Mock which Xvfb failure
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('which Xvfb');
          process.nextTick(() => callback(new Error('Command not found'), '', ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result).toEqual({
        type: 'unknown',
        display: '',
        captureMethod: 'x11grab',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'X11 display env var found but X server not accessible'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('No display server detected');
    });

    it('should handle no display server being available', async () => {
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
      // Mock which Xvfb failure
      mockExec.mockImplementationOnce(
        (cmd: string, callback: Parameters<typeof childProcess.exec>[1]) => {
          expect(cmd).toBe('which Xvfb');
          process.nextTick(() => callback(new Error('Command not found'), '', ''));
        }
      );

      const result = await detectDisplayServer();

      expect(result).toEqual({
        type: 'unknown',
        display: '',
        captureMethod: 'x11grab',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('No display server detected');
    });
  });

  describe('Screen detection through detectDisplayServer', () => {
    it('should detect screens when X11 is available', async () => {
      process.env.DISPLAY = ':0';

      // Mock xdpyinfo success
      mockExec.mockImplementationOnce((_cmd: string, callback: any) => {
        process.nextTick(() => callback(null, 'xdpyinfo output', ''));
      });

      // Mock xrandr with full output
      mockExec.mockImplementationOnce((_cmd: string, callback: any) => {
        const xrandrOutput = `
Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767
HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 510mm x 287mm
   1920x1080     60.00*+  59.93    59.96    60.00    50.00
   1680x1050     59.95
VGA-1 disconnected (normal left inverted right x axis y axis)
`;
        process.nextTick(() => callback(null, xrandrOutput, ''));
      });

      const result = await detectDisplayServer();

      expect(result?.availableScreens).toEqual([
        {
          id: 0,
          width: 1920,
          height: 1080,
          x: 0,
          y: 0,
          isPrimary: true,
        },
      ]);
    });

    it('should handle xrandr failure with fallback', async () => {
      process.env.DISPLAY = ':0';

      // Mock xdpyinfo success
      mockExec.mockImplementationOnce((_cmd: string, callback: any) => {
        process.nextTick(() => callback(null, 'xdpyinfo output', ''));
      });

      // Mock xrandr failure
      mockExec.mockImplementationOnce((_cmd: string, callback: any) => {
        process.nextTick(() => callback(new Error('xrandr not found'), '', ''));
      });

      const result = await detectDisplayServer();

      // Should still return with default screen
      expect(result?.availableScreens).toEqual([
        {
          id: 0,
          width: 1920,
          height: 1080,
          x: 0,
          y: 0,
          isPrimary: true,
        },
      ]);
    });
  });
});

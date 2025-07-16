import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';

const execAsync = promisify(exec);
const logger = createLogger('display-detection');

export interface DisplayServerInfo {
  type: 'x11' | 'wayland' | 'headless' | 'unknown';
  display: string;
  captureMethod: 'x11grab' | 'pipewire' | 'xvfb';
  requiresXvfb?: boolean;
  availableScreens?: ScreenInfo[];
}

export interface ScreenInfo {
  id: number;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary?: boolean;
}

export async function detectDisplayServer(): Promise<DisplayServerInfo> {
  logger.log('Detecting display server...');

  // Check for Wayland
  if (process.env.WAYLAND_DISPLAY) {
    logger.log('Wayland display detected:', process.env.WAYLAND_DISPLAY);

    // Check if FFmpeg supports PipeWire
    const ffmpegSupport = await checkFFmpegPipeWireSupport();

    return {
      type: 'wayland',
      display: process.env.WAYLAND_DISPLAY,
      captureMethod: ffmpegSupport ? 'pipewire' : 'x11grab', // Fallback to XWayland
      availableScreens: await getWaylandScreens(),
    };
  }

  // Check for X11
  if (process.env.DISPLAY) {
    logger.log('X11 display detected:', process.env.DISPLAY);

    // Verify X11 is actually running
    try {
      await execAsync(`xdpyinfo -display ${process.env.DISPLAY}`);

      return {
        type: 'x11',
        display: process.env.DISPLAY,
        captureMethod: 'x11grab',
        availableScreens: await getX11Screens(),
      };
    } catch {
      logger.warn('X11 display env var found but X server not accessible');
    }
  }

  // Check if we can start Xvfb for headless
  const xvfbAvailable = await checkXvfbAvailable();
  if (xvfbAvailable) {
    logger.log('No display found, but Xvfb is available for headless capture');
    return {
      type: 'headless',
      display: ':99',
      captureMethod: 'xvfb',
      requiresXvfb: true,
    };
  }

  logger.warn('No display server detected');
  return {
    type: 'unknown',
    display: '',
    captureMethod: 'x11grab',
  };
}

async function checkFFmpegPipeWireSupport(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('ffmpeg -hide_banner -sources lavfi 2>&1');
    return stdout.includes('pipewiregrab');
  } catch {
    return false;
  }
}

async function checkXvfbAvailable(): Promise<boolean> {
  try {
    await execAsync('which Xvfb');
    return true;
  } catch {
    return false;
  }
}

async function getX11Screens(): Promise<ScreenInfo[]> {
  try {
    // Use xrandr to get screen information
    const { stdout } = await execAsync('xrandr --query');
    const screens: ScreenInfo[] = [];

    // Parse xrandr output
    const lines = stdout.split('\n');
    let screenId = 0;

    for (const line of lines) {
      // Look for connected displays
      const match = line.match(/(\S+) connected (?:primary )?(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        screens.push({
          id: screenId++,
          width: Number.parseInt(match[2]),
          height: Number.parseInt(match[3]),
          x: Number.parseInt(match[4]),
          y: Number.parseInt(match[5]),
          isPrimary: line.includes('primary'),
        });
      }
    }

    if (screens.length === 0) {
      // Fallback to default screen size
      logger.warn('No screens detected via xrandr, using defaults');
      screens.push({
        id: 0,
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        isPrimary: true,
      });
    }

    logger.log(`Detected ${screens.length} X11 screen(s)`);
    return screens;
  } catch (error) {
    logger.error('Failed to get X11 screens:', error);
    // Return default screen
    return [
      {
        id: 0,
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        isPrimary: true,
      },
    ];
  }
}

async function getWaylandScreens(): Promise<ScreenInfo[]> {
  // Wayland screen detection is compositor-specific
  // This is a simplified version - real implementation would need
  // to use compositor-specific tools or portal APIs

  try {
    // Try to use wlr-randr for wlroots-based compositors
    const { stdout } = await execAsync('wlr-randr 2>/dev/null || echo "not available"');

    if (!stdout.includes('not available')) {
      // Parse wlr-randr output
      return parseWlrRandrOutput(stdout);
    }
  } catch {
    // Ignore errors
  }

  // Fallback to default
  logger.warn('Cannot detect Wayland screens, using defaults');
  return [
    {
      id: 0,
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      isPrimary: true,
    },
  ];
}

function parseWlrRandrOutput(output: string): ScreenInfo[] {
  const screens: ScreenInfo[] = [];
  const lines = output.split('\n');
  let currentScreen: Partial<ScreenInfo> | null = null;
  let screenId = 0;

  for (const line of lines) {
    if (line.match(/^\S+/)) {
      // New output device
      if (currentScreen && currentScreen.width && currentScreen.height) {
        screens.push({
          id: screenId++,
          width: currentScreen.width,
          height: currentScreen.height,
          x: currentScreen.x || 0,
          y: currentScreen.y || 0,
          isPrimary: screens.length === 0,
        });
      }
      currentScreen = {};
    } else if (currentScreen) {
      // Parse resolution
      const resMatch = line.match(/(\d+)x(\d+)/);
      if (resMatch) {
        currentScreen.width = Number.parseInt(resMatch[1]);
        currentScreen.height = Number.parseInt(resMatch[2]);
      }

      // Parse position
      const posMatch = line.match(/Position: (\d+),(\d+)/);
      if (posMatch) {
        currentScreen.x = Number.parseInt(posMatch[1]);
        currentScreen.y = Number.parseInt(posMatch[2]);
      }
    }
  }

  // Add last screen
  if (currentScreen && currentScreen.width && currentScreen.height) {
    screens.push({
      id: screenId,
      width: currentScreen.width,
      height: currentScreen.height,
      x: currentScreen.x || 0,
      y: currentScreen.y || 0,
      isPrimary: screens.length === 0,
    });
  }

  return screens;
}

export async function startXvfb(display = ':99', resolution = '1920x1080x24'): Promise<void> {
  logger.log(`Starting Xvfb on display ${display} with resolution ${resolution}`);

  try {
    // Kill any existing Xvfb on this display
    try {
      await execAsync(`pkill -f "Xvfb ${display}"`);
      await new Promise((resolve) => setTimeout(resolve, 100)); // Brief pause
    } catch {
      // Ignore if no existing process
    }

    // Start Xvfb in background
    const { spawn } = await import('node:child_process');
    const xvfbProcess = spawn(
      'Xvfb',
      [display, '-screen', '0', resolution, '-ac', '+extension', 'GLX', '+render', '-noreset'],
      {
        detached: true,
        stdio: 'ignore',
      }
    );

    if (xvfbProcess.unref) {
      xvfbProcess.unref();
    }

    // Wait for Xvfb to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify it's running
    await execAsync(`xdpyinfo -display ${display}`);

    logger.log('Xvfb started successfully');
  } catch (error) {
    logger.error('Failed to start Xvfb:', error);
    throw new Error(`Failed to start Xvfb: ${error}`);
  }
}

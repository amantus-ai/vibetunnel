/**
 * Activity detection system for terminal output
 *
 * Provides generic activity tracking and app-specific status parsing
 * for enhanced terminal title updates in dynamic mode.
 */

import { createLogger } from './logger.js';

const logger = createLogger('activity-detector');

/**
 * Activity status returned by app-specific parsers
 */
export interface ActivityStatus {
  /** The output data with status lines filtered out */
  filteredData: string;
  /** Human-readable status text for display in title */
  displayText: string;
  /** Raw status data for potential future use */
  raw?: {
    indicator?: string;
    action?: string;
    duration?: number;
    progress?: string;
  };
}

/**
 * Current activity state for a terminal session
 */
export interface ActivityState {
  /** Whether the terminal is currently active */
  isActive: boolean;
  /** Timestamp of last activity */
  lastActivityTime: number;
  /** App-specific status if detected */
  specificStatus?: {
    app: string;
    status: string;
  };
}

/**
 * App-specific detector interface
 */
export interface AppDetector {
  /** Name of the app this detector handles */
  name: string;
  /** Check if this detector should be used for the given command */
  detect: (command: string[]) => boolean;
  /** Parse app-specific status from output data */
  parseStatus: (data: string) => ActivityStatus | null;
}

// Pre-compiled regex for Claude status lines
// Matches: ✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)
const CLAUDE_STATUS_REGEX =
  /^(.)\s+(\w+)…\s*\((\d+)s\s*·\s*([↑↓])\s*([\d.]+)k\s+tokens\s*·\s*esc\s+to\s+interrupt\)\s*$/m;

/**
 * Parse Claude-specific status from output
 */
function parseClaudeStatus(data: string): ActivityStatus | null {
  const match = data.match(CLAUDE_STATUS_REGEX);
  if (!match) {
    return null;
  }

  const [_fullMatch, indicator, action, duration, direction, tokens] = match;

  // Filter out the status line from output
  const filteredData = data.replace(CLAUDE_STATUS_REGEX, '').replace(/\n\n+/g, '\n');

  // Create compact display text for title bar
  const displayText = `${indicator} ${action} (${duration}s, ${direction}${tokens}k)`;

  return {
    filteredData,
    displayText,
    raw: {
      indicator,
      action,
      duration: Number.parseInt(duration),
      progress: `${direction}${tokens}k tokens`,
    },
  };
}

// Registry of app-specific detectors
const detectors: AppDetector[] = [
  {
    name: 'claude',
    detect: (cmd) => {
      // Check if any part of the command contains 'claude'
      const cmdStr = cmd.join(' ').toLowerCase();
      return cmdStr.includes('claude');
    },
    parseStatus: parseClaudeStatus,
  },
  // Future detectors can be added here:
  // npm, git, docker, etc.
];

/**
 * Activity detector for a terminal session
 *
 * Tracks general activity and provides app-specific status parsing
 */
export class ActivityDetector {
  private lastActivityTime = Date.now();
  private currentStatus: ActivityStatus | null = null;
  private detector: AppDetector | null = null;
  private readonly ACTIVITY_TIMEOUT = 5000; // 5 seconds

  constructor(command: string[]) {
    // Find matching detector for this command
    this.detector = detectors.find((d) => d.detect(command)) || null;

    if (this.detector) {
      logger.debug(`Using ${this.detector.name} detector for command: ${command.join(' ')}`);
    }
  }

  /**
   * Process terminal output and extract activity information
   */
  processOutput(data: string): { filteredData: string; activity: ActivityState } {
    this.lastActivityTime = Date.now();

    // Try app-specific detection first
    if (this.detector) {
      const status = this.detector.parseStatus(data);
      if (status) {
        this.currentStatus = status;
        return {
          filteredData: status.filteredData,
          activity: {
            isActive: true,
            lastActivityTime: this.lastActivityTime,
            specificStatus: {
              app: this.detector.name,
              status: status.displayText,
            },
          },
        };
      }
    }

    // Generic activity detection
    return {
      filteredData: data,
      activity: {
        isActive: true,
        lastActivityTime: this.lastActivityTime,
        specificStatus:
          this.currentStatus && this.detector
            ? {
                app: this.detector.name,
                status: this.currentStatus.displayText,
              }
            : undefined,
      },
    };
  }

  /**
   * Get current activity state (for periodic updates)
   */
  getActivityState(): ActivityState {
    const isActive = Date.now() - this.lastActivityTime < this.ACTIVITY_TIMEOUT;

    return {
      isActive,
      lastActivityTime: this.lastActivityTime,
      specificStatus:
        isActive && this.currentStatus && this.detector
          ? {
              app: this.detector.name,
              status: this.currentStatus.displayText,
            }
          : undefined,
    };
  }

  /**
   * Clear current status (e.g., when session ends)
   */
  clearStatus(): void {
    this.currentStatus = null;
  }
}

/**
 * Register a new app detector
 *
 * @param detector The detector to register
 */
export function registerDetector(detector: AppDetector): void {
  const existing = detectors.findIndex((d) => d.name === detector.name);
  if (existing >= 0) {
    detectors[existing] = detector;
    logger.debug(`Updated ${detector.name} detector`);
  } else {
    detectors.push(detector);
    logger.debug(`Registered ${detector.name} detector`);
  }
}

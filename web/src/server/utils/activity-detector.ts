/**
 * Activity detection system for terminal output
 *
 * Provides generic activity tracking and app-specific status parsing
 * for enhanced terminal title updates in dynamic mode.
 */

import { createLogger } from './logger.js';
import { getClaudeCommandFromTree, isClaudeInProcessTree } from './process-tree.js';
import { PromptDetector } from './prompt-patterns.js';

const logger = createLogger('activity-detector');

// Debug flag - set to true to enable verbose logging
const CLAUDE_DEBUG = process.env.VIBETUNNEL_CLAUDE_DEBUG === 'true';

// Super debug logging wrapper
function superDebug(message: string, ...args: unknown[]): void {
  if (CLAUDE_DEBUG) {
    console.log(`[ActivityDetector:DEBUG] ${message}`, ...args);
  }
}

// ANSI escape code removal regex
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes need control characters
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
// Format 1: ✻ Crafting… (205s · ↑ 6.0k tokens · <any text> to interrupt)
// Format 2: ✻ Measuring… (6s ·  100 tokens · esc to interrupt)
// Format 3: ⏺ Calculating… (0s) - simpler format without tokens/interrupt
// Format 4: ✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt) - with hammer symbol
// Note: We match ANY non-whitespace character as the indicator since Claude uses many symbols
const CLAUDE_STATUS_REGEX =
  /(\S)\s+([\w\s]+?)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)/gi;

/**
 * Parse Claude-specific status from output
 */
function parseClaudeStatus(data: string): ActivityStatus | null {
  // Strip ANSI escape codes for cleaner matching
  const cleanData = data.replace(ANSI_REGEX, '');

  // Reset regex lastIndex since we're using global flag
  CLAUDE_STATUS_REGEX.lastIndex = 0;

  // Log if we see something that looks like a Claude status
  if (cleanData.includes('interrupt') && cleanData.includes('tokens')) {
    superDebug('Potential Claude status detected');
    superDebug('Clean data sample:', cleanData.substring(0, 200).replace(/\n/g, '\\n'));
  }

  const match = CLAUDE_STATUS_REGEX.exec(cleanData);
  if (!match) {
    // Debug log to see what we're trying to match
    if (cleanData.includes('interrupt') && cleanData.includes('tokens')) {
      superDebug('Claude status line NOT matched');
      superDebug('Looking for pattern like: ✻ Crafting… (123s · ↑ 6.0k tokens · ... to interrupt)');
      superDebug('Clean data preview:', cleanData.substring(0, 150));

      // Try to find the specific line that contains the status
      const lines = cleanData.split('\n');
      const statusLine = lines.find(
        (line) => line.includes('interrupt') && line.includes('tokens')
      );
      if (statusLine) {
        superDebug('Found status line:', statusLine);
        superDebug('Line length:', statusLine.length);
        // Log each character to debug special symbols
        if (CLAUDE_DEBUG) {
          const chars = Array.from(statusLine.substring(0, 50));
          chars.forEach((char, idx) => {
            console.log(
              `  [${idx}] '${char}' = U+${char.charCodeAt(0).toString(16).padStart(4, '0')}`
            );
          });
        }
      }
    }
    return null;
  }

  const [fullMatch, indicator, action, duration, direction, tokens] = match;

  // Handle both formats - with and without token information
  const hasTokenInfo = direction !== undefined && tokens !== undefined;

  superDebug(`Claude status MATCHED!`);
  superDebug(
    `Action: ${action}, Duration: ${duration}s, Direction: ${direction}, Tokens: ${tokens}`
  );
  superDebug(`Indicator: '${indicator}'`);
  logger.debug(
    `Claude status MATCHED! Action: ${action}, Duration: ${duration}s, Direction: ${direction}, Tokens: ${tokens}`
  );
  logger.debug(`Full match: "${fullMatch}"`);

  // Filter out the status line from output (need to search in original data with ANSI codes)
  // First try to remove the exact match from the clean data position
  const matchIndex = cleanData.indexOf(fullMatch);
  let filteredData = data;
  if (matchIndex >= 0) {
    // Find corresponding position in original data
    let originalPos = 0;
    let cleanPos = 0;
    while (cleanPos < matchIndex && originalPos < data.length) {
      if (data.startsWith('\x1b[', originalPos)) {
        // Skip ANSI sequence
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes need control characters
        const endMatch = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(data.substring(originalPos));
        if (endMatch) {
          originalPos += endMatch[0].length;
        } else {
          originalPos++;
        }
      } else {
        originalPos++;
        cleanPos++;
      }
    }
    // Now try to remove the status line from around this position
    const before = data.substring(0, Math.max(0, originalPos - 10));
    const after = data.substring(originalPos + fullMatch.length + 50);
    const middle = data.substring(
      Math.max(0, originalPos - 10),
      originalPos + fullMatch.length + 50
    );
    // Look for the status pattern in the middle section
    const statusPattern = new RegExp(
      `[^\n]*${escapeRegex(indicator)}[^\n]*to\\s+interrupt[^\n]*`,
      'gi'
    );
    const cleanedMiddle = middle.replace(statusPattern, '');
    filteredData = before + cleanedMiddle + after;
  }

  // Create compact display text for title bar
  let displayText: string;
  if (hasTokenInfo) {
    // Format tokens - the input already has 'k' suffix in the regex pattern
    // So "6.0" means 6.0k tokens, not 6.0 tokens
    const formattedTokens = `${tokens}k`;
    // Include action and stats (without indicator to avoid title jumping)
    displayText = `${action} (${duration}s, ${direction}${formattedTokens})`;
  } else {
    // Simple format without token info (without indicator to avoid title jumping)
    displayText = `${action} (${duration}s)`;
  }

  return {
    filteredData,
    displayText,
    raw: {
      indicator,
      action,
      duration: Number.parseInt(duration),
      progress: hasTokenInfo ? `${direction}${tokens} tokens` : undefined,
    },
  };
}

// Registry of app-specific detectors
const detectors: AppDetector[] = [
  {
    name: 'claude',
    detect: (cmd) => {
      // First check if the command directly contains 'claude'
      const cmdStr = cmd.join(' ').toLowerCase();
      if (cmdStr.includes('claude')) {
        logger.debug('Claude detected in command line');
        return true;
      }

      // If not found in command, check the process tree
      // This catches cases where Claude is run through wrappers or scripts
      if (isClaudeInProcessTree()) {
        logger.debug('Claude detected in process tree');
        // Log the actual Claude command if available
        const claudeCmd = getClaudeCommandFromTree();
        if (claudeCmd) {
          logger.debug(`Claude command from tree: ${claudeCmd}`);
        }
        return true;
      }

      return false;
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
  private lastStatusTime = 0; // Track when we last saw a status line
  private readonly ACTIVITY_TIMEOUT = 5000; // 5 seconds
  private readonly STATUS_TIMEOUT = 10000; // 10 seconds - clear status if not seen
  private readonly MEANINGFUL_OUTPUT_THRESHOLD = 5; // characters

  // Track Claude status transitions for turn notifications
  private hadClaudeStatus = false;
  private onClaudeTurnCallback?: (sessionId: string) => void;
  private sessionId?: string;

  constructor(command: string[], sessionId?: string) {
    // Find matching detector for this command
    this.detector = detectors.find((d) => d.detect(command)) || null;
    this.sessionId = sessionId;

    if (this.detector) {
      logger.log(
        `ActivityDetector: Using ${this.detector.name} detector for command: ${command.join(' ')}`
      );
    } else {
      logger.debug(
        `ActivityDetector: No specific detector found for command: ${command.join(' ')}`
      );
    }
  }

  /**
   * Check if output is just a prompt
   */
  private isJustPrompt(data: string): boolean {
    // Use unified prompt detector for consistency and performance
    return PromptDetector.isPromptOnly(data);
  }

  /**
   * Process terminal output and extract activity information
   */
  processOutput(data: string): { filteredData: string; activity: ActivityState } {
    // Don't count as activity if it's just a prompt or empty output
    const trimmed = data.trim();
    const isMeaningfulOutput =
      trimmed.length > this.MEANINGFUL_OUTPUT_THRESHOLD && !this.isJustPrompt(trimmed);

    if (isMeaningfulOutput) {
      this.lastActivityTime = Date.now();
    }

    // Log when we process output with a detector
    if (this.detector && data.length > 10) {
      superDebug(`Processing output with ${this.detector.name} detector (${data.length} chars)`);
    }

    // Try app-specific detection first
    if (this.detector) {
      try {
        const status = this.detector.parseStatus(data);
        if (status) {
          this.currentStatus = status;
          this.lastStatusTime = Date.now();
          // Always update activity time for app-specific status
          this.lastActivityTime = Date.now();

          // Update Claude status tracking
          if (this.detector.name === 'claude') {
            this.hadClaudeStatus = true;
          }

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
      } catch (error) {
        logger.error(`Error in ${this.detector.name} status parser:`, error);
        // Continue with unfiltered data if parsing fails
      }
    }

    // Generic activity detection - use getActivityState for consistent time-based checking
    return {
      filteredData: data,
      activity: this.getActivityState(),
    };
  }

  /**
   * Set callback for Claude turn notifications
   */
  setOnClaudeTurn(callback: (sessionId: string) => void): void {
    this.onClaudeTurnCallback = callback;
  }

  /**
   * Get current activity state (for periodic updates)
   */
  getActivityState(): ActivityState {
    const now = Date.now();
    const isActive = now - this.lastActivityTime < this.ACTIVITY_TIMEOUT;

    // Clear status if we haven't seen it for a while
    if (this.currentStatus && now - this.lastStatusTime > this.STATUS_TIMEOUT) {
      logger.debug('Clearing stale status - not seen for', this.STATUS_TIMEOUT, 'ms');
      this.currentStatus = null;

      // Check if this was a Claude status clearing
      if (this.hadClaudeStatus && this.detector?.name === 'claude') {
        logger.log("Claude turn detected - status cleared, it's the user's turn");
        if (this.onClaudeTurnCallback && this.sessionId) {
          this.onClaudeTurnCallback(this.sessionId);
        }
        this.hadClaudeStatus = false;
      }
    }

    // If we have a specific status (like Claude running), always show it
    // The activity indicator in the title will show if it's active or not
    return {
      isActive,
      lastActivityTime: this.lastActivityTime,
      specificStatus:
        this.currentStatus && this.detector
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

/**
 * Test function to help debug Claude status detection
 * @param testData Sample data to test the regex against
 */
export function testClaudeStatusDetection(testData: string): void {
  console.log('\n=== Testing Claude Status Detection ===');
  console.log('Raw data length:', testData.length);
  console.log('Raw data (first 300 chars):', testData.substring(0, 300).replace(/\n/g, '\\n'));

  // Test with current implementation
  const result = parseClaudeStatus(testData);
  if (result) {
    console.log('✅ Status detected:', result.displayText);
  } else {
    console.log('❌ No status detected');

    // Try different variations
    const cleanData = testData.replace(ANSI_REGEX, '');
    console.log('\nClean data (no ANSI):', cleanData.substring(0, 300).replace(/\n/g, '\\n'));

    // Test simpler patterns
    const patterns = [
      /tokens.*interrupt/gi,
      /\d+s.*tokens/gi,
      /[↑↓]\s*\d+.*tokens/gi,
      /(\w+)….*\d+s/gi,
    ];

    patterns.forEach((pattern, idx) => {
      if (pattern.test(cleanData)) {
        console.log(`✓ Pattern ${idx} matches:`, pattern.toString());
        const match = pattern.exec(cleanData);
        if (match) {
          console.log('  Match:', match[0].substring(0, 100));
        }
      } else {
        console.log(`✗ Pattern ${idx} no match:`, pattern.toString());
      }
      pattern.lastIndex = 0; // Reset
    });
  }
  console.log('=== End Test ===\n');
}

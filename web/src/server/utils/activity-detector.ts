/**
 * ActivityDetector - Detects and parses activity status from terminal output
 *
 * Specifically designed to detect Claude's status lines and other activity patterns
 * to determine when a terminal session is actively processing.
 */

export interface SpecificStatus {
  app: string;
  status: string;
}

export interface ActivityState {
  isActive: boolean;
  specificStatus?: SpecificStatus;
}

export interface ProcessedOutput {
  activity: ActivityState;
  filteredData: string;
}

export class ActivityDetector {
  private static readonly CLAUDE_STATUS_REGEX =
    /^([✻✽✶✳✢·⏺*+])\s+(\w+…)\s*\((\d+s(?:\s*[·•]\s*[^)]+)?)\)(?:\s|$)/;
  private static readonly IDLE_TIMEOUT = 5000; // 5 seconds
  private static readonly MIN_OUTPUT_LENGTH = 30; // Minimum output length to consider as activity
  private static readonly PROMPT_PATTERNS = /^\s*[$>❯]\s*$/;

  private lastActivityTime = 0;
  private currentStatus?: SpecificStatus;
  private command: string[];
  private idleTimer?: NodeJS.Timeout;

  constructor(command: string[]) {
    this.command = command;
  }

  /**
   * Check if command is likely Claude
   */
  private isClaudeCommand(): boolean {
    if (!this.command.length) return false;

    const executable = this.command[0].toLowerCase();
    const lastPart = executable.split('/').pop() || '';

    return (
      lastPart.includes('claude') ||
      this.command.some((arg) => arg.toLowerCase().includes('claude'))
    );
  }

  /**
   * Parse Claude status line
   */
  private parseClaudeStatus(line: string): SpecificStatus | null {
    const match = line.match(ActivityDetector.CLAUDE_STATUS_REGEX);
    if (!match) return null;

    const [, symbol, action, details] = match;

    // Parse details section
    let time = '';
    let tokens = '';

    // Split by · or similar separators
    const parts = details.split(/\s*[·•]\s*/);

    // First part is always time
    if (parts[0]) {
      time = parts[0].trim();
    }

    // Second part might be tokens
    if (parts[1]) {
      const tokenMatch = parts[1].match(/(↑|↓)?\s*(\d+(?:\.\d+)?k?)\s*tokens?/i);
      if (tokenMatch) {
        const [, arrow, count] = tokenMatch;
        // Format tokens compactly
        let formattedCount = count;
        if (!count.includes('k')) {
          // Convert large numbers to k format
          const num = Number.parseFloat(count);
          if (num >= 1000) {
            formattedCount = `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
          }
        }
        tokens = (arrow || '') + formattedCount;
      } else if (parts[1].match(/\d+/)) {
        // Just a number without "tokens"
        const numMatch = parts[1].match(/\d+/);
        tokens = numMatch ? numMatch[0] : '';
      }
    }

    // Build compact status
    let status = `${symbol} ${action} (${time}`;
    if (tokens) {
      status += `, ${tokens}`;
    }
    status += ')';

    return {
      app: 'claude',
      status: status,
    };
  }

  /**
   * Process output and update activity state
   */
  processOutput(output: string): ProcessedOutput {
    // Strip ANSI escape codes for processing
    const cleanOutput = this.stripAnsiCodes(output);
    const lines = cleanOutput.split('\n');
    const filteredLines: string[] = [];
    let detectedStatus: SpecificStatus | null = null;

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check for Claude status if this is a Claude command
      if (this.isClaudeCommand()) {
        const status = this.parseClaudeStatus(line);
        if (status) {
          detectedStatus = status;
          continue; // Filter out status lines
        }
      }

      // Keep non-status lines (preserve original with ANSI codes)
      filteredLines.push(output.split('\n')[i]);
    }

    // Update current status if detected
    if (detectedStatus) {
      this.currentStatus = detectedStatus;
      this.updateActivity();
    } else if (!this.isPromptOnly(cleanOutput) && cleanOutput.trim().length > 10) {
      // Consider as activity if output is meaningful
      this.updateActivity();
    }

    return {
      activity: this.getActivityState(),
      filteredData: filteredLines.join('\n'),
    };
  }

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Check if output is just a prompt
   */
  private isPromptOnly(output: string): boolean {
    return ActivityDetector.PROMPT_PATTERNS.test(output.trim());
  }

  /**
   * Update activity timestamp and manage idle timer
   */
  private updateActivity(): void {
    this.lastActivityTime = Date.now();

    // Clear existing timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // Set new idle timer
    this.idleTimer = setTimeout(() => {
      this.lastActivityTime = 0;
      this.currentStatus = undefined;
    }, ActivityDetector.IDLE_TIMEOUT);
  }

  /**
   * Get current activity state
   */
  getActivityState(): ActivityState {
    const now = Date.now();
    const isActive =
      this.lastActivityTime > 0 && now - this.lastActivityTime < ActivityDetector.IDLE_TIMEOUT;

    return {
      isActive,
      specificStatus: isActive ? this.currentStatus : undefined,
    };
  }

  /**
   * Clear specific status while maintaining activity state
   */
  clearStatus(): void {
    this.currentStatus = undefined;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

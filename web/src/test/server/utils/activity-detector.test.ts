import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDetector } from '../../../server/utils/activity-detector.js';

describe('ActivityDetector', () => {
  let detector: ActivityDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new ActivityDetector(['claude']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Claude status parsing', () => {
    it('should parse Claude status with full format', () => {
      const output = '✻ Thinking… (5s · ↑ 1.2k tokens · Ctrl+C to interrupt)\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: '✻ Thinking… (5s, ↑1.2k)',
      });
      expect(result.filteredData.trim()).toBe(''); // Status line should be filtered out
    });

    it('should parse Claude status without direction arrow', () => {
      const output = '✻ Thinking… (5s · 100 tokens · Ctrl+C to interrupt)\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: '✻ Thinking… (5s, 100)',
      });
    });

    it('should parse Claude status without token section', () => {
      const output = '+ Searching… (0s)\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: '+ Searching… (0s)',
      });
    });

    it('should handle various Claude activity symbols', () => {
      const symbols = ['✻', '✽', '✶', '✳', '✢', '·', '⏺', '*', '+'];

      symbols.forEach((symbol) => {
        const detector = new ActivityDetector(['claude']);
        const output = `${symbol} Thinking… (2s)\n`;
        const result = detector.processOutput(output);

        expect(result.activity.specificStatus).toEqual({
          app: 'claude',
          status: `${symbol} Thinking… (2s)`,
        });
      });
    });

    it('should parse multiple status lines in output', () => {
      const output = `Regular output line
✻ Thinking… (1s)
More output
+ Searching… (2s)
Final output`;

      const result = detector.processOutput(output);

      expect(result.activity.specificStatus?.status).toContain('Searching… (2s)'); // Latest status
      expect(result.filteredData).toContain('Regular output line');
      expect(result.filteredData).toContain('More output');
      expect(result.filteredData).toContain('Final output');
    });

    it('should handle status with special characters', () => {
      const output = '✻ Analyzing… (10s · ↓ 2.5k tokens · Ctrl+C to interrupt)\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: '✻ Analyzing… (10s, ↓2.5k)',
      });
    });

    it('should handle status with large token counts', () => {
      const output = '✻ Processing… (30s · ↑ 15432 tokens · Ctrl+C to interrupt)\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: '✻ Processing… (30s, ↑15.4k)',
      });
    });
  });

  describe('Activity state transitions', () => {
    it('should transition from idle to active on output', () => {
      expect(detector.getActivityState().isActive).toBe(false);

      detector.processOutput('Some meaningful output that is longer than threshold\n');

      expect(detector.getActivityState().isActive).toBe(true);
    });

    it('should maintain active state with Claude status', () => {
      detector.processOutput('✻ Thinking… (1s)\n');
      const state = detector.getActivityState();

      expect(state.isActive).toBe(true);
      expect(state.specificStatus).toBeDefined();
    });

    it('should return to idle after timeout', () => {
      detector.processOutput('Some output\n');
      expect(detector.getActivityState().isActive).toBe(true);

      // Advance time by 5 seconds (activity timeout)
      vi.advanceTimersByTime(5000);

      expect(detector.getActivityState().isActive).toBe(false);
    });

    it('should reset idle timer on new output', () => {
      detector.processOutput('First output\n');

      // Advance time by 3 seconds
      vi.advanceTimersByTime(3000);

      // New output should reset timer
      detector.processOutput('Second output\n');

      // Advance time by another 3 seconds (total 6s, but timer was reset)
      vi.advanceTimersByTime(3000);

      expect(detector.getActivityState().isActive).toBe(true);

      // Now advance past the idle timeout
      vi.advanceTimersByTime(2001);

      expect(detector.getActivityState().isActive).toBe(false);
    });

    it('should not count prompts as activity', () => {
      detector.processOutput('$ ');
      expect(detector.getActivityState().isActive).toBe(false);

      detector.processOutput('> ');
      expect(detector.getActivityState().isActive).toBe(false);

      detector.processOutput('❯ ');
      expect(detector.getActivityState().isActive).toBe(false);
    });
  });

  describe('Output filtering', () => {
    it('should filter out Claude status lines from output', () => {
      const output = `Regular line 1
✻ Thinking… (5s)
Regular line 2
+ Searching… (10s · ↑ 1k tokens · Ctrl+C to interrupt)
Regular line 3`;

      const result = detector.processOutput(output);

      expect(result.filteredData).toContain('Regular line 1');
      expect(result.filteredData).toContain('Regular line 2');
      expect(result.filteredData).toContain('Regular line 3');
      expect(result.filteredData).not.toContain('Thinking…');
      expect(result.filteredData).not.toContain('Searching…');
    });

    it('should preserve empty lines when filtering', () => {
      const output = `Line 1

✻ Status… (1s)

Line 2`;

      const result = detector.processOutput(output);

      expect(result.filteredData).toContain('Line 1');
      expect(result.filteredData).toContain('Line 2');
      expect(result.filteredData).not.toContain('Status…');
    });

    it('should handle output without Claude status', () => {
      const output = 'Just regular output\nNo status here\n';
      const result = detector.processOutput(output);

      expect(result.filteredData).toBe(output);
      expect(result.activity.specificStatus).toBeUndefined();
    });
  });

  describe('Command detection', () => {
    it('should detect Claude command variations', () => {
      const variations = [
        ['claude'],
        ['claude', '--help'],
        ['/usr/local/bin/claude'],
        ['claude-cli'],
        ['CLAUDE'],
        ['bash', '-c', 'claude'],
      ];

      variations.forEach((cmd) => {
        const detector = new ActivityDetector(cmd);
        const result = detector.processOutput('✻ Test… (1s)\n');
        expect(result.activity.specificStatus).toBeDefined();
        expect(result.activity.specificStatus?.app).toBe('claude');
      });
    });

    it('should not detect non-Claude commands', () => {
      const detector = new ActivityDetector(['vim', 'file.txt']);
      const result = detector.processOutput('✻ Test… (1s)\n');
      expect(result.activity.specificStatus).toBeUndefined();
    });
  });

  describe('clearStatus', () => {
    it('should clear specific status but maintain activity state', () => {
      detector.processOutput('✻ Thinking… (1s)\n');
      expect(detector.getActivityState().specificStatus).toBeDefined();

      detector.clearStatus();

      const state = detector.getActivityState();
      expect(state.specificStatus).toBeUndefined();
      expect(state.isActive).toBe(true); // Should still be active
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed status lines gracefully', () => {
      const malformed = [
        '✻ Missing parentheses',
        '✻ (5s) Missing action',
        'Missing symbol Thinking… (5s)',
        '✻ Thinking… (not a number)',
      ];

      malformed.forEach((line) => {
        const result = detector.processOutput(`${line}\n`);
        // Should not crash, output should pass through
        expect(result.filteredData).toBe(`${line}\n`);
      });
    });

    it('should handle very long status lines', () => {
      const longAction = 'A'.repeat(100);
      const longStatus = `✻ ${longAction}… (999s · ↑ 999.9k tokens · Ctrl+C to interrupt)\n`;
      const result = detector.processOutput(longStatus);

      expect(result.activity.specificStatus).toBeDefined();
      expect(result.activity.specificStatus?.status).toContain(longAction);
    });

    it('should handle rapid status updates', () => {
      for (let i = 0; i < 100; i++) {
        detector.processOutput(`✻ Thinking… (${i}s)\n`);
      }

      const state = detector.getActivityState();
      expect(state.specificStatus?.status).toContain('(99s)'); // Should have latest
    });

    it('should handle ANSI escape codes in output', () => {
      const output = '\x1B[31m✻ Thinking… (5s)\x1B[0m\n';
      const result = detector.processOutput(output);

      expect(result.activity.specificStatus).toBeDefined();
      expect(result.activity.specificStatus?.status).toContain('Thinking…');
    });

    it('should clear stale status after timeout', () => {
      detector.processOutput('✻ Thinking… (1s)\n');
      expect(detector.getActivityState().specificStatus).toBeDefined();

      // Advance time past status timeout (10 seconds)
      vi.advanceTimersByTime(10001);

      expect(detector.getActivityState().specificStatus).toBeUndefined();
    });
  });
});

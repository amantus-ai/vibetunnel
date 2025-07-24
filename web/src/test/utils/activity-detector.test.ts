import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityDetector,
  type AppDetector,
  registerDetector,
} from '../../server/utils/activity-detector.js';
import * as processTree from '../../server/utils/process-tree.js';

// Mock the process-tree module
vi.mock('../../server/utils/process-tree.js');

describe('Activity Detector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ActivityDetector', () => {
    it('should detect generic activity', () => {
      const detector = new ActivityDetector(['bash']);
      const result = detector.processOutput('Hello world\n');

      expect(result.filteredData).toBe('Hello world\n');
      expect(result.activity.isActive).toBe(true);
      expect(result.activity.specificStatus).toBeUndefined();
    });

    it('should timeout activity after 5 seconds', () => {
      const detector = new ActivityDetector(['bash']);
      detector.processOutput('Hello world\n');

      // Activity should be active immediately
      let state = detector.getActivityState();
      expect(state.isActive).toBe(true);

      // Still active after 4.9 seconds
      vi.advanceTimersByTime(4900);
      state = detector.getActivityState();
      expect(state.isActive).toBe(true);

      // Inactive after 5.1 seconds
      vi.advanceTimersByTime(200);
      state = detector.getActivityState();
      expect(state.isActive).toBe(false);
    });

    it('should use Claude detector for claude commands', () => {
      const detector = new ActivityDetector(['claude', '--resume']);
      const claudeOutput = '✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)\n';
      const result = detector.processOutput(claudeOutput);

      expect(result.filteredData).toBe('\n');
      expect(result.activity.isActive).toBe(true);
      expect(result.activity.specificStatus).toEqual({
        app: 'claude',
        status: 'Crafting (205s, ↑6.0k)',
      });
    });

    it('should detect various Claude status formats', () => {
      const detector = new ActivityDetector(['claude']);

      // Test different status indicators
      const statuses = [
        {
          input: '✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)\n',
          expected: 'Crafting (205s, ↑6.0k)',
        },
        {
          input: '✢ Transitioning… (381s · ↓ 4.0k tokens · esc to interrupt)\n',
          expected: 'Transitioning (381s, ↓4.0k)',
        },
        {
          input: '◐ Processing… (42s · ↑ 1.2k tokens · esc to interrupt)\n',
          expected: 'Processing (42s, ↑1.2k)',
        },
        {
          input: '✻ Compacting conversation… (303s · ↑ 16.3k tokens · esc to interrupt)\n',
          expected: 'Compacting conversation (303s, ↑16.3k)',
        },
      ];

      for (const { input, expected } of statuses) {
        const result = detector.processOutput(input);
        expect(result.activity.specificStatus?.status).toBe(expected);
      }
    });

    it('should preserve non-Claude output', () => {
      const detector = new ActivityDetector(['claude']);
      const mixedOutput =
        'Regular output\n✻ Crafting… (10s · ↑ 1.0k tokens · esc to interrupt)\nMore output\n';
      const result = detector.processOutput(mixedOutput);

      expect(result.filteredData).toBe('Regular output\n\nMore output\n');
      expect(result.activity.specificStatus?.status).toBe('Crafting (10s, ↑1.0k)');
    });

    it('should remember last Claude status', () => {
      const detector = new ActivityDetector(['claude']);

      // Process Claude status
      detector.processOutput('✻ Crafting… (10s · ↑ 1.0k tokens · esc to interrupt)\n');

      // Process regular output - should retain status
      const result = detector.processOutput('Regular output\n');
      expect(result.filteredData).toBe('Regular output\n');
      expect(result.activity.specificStatus?.status).toBe('Crafting (10s, ↑1.0k)');
    });

    it('should clear status on demand', () => {
      const detector = new ActivityDetector(['claude']);

      // Set status
      detector.processOutput('✻ Crafting… (10s · ↑ 1.0k tokens · esc to interrupt)\n');
      let state = detector.getActivityState();
      expect(state.specificStatus).toBeDefined();

      // Clear status
      detector.clearStatus();
      state = detector.getActivityState();
      expect(state.specificStatus).toBeUndefined();
    });

    it('should not detect Claude for non-Claude commands', () => {
      const detector = new ActivityDetector(['vim', 'file.txt']);
      const claudeOutput = '✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)\n';
      const result = detector.processOutput(claudeOutput);

      // Should not filter or detect Claude status
      expect(result.filteredData).toBe(claudeOutput);
      expect(result.activity.specificStatus).toBeUndefined();
    });

    it('should handle regex special characters in status indicators', () => {
      const detector = new ActivityDetector(['claude']);

      // Test with * which is a regex special character that was causing crashes
      const statusWithStar = '* Processing… (42s · ↑ 1.2k tokens · esc to interrupt)\n';
      const result1 = detector.processOutput(statusWithStar);
      expect(result1.activity.specificStatus?.status).toBe('Processing (42s, ↑1.2k)');
      expect(result1.filteredData).toBe('\n');

      // Test with other regex special characters
      const specialChars = ['*', '+', '?', '.', '^', '$', '|', '(', ')', '[', ']', '{', '}', '\\'];
      for (const char of specialChars) {
        const statusWithSpecialChar = `${char} Testing… (10s · ↑ 1.0k tokens · esc to interrupt)\n`;
        const result = detector.processOutput(statusWithSpecialChar);
        expect(result.activity.specificStatus?.status).toBe('Testing (10s, ↑1.0k)');
        expect(result.filteredData).toBe('\n');
      }
    });

    it('should not crash when parsing fails', () => {
      const detector = new ActivityDetector(['claude']);

      // Even if something unexpected happens, it should not crash
      const malformedOutput = 'Some output that might cause issues\n';
      expect(() => {
        const result = detector.processOutput(malformedOutput);
        expect(result.filteredData).toBe(malformedOutput);
        expect(result.activity.specificStatus).toBeUndefined();
      }).not.toThrow();
    });
  });

  describe('registerDetector', () => {
    it('should register a new detector', () => {
      const mockDetector: AppDetector = {
        name: 'test',
        detect: (cmd) => cmd[0] === 'test',
        parseStatus: (data) => ({
          filteredData: data,
          displayText: 'Test status',
        }),
      };

      registerDetector(mockDetector);

      const detector = new ActivityDetector(['test']);
      const result = detector.processOutput('test output');

      expect(result.activity.specificStatus?.app).toBe('test');
    });

    it('should update existing detector', () => {
      const mockDetector1: AppDetector = {
        name: 'update-test',
        detect: (cmd) => cmd[0] === 'update-test',
        parseStatus: () => ({
          filteredData: '',
          displayText: 'Version 1',
        }),
      };

      const mockDetector2: AppDetector = {
        name: 'update-test',
        detect: (cmd) => cmd[0] === 'update-test',
        parseStatus: () => ({
          filteredData: '',
          displayText: 'Version 2',
        }),
      };

      registerDetector(mockDetector1);
      registerDetector(mockDetector2);

      const detector = new ActivityDetector(['update-test']);
      const result = detector.processOutput('test');

      expect(result.activity.specificStatus?.status).toBe('Version 2');
    });
  });

  describe('Claude detection with process tree', () => {
    beforeEach(() => {
      // Reset mocks
      vi.mocked(processTree.isClaudeInProcessTree).mockReturnValue(false);
      vi.mocked(processTree.getClaudeCommandFromTree).mockReturnValue(null);
    });

    it('should detect claude via process tree when not in command', () => {
      // Mock process tree to indicate Claude is running
      vi.mocked(processTree.isClaudeInProcessTree).mockReturnValue(true);
      vi.mocked(processTree.getClaudeCommandFromTree).mockReturnValue('/usr/bin/claude --resume');

      // Create detector with a command that doesn't contain 'claude'
      const detector = new ActivityDetector(['bash', '-l']);
      const result = detector.processOutput(
        '✻ Measuring… (6s · ↑ 100 tokens · esc to interrupt)\n'
      );

      // Should still detect Claude status because it's in the process tree
      expect(result.activity.specificStatus).toBeDefined();
      expect(result.activity.specificStatus?.app).toBe('claude');
      expect(result.activity.specificStatus?.status).toContain('Measuring');
    });

    it('should not detect claude when neither in command nor process tree', () => {
      // Process tree indicates no Claude
      vi.mocked(processTree.isClaudeInProcessTree).mockReturnValue(false);

      const detector = new ActivityDetector(['vim', 'file.txt']);
      const result = detector.processOutput(
        '✻ Measuring… (6s · ↑ 100 tokens · esc to interrupt)\n'
      );

      // Should not detect Claude status
      expect(result.activity.specificStatus).toBeUndefined();
    });

    it('should prefer direct command detection over process tree', () => {
      // Even if process tree check fails, should still work with direct command
      vi.mocked(processTree.isClaudeInProcessTree).mockImplementation(() => {
        throw new Error('Process tree check failed');
      });

      const detector = new ActivityDetector(['claude', '--resume']);
      const result = detector.processOutput(
        '✻ Measuring… (6s · ↑ 100 tokens · esc to interrupt)\n'
      );

      // Should still detect Claude status
      expect(result.activity.specificStatus).toBeDefined();
      expect(result.activity.specificStatus?.app).toBe('claude');
    });
  });
});

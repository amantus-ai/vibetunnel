import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityDetector,
  type AppDetector,
  registerDetector,
} from '../../server/utils/activity-detector.js';

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
        status: '✻ Crafting (205s, ↑6.0k)',
      });
    });

    it('should detect various Claude status formats', () => {
      const detector = new ActivityDetector(['claude']);

      // Test different status indicators
      const statuses = [
        {
          input: '✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)\n',
          expected: '✻ Crafting (205s, ↑6.0k)',
        },
        {
          input: '✢ Transitioning… (381s · ↓ 4.0k tokens · esc to interrupt)\n',
          expected: '✢ Transitioning (381s, ↓4.0k)',
        },
        {
          input: '◐ Processing… (42s · ↑ 1.2k tokens · esc to interrupt)\n',
          expected: '◐ Processing (42s, ↑1.2k)',
        },
        {
          input: '✻ Compacting conversation… (303s · ↑ 16.3k tokens · esc to interrupt)\n',
          expected: '✻ Compacting conversation (303s, ↑16.3k)',
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
      expect(result.activity.specificStatus?.status).toBe('✻ Crafting (10s, ↑1.0k)');
    });

    it('should remember last Claude status', () => {
      const detector = new ActivityDetector(['claude']);

      // Process Claude status
      detector.processOutput('✻ Crafting… (10s · ↑ 1.0k tokens · esc to interrupt)\n');

      // Process regular output - should retain status
      const result = detector.processOutput('Regular output\n');
      expect(result.filteredData).toBe('Regular output\n');
      expect(result.activity.specificStatus?.status).toBe('✻ Crafting (10s, ↑1.0k)');
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
});

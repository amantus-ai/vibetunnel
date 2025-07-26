import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDetector } from './activity-detector.js';

describe('ActivityDetector - Claude Turn Notifications', () => {
  let detector: ActivityDetector;
  let turnCallback: ReturnType<typeof vi.fn>;
  const sessionId = 'test-session-123';

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new ActivityDetector(['claude'], sessionId);
    turnCallback = vi.fn();
    detector.setOnClaudeTurn(turnCallback);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should detect Claude turn when status clears after being active', () => {
    // First, simulate Claude being active with a status
    const claudeOutput = '✻ Crafting… (10s · ↑ 2.5k tokens · esc to interrupt)\n';
    detector.processOutput(claudeOutput);

    // Verify Claude is active
    let state = detector.getActivityState();
    expect(state.specificStatus).toBeDefined();
    expect(state.specificStatus?.app).toBe('claude');
    expect(state.specificStatus?.status).toContain('Crafting');

    // Advance time past STATUS_TIMEOUT (10 seconds)
    vi.advanceTimersByTime(11000);

    // Check state again - status should clear and trigger turn notification
    state = detector.getActivityState();
    expect(state.specificStatus).toBeUndefined();
    expect(turnCallback).toHaveBeenCalledWith(sessionId);
    expect(turnCallback).toHaveBeenCalledTimes(1);
  });

  it('should not trigger turn notification if Claude was never active', () => {
    // Process some non-Claude output
    detector.processOutput('Regular terminal output\n');

    // Advance time
    vi.advanceTimersByTime(15000);

    // Check state - should not trigger turn notification
    detector.getActivityState();
    expect(turnCallback).not.toHaveBeenCalled();
  });

  it('should not trigger turn notification multiple times for same transition', () => {
    // Simulate Claude being active
    const claudeOutput = '✻ Thinking… (5s · ↓ 1.2k tokens · esc to interrupt)\n';
    detector.processOutput(claudeOutput);

    // Let status timeout
    vi.advanceTimersByTime(11000);

    // First check should trigger
    detector.getActivityState();
    expect(turnCallback).toHaveBeenCalledTimes(1);

    // Subsequent checks should not trigger again
    detector.getActivityState();
    detector.getActivityState();
    expect(turnCallback).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple Claude sessions correctly', () => {
    // First session becomes active
    detector.processOutput('✻ Searching… (3s · ↑ 0.5k tokens · esc to interrupt)\n');

    // Status clears
    vi.advanceTimersByTime(11000);
    detector.getActivityState();
    expect(turnCallback).toHaveBeenCalledTimes(1);

    // Claude becomes active again
    detector.processOutput('✻ Crafting… (8s · ↑ 3.0k tokens · esc to interrupt)\n');

    // Status clears again
    vi.advanceTimersByTime(11000);
    detector.getActivityState();
    expect(turnCallback).toHaveBeenCalledTimes(2);
  });

  it('should not trigger if callback is not set', () => {
    // Create detector without callback
    const detectorNoCallback = new ActivityDetector(['claude'], 'session-2');

    // Simulate Claude activity and timeout
    detectorNoCallback.processOutput('✻ Thinking… (5s · ↓ 1.2k tokens · esc to interrupt)\n');
    vi.advanceTimersByTime(11000);

    // Should not throw error
    expect(() => detectorNoCallback.getActivityState()).not.toThrow();
  });

  it('should update status when new Claude output arrives before timeout', () => {
    // Initial Claude status
    detector.processOutput('✻ Thinking… (1s · ↓ 0.1k tokens · esc to interrupt)\n');

    // Advance time but not past timeout
    vi.advanceTimersByTime(5000);

    // New Claude status arrives
    detector.processOutput('✻ Crafting… (6s · ↑ 2.0k tokens · esc to interrupt)\n');

    // Status should update, not clear
    const state = detector.getActivityState();
    expect(state.specificStatus?.status).toContain('Crafting');
    expect(turnCallback).not.toHaveBeenCalled();
  });
});

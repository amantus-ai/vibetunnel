import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafePTYWriter } from '../../server/pty/safe-pty-writer.js';

describe('SafePTYWriter', () => {
  let mockPty: IPty;
  let onDataCallback: ((data: string) => void) | undefined;
  let writer: SafePTYWriter;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create mock PTY
    mockPty = {
      onData: vi.fn((callback: (data: string) => void) => {
        onDataCallback = callback;
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 12345,
      process: 'test',
      handleFlowControl: false,
      onExit: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as IPty;

    writer = new SafePTYWriter(mockPty, { debug: false });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe('basic functionality', () => {
    it('should attach to PTY and intercept data', () => {
      const onData = vi.fn();
      writer.attach(onData);

      expect(mockPty.onData).toHaveBeenCalledWith(expect.any(Function));

      // Simulate PTY output
      onDataCallback?.('Hello World');
      expect(onData).toHaveBeenCalledWith('Hello World');
    });

    it('should queue titles for injection', () => {
      writer.queueTitle('Test Title');
      expect(writer.getPendingCount()).toBe(1);

      // New title replaces the previous one
      writer.queueTitle('Another Title');
      expect(writer.getPendingCount()).toBe(1);
    });

    it('should clear pending titles', () => {
      writer.queueTitle('Test Title');
      // New title replaces the previous one
      writer.queueTitle('Another Title');
      expect(writer.getPendingCount()).toBe(1);

      writer.clearPending();
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('safe injection at newlines', () => {
    it('should inject title after newline', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Safe Title');

      // Send data with newline
      onDataCallback?.('Hello World\n');

      expect(onData).toHaveBeenCalledWith('Hello World\n\x1b]0;Safe Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });

    it('should only inject latest title when multiple are queued', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Title 1');
      writer.queueTitle('Title 2'); // This replaces Title 1

      // Send data with newline
      onDataCallback?.('Line 1\nLine 2\n');

      // Should only inject the latest title (Title 2)
      expect(onData).toHaveBeenCalledWith('Line 1\n\x1b]0;Title 2\x07Line 2\n');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('safe injection at carriage returns', () => {
    it('should inject title after carriage return', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('CR Title');

      // Send data with carriage return
      onDataCallback?.('Progress: 100%\r');

      expect(onData).toHaveBeenCalledWith('Progress: 100%\r\x1b]0;CR Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('safe injection after escape sequences', () => {
    it('should inject after CSI sequence', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('After CSI');

      // Send data with color escape sequence
      onDataCallback?.('\x1b[31mRed Text\x1b[0m');

      // Should inject after either escape sequence (both are safe)
      const callArg = onData.mock.calls[0][0];
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Testing ANSI escape sequences
      expect(callArg).toMatch(/\x1b\[31m.*\x1b\]0;After CSI\x07.*Red Text\x1b\[0m/);
      expect(writer.getPendingCount()).toBe(0);
    });

    it('should not inject in middle of escape sequence', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Mid Escape');

      // Send incomplete escape sequence
      onDataCallback?.('\x1b[31');

      // Should not inject yet
      expect(onData).toHaveBeenCalledWith('\x1b[31');
      expect(writer.getPendingCount()).toBe(1); // Still pending

      // Complete the sequence
      onDataCallback?.('m');

      // Now it should inject
      expect(onData).toHaveBeenCalledWith('m\x1b]0;Mid Escape\x07');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('safe injection at prompt patterns', () => {
    it('should inject after bash prompt', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Prompt Title');

      // Send data with bash prompt
      onDataCallback?.('user@host:~$ ');

      expect(onData).toHaveBeenCalledWith('user@host:~$ \x1b]0;Prompt Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });

    it('should inject after root prompt', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Root Title');

      // Send data with root prompt
      onDataCallback?.('root@host:/# ');

      expect(onData).toHaveBeenCalledWith('root@host:/# \x1b]0;Root Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('idle injection', () => {
    it('should inject during idle period', () => {
      const writer = new SafePTYWriter(mockPty, { idleThreshold: 50 });
      const onData = vi.fn();
      writer.attach(onData);

      // Queue title but send data without safe points
      writer.queueTitle('Idle Title');
      onDataCallback?.('Some output');

      // Title should not be injected yet
      expect(writer.getPendingCount()).toBe(1);
      expect(mockPty.write).not.toHaveBeenCalled();

      // Advance time past idle threshold
      vi.advanceTimersByTime(60);

      // Title should be injected directly to PTY
      expect(mockPty.write).toHaveBeenCalledWith('\x1b]0;Idle Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });

    it('should reset idle timer on new output', () => {
      const writer = new SafePTYWriter(mockPty, { idleThreshold: 50 });
      const onData = vi.fn();
      writer.attach(onData);

      writer.queueTitle('Reset Timer');
      onDataCallback?.('Output 1');

      // Advance time partially
      vi.advanceTimersByTime(30);

      // New output should reset timer
      onDataCallback?.('Output 2');

      // Advance time past original threshold
      vi.advanceTimersByTime(30);

      // Should not have injected yet (timer was reset)
      expect(mockPty.write).not.toHaveBeenCalled();

      // Advance remaining time
      vi.advanceTimersByTime(30);

      // Now it should inject
      expect(mockPty.write).toHaveBeenCalledWith('\x1b]0;Reset Timer\x07');
    });
  });

  describe('UTF-8 safety', () => {
    it('should not inject in middle of UTF-8 sequence', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('UTF8 Title');

      // Send partial UTF-8 sequence for emoji 😀 (F0 9F 98 80)
      onDataCallback?.('Hello \xF0\x9F');

      // Should not inject in middle of UTF-8
      expect(onData).toHaveBeenCalledWith('Hello \xF0\x9F');
      expect(writer.getPendingCount()).toBe(1);

      // Complete UTF-8 sequence and add newline
      onDataCallback?.('\x98\x80\n');

      // Should inject after newline
      expect(onData).toHaveBeenCalledWith('\x98\x80\n\x1b]0;UTF8 Title\x07');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('force injection', () => {
    it('should force inject pending title', () => {
      writer.queueTitle('Force 1');
      writer.queueTitle('Force 2'); // This replaces Force 1

      expect(writer.getPendingCount()).toBe(1);

      writer.forceInject();

      expect(mockPty.write).toHaveBeenCalledWith('\x1b]0;Force 2\x07');
      expect(writer.getPendingCount()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty data', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Empty Data');

      onDataCallback?.('');

      expect(onData).toHaveBeenCalledWith('');
      expect(writer.getPendingCount()).toBe(1);
    });

    it('should handle detach', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Detach Test');

      writer.detach();

      // Should clear pending titles
      expect(writer.getPendingCount()).toBe(0);
    });

    it('should handle multiple safe points in single chunk', () => {
      const onData = vi.fn();
      writer.attach(onData);
      writer.queueTitle('Multi 1');
      writer.queueTitle('Multi 2');
      writer.queueTitle('Multi 3'); // Only this one will be injected

      // Send data with multiple safe points
      onDataCallback?.('Line 1\nLine 2\nLine 3\n');

      // Only latest title should be injected at first safe point
      expect(onData).toHaveBeenCalledWith('Line 1\n\x1b]0;Multi 3\x07Line 2\nLine 3\n');
      expect(writer.getPendingCount()).toBe(0);
    });
  });
});

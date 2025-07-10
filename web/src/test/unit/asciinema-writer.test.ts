import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../server/config.js';
import { AsciinemaWriter } from '../../server/pty/asciinema-writer.js';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);
const stat = promisify(fs.stat);

describe('AsciinemaWriter', () => {
  const testDir = path.join(process.cwd(), 'test-temp');
  const testFile = path.join(testDir, 'test.cast');
  let writer: AsciinemaWriter;

  beforeEach(async () => {
    // Create test directory
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    if (writer?.isOpen()) {
      await writer.close();
    }

    // Clean up test files
    try {
      await unlink(testFile);
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }

    // Restore timers if they were mocked
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  describe('Startup File Handling', () => {
    it('should truncate large existing files on startup', async () => {
      const originalMaxSize = config.MAX_CAST_SIZE;
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.MAX_CAST_SIZE = 1024; // 1KB for testing
      config.CAST_SIZE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour to prevent timer issues

      try {
        // Create a large file first
        const header = JSON.stringify({
          version: 2,
          width: 80,
          height: 24,
          timestamp: Math.floor(Date.now() / 1000),
        });

        let content = header + '\n';
        // Add many events to exceed size limit
        for (let i = 0; i < 100; i++) {
          const event = JSON.stringify([i * 0.1, 'o', `Line ${i}: ${'X'.repeat(50)}\n`]);
          content += event + '\n';
        }

        await writeFile(testFile, content);

        // Verify file is large
        const statsBefore = await stat(testFile);
        expect(statsBefore.size).toBeGreaterThan(config.MAX_CAST_SIZE);

        // Create writer - should truncate on startup
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Give it a moment to complete initialization
        await new Promise((resolve) => setTimeout(resolve, 50));

        await writer.close();

        // Check file was truncated
        const statsAfter = await stat(testFile);
        expect(statsAfter.size).toBeLessThan(config.MAX_CAST_SIZE);

        // Verify truncation marker was added
        const newContent = await readFile(testFile, 'utf8');
        expect(newContent).toContain('[Truncated');
        expect(newContent).toContain('on startup');

        // Verify it kept recent events
        const lines = newContent.trim().split('\n');
        const lastEvent = lines[lines.length - 1];
        expect(lastEvent).toContain('Line 99'); // Should keep the most recent event
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });

    it('should append to existing small files', async () => {
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.CAST_SIZE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour to prevent timer issues

      try {
        // Create a small valid cast file
        const header = JSON.stringify({
          version: 2,
          width: 80,
          height: 24,
          timestamp: Math.floor(Date.now() / 1000),
        });

        const existingEvents = [
          JSON.stringify([0.1, 'o', 'Existing line 1\n']),
          JSON.stringify([0.2, 'o', 'Existing line 2\n']),
        ];

        const content = header + '\n' + existingEvents.join('\n') + '\n';
        await writeFile(testFile, content);

        // Create writer - should append to existing file
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write new data
        writer.writeOutput(Buffer.from('New line\n'));

        await writer.close();

        // Verify file contains both old and new content
        const finalContent = await readFile(testFile, 'utf8');
        expect(finalContent).toContain('Existing line 1');
        expect(finalContent).toContain('Existing line 2');
        expect(finalContent).toContain('New line');

        // Verify only one header
        const headerCount = (finalContent.match(/"version"/g) || []).length;
        expect(headerCount).toBe(1);
      } finally {
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });

    it('should create new file if existing file has invalid format', async () => {
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.CAST_SIZE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour to prevent timer issues

      try {
        // Create an invalid file
        await writeFile(testFile, 'Not a valid asciinema file\n');

        // Create writer - should create new file
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        await writer.close();

        // Verify file has valid header
        const content = await readFile(testFile, 'utf8');
        const lines = content.trim().split('\n');
        expect(lines[0]).toContain('"version":2');
      } finally {
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });
  });

  describe('File Size Limiting', () => {
    it('should not truncate files under the size limit', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

      // Write some data (but not enough to exceed limit)
      const smallData = Buffer.from('Hello, World!\n');
      for (let i = 0; i < 10; i++) {
        writer.writeOutput(smallData);
      }

      // Advance time to trigger size check
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);

      // Wait for async operations
      await vi.runAllTimersAsync();

      await writer.close();

      // Read file and verify no truncation marker
      const content = await readFile(testFile, 'utf8');
      expect(content).not.toContain('[Truncated');

      // Verify all events are present
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(11); // 1 header + 10 events
    });

    it('should truncate files exceeding the size limit', async () => {
      // Temporarily reduce the max size for testing
      const originalMaxSize = config.MAX_CAST_SIZE;
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.MAX_CAST_SIZE = 1024; // 1KB for testing
      config.CAST_SIZE_CHECK_INTERVAL = 100; // Short interval for testing

      try {
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write some initial data
        for (let i = 0; i < 5; i++) {
          writer.writeOutput(Buffer.from(`Line ${i}\n`));
        }

        // Wait for writes to complete
        await (writer as any).writeQueue.drain();

        // Now write large amounts of data to exceed limit
        const largeData = Buffer.from(`${'A'.repeat(100)}\n`);
        for (let i = 0; i < 20; i++) {
          writer.writeOutput(largeData);
        }

        // Wait for the write queue to drain
        await (writer as any).writeQueue.drain();

        // Check size before truncation
        const statsBefore = await stat(testFile);
        expect(statsBefore.size).toBeGreaterThan(config.MAX_CAST_SIZE);

        // Manually trigger size check by calling the private method
        const checkMethod = (writer as any).checkAndTruncateFile.bind(writer);
        await checkMethod();

        // Wait a bit for truncation to complete (it's async)
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Wait for any pending operations after truncation
        await (writer as any).writeQueue.drain();

        // Check size after truncation but before closing
        const statsAfterTruncate = await stat(testFile);

        await writer.close();

        // Verify file was truncated
        const stats = await stat(testFile);

        // The file should be truncated
        expect(statsAfterTruncate.size).toBeLessThan(config.MAX_CAST_SIZE);
        expect(stats.size).toBeLessThan(config.MAX_CAST_SIZE * 1.1); // Allow 10% margin for close operations

        // Verify truncation marker exists
        const content = await readFile(testFile, 'utf8');
        expect(content).toContain('[Truncated');
        expect(content).toContain('events to limit file size');
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });

    it('should keep most recent events when truncating', async () => {
      const originalMaxSize = config.MAX_CAST_SIZE;
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.MAX_CAST_SIZE = 1024; // 1KB for testing
      config.CAST_SIZE_CHECK_INTERVAL = 100; // Short interval

      try {
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write numbered events to track which ones are kept
        for (let i = 0; i < 100; i++) {
          writer.writeOutput(Buffer.from(`Event ${i}: ${'X'.repeat(20)}\n`));
        }

        // Wait for the write queue to drain
        await (writer as any).writeQueue.drain();

        // Manually trigger truncation
        const checkMethod = (writer as any).checkAndTruncateFile.bind(writer);
        await checkMethod();

        // Wait for truncation to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
        await (writer as any).writeQueue.drain();

        await writer.close();

        const content = await readFile(testFile, 'utf8');
        const lines = content.trim().split('\n');
        const events = lines.slice(1); // Skip header

        // Verify we have recent events (higher numbers)
        const lastEvent = events[events.length - 1];
        expect(lastEvent).toContain('Event 99'); // Most recent event

        // Verify older events were removed
        const allContent = events.join('\n');
        expect(allContent).not.toContain('Event 0'); // Oldest event should be gone
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });

    it('should handle truncation errors gracefully', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      const originalMaxSize = config.MAX_CAST_SIZE;
      config.MAX_CAST_SIZE = 1024; // 1KB for testing

      try {
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write data to exceed limit
        const largeData = Buffer.from(`${'A'.repeat(100)}\n`);
        for (let i = 0; i < 20; i++) {
          writer.writeOutput(largeData);
        }

        // Mock file read to fail during truncation
        const originalReadFile = fs.promises.readFile;
        fs.promises.readFile = vi.fn().mockRejectedValue(new Error('Read failed'));

        // Advance time to trigger size check
        vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);

        // Wait for async operations
        await vi.runAllTimersAsync();

        // Give error handling time to complete
        await vi.runAllTimersAsync();

        // Restore original function
        fs.promises.readFile = originalReadFile;

        // Writer should still be functional
        expect(writer.isOpen()).toBe(true);

        // Should be able to write more data
        writer.writeOutput(Buffer.from('After error\n'));

        await writer.close();

        // File should still exist and contain data
        const content = await readFile(testFile, 'utf8');
        expect(content).toBeTruthy();
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
      }
    });

    it('should stop size checking when writer is closed', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

      // Close the writer
      await writer.close();

      // Advance time - no errors should occur
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL * 2);

      // No size check should have been performed
      const stats = await stat(testFile);
      expect(stats.size).toBeGreaterThan(0);
    });

    it('should handle concurrent writes during truncation', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      const originalMaxSize = config.MAX_CAST_SIZE;
      config.MAX_CAST_SIZE = 2048; // 2KB for testing

      try {
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write initial data to approach limit
        const data = Buffer.from(`${'X'.repeat(50)}\n`);
        for (let i = 0; i < 30; i++) {
          writer.writeOutput(data);
        }

        // Start concurrent writes
        const writePromises = [];
        for (let i = 0; i < 10; i++) {
          writePromises.push(
            new Promise<void>((resolve) => {
              writer.writeOutput(Buffer.from(`Concurrent ${i}\n`));
              resolve();
            })
          );
        }

        // Trigger size check while writes are happening
        vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);

        // Wait for all operations
        await Promise.all(writePromises);
        await vi.runAllTimersAsync();

        // Give truncation time to complete
        await vi.runAllTimersAsync();

        await writer.close();

        // Verify file is still valid
        const content = await readFile(testFile, 'utf8');
        const lines = content.trim().split('\n');

        // Should have header
        expect(lines[0]).toContain('"version":2');

        // All remaining lines should be valid JSON arrays (events)
        for (let i = 1; i < lines.length; i++) {
          expect(() => JSON.parse(lines[i])).not.toThrow();
        }
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
      }
    });

    it('should respect the truncation target percentage', async () => {
      const originalMaxSize = config.MAX_CAST_SIZE;
      const originalCheckInterval = config.CAST_SIZE_CHECK_INTERVAL;
      config.MAX_CAST_SIZE = 10240; // 10KB for testing
      config.CAST_SIZE_CHECK_INTERVAL = 100; // Short interval

      try {
        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Fill file beyond limit
        const data = Buffer.from(`${'Y'.repeat(100)}\n`);
        for (let i = 0; i < 150; i++) {
          writer.writeOutput(data);
        }

        // Wait for the write queue to drain
        await (writer as any).writeQueue.drain();

        // Manually trigger truncation
        const checkMethod = (writer as any).checkAndTruncateFile.bind(writer);
        await checkMethod();

        // Wait for truncation to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
        await (writer as any).writeQueue.drain();

        await writer.close();

        // Check final size is around target percentage
        const stats = await stat(testFile);
        const targetSize = config.MAX_CAST_SIZE * config.CAST_TRUNCATION_TARGET_PERCENTAGE;

        // Allow some variance due to event boundaries
        expect(stats.size).toBeLessThan(config.MAX_CAST_SIZE);
        expect(stats.size).toBeLessThan(targetSize * 1.2); // Within 20% of target
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
        config.CAST_SIZE_CHECK_INTERVAL = originalCheckInterval;
      }
    });

    it('should handle empty files gracefully', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

      // Don't write any data, just trigger size check
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
      await vi.runAllTimersAsync();

      await writer.close();

      // Should only have header
      const content = await readFile(testFile, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('"version":2');
    });

    it('should handle malformed files during truncation', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      const originalMaxSize = config.MAX_CAST_SIZE;
      config.MAX_CAST_SIZE = 1024; // 1KB for testing

      try {
        // Create a malformed cast file
        const malformedContent = '{"version":2}\nNOT_VALID_JSON\n[1,"o","valid"]\n';
        await writeFile(testFile, malformedContent);

        writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

        // Write more data to trigger truncation
        const data = Buffer.from(`${'Z'.repeat(100)}\n`);
        for (let i = 0; i < 20; i++) {
          writer.writeOutput(data);
        }

        // Trigger size check
        vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
        await vi.runAllTimersAsync();

        // Give truncation time to complete
        await vi.runAllTimersAsync();

        // Writer should still be functional
        expect(writer.isOpen()).toBe(true);

        await writer.close();

        // File should still exist
        const stats = await stat(testFile);
        expect(stats.size).toBeGreaterThan(0);
      } finally {
        config.MAX_CAST_SIZE = originalMaxSize;
      }
    });
  });

  describe('Timer Management', () => {
    it('should reschedule timer after each check', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

      // First check
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
      await vi.runAllTimersAsync();

      // Write some data
      writer.writeOutput(Buffer.from('After first check\n'));

      // Second check should still happen
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
      await vi.runAllTimersAsync();

      await writer.close();

      const content = await readFile(testFile, 'utf8');
      expect(content).toContain('After first check');
    });

    it('should not reschedule timer if writer is closed during check', async () => {
      // Use fake timers for this test
      vi.useFakeTimers();

      writer = AsciinemaWriter.create(testFile, 80, 24, 'test-cmd');

      // Mock checkAndTruncateFile to close the writer
      const checkAndTruncate = vi
        .spyOn(
          writer as unknown as { checkAndTruncateFile: () => Promise<void> },
          'checkAndTruncateFile'
        )
        .mockImplementation(async () => {
          await writer.close();
        });

      // Trigger first check
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
      await vi.runAllTimersAsync();

      // Verify check was called
      expect(checkAndTruncate).toHaveBeenCalledTimes(1);

      // Advance time again - no second check should happen
      vi.advanceTimersByTime(config.CAST_SIZE_CHECK_INTERVAL);
      await vi.runAllTimersAsync();

      // Still only one call
      expect(checkAndTruncate).toHaveBeenCalledTimes(1);
    });
  });
});

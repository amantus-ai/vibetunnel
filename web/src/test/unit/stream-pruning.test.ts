import type { Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsciinemaHeader } from '../../server/pty/types.js';
import { StreamWatcher } from '../../server/services/stream-watcher.js';
import {
  mockAsciinemaNoClears,
  mockAsciinemaWithClearMidLine,
  mockAsciinemaWithClears,
} from '../fixtures/test-data.js';

// Type for asciinema events used in tests
type TestAsciinemaEvent = [number | 'exit', string | number, string?];

describe('StreamWatcher - Asciinema Stream Pruning', () => {
  let streamWatcher: StreamWatcher;
  let tempDir: string;
  let mockResponse: Partial<Response>;
  let writtenData: string[] = [];

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-pruning-test-'));

    // Mock response object
    writtenData = [];
    mockResponse = {
      write: vi.fn((data: string) => {
        writtenData.push(data);
        return true;
      }),
      end: vi.fn(),
      locals: {},
    };

    streamWatcher = new StreamWatcher();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper to create test asciinema file
  function createTestFile(
    filename: string,
    header: AsciinemaHeader,
    events: TestAsciinemaEvent[]
  ): string {
    const filepath = path.join(tempDir, filename);
    const lines = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))];
    fs.writeFileSync(filepath, lines.join('\n'));
    return filepath;
  }

  // Helper to parse SSE data
  function parseSSEData(data: string[]): Array<AsciinemaHeader | TestAsciinemaEvent> {
    return data
      .filter((line) => line.startsWith('data: '))
      .map((line) => {
        const jsonStr = line.substring(6).trim();
        try {
          return JSON.parse(jsonStr);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  it('should prune content before the last clear sequence', async () => {
    const filepath = createTestFile(
      'with-clears.cast',
      mockAsciinemaWithClears.header as AsciinemaHeader,
      mockAsciinemaWithClears.events as TestAsciinemaEvent[]
    );

    // Use reflection to call private method
    // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
    const sendExistingContent = (streamWatcher as any).sendExistingContent.bind(streamWatcher);
    sendExistingContent(filepath, { response: mockResponse, startTime: Date.now() / 1000 });

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = parseSSEData(writtenData);

    // Should have header + final content only
    expect(events.length).toBeGreaterThan(0);

    // First event should be header with updated dimensions
    const header = events[0] as AsciinemaHeader;
    expect(header.version).toBe(2);
    expect(header.width).toBe(100); // From last resize before clear
    expect(header.height).toBe(30);

    // Should only have content after the last clear
    const outputEvents = events.filter((e) => Array.isArray(e) && e[1] === 'o');
    expect(outputEvents.length).toBe(3); // Lines 9, 10, 11
    expect(outputEvents[0][2]).toContain('Line 9: Final content');
    expect(outputEvents[1][2]).toContain('Line 10: This should be visible');
    expect(outputEvents[2][2]).toContain('Line 11: Last line');

    // Should have exit event
    const exitEvent = events.find((e) => Array.isArray(e) && e[0] === 'exit');
    expect(exitEvent).toBeDefined();
  });

  it('should handle clear sequence in middle of line', async () => {
    const filepath = createTestFile(
      'clear-mid-line.cast',
      mockAsciinemaWithClearMidLine.header as AsciinemaHeader,
      mockAsciinemaWithClearMidLine.events as TestAsciinemaEvent[]
    );

    // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
    const sendExistingContent = (streamWatcher as any).sendExistingContent.bind(streamWatcher);
    sendExistingContent(filepath, { response: mockResponse, startTime: Date.now() / 1000 });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = parseSSEData(writtenData);

    // Should only have content after the clear
    const outputEvents = events.filter((e) => Array.isArray(e) && e[1] === 'o');
    expect(outputEvents.length).toBe(1); // Only "After clear"
    expect(outputEvents[0][2]).toContain('After clear');
  });

  it('should not prune streams without clear sequences', async () => {
    const filepath = createTestFile(
      'no-clears.cast',
      mockAsciinemaNoClears.header as AsciinemaHeader,
      mockAsciinemaNoClears.events as TestAsciinemaEvent[]
    );

    // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
    const sendExistingContent = (streamWatcher as any).sendExistingContent.bind(streamWatcher);
    sendExistingContent(filepath, { response: mockResponse, startTime: Date.now() / 1000 });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = parseSSEData(writtenData);

    // Should have all events
    const outputEvents = events.filter((e) => Array.isArray(e) && e[1] === 'o');
    expect(outputEvents.length).toBe(3); // All 3 lines
    expect(outputEvents[0][2]).toContain('Line 1: No clears');
    expect(outputEvents[1][2]).toContain('Line 2: Just regular');
    expect(outputEvents[2][2]).toContain('Line 3: Should replay');
  });

  it('should fall back to non-pruning on read errors', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.cast');

    // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
    const sendExistingContent = (streamWatcher as any).sendExistingContent.bind(streamWatcher);
    sendExistingContent(nonExistentPath, { response: mockResponse, startTime: Date.now() / 1000 });

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have called the fallback method (no data written due to missing file)
    expect(writtenData.length).toBe(0);
  });

  it('should handle real-world Claude session with multiple clears', async () => {
    // Use the actual real-world cast file
    const filepath = path.join(__dirname, '../fixtures/asciinema/real-world-claude-session.cast');

    // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
    const sendExistingContent = (streamWatcher as any).sendExistingContent.bind(streamWatcher);
    sendExistingContent(filepath, { response: mockResponse, startTime: Date.now() / 1000 });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = parseSSEData(writtenData);

    // Should have pruned everything before the last clear
    expect(events.length).toBeGreaterThan(0);

    // First event should be header
    const header = events[0] as AsciinemaHeader;
    expect(header.version).toBe(2);

    // Check that we're getting content after the last clear
    const outputEvents = events.filter((e) => Array.isArray(e) && e[1] === 'o');
    expect(outputEvents.length).toBeGreaterThan(0);

    // The real file has 4 clear sequences, we should only see content after the last one
    // Check that we have the welcome banner (appears after the last clear)
    const welcomeContent = outputEvents.map((e) => e[2]).join('');
    // Strip ANSI escape sequences for easier testing
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are necessary for terminal output
    const cleanContent = welcomeContent.replace(/\u001b\[[^m]*m/g, '');
    expect(cleanContent).toContain('Welcome to Claude Code');
    expect(cleanContent).toContain('/help for help');

    // We should NOT see content from before the clears
    expect(cleanContent).not.toContain('Some previous Claude output');
    expect(cleanContent).not.toContain('cd workspaces'); // This was at the beginning
  });
});

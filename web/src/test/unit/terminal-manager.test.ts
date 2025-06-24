import { beforeEach, describe, expect, it } from 'vitest';
import { TerminalManager } from '../../server/services/terminal-manager';
import type { SessionEntry } from '../../server/types';

describe.skip('TerminalManager - OUTDATED TESTS', () => {
  let terminalManager: TerminalManager;

  beforeEach(() => {
    terminalManager = new TerminalManager();
  });

  describe('Terminal Creation', () => {
    it('should create a new terminal', () => {
      const session: SessionEntry = {
        id: 'test123',
        cmdline: ['bash', '-l'],
        name: 'Test Terminal',
        cwd: '/home/user',
        pid: 12345,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm-256color',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);

      // Terminal should be created
      const terminal = terminalManager.terminals.get('test123');
      expect(terminal).toBeDefined();
      expect(terminal?.cols).toBe(80);
      expect(terminal?.rows).toBe(24);
    });

    it('should update existing terminal on recreation', () => {
      const session: SessionEntry = {
        id: 'test456',
        cmdline: ['vim'],
        name: 'Editor',
        cwd: '/tmp',
        pid: 54321,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      // Create initial terminal
      terminalManager.createTerminal(session);

      // Update with new dimensions
      const updatedSession = { ...session, cols: 120, rows: 40 };
      terminalManager.createTerminal(updatedSession);

      const terminal = terminalManager.terminals.get('test456');
      expect(terminal?.cols).toBe(120);
      expect(terminal?.rows).toBe(40);
    });
  });

  describe('Terminal Output', () => {
    it('should write output to terminal', () => {
      const session: SessionEntry = {
        id: 'output-test',
        cmdline: ['cat'],
        name: 'Output Test',
        cwd: '/',
        pid: 11111,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      terminalManager.writeOutput('output-test', 'Hello, Terminal!\n');

      const buffer = terminalManager.getBufferSnapshot('output-test');
      expect(buffer).toBeDefined();

      // Verify terminal contains the output
      const terminal = terminalManager.terminals.get('output-test');
      const lines = [];
      if (!terminal) {
        throw new Error('Terminal not found');
      }
      for (let y = 0; y < terminal.rows; y++) {
        const line = terminal.buffer.active.getLine(y);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      expect(lines.join('\n')).toContain('Hello, Terminal!');
    });

    it('should handle ANSI escape sequences', () => {
      const session: SessionEntry = {
        id: 'ansi-test',
        cmdline: ['test'],
        name: 'ANSI Test',
        cwd: '/',
        pid: 22222,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm-256color',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);

      // Write colored output
      terminalManager.writeOutput('ansi-test', '\x1b[31mRed Text\x1b[0m\n');
      terminalManager.writeOutput('ansi-test', '\x1b[1mBold Text\x1b[0m\n');

      const terminal = terminalManager.terminals.get('ansi-test');
      expect(terminal).toBeDefined();

      // Terminal should process the escape sequences
      if (!terminal) {
        throw new Error('Terminal not found');
      }
      const line0 = terminal.buffer.active.getLine(0);
      if (line0) {
        // Check that text was written
        expect(line0.translateToString(true)).toContain('Red Text');
      }
    });

    it('should ignore output for non-existent terminal', () => {
      // Should not throw
      expect(() => {
        terminalManager.writeOutput('nonexistent', 'test');
      }).not.toThrow();
    });
  });

  describe('Terminal Resize', () => {
    it('should resize terminal', () => {
      const session: SessionEntry = {
        id: 'resize-test',
        cmdline: ['sh'],
        name: 'Resize Test',
        cwd: '/',
        pid: 33333,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      terminalManager.resize('resize-test', 120, 40);

      const terminal = terminalManager.terminals.get('resize-test');
      expect(terminal?.cols).toBe(120);
      expect(terminal?.rows).toBe(40);
    });

    it('should handle resize for non-existent terminal', () => {
      // Should not throw
      expect(() => {
        terminalManager.resize('nonexistent', 80, 24);
      }).not.toThrow();
    });
  });

  describe('Buffer Snapshot', () => {
    it('should get buffer snapshot', () => {
      const session: SessionEntry = {
        id: 'snapshot-test',
        cmdline: ['ls'],
        name: 'Snapshot Test',
        cwd: '/',
        pid: 44444,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      terminalManager.writeOutput('snapshot-test', 'Line 1\n');
      terminalManager.writeOutput('snapshot-test', 'Line 2\n');

      const snapshot = terminalManager.getBufferSnapshot('snapshot-test');
      expect(snapshot).toBeDefined();
      expect(snapshot?.lines).toBeDefined();
      expect(snapshot?.cols).toBe(80);
      expect(snapshot?.rows).toBe(24);
    });

    it('should include cursor position in snapshot', () => {
      const session: SessionEntry = {
        id: 'cursor-test',
        cmdline: ['test'],
        name: 'Cursor Test',
        cwd: '/',
        pid: 55555,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      terminalManager.writeOutput('cursor-test', 'Hello');

      const snapshot = terminalManager.getBufferSnapshot('cursor-test');
      expect(snapshot?.cursor).toBeDefined();
      expect(snapshot?.cursor.x).toBeGreaterThanOrEqual(0);
      expect(snapshot?.cursor.y).toBeGreaterThanOrEqual(0);
    });

    it('should return null for non-existent terminal', () => {
      const snapshot = terminalManager.getBufferSnapshot('nonexistent');
      expect(snapshot).toBeNull();
    });
  });

  describe('Binary Encoding', () => {
    it('should encode snapshot to binary format', () => {
      const session: SessionEntry = {
        id: 'binary-test',
        cmdline: ['test'],
        name: 'Binary Test',
        cwd: '/',
        pid: 66666,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      terminalManager.writeOutput('binary-test', 'Test Output\n');

      const snapshot = terminalManager.getBufferSnapshot('binary-test');
      expect(snapshot).toBeDefined();

      if (!snapshot) {
        throw new Error('Snapshot not found');
      }
      const encoded = terminalManager.encodeSnapshot(snapshot);
      expect(encoded).toBeInstanceOf(Uint8Array);

      // Verify header
      const view = new DataView(encoded.buffer);
      expect(view.getUint16(0)).toBe(0x5654); // Magic "VT"
      expect(view.getUint8(2)).toBe(1); // Version
      expect(view.getUint32(4)).toBe(80); // Cols
      expect(view.getUint32(8)).toBe(24); // Rows
    });

    it('should encode empty lines efficiently', () => {
      const session: SessionEntry = {
        id: 'empty-test',
        cmdline: ['test'],
        name: 'Empty Test',
        cwd: '/',
        pid: 77777,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 10,
      };

      terminalManager.createTerminal(session);
      // Don't write any output - terminal should be empty

      const snapshot = terminalManager.getBufferSnapshot('empty-test');
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }
      const encoded = terminalManager.encodeSnapshot(snapshot);

      // Should use 0xFE markers for empty lines
      let emptyLineCount = 0;
      for (let i = 32; i < encoded.length; i++) {
        if (encoded[i] === 0xfe) {
          emptyLineCount++;
        }
      }

      expect(emptyLineCount).toBe(10); // All lines should be empty
    });

    it('should encode styled text', () => {
      const session: SessionEntry = {
        id: 'style-test',
        cmdline: ['test'],
        name: 'Style Test',
        cwd: '/',
        pid: 88888,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm-256color',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);

      // Write styled text
      terminalManager.writeOutput('style-test', '\x1b[1;31mBold Red\x1b[0m Normal\n');

      const snapshot = terminalManager.getBufferSnapshot('style-test');
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }
      const encoded = terminalManager.encodeSnapshot(snapshot);

      // Should contain styled cells
      expect(encoded.length).toBeGreaterThan(32); // Header + content
    });
  });

  describe('Terminal Cleanup', () => {
    it('should remove terminal', () => {
      const session: SessionEntry = {
        id: 'cleanup-test',
        cmdline: ['test'],
        name: 'Cleanup Test',
        cwd: '/',
        pid: 99999,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);
      expect(terminalManager.terminals.has('cleanup-test')).toBe(true);

      terminalManager.removeTerminal('cleanup-test');
      expect(terminalManager.terminals.has('cleanup-test')).toBe(false);
    });

    it('should handle removing non-existent terminal', () => {
      // Should not throw
      expect(() => {
        terminalManager.removeTerminal('nonexistent');
      }).not.toThrow();
    });
  });

  describe('Buffer Change Notifications', () => {
    it('should emit buffer change events', (done) => {
      const session: SessionEntry = {
        id: 'event-test',
        cmdline: ['test'],
        name: 'Event Test',
        cwd: '/',
        pid: 10101,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);

      // Listen for buffer change
      terminalManager.on('bufferChanged', (sessionId: string) => {
        expect(sessionId).toBe('event-test');
        done();
      });

      // Write output to trigger change
      terminalManager.writeOutput('event-test', 'Trigger event\n');
    });

    it('should debounce rapid changes', (done) => {
      const session: SessionEntry = {
        id: 'debounce-test',
        cmdline: ['test'],
        name: 'Debounce Test',
        cwd: '/',
        pid: 20202,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
        cols: 80,
        rows: 24,
      };

      terminalManager.createTerminal(session);

      let eventCount = 0;
      terminalManager.on('bufferChanged', (sessionId: string) => {
        if (sessionId === 'debounce-test') {
          eventCount++;
        }
      });

      // Write multiple outputs rapidly
      for (let i = 0; i < 10; i++) {
        terminalManager.writeOutput('debounce-test', `Line ${i}\n`);
      }

      // Should only get one event due to debouncing
      setTimeout(() => {
        expect(eventCount).toBe(1);
        done();
      }, 200);
    });
  });
});

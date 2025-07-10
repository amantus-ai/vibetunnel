import { describe, it, expect, beforeAll } from 'vitest';

// This test uses the real native addon, bypassing the mock
// Run with: pnpm test native-addon-real --no-mock-native-addon

describe.skip('Native Addon - Real Integration Tests', () => {
  let NativePty: any;
  let ActivityDetector: any;
  let initPtySystem: any;
  
  beforeAll(() => {
    try {
      // Import the real native addon directly
      const addon = require('../../../native-pty');
      NativePty = addon.NativePty;
      ActivityDetector = addon.ActivityDetector;
      initPtySystem = addon.initPtySystem;
      
      // Initialize PTY system
      initPtySystem();
    } catch (error) {
      console.error('Failed to load native addon:', error);
      throw error;
    }
  });
  
  describe('ActivityDetector', () => {
    it('should detect basic Claude activity', () => {
      const detector = new ActivityDetector();
      const activity = detector.detect(Buffer.from('✻ Crafting… (10s)'));
      
      expect(activity).toBeDefined();
      expect(activity?.status).toBe('✻ Crafting');
      expect(activity?.details).toBe('10s');
      expect(activity?.timestamp).toBeGreaterThan(0);
    });
    
    it('should detect activity with tokens', () => {
      const detector = new ActivityDetector();
      const activity = detector.detect(
        Buffer.from('✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)')
      );
      
      expect(activity).toBeDefined();
      expect(activity?.status).toBe('✻ Processing');
      expect(activity?.details).toBe('42s, ↑2.5k');
    });
    
    it('should handle ANSI codes', () => {
      const detector = new ActivityDetector();
      const activity = detector.detect(
        Buffer.from('\x1b[32m✻ Thinking…\x1b[0m (100s · ↓ 5k tokens · esc to interrupt)')
      );
      
      expect(activity).toBeDefined();
      expect(activity?.status).toBe('✻ Thinking');
      expect(activity?.details).toBe('100s, ↓5k');
    });
    
    it('should return null for non-activity text', () => {
      const detector = new ActivityDetector();
      const testCases = [
        'Normal terminal output',
        '✻ Not a status (missing ellipsis)',
        'Crafting… (no indicator)',
        '',
      ];
      
      for (const text of testCases) {
        const activity = detector.detect(Buffer.from(text));
        expect(activity).toBeNull();
      }
    });
  });
  
  describe('NativePty', () => {
    it('should create PTY with valid PID', () => {
      const pty = new NativePty();
      const pid = pty.getPid();
      
      expect(pid).toBeGreaterThan(0);
      
      // Clean up
      pty.destroy();
    });
    
    it('should execute echo command', async () => {
      const pty = new NativePty('echo', ['Hello from PTY!']);
      
      // Wait for command to execute
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = pty.readAllOutput();
      expect(output).toBeDefined();
      
      if (output) {
        const text = output.toString();
        expect(text).toContain('Hello from PTY!');
      }
      
      pty.destroy();
    });
    
    it('should handle resize', () => {
      const pty = new NativePty(null, null, null, null, 80, 24);
      
      // Should not throw
      expect(() => pty.resize(120, 40)).not.toThrow();
      
      pty.destroy();
    });
    
    it('should detect exit status', async () => {
      const pty = new NativePty('true');
      
      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const status = pty.checkExitStatus();
      expect(status).toBe(0);
      
      pty.destroy();
    });
  });
  
  describe('Integration', () => {
    it('should detect activity through PTY output', async () => {
      const pty = new NativePty('echo', ['✻ Processing… (10s · ↑ 1.2k tokens · esc to interrupt)']);
      const detector = new ActivityDetector();
      
      // Wait for echo to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = pty.readAllOutput();
      expect(output).toBeDefined();
      
      if (output) {
        const activity = detector.detect(output);
        expect(activity).toBeDefined();
        expect(activity?.status).toBe('✻ Processing');
        expect(activity?.details).toBe('10s, ↑1.2k');
      }
      
      pty.destroy();
    });
    
    it('should handle event-driven data', async () => {
      const pty = new NativePty('echo', ['✻ Analyzing… (5s)']);
      const detector = new ActivityDetector();
      
      let detectedActivity: any = null;
      
      pty.setOnData((data: Buffer) => {
        const activity = detector.detect(data);
        if (activity) {
          detectedActivity = activity;
        }
      });
      
      // Wait for callback
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(detectedActivity).toBeDefined();
      expect(detectedActivity?.status).toBe('✻ Analyzing');
      
      pty.destroy();
    });
  });
});
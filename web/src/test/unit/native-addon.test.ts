<<<<<<< HEAD
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
||||||| parent of 201dcee3 (Fix linting errors in test files)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
=======
import { beforeAll, describe, expect, it } from 'vitest';
>>>>>>> 201dcee3 (Fix linting errors in test files)
import type { ActivityDetector, NativePty } from '../../server/pty/native-addon-adapter.js';

// Skip these tests in CI where native addon might not be built
const skipInCI = process.env.CI ? describe.skip : describe;

// Set to false to run tests locally
const SKIP_NATIVE_TESTS = false;
const _testDescribe = SKIP_NATIVE_TESTS ? describe.skip : describe;

skipInCI('Native Addon - ActivityDetector', () => {
  let ActivityDetectorClass: typeof ActivityDetector;
  
  beforeAll(async () => {
    try {
      const addon = await import('../../server/pty/native-addon-adapter.js');
      ActivityDetectorClass = addon.ActivityDetector;
    } catch (_error) {
      console.log('Native addon not available, skipping tests');
    }
  });
  
  it('should detect basic Claude activity', () => {
    if (!ActivityDetectorClass) return;
    
    const detector = new ActivityDetectorClass();
    const activity = detector.detect(Buffer.from('✻ Crafting… (10s)'));
    
    expect(activity).toBeDefined();
    expect(activity?.status).toBe('✻ Crafting');
    expect(activity?.details).toBe('10s');
    expect(activity?.timestamp).toBeGreaterThan(0);
  });
  
  it('should detect activity with tokens', () => {
    if (!ActivityDetectorClass) return;
    
    const detector = new ActivityDetectorClass();
    const activity = detector.detect(
      Buffer.from('✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)')
    );
    
    expect(activity).toBeDefined();
    expect(activity?.status).toBe('✻ Processing');
    expect(activity?.details).toBe('42s, ↑2.5k');
  });
  
  it('should handle ANSI codes', () => {
    if (!ActivityDetectorClass) return;
    
    const detector = new ActivityDetectorClass();
    const activity = detector.detect(
      Buffer.from('\x1b[32m✻ Thinking…\x1b[0m (100s · ↓ 5k tokens · esc to interrupt)')
    );
    
    expect(activity).toBeDefined();
    expect(activity?.status).toBe('✻ Thinking');
    expect(activity?.details).toBe('100s, ↓5k');
  });
  
  it('should return null for non-activity text', () => {
    if (!ActivityDetectorClass) return;
    
    const detector = new ActivityDetectorClass();
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
  
  it('should handle various indicators', () => {
    if (!ActivityDetectorClass) return;
    
    const detector = new ActivityDetectorClass();
    const indicators = ['✻', '⏺', '✳', '●', '◆', '▶'];
    
    for (const indicator of indicators) {
      const activity = detector.detect(
        Buffer.from(`${indicator} Testing… (5s)`)
      );
      expect(activity).toBeDefined();
      expect(activity?.status).toBe(`${indicator} Testing`);
    }
  });
});

skipInCI('Native Addon - PTY Integration', () => {
  let _NativePtyClass: typeof NativePty;
  let ActivityDetectorClass: typeof ActivityDetector;
  // biome-ignore lint/suspicious/noExplicitAny: Mock spawn function for testing
  let spawn: any;
  
  beforeAll(async () => {
    try {
      const addon = await import('../../server/pty/native-addon-adapter.js');
      _NativePtyClass = addon.NativePty;
      ActivityDetectorClass = addon.ActivityDetector;
      spawn = addon.spawn;
    } catch (_error) {
      console.log('Native addon not available, skipping tests');
    }
  });
  
  it('should detect activity through PTY output', async () => {
    if (!spawn || !ActivityDetectorClass) return;
    
    const pty = spawn('echo', ['✻ Processing… (10s)'], {
      name: 'test',
      cols: 80,
      rows: 24,
    });
    
    const detector = new ActivityDetectorClass();
    let detectedActivity = false;
    
    pty.onData((data: string) => {
      const activity = detector.detect(Buffer.from(data));
      if (activity) {
        expect(activity.status).toBe('✻ Processing');
        detectedActivity = true;
      }
    });
    
    // Wait for echo to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(detectedActivity).toBe(true);
    pty.kill();
  });
  
  it('should handle streaming activity detection', async () => {
    if (!spawn || !ActivityDetectorClass) return;
    
    const script = process.platform === 'win32'
      ? 'echo ✻ Thinking… (1s) && timeout /t 1 >nul && echo ⏺ Done… (2s)'
      : 'echo "✻ Thinking… (1s)" && sleep 0.1 && echo "⏺ Done… (2s)"';
    
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const args = process.platform === 'win32' ? ['/c', script] : ['-c', script];
    
    const pty = spawn(shell, args, {
      name: 'test',
      cols: 80,
      rows: 24,
    });
    
    const detector = new ActivityDetectorClass();
    // biome-ignore lint/suspicious/noExplicitAny: Activity type from native addon
    const activities: any[] = [];
    
    pty.onData((data: string) => {
      const activity = detector.detect(Buffer.from(data));
      if (activity) {
        activities.push(activity);
      }
    });
    
    // Wait for commands to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(activities[0].status).toContain('Thinking');
    
    pty.kill();
  });
});
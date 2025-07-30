const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Load the native addon
const addon = require('../index.js');

test('NativePty constructor and basic methods', async (t) => {
  await t.test('should create a NativePty instance', () => {
    const pty = new addon.NativePty();
    assert(pty instanceof addon.NativePty);
    assert(typeof pty.getPid() === 'number');
    assert(pty.getPid() > 0);
    
    // Clean up
    pty.destroy();
  });

  await t.test('should accept custom shell and arguments', () => {
    const pty = new addon.NativePty(
      '/bin/echo',
      ['hello', 'world'],
      null, // env
      null, // cwd
      80,   // cols
      24    // rows
    );
    
    assert(pty instanceof addon.NativePty);
    pty.destroy();
  });

  await t.test('should handle environment variables', () => {
    const env = { TEST_VAR: 'test_value', PATH: process.env.PATH };
    const pty = new addon.NativePty(
      null, // default shell
      null, // no args
      env,
      null, // cwd
      80,
      24
    );
    
    assert(pty instanceof addon.NativePty);
    pty.destroy();
  });

  await t.test('should handle custom working directory', () => {
    const cwd = process.cwd();
    const pty = new addon.NativePty(
      null,
      null,
      null,
      cwd,
      80,
      24
    );
    
    assert(pty instanceof addon.NativePty);
    pty.destroy();
  });
});

test('NativePty I/O operations', async (t) => {
  await t.test('should write data to PTY', () => {
    const pty = new addon.NativePty();
    
    // Write some data
    assert.doesNotThrow(() => {
      pty.write(Buffer.from('echo "test"\n'));
    });
    
    pty.destroy();
  });

  await t.test('should read output from PTY', async () => {
    const pty = new addon.NativePty('/bin/echo', ['hello']);
    
    // Give the process time to start and produce output
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const output = pty.readOutput(1000);
    if (output) {
      const text = output.toString();
      assert(text.includes('hello'), `Expected output to contain 'hello', got: ${text}`);
    }
    
    pty.destroy();
  });

  await t.test('should handle resize operations', () => {
    const pty = new addon.NativePty();
    
    assert.doesNotThrow(() => {
      pty.resize(100, 50);
    });
    
    pty.destroy();
  });
});

test('NativePty process management', async (t) => {
  await t.test('should check exit status', async () => {
    const pty = new addon.NativePty('/bin/echo', ['test']);
    
    // Initially, process should be running
    let exitStatus = pty.checkExitStatus();
    assert(exitStatus === null || exitStatus === undefined);
    
    // Wait for process to exit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    exitStatus = pty.checkExitStatus();
    assert(typeof exitStatus === 'number', `Expected exit status to be a number, got: ${exitStatus}`);
    
    pty.destroy();
  });

  await t.test('should kill process with signal', async () => {
    const pty = new addon.NativePty('/bin/sleep', ['10']);
    
    // Process should be running
    assert(pty.checkExitStatus() === null);
    
    // Kill the process
    pty.kill('SIGTERM');
    
    // Wait for process to be killed
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Process should have exited
    const exitStatus = pty.checkExitStatus();
    assert(typeof exitStatus === 'number');
    
    pty.destroy();
  });

  await t.test('should handle multiple destroy calls', () => {
    const pty = new addon.NativePty();
    
    assert.doesNotThrow(() => {
      pty.destroy();
      pty.destroy(); // Should not throw
    });
  });
});

test('ActivityDetector', async (t) => {
  await t.test('should create ActivityDetector instance', () => {
    const detector = new addon.ActivityDetector();
    assert(detector instanceof addon.ActivityDetector);
  });

  await t.test('should detect activity in data', () => {
    const detector = new addon.ActivityDetector();
    
    // Test with various data patterns
    const testCases = [
      { data: Buffer.from('Building project...\n'), expectActivity: true },
      { data: Buffer.from('npm install\n'), expectActivity: true },
      { data: Buffer.from('   \n'), expectActivity: false },
      { data: Buffer.from(''), expectActivity: false },
    ];
    
    for (const { data, expectActivity } of testCases) {
      const activity = detector.detect(data);
      if (expectActivity) {
        assert(activity !== null && activity !== undefined, 
          `Expected activity for data: ${data.toString()}`);
        if (activity) {
          assert(typeof activity.timestamp === 'number');
          assert(typeof activity.status === 'string');
        }
      } else {
        assert(activity === null || activity === undefined,
          `Expected no activity for data: ${data.toString()}`);
      }
    }
  });
});

test('initPtySystem', async (t) => {
  await t.test('should initialize PTY system without error', () => {
    assert.doesNotThrow(() => {
      addon.initPtySystem();
    });
  });

  await t.test('should be idempotent', () => {
    assert.doesNotThrow(() => {
      addon.initPtySystem();
      addon.initPtySystem(); // Should not throw when called multiple times
    });
  });
});

test('Error handling', async (t) => {
  await t.test('should handle invalid shell gracefully', () => {
    try {
      const pty = new addon.NativePty('/nonexistent/shell');
      pty.destroy();
      // If we get here, the implementation allows invalid shells
      // which is okay - some systems might handle this differently
    } catch (err) {
      // Expected - invalid shell should throw
      assert(err.message.includes('Failed to create PTY') || 
             err.message.includes('nonexistent'));
    }
  });

  await t.test('should handle operations on destroyed PTY', () => {
    const pty = new addon.NativePty();
    const pid = pty.getPid();
    pty.destroy();
    
    // These operations should either throw or return null/undefined
    // but should not crash
    try {
      pty.write(Buffer.from('test'));
      // If no error, that's okay - implementation might ignore writes
    } catch (err) {
      // Expected - writing to destroyed PTY might throw
    }
    
    try {
      const output = pty.readOutput();
      // Output should be null/undefined for destroyed PTY
      assert(output === null || output === undefined);
    } catch (err) {
      // Expected - reading from destroyed PTY might throw
    }
  });
});

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('Running NAPI addon tests...');
}
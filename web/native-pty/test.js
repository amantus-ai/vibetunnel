#!/usr/bin/env node

// Integration tests for native PTY module
// Run with: node test.js (after building with npm run build)

// Dynamically load the correct binary for the current platform
const os = require('os');
const platform = os.platform();
const arch = os.arch();

let binaryName;
if (platform === 'darwin') {
  binaryName = `./vibetunnel-native-pty.darwin-${arch}.node`;
} else if (platform === 'linux') {
  if (arch === 'x64') {
    binaryName = './vibetunnel-native-pty.linux-x64-gnu.node';
  } else if (arch === 'arm64') {
    binaryName = './vibetunnel-native-pty.linux-arm64-gnu.node';
  }
} else if (platform === 'win32') {
  binaryName = './vibetunnel-native-pty.win32-x64-msvc.node';
} else {
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

const { NativePty, ActivityDetector, initPtySystem } = require(binaryName);
const assert = require('assert');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testActivityDetector() {
  console.log('\n=== Testing ActivityDetector ===');
  
  const detector = new ActivityDetector();
  
  // Test 1: Basic detection
  {
    const data = Buffer.from('✻ Crafting… (10s)');
    const activity = detector.detect(data);
    assert(activity, 'Should detect basic activity');
    assert.strictEqual(activity.status, '✻ Crafting');
    assert.strictEqual(activity.details, '10s');
    console.log('✓ Basic detection works');
  }
  
  // Test 2: With tokens
  {
    const data = Buffer.from('✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)');
    const activity = detector.detect(data);
    assert(activity, 'Should detect activity with tokens');
    assert.strictEqual(activity.status, '✻ Processing');
    assert.strictEqual(activity.details, '42s, ↑2.5k');
    console.log('✓ Token detection works');
  }
  
  // Test 3: No match
  {
    const data = Buffer.from('Normal terminal output');
    const activity = detector.detect(data);
    assert(!activity, 'Should not detect activity in normal text');
    console.log('✓ Non-activity rejection works');
  }
  
  // Test 4: ANSI codes
  {
    const data = Buffer.from('\x1b[32m✻ Thinking…\x1b[0m (100s)');
    const activity = detector.detect(data);
    assert(activity, 'Should detect activity with ANSI codes');
    assert.strictEqual(activity.status, '✻ Thinking');
    console.log('✓ ANSI stripping works');
  }
}

async function testPtyBasic() {
  console.log('\n=== Testing PTY Basic Functions ===');
  
  // Initialize PTY system
  initPtySystem();
  
  // Test 1: Create PTY
  {
    const pty = new NativePty();
    assert(pty.getPid() > 0, 'Should have valid PID');
    console.log(`✓ PTY created with PID: ${pty.getPid()}`);
    
    await pty.destroy();
    console.log('✓ PTY destroyed');
  }
  
  // Test 2: Echo command
  {
    const pty = new NativePty('echo', ['Hello, PTY!']);
    await sleep(100);
    
    const output = pty.readAllOutput();
    if (output) {
      const text = output.toString();
      assert(text.includes('Hello, PTY!'), 'Should contain echoed text');
      console.log('✓ Echo command works');
    }
    
    await pty.destroy();
  }
  
  // Test 3: Custom size
  {
    const pty = new NativePty(null, null, null, null, 120, 40);
    await pty.resize(80, 24);
    console.log('✓ Resize works');
    
    await pty.destroy();
  }
}

async function testPtyIO() {
  console.log('\n=== Testing PTY I/O ===');
  
  // Test 1: Write and read
  {
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'cat';
    const pty = new NativePty(shell);
    
    // Set up data callback
    let receivedData = '';
    pty.setOnData((data) => {
      receivedData += data.toString();
    });
    
    // Write data
    const testData = 'Test input\n';
    pty.write(Buffer.from(testData));
    
    await sleep(200);
    
    if (!process.platform === 'win32') {
      assert(receivedData.includes('Test input'), 'Should receive echoed data');
      console.log('✓ Write/read with callbacks works');
    }
    
    await pty.destroy();
  }
  
  // Test 2: Exit status
  {
    const pty = new NativePty('true');
    await sleep(200);
    
    const status = pty.checkExitStatus();
    assert.strictEqual(status, 0, 'Exit status should be 0');
    console.log('✓ Exit status detection works');
    
    await pty.destroy();
  }
}

async function testIntegration() {
  console.log('\n=== Testing Integration ===');
  
  // Test: PTY + Activity Detection
  {
    const pty = new NativePty('echo', ['✻ Processing… (10s · ↑ 1.2k tokens · esc to interrupt)']);
    const detector = new ActivityDetector();
    
    await sleep(100);
    
    const output = pty.readAllOutput();
    if (output) {
      const activity = detector.detect(output);
      assert(activity, 'Should detect activity from PTY output');
      assert.strictEqual(activity.status, '✻ Processing');
      console.log('✓ PTY + Activity detection integration works');
    }
    
    await pty.destroy();
  }
}

async function runAllTests() {
  try {
    await testActivityDetector();
    await testPtyBasic();
    await testPtyIO();
    await testIntegration();
    
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
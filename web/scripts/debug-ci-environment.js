#!/usr/bin/env node

/**
 * Debug script to check CI environment for terminal spawning issues
 */

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('=== CI Environment Debug Info ===\n');

// Check basic environment
console.log('Platform:', os.platform());
console.log('Node version:', process.version);
console.log('User:', os.userInfo().username);
console.log('Home directory:', os.homedir());
console.log('Current directory:', process.cwd());

// Check shell environment
console.log('\n=== Shell Environment ===');
console.log('SHELL:', process.env.SHELL || '(not set)');
console.log('PATH:', process.env.PATH);
console.log('TERM:', process.env.TERM || '(not set)');
console.log('CI:', process.env.CI || '(not set)');

// Check available shells
console.log('\n=== Available Shells ===');
const shells = ['/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh', '/bin/zsh', '/usr/bin/zsh'];
shells.forEach(shell => {
  const exists = fs.existsSync(shell);
  console.log(`${shell}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
});

// Check PTY availability
console.log('\n=== PTY Availability ===');
try {
  const ptyCount = execSync('ls /dev/pts | wc -l', { encoding: 'utf8' }).trim();
  console.log('PTY devices available:', ptyCount);
} catch (e) {
  console.log('Unable to check PTY devices:', e.message);
}

// Check if we can spawn a simple process
console.log('\n=== Test Process Spawning ===');
try {
  const result = execSync('echo "test"', { encoding: 'utf8' });
  console.log('Basic spawn test: SUCCESS');
  console.log('Output:', result.trim());
} catch (e) {
  console.log('Basic spawn test: FAILED');
  console.log('Error:', e.message);
}

// Test node-pty
console.log('\n=== Test node-pty ===');
try {
  const pty = require('node-pty');
  console.log('node-pty loaded successfully');
  
  // Try to spawn a simple echo command
  try {
    const ptyProcess = pty.spawn('echo', ['test'], {
      name: 'xterm',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    });
    
    console.log('PTY spawn test: SUCCESS');
    console.log('PID:', ptyProcess.pid);
    
    ptyProcess.on('data', (data) => {
      console.log('PTY output:', data.trim());
    });
    
    ptyProcess.on('exit', (exitCode) => {
      console.log('PTY exit code:', exitCode);
    });
    
    // Give it time to complete
    setTimeout(() => {
      ptyProcess.kill();
    }, 1000);
    
  } catch (spawnError) {
    console.log('PTY spawn test: FAILED');
    console.log('Error:', spawnError.message);
    console.log('Error code:', spawnError.code);
  }
} catch (e) {
  console.log('node-pty not available:', e.message);
}

// Check ulimits
console.log('\n=== Resource Limits ===');
try {
  const ulimitOutput = execSync('ulimit -a', { encoding: 'utf8' });
  console.log(ulimitOutput);
} catch (e) {
  console.log('Unable to check ulimits:', e.message);
}
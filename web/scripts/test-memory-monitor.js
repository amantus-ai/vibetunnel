#!/usr/bin/env node
/**
 * Test memory monitor that runs tests in an isolated subprocess
 * and captures output even if the process crashes
 */

import { spawn } from 'child_process';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'test-memory-monitor.log');
const CRASH_LOG_FILE = join(process.cwd(), 'test-crash.log');

console.log('🔍 Starting test memory monitor...');
console.log('This will run tests in an isolated process and capture all output.');
console.log(`Logs will be saved to: ${LOG_FILE}`);
console.log(`Crash info will be saved to: ${CRASH_LOG_FILE}\n`);

// Clear log files
writeFileSync(LOG_FILE, `Test Memory Monitor - ${new Date().toISOString()}\n\n`);
writeFileSync(CRASH_LOG_FILE, '');

// Start the test process with memory logging enabled
const testProcess = spawn('pnpm', ['run', 'test', '--run'], {
  env: {
    ...process.env,
    MEMORY_LOG: '1',
    NODE_OPTIONS: '--expose-gc --max-old-space-size=8192',
  },
  stdio: ['inherit', 'pipe', 'pipe'],
});

let lastOutput = '';
let currentTest = 'Unknown';
let currentFile = 'Unknown';

// Function to parse test info from output
function parseTestInfo(data) {
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.includes('Running:')) {
      currentTest = line.split('Running:')[1]?.trim() || currentTest;
    }
    if (line.includes('.test.ts')) {
      const match = line.match(/([^\s]+\.test\.ts)/);
      if (match) currentFile = match[1];
    }
  }
}

// Capture stdout
testProcess.stdout.on('data', (data) => {
  const output = data.toString();
  process.stdout.write(data);
  appendFileSync(LOG_FILE, output);
  lastOutput = output;
  parseTestInfo(output);
});

// Capture stderr
testProcess.stderr.on('data', (data) => {
  const output = data.toString();
  process.stderr.write(data);
  appendFileSync(LOG_FILE, `[STDERR] ${output}`);
  parseTestInfo(output);
});

// Monitor memory usage
const memoryInterval = setInterval(() => {
  const usage = process.memoryUsage();
  const memInfo = {
    timestamp: new Date().toISOString(),
    rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
    heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`,
  };
  
  appendFileSync(LOG_FILE, `\n[MEMORY CHECK] ${JSON.stringify(memInfo)}\n`);
}, 5000); // Check every 5 seconds

// Handle process exit
testProcess.on('exit', (code, signal) => {
  clearInterval(memoryInterval);
  
  if (code !== 0 || signal) {
    console.error(`\n\n❌ Test process crashed!`);
    console.error(`Exit code: ${code}`);
    console.error(`Signal: ${signal}`);
    console.error(`Last known test: ${currentTest}`);
    console.error(`Last known file: ${currentFile}`);
    
    // Save crash information
    const crashInfo = {
      timestamp: new Date().toISOString(),
      exitCode: code,
      signal: signal,
      lastTest: currentTest,
      lastFile: currentFile,
      lastOutput: lastOutput.slice(-1000), // Last 1000 chars
    };
    
    writeFileSync(CRASH_LOG_FILE, JSON.stringify(crashInfo, null, 2));
    console.error(`\nCrash details saved to: ${CRASH_LOG_FILE}`);
    
    // Also check for test-memory.log
    try {
      const memLogPath = join(process.cwd(), 'test-memory.log');
      console.error(`\nCheck ${memLogPath} for detailed memory logs`);
    } catch (e) {}
  } else {
    console.log('\n✅ Tests completed successfully');
  }
  
  process.exit(code || 0);
});

// Handle termination
process.on('SIGINT', () => {
  console.log('\n\nInterrupted by user');
  testProcess.kill('SIGTERM');
});
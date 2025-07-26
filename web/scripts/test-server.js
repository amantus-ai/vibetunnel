#!/usr/bin/env node

// Test server runner that builds and runs the JavaScript version to avoid tsx/node-pty issues
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

// Build server TypeScript files
console.log('Building server TypeScript files for tests...');
try {
  execSync('pnpm exec tsc -p tsconfig.server.json', { 
    stdio: 'inherit',
    cwd: projectRoot
  });
  console.log('TypeScript build completed successfully');
} catch (error) {
  console.error('Failed to build server TypeScript files:', error);
  console.error('Build command exit code:', error.status);
  console.error('Build command signal:', error.signal);
  process.exit(1);
}

// Ensure native modules are available
execSync('node scripts/ensure-native-modules.js', { 
  stdio: 'inherit',
  cwd: projectRoot
});

// Forward all arguments to the built JavaScript version
const cliPath = path.join(projectRoot, 'dist/cli.js');

// Check if the built file exists
if (!fs.existsSync(cliPath)) {
  console.error(`Built CLI not found at ${cliPath}`);
  console.error('Contents of dist directory:');
  try {
    const distPath = path.join(projectRoot, 'dist');
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(distPath);
      files.forEach(file => console.error(`  - ${file}`));
    } else {
      console.error('  dist directory does not exist!');
    }
  } catch (e) {
    console.error('  Error listing dist directory:', e.message);
  }
  process.exit(1);
}

const args = [cliPath, ...process.argv.slice(2)];

// Extract port from arguments
let port = 4022; // default test port
const portArgIndex = process.argv.indexOf('--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
  port = process.argv[portArgIndex + 1];
}

// Spawn node with the built CLI
console.log(`Starting test server: node ${args.join(' ')}`);
console.log(`Working directory: ${projectRoot}`);
console.log(`Port: ${port}`);

const child = spawn('node', args, {
  stdio: 'inherit',
  cwd: projectRoot,
  env: {
    ...process.env,
    // Ensure we're not in SEA mode for tests
    VIBETUNNEL_SEA: '',
    PORT: port.toString()
  }
});

// Add error handling
child.on('error', (error) => {
  console.error('Failed to start server process:', error);
  process.exit(1);
});

// Log when process starts
child.on('spawn', () => {
  console.log('Server process spawned successfully');
});

// Wait for server to be ready before allowing parent process to continue
if (process.env.CI || process.env.WAIT_FOR_SERVER) {
  // Give server a moment to start
  setTimeout(() => {
    const waitChild = spawn('node', [path.join(projectRoot, 'scripts/wait-for-server.js')], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: port.toString()
      }
    });
    
    waitChild.on('exit', (code) => {
      if (code !== 0) {
        console.error('Server failed to become ready');
        child.kill();
        process.exit(1);
      } else {
        console.log('Server is ready, tests can proceed');
      }
    });
  }, 2000); // Wait 2 seconds before checking
}

child.on('exit', (code) => {
  process.exit(code || 0);
});
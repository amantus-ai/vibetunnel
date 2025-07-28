#!/usr/bin/env node

// Test server runner that builds and runs the JavaScript version to avoid tsx/node-pty issues
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

// Check if we're in VIBETUNNEL_SEA mode and have the native executable
const nativeExecutable = path.join(projectRoot, 'native/vibetunnel');
const distCliPath = path.join(projectRoot, 'dist/cli.js');
let cliPath;
let useNode = true;

if (process.env.VIBETUNNEL_SEA === 'true' && fs.existsSync(nativeExecutable)) {
  console.log('Using native executable for tests (VIBETUNNEL_SEA mode)');
  cliPath = nativeExecutable;
  useNode = false;
} else if (fs.existsSync(distCliPath)) {
  console.log('Using TypeScript compiled version for tests');
  cliPath = distCliPath;
} else {
  // Fallback: build TypeScript files if needed
  console.log('Building server TypeScript files for tests...');
  try {
    execSync('pnpm exec tsc -p tsconfig.server.json', { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    console.log('TypeScript build completed successfully');
    cliPath = distCliPath;
  } catch (error) {
    console.error('Failed to build server TypeScript files:', error);
    console.error('Build command exit code:', error.status);
    console.error('Build command signal:', error.signal);
    process.exit(1);
  }
}

// Ensure native modules are available
execSync('node scripts/ensure-native-modules.js', { 
  stdio: 'inherit',
  cwd: projectRoot
});

// Check if the CLI file exists
if (!fs.existsSync(cliPath)) {
  console.error(`CLI not found at ${cliPath}`);
  console.error('Available files:');
  
  // Check native directory
  const nativePath = path.join(projectRoot, 'native');
  if (fs.existsSync(nativePath)) {
    console.error('Native directory contents:');
    const files = fs.readdirSync(nativePath);
    files.forEach(file => console.error(`  - ${file}`));
  }
  
  // Check dist directory
  const distPath = path.join(projectRoot, 'dist');
  if (fs.existsSync(distPath)) {
    console.error('Dist directory contents:');
    const files = fs.readdirSync(distPath);
    files.forEach(file => console.error(`  - ${file}`));
  }
  
  process.exit(1);
}

// Verify executable permissions for native executable
if (!useNode) {
  try {
    fs.accessSync(cliPath, fs.constants.X_OK);
    console.log('Native executable has execute permissions');
  } catch (error) {
    console.error('Native executable is not executable! Attempting to fix...');
    try {
      fs.chmodSync(cliPath, 0o755);
      console.log('Fixed executable permissions');
    } catch (chmodError) {
      console.error('Failed to fix permissions:', chmodError.message);
    }
  }
}

// Prepare arguments based on whether we're using node or native executable
const args = useNode ? [cliPath, ...process.argv.slice(2)] : process.argv.slice(2);
const command = useNode ? 'node' : cliPath;

// Extract port from arguments
let port = 4022; // default test port
const portArgIndex = process.argv.indexOf('--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
  port = process.argv[portArgIndex + 1];
}

// Spawn the server
console.log(`Starting test server: ${command} ${args.join(' ')}`);
console.log(`Working directory: ${projectRoot}`);
console.log(`Port: ${port}`);

// Capture output for debugging in CI
const stdio = process.env.CI ? ['inherit', 'pipe', 'pipe'] : 'inherit';

const child = spawn(command, args, {
  stdio: stdio,
  cwd: projectRoot,
  env: {
    ...process.env,
    // Ensure we're not in SEA mode for tests (unless we're already using the native executable)
    VIBETUNNEL_SEA: useNode ? '' : 'true',
    PORT: port.toString()
  }
});

// Capture output in CI for debugging
let stdout = '';
let stderr = '';
let hasExited = false;

if (process.env.CI) {
  child.stdout.on('data', (data) => {
    const str = data.toString();
    stdout += str;
    process.stdout.write(str);
  });
  
  child.stderr.on('data', (data) => {
    const str = data.toString();
    stderr += str;
    process.stderr.write(str);
  });
}

// Add error handling
child.on('error', (error) => {
  console.error('Failed to start server process:', error);
  if (error.code === 'ENOENT') {
    console.error('The executable was not found. Path:', command);
  } else if (error.code === 'EACCES') {
    console.error('The executable does not have execute permissions');
  }
  process.exit(1);
});

// Log when process starts
child.on('spawn', () => {
  console.log('Server process spawned successfully');
  console.log(`Server PID: ${child.pid}`);
});

// Handle early exit
child.on('exit', (code, signal) => {
  hasExited = true;
  if (code !== 0 || signal) {
    console.error(`\nServer process exited unexpectedly with code ${code}, signal ${signal}`);
    if (stderr) {
      console.error('Last stderr output:', stderr.slice(-1000));
    }
    if (stdout) {
      console.error('Last stdout output:', stdout.slice(-1000));
    }
    
    // If using native executable, try to diagnose the issue
    if (!useNode && process.env.CI) {
      console.error('\nAttempting to diagnose native executable issue...');
      try {
        // Try running with --version to see if it works at all
        const versionResult = require('child_process').spawnSync(cliPath, ['--version'], {
          encoding: 'utf8',
          env: { ...process.env, NODE_ENV: 'test' }
        });
        console.error('Version test result:', versionResult);
      } catch (e) {
        console.error('Failed to run version test:', e.message);
      }
    }
  }
  process.exit(code || 0);
});

// Wait for server to be ready before allowing parent process to continue
if (process.env.CI || process.env.WAIT_FOR_SERVER) {
  // Give server a moment to start
  setTimeout(() => {
    if (hasExited) {
      console.error('Server exited before we could check if it was ready');
      return;
    }
    
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
        
        // In CI, add periodic health checks
        if (process.env.CI) {
          const healthCheckInterval = setInterval(() => {
            if (hasExited) {
              clearInterval(healthCheckInterval);
              return;
            }
            
            const http = require('http');
            http.get(`http://localhost:${port}/api/health`, (res) => {
              if (res.statusCode !== 200) {
                console.error(`Health check failed with status ${res.statusCode}`);
              }
            }).on('error', (err) => {
              console.error(`Health check error: ${err.message}`);
            });
          }, 10000); // Check every 10 seconds
        }
      }
    });
  }, 3000); // Wait 3 seconds before checking
}
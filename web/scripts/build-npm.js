#!/usr/bin/env node

/**
 * Build script for npm package distribution
 * Creates a full-featured package with server, web UI, and CLI tools
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building VibeTunnel for npm distribution...');

// Step 1: Run the standard build process (includes web assets)
console.log('\n1. Running full build process...');
try {
  execSync('node scripts/build.js', { stdio: 'inherit' });
  console.log('✓ Build completed successfully');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}

// Step 2: Ensure node-pty is built
console.log('\n2. Ensuring node-pty is built...');
const nodePtyBuild = path.join(__dirname, '..', 'node-pty', 'build', 'Release', 'pty.node');
if (!fs.existsSync(nodePtyBuild)) {
  console.log('Building node-pty...');
  const nodePtyDir = path.join(__dirname, '..', 'node-pty');
  try {
    execSync('npm install && npm run build', { 
      cwd: nodePtyDir,
      stdio: 'inherit' 
    });
  } catch (error) {
    console.error('Failed to build node-pty:', error.message);
    console.log('Trying to build with pnpm directly...');
    execSync('pnpm exec node-gyp rebuild', {
      cwd: nodePtyDir,
      stdio: 'inherit'
    });
  }
}

// Step 3: Update package README for npm
const npmReadme = path.join(__dirname, '..', 'README.md');
console.log('\n3. Creating npm README...');
const readmeContent = `# VibeTunnel CLI

Full-featured terminal sharing server with web interface for macOS and Linux.

## Installation

\`\`\`bash
npm install -g vibetunnel
\`\`\`

## Requirements

- Node.js >= 20.0.0
- macOS or Linux
- Build tools for native modules (Xcode on macOS, build-essential on Linux)

## Usage

### Start the server

\`\`\`bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth
\`\`\`

Then open http://localhost:4020 in your browser to access the web interface.

### Use the vt command wrapper

The \`vt\` command allows you to run commands with TTY forwarding:

\`\`\`bash
# Monitor AI agents with automatic activity tracking
vt claude
vt claude --dangerously-skip-permissions

# Run commands with output visible in VibeTunnel
vt npm test
vt python script.py
vt top

# Launch interactive shell
vt --shell
vt -i

# Update session title (inside a session)
vt title "My Project"
\`\`\`

### Forward commands to a session

\`\`\`bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd --session-id abc123 ls -la
vibetunnel fwd --session-id abc123 npm test
vibetunnel fwd --session-id abc123 python script.py
\`\`\`

## Features

- **Web-based terminal interface** - Access terminals from any browser
- **Multiple concurrent sessions** - Run multiple terminals simultaneously
- **Real-time synchronization** - See output in real-time
- **TTY forwarding** - Full terminal emulation support
- **Session management** - Create, list, and manage sessions
- **Cross-platform** - Works on macOS and Linux
- **No dependencies** - Just Node.js required

## Package Contents

This npm package includes:
- Full VibeTunnel server with web UI
- Command-line tools (vibetunnel, vt)
- Native PTY support for terminal emulation
- Web interface with xterm.js
- Session management and forwarding

## Platform Support

- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64)

## Documentation

See the main repository for complete documentation: https://github.com/amantus-ai/vibetunnel

## License

MIT
`;
fs.writeFileSync(npmReadme, readmeContent);

// Step 4: Clean up test files to reduce package size
console.log('\n4. Cleaning up test files...');
const testFiles = [
  'public/bundle/test.js',
  'public/bundle/screencap.js',
  'public/test',  // Remove entire test directory
  'public/test.cast'  // Remove test recording file
];

testFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    if (fs.lstatSync(filePath).isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    console.log(`  ✓ Removed ${file}`);
  }
});

// Step 5: Verify the package structure
console.log('\n5. Package structure:');
console.log('  - dist/         (compiled server code)');
console.log('  - public/       (web interface assets)');
console.log('  - bin/          (CLI entry points including vt)');
console.log('  - node-pty/     (native terminal support)');
console.log('  - README.md     (package documentation)');

// Step 6: Build prebuilt binaries if requested
if (process.argv.includes('--prebuild')) {
  console.log('\n6. Building prebuilt binaries...');
  try {
    execSync('npm run prebuild', { stdio: 'inherit' });
    console.log('✓ Prebuilt binaries created');
  } catch (error) {
    console.error('Failed to create prebuilt binaries:', error.message);
    console.log('Continuing without prebuilds...');
  }
} else {
  console.log('\n6. Skipping prebuild (use --prebuild flag to build binaries)');
}

// Step 7: Show package size estimate
console.log('\n7. Checking package size...');
const checkSize = () => {
  try {
    const output = execSync('npm pack --dry-run 2>&1 | grep "package size" || true', { encoding: 'utf8' });
    const sizeMatch = output.match(/package size:\s*([^\n]+)/);
    if (sizeMatch) {
      console.log(`  Estimated package size: ${sizeMatch[1]}`);
    }
  } catch (e) {
    // Ignore errors in size check
  }
};
checkSize();

console.log('\n✅ Build for npm distribution complete!');
console.log('\nThis package includes the full VibeTunnel server with web UI.');
console.log('\nTo build with prebuilt binaries: npm run build:npm -- --prebuild');
console.log('To test locally: npm pack');
console.log('To publish: npm publish');
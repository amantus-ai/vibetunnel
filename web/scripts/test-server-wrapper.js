#!/usr/bin/env node

// Wrapper to start the test server with proper environment
console.log('Test server wrapper starting...');
console.log('Current directory:', process.cwd());
console.log('Node version:', process.version);
console.log('VIBETUNNEL_SEA before:', process.env.VIBETUNNEL_SEA);

// Remove VIBETUNNEL_SEA to prevent SEA loader issues
delete process.env.VIBETUNNEL_SEA;
console.log('VIBETUNNEL_SEA after:', process.env.VIBETUNNEL_SEA);

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.VIBETUNNEL_DISABLE_PUSH_NOTIFICATIONS = 'true';
process.env.SUPPRESS_CLIENT_ERRORS = 'true';

// Check if dist/cli.js exists
const fs = require('fs');
const path = require('path');

const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
if (!fs.existsSync(cliPath)) {
  console.error('Error: dist/cli.js not found at', cliPath);
  console.error('Directory contents:', fs.readdirSync(path.join(process.cwd(), 'dist')));
  process.exit(1);
}

// Start the server
console.log('Starting server with args:', process.argv.slice(2));
require('../dist/cli.js');
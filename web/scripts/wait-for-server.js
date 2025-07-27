#!/usr/bin/env node

/**
 * Wait for the test server to be ready before starting tests
 * This helps prevent race conditions in CI where tests start before the server is ready
 */

const http = require('http');

const port = process.env.PORT || 4022;
const maxRetries = 30; // 30 seconds max wait
const retryDelay = 1000; // 1 second between retries

async function checkServerReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      if (res.statusCode === 200) {
        // 200 = server ready and health endpoint responding
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.setTimeout(1000);
  });
}

async function waitForServer() {
  console.log(`Waiting for server on port ${port}...`);
  
  for (let i = 0; i < maxRetries; i++) {
    const isReady = await checkServerReady();
    
    if (isReady) {
      console.log(`Server is ready on port ${port}!`);
      process.exit(0);
    }
    
    if (i < maxRetries - 1) {
      process.stdout.write('.');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  console.error(`\nServer failed to start on port ${port} after ${maxRetries} seconds`);
  process.exit(1);
}

waitForServer();
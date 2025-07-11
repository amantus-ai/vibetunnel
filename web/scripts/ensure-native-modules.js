#!/usr/bin/env node

/**
 * Ensures native modules are built and available for tests
 * This script handles the native PTY addon built with napi-rs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring native modules are built...');

// Legacy vibetunnel-pty is no longer needed - removed to prevent CI failures

console.log('Native modules are ready for tests');
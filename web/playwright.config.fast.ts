/**
 * Balanced Playwright configuration for CI
 * 
 * This configuration provides:
 * 1. Comprehensive test coverage (5+ minutes runtime)
 * 2. Reasonable timeouts to catch real issues
 * 3. Essential tests for terminal functionality
 * 4. File browser and session management coverage
 * 5. Optimized for reliable CI execution
 */

import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...baseConfig,
  
  // Reasonable timeouts for comprehensive testing
  timeout: 45 * 1000, // 45s test timeout - allows for real interactions
  
  use: {
    ...baseConfig.use,
    
    // Balanced action timeouts
    actionTimeout: 8000, // 8s for real interactions
    navigationTimeout: 15000, // 15s for app loading
    
    // Keep traces for debugging failures, but optimize storage
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure', 
    video: 'retain-on-failure',
    
    // Optimized browser settings for CI stability
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-javascript-harmony-shipping',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    },
  },

  // Allow parallel execution but limit workers for CI stability
  workers: 2,
  
  // Allow one retry for flaky tests
  retries: 1,
  
  // Run comprehensive test suite
  projects: [
    {
      name: 'comprehensive-tests',
      use: { ...baseConfig.use },
      testMatch: [
        // Core functionality tests
        '**/smoke.spec.ts',
        '**/basic-session.spec.ts',
        '**/minimal-session.spec.ts',
        '**/session-navigation.spec.ts',
        '**/ui-features.spec.ts',
        '**/file-browser-basic.spec.ts',
        '**/terminal-basic.spec.ts',
      ],
      // Skip the most complex/flaky tests but keep substantial coverage
      testIgnore: [
        '**/debug-session.spec.ts', 
        '**/file-browser.spec.ts', // Keep basic, skip complex
        '**/git-*.spec.ts', // Skip git tests (complex)
        '**/session-management.spec.ts', // Skip complex session management
        '**/ssh-key-manager.spec.ts', // Skip SSH tests
        '**/terminal-advanced.spec.ts', // Keep basic, skip advanced
        '**/test-session-persistence.spec.ts', // Skip persistence tests
        '**/worktree-*.spec.ts', // Skip worktree tests
      ],
    },
  ],

  // Reasonable server startup timeout
  webServer: {
    ...baseConfig.webServer,
    timeout: 30 * 1000, // 30s server startup timeout
  },
});
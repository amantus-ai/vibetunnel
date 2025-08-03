/**
 * Fast Playwright configuration - minimal essential tests only
 * 
 * This configuration is optimized for CI speed by:
 * 1. Running only the most critical tests
 * 2. Using aggressive timeouts for fast failure
 * 3. Disabling expensive features (video, traces, etc.)
 * 4. Using single worker to avoid race conditions
 * 5. Removing slow/flaky tests entirely
 */

import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...baseConfig,
  
  // Much more aggressive timeouts for faster feedback
  timeout: 15 * 1000, // 15s test timeout (vs 20s)
  
  use: {
    ...baseConfig.use,
    
    // Even more aggressive action timeouts
    actionTimeout: 2000, // 2s (vs 5s)
    navigationTimeout: 5000, // 5s (vs 10s)
    
    // Disable all expensive debugging features
    trace: 'off',
    screenshot: 'off', 
    video: 'off',
    
    // More aggressive browser optimizations
    launchOptions: {
      args: [
        // Keep base optimizations
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-javascript-harmony-shipping',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        
        // Additional speed optimizations
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--disable-notifications',
        '--disable-permissions-api',
      ],
    },
  },

  // Single worker for predictable execution
  workers: 1,
  
  // No retries - fail fast
  retries: 0,
  
  // Only run absolutely essential tests
  projects: [
    {
      name: 'essential-tests',
      use: { ...baseConfig.use },
      testMatch: [
        // Only ultra-minimal smoke test
        '**/smoke.spec.ts',
      ],
      // Skip everything else
      testIgnore: [
        '**/basic-session.spec.ts',
        '**/debug-session.spec.ts', 
        '**/minimal-session.spec.ts',
        '**/file-browser*.spec.ts',
        '**/git-*.spec.ts',
        '**/session-management*.spec.ts',
        '**/session-navigation.spec.ts',
        '**/ssh-key-manager.spec.ts',
        '**/terminal-*.spec.ts',
        '**/test-session-persistence.spec.ts',
        '**/ui-features.spec.ts',
        '**/worktree-*.spec.ts',
      ],
    },
  ],

  // Reduce server startup timeout
  webServer: {
    ...baseConfig.webServer,
    timeout: 10 * 1000, // 10s server startup timeout
  },
});
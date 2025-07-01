import { test } from '@playwright/test';

test.describe('Minimal Debug Test', () => {
  test('should load the application', async ({ page }) => {
    console.log('[Debug Test] Starting minimal test...');
    
    // Just navigate to the page
    await page.goto('/');
    console.log('[Debug Test] Navigated to home page');
    
    // Wait for the app element
    await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });
    console.log('[Debug Test] Found app element');
    
    // Check auth config
    try {
      const response = await page.request.get('/api/auth/config');
      const config = await response.json();
      console.log('[Debug Test] Auth config:', config);
    } catch (error) {
      console.error('[Debug Test] Failed to get auth config:', error);
    }
    
    // Get app state
    const appState = await page.evaluate(() => {
      const app = document.querySelector('vibetunnel-app') as any;
      return {
        exists: !!app,
        currentView: app?.currentView,
        isAuthenticated: app?.isAuthenticated,
        loading: app?.loading,
      };
    });
    console.log('[Debug Test] App state:', appState);
    
    // Just wait a bit to see if anything loads
    await page.waitForTimeout(3000);
    console.log('[Debug Test] Test completed');
  });
});
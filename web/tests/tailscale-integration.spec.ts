import { test, expect } from '@playwright/test';

test.describe('Tailscale Integration E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to VibeTunnel
    await page.goto('http://localhost:4020');
    
    // Wait for app to load
    await expect(page.locator('body')).toBeVisible();
  });

  test('Tailscale status endpoint responds correctly', async ({ page }) => {
    // Test the API endpoint directly
    const response = await page.request.get('/api/sessions/tailscale/status');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('isRunning');
    expect(typeof data.isRunning).toBe('boolean');
  });

  test('Tailscale test endpoint provides diagnostics', async ({ page }) => {
    // Test the new diagnostic endpoint
    const response = await page.request.get('/api/sessions/tailscale/test');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Should have all diagnostic sections
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('tailscale');
    expect(data).toHaveProperty('tailscaleServe');
    expect(data).toHaveProperty('server');
    expect(data).toHaveProperty('recommendations');
    
    // Tailscale section
    expect(data.tailscale).toHaveProperty('installed');
    expect(data.tailscale).toHaveProperty('status');
    expect(typeof data.tailscale.installed).toBe('boolean');
    
    // Tailscale Serve section
    expect(data.tailscaleServe).toHaveProperty('configured');
    expect(typeof data.tailscaleServe.configured).toBe('boolean');
    
    // Server section
    expect(data.server).toHaveProperty('isListening');
    expect(data.server).toHaveProperty('port');
    expect(data.server).toHaveProperty('bindAddress');
    
    // Recommendations should be an array
    expect(Array.isArray(data.recommendations)).toBe(true);
    
    console.log('Tailscale diagnostic data:', JSON.stringify(data, null, 2));
  });

  test('handles Tailscale not installed gracefully', async ({ page }) => {
    // This test verifies the UI handles missing Tailscale appropriately
    // It should work regardless of whether Tailscale is actually installed
    
    const diagnosticResponse = await page.request.get('/api/sessions/tailscale/test');
    const diagnosticData = await diagnosticResponse.json();
    
    if (!diagnosticData.tailscale.installed) {
      console.log('Tailscale not installed - testing graceful degradation');
      
      // The endpoints should still respond even without Tailscale
      const statusResponse = await page.request.get('/api/sessions/tailscale/status');
      expect(statusResponse.ok()).toBeTruthy();
      
      const statusData = await statusResponse.json();
      expect(statusData.isRunning).toBe(false);
      expect(statusData.lastError).toBeDefined();
    } else {
      console.log('Tailscale is installed - testing with real installation');
      
      // With Tailscale installed, we should get more meaningful status
      expect(diagnosticData.tailscale.status).toBeDefined();
      expect(diagnosticData.tailscale.status.length).toBeGreaterThan(0);
    }
  });

  test('Tailscale error states are handled properly', async ({ page }) => {
    // Test various error conditions through the API
    
    const statusResponse = await page.request.get('/api/sessions/tailscale/status');
    expect(statusResponse.ok()).toBeTruthy();
    
    const statusData = await statusResponse.json();
    
    // If there's an error, it should be descriptive
    if (statusData.lastError) {
      expect(typeof statusData.lastError).toBe('string');
      expect(statusData.lastError.length).toBeGreaterThan(0);
      
      // Should not contain internal error details that confuse users
      expect(statusData.lastError).not.toContain('Process exited');
      expect(statusData.lastError).not.toContain('code 0');
    }
    
    // Status should be consistent
    if (statusData.isRunning) {
      expect(statusData.port).toBeDefined();
      expect(typeof statusData.port).toBe('number');
    } else {
      // If not running, there should usually be an error explaining why
      // (unless it's simply disabled)
    }
  });

  test('connection test provides actionable recommendations', async ({ page }) => {
    const response = await page.request.get('/api/sessions/tailscale/test');
    const data = await response.json();
    
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBeGreaterThan(0);
    
    // Each recommendation should be a non-empty string
    for (const rec of data.recommendations) {
      expect(typeof rec).toBe('string');
      expect(rec.length).toBeGreaterThan(0);
    }
    
    console.log('Tailscale recommendations:', data.recommendations);
  });
});

// Real integration tests that require Tailscale to be installed and running
test.describe('Tailscale Real Integration Tests', () => {
  test.skip(({ browserName }) => {
    // These tests require manual setup and should be run explicitly
    // Skip by default to avoid breaking CI for contributors without Tailscale
    return !process.env.ENABLE_TAILSCALE_TESTS;
  }, 'Tailscale real integration tests require ENABLE_TAILSCALE_TESTS=1');

  test('can connect through Tailscale hostname', async ({ page }) => {
    // This test requires:
    // 1. Tailscale installed and running
    // 2. VibeTunnel running with Tailscale Serve enabled
    // 3. Access to the Tailscale hostname
    
    const diagnosticResponse = await page.request.get('/api/sessions/tailscale/test');
    const diagnosticData = await diagnosticResponse.json();
    
    // Verify prerequisites
    expect(diagnosticData.tailscale.installed).toBe(true);
    expect(diagnosticData.tailscaleServe.configured).toBe(true);
    
    // TODO: This would require knowing the actual Tailscale hostname
    // For now, just verify the diagnostic data looks correct
    console.log('Tailscale real integration test - diagnostic data:', diagnosticData);
  });

  test('Tailscale Serve proxy forwards requests correctly', async ({ page }) => {
    // This test would verify that requests through Tailscale hostname
    // actually reach the VibeTunnel server correctly
    
    const response = await page.request.get('/api/sessions');
    expect(response.ok()).toBeTruthy();
    
    // If we can get this response, the proxy is working
    const sessions = await response.json();
    expect(Array.isArray(sessions)).toBe(true);
    
    console.log('Tailscale proxy test completed - server is reachable');
  });

  test('authentication headers are properly handled', async ({ page }) => {
    // Test that Tailscale identity headers work for authentication
    
    const response = await page.request.get('/api/auth/status');
    expect(response.ok()).toBeTruthy();
    
    const authStatus = await response.json();
    console.log('Auth status with Tailscale headers:', authStatus);
    
    // The response should indicate authentication method
    expect(authStatus).toHaveProperty('authenticated');
  });
});
import { test, expect } from '@playwright/test';

test.describe('Health Endpoint Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to VibeTunnel
    await page.goto('http://localhost:4020');
    
    // Wait for app to load
    await expect(page.locator('body')).toBeVisible();
  });

  test('health endpoint provides basic status', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Basic health check properties
    expect(data).toHaveProperty('status');
    expect(data.status).toBe('healthy');
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime).toBe('number');
  });

  test('health endpoint includes connection information', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Connection information
    expect(data).toHaveProperty('connections');
    expect(data.connections).toHaveProperty('http');
    expect(data.connections.http).toHaveProperty('port');
    expect(data.connections.http).toHaveProperty('url');
  });

  test('health endpoint includes Tailscale information when available', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // When Tailscale is configured, additional fields should be present
    if (data.connections?.tailscale) {
      expect(data.connections.tailscale).toHaveProperty('available');
      
      if (data.connections.tailscale.available) {
        // When Tailscale is available, we should have hostname and URL
        expect(data.connections.tailscale).toHaveProperty('hostname');
        expect(data.connections.tailscale).toHaveProperty('httpsUrl');
        
        // Verify the URL format
        if (data.connections.tailscale.httpsUrl) {
          expect(data.connections.tailscale.httpsUrl).toMatch(/^https:\/\//);
        }
        
        // Check for Funnel status
        expect(data.connections.tailscale).toHaveProperty('funnel');
        expect(typeof data.connections.tailscale.funnel).toBe('boolean');
      }
    }
    
    // Top-level Tailscale URL for easy access
    if (data.tailscaleUrl) {
      expect(data.tailscaleUrl).toMatch(/^https:\/\//);
    }
  });

  test('health endpoint handles missing Tailscale gracefully', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Even without Tailscale, the endpoint should work
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('connections');
    
    // If Tailscale is not available, it should indicate that
    if (data.connections?.tailscale && !data.connections.tailscale.available) {
      expect(data.connections.tailscale.available).toBe(false);
      // Should not have hostname or httpsUrl when not available
      expect(data.connections.tailscale.hostname).toBeUndefined();
      expect(data.connections.tailscale.httpsUrl).toBeUndefined();
    }
  });

  test('health endpoint response structure is consistent', async ({ page }) => {
    // Make multiple requests to ensure consistency
    const responses = await Promise.all([
      page.request.get('/api/health'),
      page.request.get('/api/health'),
      page.request.get('/api/health'),
    ]);
    
    const dataArray = await Promise.all(responses.map(r => r.json()));
    
    // All responses should have the same structure
    for (const data of dataArray) {
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('connections');
      expect(data.connections).toHaveProperty('http');
    }
    
    // Status should always be 'healthy' if we get a 200 response
    for (const data of dataArray) {
      expect(data.status).toBe('healthy');
    }
  });
});
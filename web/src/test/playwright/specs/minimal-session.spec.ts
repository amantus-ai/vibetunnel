import { test, expect } from '../fixtures/test.fixture';

test.describe('Minimal Session Tests', () => {
  test('should create and list a session', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    await page.waitForTimeout(1000);
    
    // Click the create session button
    await page.click('button[title="Create New Session"]');
    
    // Wait for the modal
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });
    
    // Give it a unique name
    const sessionName = `Test-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName);
    
    // Click create button
    await page.click('button:has-text("Create")');
    
    // Verify we navigated to a session
    await expect(page).toHaveURL(/\?session=/);
    
    // Wait a bit for the session to initialize
    await page.waitForTimeout(3000);
    
    // Go back to session list
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Check if our session is listed (use first() to avoid multiple matches)
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();
  });

  test('should create multiple sessions', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    
    const sessions = [];
    
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1000);
      
      // Click create button
      await page.click('button[title="Create New Session"]');
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });
      
      // Give unique name
      const name = `Session-${Date.now()}-${i}`;
      sessions.push(name);
      await page.fill('input[placeholder="My Session"]', name);
      
      // Create
      await page.click('button:has-text("Create")');
      await expect(page).toHaveURL(/\?session=/);
      await page.waitForTimeout(2000);
      
      // Go back to list
      await page.goto('/');
    }
    
    // Verify all sessions are listed
    for (const sessionName of sessions) {
      const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      await expect(sessionCard).toBeVisible();
    }
    
    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
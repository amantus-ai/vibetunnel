import { expect, test } from '../fixtures/test.fixture';

test.describe('Debug Session Tests', () => {
  test('debug session creation and listing', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Create a session manually to debug the flow
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Check the initial state of spawn window toggle
    const spawnWindowToggle = page.locator('button[role="switch"]');
    const initialState = await spawnWindowToggle.getAttribute('aria-checked');
    console.log(`Initial spawn window state: ${initialState}`);

    // Turn OFF spawn window
    if (initialState === 'true') {
      await spawnWindowToggle.click();
      await page.waitForTimeout(100);
    }

    const finalState = await spawnWindowToggle.getAttribute('aria-checked');
    console.log(`Final spawn window state: ${finalState}`);

    // Fill in session name
    const sessionName = `debug-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Intercept the API request to see what's being sent
    const [request] = await Promise.all([
      page.waitForRequest('/api/sessions'),
      page.locator('button').filter({ hasText: 'Create' }).click(),
    ]);

    const requestBody = request.postDataJSON();
    console.log('Request body:', JSON.stringify(requestBody));

    // Wait for response
    const response = await request.response();
    const responseBody = await response?.json();
    console.log('Response status:', response?.status());
    console.log('Response body:', JSON.stringify(responseBody));

    // Wait for navigation
    await page.waitForURL(/\?session=/, { timeout: 10000 });
    console.log('Navigated to session');

    // Navigate back to home using the UI
    await page.click('button:has(h1:has-text("VibeTunnel"))');
    await page.waitForURL('/');
    console.log('Navigated back to home');

    // Wait a bit for sessions to load
    await page.waitForTimeout(2000);

    // Check what's in the DOM
    const sessionCards = await page.locator('session-card').count();
    console.log(`Found ${sessionCards} session cards in DOM`);

    // Check for any error messages
    const errorElements = await page.locator('.text-red-500, .error, [class*="error"]').count();
    console.log(`Found ${errorElements} error elements`);

    // Check the session list container
    const listContainer = await page.locator('[data-testid="session-list-container"]').textContent();
    console.log('Session list container content:', listContainer?.substring(0, 200));

    // Try to fetch sessions directly
    const sessionsResponse = await page.evaluate(async () => {
      const response = await fetch('/api/sessions');
      const data = await response.json();
      return { status: response.status, count: data.length, sessions: data };
    });
    console.log('Direct API call:', JSON.stringify(sessionsResponse));
  });
});
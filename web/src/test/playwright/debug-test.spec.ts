import { test } from '@playwright/test';

test('debug screenshot', async ({ page }) => {
  // Capture console messages
  page.on('console', msg => {
    console.log(`Console ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.log('Page error:', err.message);
  });
  await page.goto('http://localhost:4022');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  
  // Log page content
  const content = await page.content();
  console.log('Page title:', await page.title());
  console.log('Page URL:', page.url());
  console.log('Has vibetunnel-app:', await page.locator('vibetunnel-app').count());
  console.log('Has create button:', await page.locator('button[title="Create New Session"]').count());
  console.log('Has auth form:', await page.locator('auth-login').count());
  console.log('Body text:', await page.locator('body').textContent());
});
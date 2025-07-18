#!/usr/bin/env node

import { chromium } from 'playwright';

console.log('Testing Linux screenshare...');

(async () => {
  const browser = await chromium.launch({ 
    headless: false
  });
  
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:4020');
  console.log('Page loaded');
  
  // Wait and take screenshot
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-page.png' });
  console.log('Screenshot saved');

  // Click on session create button
  const createButton = await page.locator('vt-button:has-text("Create Session")').first();
  if (await createButton.isVisible()) {
    console.log('Found Create Session button');
    await createButton.click();
    await page.waitForTimeout(2000);
  }

  // Look for screenshare in session options
  const screenshareOption = await page.locator('text=/screenshare/i').first();
  if (await screenshareOption.isVisible()) {
    console.log('Found screenshare option');
    await screenshareOption.click();
  } else {
    // Try the card approach
    const cards = await page.locator('.session-card, vt-card').all();
    console.log(`Found ${cards.length} cards`);
    
    for (const card of cards) {
      const text = await card.textContent();
      if (text?.toLowerCase().includes('screenshare')) {
        console.log('Found screenshare card');
        await card.click();
        break;
      }
    }
  }
  
  await page.waitForTimeout(5000);
  console.log('Test complete');
  
  await browser.close();
})();
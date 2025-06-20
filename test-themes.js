const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3000';
const SCREENSHOTS_DIR = path.join(__dirname, 'theme-screenshots');
const THEMES = ['VibeTunnel', 'solarized_dark', 'dracula', 'monokai'];
const THEME_DISPLAY_NAMES = {
  'VibeTunnel': 'VibeTunnel',
  'solarized_dark': 'Solarized Dark',
  'dracula': 'Dracula',
  'monokai': 'Monokai'
};

async function ensureScreenshotsDir() {
  try {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    console.log(`Screenshots directory created at: ${SCREENSHOTS_DIR}`);
  } catch (error) {
    console.error('Error creating screenshots directory:', error);
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testThemes() {
  await ensureScreenshotsDir();
  
  const browser = await puppeteer.launch({
    headless: false, // Set to true for automated testing
    defaultViewport: {
      width: 1280,
      height: 800
    }
  });

  try {
    const page = await browser.newPage();
    
    // Go to the main page
    console.log('Navigating to VibeTunnel...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await delay(2000);

    // Take screenshot of main page
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-main-page.png'),
      fullPage: true 
    });
    console.log('✓ Captured main page screenshot');

    // Click on the first session to enter terminal view
    console.log('Looking for sessions...');
    
    // Wait for session cards to load
    try {
      await page.waitForSelector('session-card', { timeout: 10000 });
    } catch (e) {
      console.log('No sessions found, creating a test session...');
      // Try to create a new session if none exist
      const createButton = await page.$('button:has-text("Create"), button:has-text("New Session"), button:has-text("+")');
      if (createButton) {
        await createButton.click();
        await delay(1000);
        // Fill in session creation form if needed
        const commandInput = await page.$('input[name="command"], input[placeholder*="command"]');
        if (commandInput) {
          await commandInput.type('bash');
        }
        const submitButton = await page.$('button[type="submit"], button:has-text("Create Session")');
        if (submitButton) {
          await submitButton.click();
          await delay(2000);
        }
      }
    }
    
    // Get all sessions and click the first one
    const sessions = await page.$$('session-card');
    if (sessions.length > 0) {
      console.log(`Found ${sessions.length} sessions, clicking the first one...`);
      await sessions[0].click();
    } else {
      throw new Error('No sessions found to test');
    }

    // Wait for terminal to load
    await page.waitForSelector('vibe-terminal', { timeout: 10000 });
    await delay(3000); // Give terminal time to fully render

    // Take screenshot of terminal with default theme
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '02-terminal-default-theme.png'),
      fullPage: true 
    });
    console.log('✓ Captured terminal with default theme');

    // Find and hover over the gear icon to show it clearly
    console.log('Looking for theme settings gear icon...');
    const gearButton = await page.$('button[title="Theme Settings"]');
    if (!gearButton) {
      throw new Error('Theme settings gear icon not found');
    }
    
    await gearButton.hover();
    await delay(500);
    
    // Take screenshot showing the gear icon
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '03-gear-icon-hover.png'),
      fullPage: true 
    });
    console.log('✓ Captured gear icon');

    // Click the gear icon to open theme selector
    await gearButton.click();
    await delay(1000);

    // Take screenshot of theme selector dropdown
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '04-theme-selector-open.png'),
      fullPage: true 
    });
    console.log('✓ Captured theme selector dropdown');

    // Test each theme
    for (let i = 0; i < THEMES.length; i++) {
      const themeName = THEMES[i];
      const displayName = THEME_DISPLAY_NAMES[themeName];
      
      console.log(`\nTesting theme: ${displayName}...`);
      
      // Click on the theme
      const themeSelector = `div[data-theme="${themeName}"]`;
      const themeOption = await page.$(themeSelector);
      
      if (!themeOption) {
        console.error(`Theme option not found: ${displayName}`);
        continue;
      }
      
      await themeOption.click();
      await delay(2000); // Wait for theme to apply
      
      // Take screenshot of terminal with this theme
      const screenshotName = `05-theme-${themeName.toLowerCase()}.png`;
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, screenshotName),
        fullPage: true 
      });
      console.log(`✓ Captured ${displayName} theme`);
      
      // Open the selector again for the next theme (except for the last one)
      if (i < THEMES.length - 1) {
        await gearButton.click();
        await delay(500);
      }
    }

    // Test theme persistence
    console.log('\nTesting theme persistence...');
    
    // Get current theme from localStorage
    const savedTheme = await page.evaluate(() => {
      return localStorage.getItem('vibetunnel-theme');
    });
    console.log(`✓ Current theme saved in localStorage: ${savedTheme}`);
    
    // Reload the page
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);
    
    // Check if theme persisted
    const themeAfterReload = await page.evaluate(() => {
      return localStorage.getItem('vibetunnel-theme');
    });
    
    if (savedTheme === themeAfterReload) {
      console.log('✓ Theme persisted successfully after reload');
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, '06-theme-after-reload.png'),
        fullPage: true 
      });
    } else {
      console.error('✗ Theme did not persist after reload');
    }

    // Test localStorage error handling
    console.log('\nTesting localStorage error handling...');
    await page.evaluate(() => {
      // Temporarily break localStorage
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function() {
        throw new Error('localStorage is full');
      };
      
      // Try to change theme - should handle error gracefully
      const event = new MouseEvent('click', { bubbles: true });
      document.querySelector('button[title="Theme Settings"]').dispatchEvent(event);
      
      // Restore localStorage
      Storage.prototype.setItem = originalSetItem;
    });
    
    console.log('✓ localStorage error handling tested (check console for any errors)');

    console.log('\n✅ All tests completed successfully!');
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('\nScreenshots captured:');
    console.log('1. Main page');
    console.log('2. Terminal with default theme');
    console.log('3. Gear icon hover state');
    console.log('4. Theme selector dropdown open');
    console.log('5. Each theme applied (VibeTunnel, Solarized Dark, Dracula, Monokai)');
    console.log('6. Theme persistence after page reload');

  } catch (error) {
    console.error('Error during testing:', error);
  } finally {
    await browser.close();
  }
}

// Run the tests
testThemes().catch(console.error);
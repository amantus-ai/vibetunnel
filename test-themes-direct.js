const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testThemesDirectly() {
  const screenshotsDir = path.join(__dirname, 'theme-screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = await browser.newPage();
    
    // Try the terminal test page first
    console.log('Trying terminal test page...');
    await page.goto('http://localhost:3000/terminal-test.html', { waitUntil: 'networkidle2' });
    await delay(2000);
    
    // Check if we have a terminal
    const hasTerminal = await page.$('vibe-terminal') !== null;
    
    if (!hasTerminal) {
      console.log('No terminal on test page, trying main app...');
      // Navigate to main app
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
      await delay(2000);
      
      // Take screenshot of main page
      await page.screenshot({ 
        path: path.join(screenshotsDir, '00-main-page.png'),
        fullPage: true 
      });
      console.log('✓ Captured main page');
      
      // Look for any session or create button
      const sessionCard = await page.$('session-card');
      if (sessionCard) {
        console.log('Found session, clicking...');
        await sessionCard.click();
      } else {
        // Try to find create button
        const buttons = await page.$$('button');
        for (const button of buttons) {
          const text = await page.evaluate(el => el.textContent, button);
          if (text && (text.includes('Create') || text.includes('New') || text === '+')) {
            console.log('Found create button, clicking...');
            await button.click();
            await delay(1000);
            
            // Try to fill in form
            const inputs = await page.$$('input');
            if (inputs.length > 0) {
              await inputs[0].type('bash');
              await delay(500);
              
              // Submit form
              const submitButtons = await page.$$('button[type="submit"], button');
              for (const btn of submitButtons) {
                const btnText = await page.evaluate(el => el.textContent, btn);
                if (btnText && (btnText.includes('Create') || btnText.includes('Submit'))) {
                  await btn.click();
                  break;
                }
              }
            }
            break;
          }
        }
      }
      
      // Wait for navigation to terminal
      await page.waitForSelector('vibe-terminal', { timeout: 10000 });
      await delay(2000);
    }
    
    // Now we should be in a terminal view
    console.log('In terminal view, looking for gear icon...');
    
    // Take initial screenshot
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-terminal-default.png'),
      fullPage: true 
    });
    console.log('✓ Captured default terminal');
    
    // Find gear button - try multiple selectors
    let gearButton = await page.$('button[title="Theme Settings"]');
    if (!gearButton) {
      // Try finding by content
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await page.evaluate(el => el.textContent, button);
        if (text && text.includes('⚙')) {
          gearButton = button;
          break;
        }
      }
    }
    
    if (!gearButton) {
      console.error('Could not find theme settings button!');
      console.log('Taking screenshot of current state...');
      await page.screenshot({ 
        path: path.join(screenshotsDir, 'debug-no-gear-button.png'),
        fullPage: true 
      });
      return;
    }
    
    console.log('Found gear button, clicking...');
    await gearButton.click();
    await delay(1000);
    
    // Screenshot with dropdown open
    await page.screenshot({ 
      path: path.join(screenshotsDir, '02-theme-selector-open.png'),
      fullPage: true 
    });
    console.log('✓ Captured theme selector');
    
    // Test each theme
    const themes = ['solarized_dark', 'dracula', 'monokai', 'VibeTunnel'];
    
    for (const themeName of themes) {
      const themeOption = await page.$(`div[data-theme="${themeName}"]`);
      if (themeOption) {
        console.log(`Applying ${themeName} theme...`);
        await themeOption.click();
        await delay(1500);
        
        await page.screenshot({ 
          path: path.join(screenshotsDir, `theme-${themeName}.png`),
          fullPage: true 
        });
        console.log(`✓ Captured ${themeName} theme`);
        
        // Reopen dropdown for next theme
        if (themeName !== themes[themes.length - 1]) {
          await gearButton.click();
          await delay(500);
        }
      } else {
        console.log(`Could not find theme option: ${themeName}`);
      }
    }
    
    // Test persistence
    console.log('\nTesting theme persistence...');
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);
    
    await page.screenshot({ 
      path: path.join(screenshotsDir, '03-after-reload.png'),
      fullPage: true 
    });
    console.log('✓ Captured state after reload');
    
    console.log('\n✅ All screenshots captured!');
    console.log(`Screenshots saved to: ${screenshotsDir}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testThemesDirectly().catch(console.error);
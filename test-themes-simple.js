const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

async function testThemes() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  
  console.log('Please follow these steps:');
  console.log('1. Navigate to http://localhost:3000');
  console.log('2. Create or click on a terminal session');
  console.log('3. Once in the terminal view, press Enter to continue...');
  
  // Wait for user to navigate manually
  await page.goto('http://localhost:3000');
  
  // Simple way to pause - wait for user input
  console.log('\nWaiting for you to navigate to a terminal session...');
  console.log('Press Enter when you are in a terminal view with the gear icon visible:');
  
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  const screenshotsDir = path.join(__dirname, 'theme-screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  
  // Now take screenshots
  console.log('\nTaking screenshots...');
  
  // 1. Default view
  await page.screenshot({ 
    path: path.join(screenshotsDir, '01-terminal-default.png'),
    fullPage: true 
  });
  console.log('✓ Captured default terminal');
  
  // 2. Click gear icon
  const gearButton = await page.$('button[title="Theme Settings"]');
  if (gearButton) {
    await gearButton.click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ 
      path: path.join(screenshotsDir, '02-theme-selector-open.png'),
      fullPage: true 
    });
    console.log('✓ Captured theme selector dropdown');
    
    // 3. Test each theme
    const themes = [
      { selector: 'div[data-theme="solarized_dark"]', name: 'solarized_dark' },
      { selector: 'div[data-theme="dracula"]', name: 'dracula' },
      { selector: 'div[data-theme="monokai"]', name: 'monokai' },
      { selector: 'div[data-theme="VibeTunnel"]', name: 'VibeTunnel' }
    ];
    
    for (const theme of themes) {
      const themeOption = await page.$(theme.selector);
      if (themeOption) {
        await themeOption.click();
        await page.waitForTimeout(1000);
        
        await page.screenshot({ 
          path: path.join(screenshotsDir, `theme-${theme.name}.png`),
          fullPage: true 
        });
        console.log(`✓ Captured ${theme.name} theme`);
        
        // Reopen selector for next theme
        await gearButton.click();
        await page.waitForTimeout(500);
      }
    }
  } else {
    console.error('Could not find theme settings button!');
  }
  
  console.log('\n✅ Screenshots saved to:', screenshotsDir);
  await browser.close();
}

testThemes().catch(console.error);
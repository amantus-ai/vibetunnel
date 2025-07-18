// Test script to verify screen capture functionality using Playwright

async function testScreenCapture() {
  console.log('Starting Playwright MCP screen capture test...');
  
  try {
    // Navigate to the screencap page
    console.log('Navigating to http://localhost:4020/screencap');
    await mcp_playwright_browser_navigate({ url: 'http://localhost:4020/screencap' });
    
    // Take initial screenshot
    console.log('Taking initial screenshot...');
    await mcp_playwright_browser_take_screenshot({ filename: 'screencap-initial.png' });
    
    // Wait for page to load
    await mcp_playwright_browser_wait_for({ time: 2 });
    
    // Get page snapshot
    console.log('Getting page accessibility snapshot...');
    const snapshot = await mcp_playwright_browser_snapshot();
    console.log('Page loaded, snapshot:', JSON.stringify(snapshot, null, 2));
    
    // Click on a display if available
    console.log('Looking for display options...');
    const displayElement = snapshot.find(el => el.text?.includes('Display'));
    if (displayElement) {
      console.log('Found display element, clicking...');
      await mcp_playwright_browser_click({ 
        element: 'Display selection', 
        ref: displayElement.ref 
      });
    }
    
    // Look for Start button
    console.log('Looking for Start button...');
    const startButton = snapshot.find(el => el.text === 'Start' && el.role === 'button');
    if (startButton) {
      console.log('Found Start button, clicking...');
      await mcp_playwright_browser_click({ 
        element: 'Start capture button', 
        ref: startButton.ref 
      });
      
      // Wait for capture to start
      await mcp_playwright_browser_wait_for({ time: 3 });
      
      // Take screenshot of capture in progress
      console.log('Taking screenshot of active capture...');
      await mcp_playwright_browser_take_screenshot({ filename: 'screencap-active.png' });
    } else {
      console.log('Start button not found or disabled');
    }
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testScreenCapture();
import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { testConfig } from '../test-config';

// Global storage for reusable contexts and pages
let globalContext: BrowserContext | null = null;
let globalPage: Page | null = null;
let contextRefCount = 0;

// Extend base test with reusable context and page
export const test = base.extend<{
  reusableContext: BrowserContext;
  reusablePage: Page;
}>({
  // Reusable browser context that persists across tests
  reusableContext: async ({ browser }, use) => {
    // Create new context only if needed
    if (!globalContext || globalContext.browser() !== browser) {
      // Clean up old context if browser changed
      if (globalContext) {
        await globalContext.close();
      }
      
      globalContext = await browser.newContext({
        // Share storage state across tests for speed
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      });
      
      // Set up resource blocking once for the context
      await globalContext.route('**/*', (route) => {
        const url = route.request().url();
        const resourceType = route.request().resourceType();

        // Allow only essential resources for localhost
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
          const blockedLocalTypes = ['image', 'font', 'media'];
          if (blockedLocalTypes.includes(resourceType)) {
            return route.abort();
          }
          
          const allowedExtensions = ['.js', '.css', '.html', '/api/', '.json'];
          const hasAllowedExtension = allowedExtensions.some(ext => url.includes(ext));
          
          if (!hasAllowedExtension && resourceType !== 'document' && resourceType !== 'xhr' && resourceType !== 'fetch') {
            return route.abort();
          }
          
          return route.continue();
        }

        // Block all external resources
        return route.abort();
      });
    }
    
    contextRefCount++;
    await use(globalContext);
    contextRefCount--;
    
    // Don't close context - keep it for next test
  },

  // Reusable page that gets cleaned between tests
  reusablePage: async ({ reusableContext }, use) => {
    // Create new page if needed or if previous one is closed
    if (!globalPage || globalPage.isClosed()) {
      globalPage = await reusableContext.newPage();
      
      // Set up page-level optimizations once
      globalPage.setDefaultTimeout(testConfig.defaultTimeout);
      globalPage.setDefaultNavigationTimeout(testConfig.navigationTimeout);
      
      // Inject CSS to skip animations once
      await globalPage.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            scroll-behavior: auto !important;
          }
        `,
      });
    } else {
      // Clean existing page for reuse
      await globalPage.goto('about:blank');
      
      // Clear storage to avoid test contamination
      await globalPage.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    }
    
    // Navigate to base URL
    await globalPage.goto('/', { waitUntil: 'domcontentloaded' });
    
    // Set localStorage defaults
    await globalPage.evaluate(() => {
      localStorage.setItem('hideExitedSessions', 'false');
    });
    
    // Wait for app to be ready
    await globalPage.waitForSelector('vibetunnel-app', { state: 'attached' });
    
    await use(globalPage);
    // Don't close page - keep it for next test
  },
});

// Clean up on test completion
test.afterAll(async () => {
  if (contextRefCount === 0 && globalContext) {
    await globalContext.close();
    globalContext = null;
    globalPage = null;
  }
});

export { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Optimized wait utilities for Playwright tests
 * Reduces duplication and improves performance
 */
export class WaitUtils {
  private static readonly DEFAULT_TIMEOUT = 5000;
  private static readonly POLL_INTERVAL = 100;
  
  /**
   * Wait for an element with a specific test ID
   */
  static async waitForTestId(page: Page, testId: string, options?: { state?: 'attached' | 'visible' | 'hidden' | 'detached'; timeout?: number }) {
    const selector = `[data-testid="${testId}"]`;
    return page.waitForSelector(selector, {
      state: options?.state ?? 'visible',
      timeout: options?.timeout ?? this.DEFAULT_TIMEOUT
    });
  }
  
  /**
   * Wait for multiple conditions in parallel
   */
  static async waitForAll(conditions: Array<() => Promise<any>>, options?: { timeout?: number }) {
    const timeout = options?.timeout ?? this.DEFAULT_TIMEOUT;
    const promises = conditions.map(condition => 
      Promise.race([
        condition(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ])
    );
    return Promise.all(promises);
  }
  
  /**
   * Wait for any of multiple conditions (first one wins)
   */
  static async waitForAny(conditions: Array<() => Promise<any>>, options?: { timeout?: number }) {
    const timeout = options?.timeout ?? this.DEFAULT_TIMEOUT;
    return Promise.race([
      Promise.race(conditions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('None of the conditions were met')), timeout)
      )
    ]);
  }
  
  /**
   * Wait with exponential backoff for retries
   */
  static async waitWithBackoff<T>(
    fn: () => Promise<T>, 
    options?: { 
      maxRetries?: number; 
      initialDelay?: number; 
      maxDelay?: number;
      factor?: number;
    }
  ): Promise<T> {
    const { 
      maxRetries = 3, 
      initialDelay = 100, 
      maxDelay = 5000,
      factor = 2 
    } = options ?? {};
    
    let delay = initialDelay;
    let lastError: Error;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * factor, maxDelay);
        }
      }
    }
    
    throw lastError!;
  }
  
  /**
   * Wait for network idle state
   */
  static async waitForNetworkIdle(page: Page, options?: { timeout?: number; maxInflightRequests?: number }) {
    const { timeout = this.DEFAULT_TIMEOUT, maxInflightRequests = 0 } = options ?? {};
    await page.waitForLoadState('networkidle', { timeout });
    
    // Additional check for any pending requests
    await page.waitForFunction(
      (max) => {
        const pending = (window as any).__pendingRequests || 0;
        return pending <= max;
      },
      maxInflightRequests,
      { timeout: timeout / 2 }
    );
  }
  
  /**
   * Wait for element count to match expected
   */
  static async waitForElementCount(
    page: Page, 
    selector: string, 
    expectedCount: number,
    options?: { timeout?: number; operator?: 'exact' | 'minimum' | 'maximum' }
  ) {
    const { timeout = this.DEFAULT_TIMEOUT, operator = 'exact' } = options ?? {};
    
    await page.waitForFunction(
      ({ selector, count, op }) => {
        const elements = document.querySelectorAll(selector);
        switch (op) {
          case 'minimum':
            return elements.length >= count;
          case 'maximum':
            return elements.length <= count;
          default:
            return elements.length === count;
        }
      },
      { selector, count: expectedCount, op: operator },
      { timeout }
    );
  }
  
  /**
   * Wait for text content in element
   */
  static async waitForTextContent(
    page: Page,
    selector: string,
    text: string | RegExp,
    options?: { timeout?: number; exact?: boolean }
  ) {
    const { timeout = this.DEFAULT_TIMEOUT, exact = false } = options ?? {};
    
    await page.waitForFunction(
      ({ selector, text, exact }) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        
        const content = element.textContent?.trim() ?? '';
        
        if (text instanceof RegExp) {
          return text.test(content);
        }
        
        return exact ? content === text : content.includes(text);
      },
      { selector, text, exact },
      { timeout }
    );
  }
  
  /**
   * Wait for animation to complete
   */
  static async waitForAnimation(page: Page, selector: string, options?: { timeout?: number }) {
    const { timeout = this.DEFAULT_TIMEOUT } = options ?? {};
    
    // Wait for element to exist
    await page.waitForSelector(selector, { state: 'attached', timeout: timeout / 2 });
    
    // Wait for animations to complete
    await page.waitForFunction(
      (sel) => {
        const element = document.querySelector(sel);
        if (!element) return false;
        
        const animations = element.getAnimations?.() ?? [];
        return animations.every(animation => animation.playState === 'finished');
      },
      selector,
      { timeout: timeout / 2 }
    );
  }
  
  /**
   * Smart wait that combines multiple strategies
   */
  static async smartWait(page: Page, options?: {
    networkIdle?: boolean;
    animations?: boolean;
    timeout?: number;
    selectors?: string[];
  }) {
    const { 
      networkIdle = true, 
      animations = true, 
      timeout = this.DEFAULT_TIMEOUT,
      selectors = []
    } = options ?? {};
    
    const waitTasks: Array<() => Promise<any>> = [];
    
    if (networkIdle) {
      waitTasks.push(() => this.waitForNetworkIdle(page, { timeout }));
    }
    
    if (animations && selectors.length > 0) {
      selectors.forEach(selector => {
        waitTasks.push(() => this.waitForAnimation(page, selector, { timeout }));
      });
    }
    
    if (waitTasks.length > 0) {
      await Promise.all(waitTasks.map(task => task().catch(() => {})));
    }
  }
}
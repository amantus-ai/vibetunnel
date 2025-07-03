# Playwright Test Optimization Guide

## Current Issues

1. **Test Duration**: Tests are taking 20-30+ minutes in CI
2. **Modal Tests**: Working correctly locally but may have timing issues in CI
3. **Session Creation**: Each test creates real terminal sessions which adds overhead

## Implemented Fixes

### Modal Implementation
- ✅ Modal functionality works correctly with the new `modal-wrapper` component
- ✅ Escape key handling works as expected
- ✅ Form interactions are responsive

### Test Improvements
- ✅ Reduced unnecessary `waitForTimeout` calls where possible
- ✅ Optimized wait strategies for modal interactions

## Recommendations for Further Optimization

### 1. Parallel Test Execution
Currently tests run with `workers: 1`. Consider:
```javascript
// playwright.config.ts
workers: process.env.CI ? 2 : 4,
fullyParallel: true,
```

### 2. Mock Session Creation
For non-critical tests, mock the session API:
```javascript
await page.route('/api/sessions', async (route) => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify({ 
      sessionId: 'mock-session-id',
      // ... other session data
    })
  });
});
```

### 3. Reuse Test Sessions
Create a pool of test sessions at the start and reuse them:
```javascript
// global-setup.ts
const testSessions = await createTestSessionPool(5);
process.env.TEST_SESSION_POOL = JSON.stringify(testSessions);
```

### 4. Reduce Animation Delays
In test mode, disable or speed up animations:
```css
/* When running tests */
body[data-testid="playwright"] * {
  animation-duration: 0s !important;
  transition-duration: 0s !important;
}
```

### 5. Use Test-Specific Timeouts
```javascript
// For fast operations
await expect(element).toBeVisible({ timeout: 2000 });

// For network operations  
await page.waitForResponse('/api/sessions', { timeout: 5000 });
```

### 6. Skip Unnecessary Waits
Replace:
```javascript
await page.waitForLoadState('networkidle');
```

With:
```javascript
await page.waitForSelector('vibetunnel-app', { state: 'attached' });
```

### 7. CI-Specific Optimizations
- Use `--disable-dev-shm-usage` for Chromium in CI
- Increase `--max-old-space-size` for Node.js
- Consider using a more powerful CI runner

## Running Tests Efficiently

### Local Development
```bash
# Run specific test file
pnpm exec playwright test session-creation.spec.ts

# Run with UI mode for debugging
pnpm exec playwright test --ui

# Run with trace for debugging failures
pnpm exec playwright test --trace on
```

### CI Optimization
```yaml
# GitHub Actions example
- name: Run Playwright tests
  run: pnpm run test:e2e
  env:
    NODE_OPTIONS: --max-old-space-size=4096
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1
```

## Monitoring Test Performance

Use the provided script to identify slow tests:
```bash
./scripts/profile-playwright-tests.sh
```

This will show the slowest tests that need optimization.
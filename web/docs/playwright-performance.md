# Playwright Performance Optimization Guide

## Overview

This guide provides comprehensive strategies for optimizing Playwright test execution speed based on 2024-2025 best practices. Our goal is to achieve significant performance improvements while maintaining test reliability.

## Current Performance Baseline

Before optimization:
- 31 tests taking ~12+ minutes in CI
- Sequential execution with limited parallelization
- No sharding or distributed execution
- Full browser context creation for each test

## Optimization Strategies

### 1. Parallel Execution and Workers

**Impact**: 3-4x speed improvement

```typescript
// playwright.config.ts
export default defineConfig({
  // Optimize worker count based on CI environment
  workers: process.env.CI ? 4 : undefined,
  
  // Enable full parallelization
  fullyParallel: true,
  
  // Limit failures to avoid wasting resources
  maxFailures: process.env.CI ? 10 : undefined,
});
```

**Implementation**:
- Use CPU core count for optimal worker allocation
- Enable `fullyParallel` for test-level parallelization
- Set `maxFailures` to stop early on broken builds

### 2. Test Sharding for CI

**Impact**: 4-8x speed improvement with proper distribution

```yaml
# .github/workflows/playwright.yml
strategy:
  matrix:
    shardIndex: [1, 2, 3, 4]
    shardTotal: [4]
steps:
  - run: pnpm exec playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
```

**Implementation**:
- Split tests across 4 shards for parallel CI execution
- Each shard runs on separate CI job
- Aggregate results after all shards complete

### 3. Browser Context Optimization

**Impact**: 20-30% speed improvement

```typescript
// fixtures/session-fixtures.ts
export const test = base.extend<{
  authenticatedContext: BrowserContext;
}>({
  authenticatedContext: async ({ browser }, use) => {
    // Create context once per worker
    const context = await browser.newContext({
      storageState: 'tests/auth.json'
    });
    await use(context);
    await context.close();
  },
});
```

**Strategies**:
- Reuse authentication state across tests
- Share expensive setup within workers
- Use project-specific contexts for different test types

### 4. Smart Waiting and Selectors

**Impact**: 10-20% speed improvement

```typescript
// Bad: Static waits
await page.waitForTimeout(5000);

// Good: Dynamic waits
await page.waitForSelector('[data-testid="session-ready"]', {
  state: 'visible',
  timeout: 5000
});

// Better: Wait for specific conditions
await page.waitForFunction(() => {
  const terminal = document.querySelector('vibe-terminal');
  return terminal?.dataset.ready === 'true';
});
```

**Best Practices**:
- Never use static timeouts
- Use data-testid attributes for fast selection
- Avoid XPath selectors
- Wait for specific application states

### 5. Resource Blocking

**Impact**: 15-25% speed improvement

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // Block unnecessary resources
    launchOptions: {
      args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
    },
  },
});

// In tests
await context.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}', route => route.abort());
await context.route('**/analytics/**', route => route.abort());
```

### 6. Test Organization and Isolation

**Impact**: 30-40% improvement through smart grouping

```typescript
// Group related tests that can share setup
test.describe('Session Management', () => {
  test.beforeAll(async ({ browser }) => {
    // Expensive setup once per group
  });
  
  test('should create session', async ({ page }) => {
    // Test implementation
  });
  
  test('should delete session', async ({ page }) => {
    // Test implementation
  });
});
```

### 7. Global Setup for Authentication

**Impact**: Saves 2-3 seconds per test

```typescript
// global-setup.ts
import { chromium } from '@playwright/test';

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Perform authentication
  await page.goto('http://localhost:4022');
  await page.fill('[name="username"]', 'testuser');
  await page.fill('[name="password"]', 'testpass');
  await page.click('[type="submit"]');
  
  // Save storage state
  await page.context().storageState({ path: 'tests/auth.json' });
  await browser.close();
}

export default globalSetup;
```

### 8. CI/CD Optimizations

**Impact**: 50% faster CI builds

```yaml
# Cache Playwright browsers
- uses: actions/cache@v3
  with:
    path: ~/.cache/ms-playwright
    key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}

# Install only required browsers
- run: pnpm exec playwright install chromium

# Use Linux for CI (faster and cheaper)
runs-on: ubuntu-latest
```

### 9. Headless Mode

**Impact**: 20-30% speed improvement

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    headless: true, // Always true in CI
    video: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
});
```

### 10. Performance Monitoring

```typescript
// Add performance tracking
test.beforeEach(async ({ page }, testInfo) => {
  const startTime = Date.now();
  
  testInfo.attachments.push({
    name: 'performance-metrics',
    body: JSON.stringify({
      test: testInfo.title,
      startTime,
    }),
    contentType: 'application/json',
  });
});
```

## Implementation Priority

1. **Phase 1 - Quick Wins** (1-2 hours)
   - Enable parallel execution
   - Switch to headless mode in CI
   - Implement resource blocking
   - Optimize selectors

2. **Phase 2 - Medium Impact** (2-4 hours)
   - Implement test sharding
   - Add global authentication setup
   - Optimize browser contexts
   - Group related tests

3. **Phase 3 - Advanced** (4-8 hours)
   - Implement custom fixtures
   - Add performance monitoring
   - Optimize CI pipeline
   - Fine-tune worker allocation

## Expected Results

With full implementation:
- **Local development**: 3-4x faster (3-4 minutes)
- **CI execution**: 6-8x faster (1.5-2 minutes)
- **Resource usage**: 40% reduction
- **Flakiness**: Significantly reduced

## Monitoring and Maintenance

1. Track test execution times in CI
2. Monitor flaky tests with retry analytics
3. Regular review of slow tests
4. Periodic selector optimization
5. Update Playwright version quarterly

## Common Pitfalls to Avoid

1. Over-parallelization causing resource contention
2. Sharing too much state between tests
3. Using static waits instead of dynamic conditions
4. Not considering CI environment limitations
5. Ignoring test isolation principles

## Sequential Execution Optimizations

Since VibeTunnel tests share system-level terminal resources and cannot run in parallel, we need different optimization strategies:

### 1. Browser Context and Page Reuse

**Impact**: Save 1-2s per test

```typescript
// fixtures/reusable-context.ts
let globalContext: BrowserContext | null = null;
let globalPage: Page | null = null;

export const test = base.extend({
  context: async ({ browser }, use) => {
    if (!globalContext) {
      globalContext = await browser.newContext();
    }
    await use(globalContext);
    // Don't close - reuse for next test
  },
  
  page: async ({ context }, use) => {
    if (!globalPage || globalPage.isClosed()) {
      globalPage = await context.newPage();
    } else {
      // Clear state for next test
      await globalPage.goto('about:blank');
    }
    await use(globalPage);
    // Don't close - reuse for next test
  }
});
```

### 2. Smart Test Ordering

Order tests from least destructive to most destructive:

```typescript
test.describe.configure({ mode: 'serial' });

test.describe('1. Read operations', () => {
  test('view sessions', async ({ page }) => {});
});

test.describe('2. Create operations', () => {
  test('create sessions', async ({ page }) => {});
});

test.describe('3. Destructive operations', () => {
  test('kill sessions', async ({ page }) => {});
});
```

### 3. Session Pool with Pre-creation

**Impact**: Save 2-3s per test

```typescript
test.beforeAll(async ({ page }) => {
  const pool = new SessionPool(page);
  await pool.initialize(5); // Create 5 sessions upfront
  global.sessionPool = pool;
});
```

### 4. Aggressive Resource Blocking

```typescript
await context.route('**/*', (route) => {
  const url = route.request().url();
  const allowedPatterns = ['localhost:4022', '/api/', '.js', '.css'];
  
  if (!allowedPatterns.some(pattern => url.includes(pattern))) {
    route.abort();
  } else {
    route.continue();
  }
});
```

### 5. Reduced Timeouts

```typescript
export const TEST_TIMEOUTS = {
  QUICK: 1000,    // Reduce from 3000
  DEFAULT: 2000,  // Reduce from 5000
  LONG: 5000,     // Reduce from 10000
};
```

### 6. Skip Animations

```typescript
await page.addStyleTag({
  content: `
    *, *::before, *::after {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
    }
  `
});
```

### Sequential Implementation Plan

**Phase 1 - Immediate (30 mins)**:
- Reduce all timeouts
- Enable headless mode
- Block unnecessary resources
- Skip animations

**Phase 2 - Quick Wins (1-2 hours)**:
- Implement browser/page reuse
- Add smart cleanup
- Optimize waiting strategies

**Phase 3 - Architecture (2-4 hours)**:
- Implement session pool
- Reorganize test order
- Add state persistence

### Expected Results for Sequential Tests

- **Current**: ~12+ minutes
- **Target**: ~3-5 minutes (3-4x improvement)
- **Key gains**: 
  - Page reuse: Save 1-2s per test
  - Reduced timeouts: Save 30-60s total
  - Resource blocking: Save 20-30% load time
  - Session pool: Save 2-3s per test

## Conclusion

While parallel execution would provide the best performance gains, these sequential optimizations can still achieve significant improvements. Start with quick wins and progressively implement more advanced optimizations based on your specific needs.
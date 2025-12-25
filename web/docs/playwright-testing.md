# Playwright Testing Best Practices for VibeTunnel

## Overview

This guide documents best practices for writing reliable, non-flaky Playwright tests for VibeTunnel, based on official Playwright documentation and community best practices.

## Core Principles

### 1. Use Auto-Waiting Instead of Arbitrary Delays

**❌ Bad: Arbitrary timeouts**
```typescript
await page.waitForTimeout(1000); // Don't do this!
```

**✅ Good: Wait for specific conditions**
```typescript
// Wait for element to be visible
await page.waitForSelector('vibe-terminal', { state: 'visible' });

// Wait for loading indicator to disappear
await page.locator('.loading-spinner').waitFor({ state: 'hidden' });

// Wait for specific text to appear
await page.getByText('Session created').waitFor();
```

### 2. Use Web-First Assertions

Web-first assertions automatically wait and retry until the condition is met:

```typescript
// These assertions auto-wait
await expect(page.locator('session-card')).toBeVisible();
await expect(page).toHaveURL(/\?session=/);
await expect(sessionCard).toContainText('RUNNING');
```

### 3. Prefer User-Facing Locators

**Locator Priority (best to worst):**
1. `getByRole()` - semantic HTML roles
2. `getByText()` - visible text content
3. `getByTestId()` - explicit test IDs
4. `locator()` with CSS - last resort

```typescript
// Good examples
await page.getByRole('button', { name: 'Create Session' }).click();
await page.getByText('Session Name').fill('My Session');
await page.getByTestId('terminal-output').waitFor();
```

## VibeTunnel-Specific Patterns

### Waiting for Terminal Ready

Instead of arbitrary delays, wait for terminal indicators:

```typescript
// Wait for terminal component to be visible
await page.waitForSelector('vibe-terminal', { state: 'visible' });

// Wait for terminal to have content or structure
await page.waitForFunction(() => {
  const terminal = document.querySelector('vibe-terminal');
  return terminal && (
    terminal.textContent?.trim().length > 0 ||
    !!terminal.shadowRoot ||
    !!terminal.querySelector('vibe-terminal')
  );
});
```

### Handling Session Creation

```typescript
// Wait for navigation after session creation
await expect(page).toHaveURL(/\?session=/, { timeout: 2000 });

// Wait for terminal to be ready
await page.locator('vibe-terminal').waitFor({ state: 'visible' });
```

### Managing Modal Animations

Instead of waiting for animations, wait for the modal state:

```typescript
// Wait for modal to be fully visible
await page.locator('[role="dialog"]').waitFor({ state: 'visible' });

// Wait for modal to be completely gone
await page.locator('[role="dialog"]').waitFor({ state: 'hidden' });
```

### Session List Updates

```typescript
// Wait for session cards to update
await page.locator('session-card').first().waitFor();

// Wait for specific session by name
await page.locator(`session-card:has-text("${sessionName}")`).waitFor();
```

## Common Anti-Patterns to Avoid

### 1. Storing Element References
```typescript
// ❌ Bad: Element reference can become stale
const button = await page.$('button');
await doSomething();
await button.click(); // May fail!

// ✅ Good: Re-query element when needed
await doSomething();
await page.locator('button').click();
```

### 2. Assuming Immediate Availability
```typescript
// ❌ Bad: No waiting
await page.goto('/');
await page.click('session-card'); // May not exist yet!

// ✅ Good: Wait for element
await page.goto('/');
await page.locator('session-card').waitFor();
await page.locator('session-card').click();
```

### 3. Fixed Sleep for Dynamic Content
```typescript
// ❌ Bad: Arbitrary wait for data load
await page.click('#load-data');
await page.waitForTimeout(3000);

// ✅ Good: Wait for loading state
await page.click('#load-data');
await page.locator('.loading').waitFor({ state: 'hidden' });
// Or wait for results
await page.locator('[data-testid="results"]').waitFor();
```

## Test Configuration

### Timeouts

Configure appropriate timeouts in `playwright.config.ts`:

```typescript
use: {
  // Global timeout for assertions
  expect: { timeout: 5000 },
  
  // Action timeout (click, fill, etc.)
  actionTimeout: 10000,
  
  // Navigation timeout
  navigationTimeout: 10000,
}
```

### Test Isolation

Each test should be independent:

```typescript
test.beforeEach(async ({ page }) => {
  // Fresh start for each test
  await page.goto('/');
  await page.waitForSelector('vibetunnel-app', { state: 'attached' });
});
```

## Debugging Flaky Tests

### 1. Enable Trace Recording
```typescript
// In playwright.config.ts
use: {
  trace: 'on-first-retry',
}
```

### 2. Use Debug Mode
```bash
# Run with headed browser and inspector
pnpm exec playwright test --debug
```

### 3. Add Strategic Logging
```typescript
console.log('Waiting for terminal to be ready...');
await page.locator('vibe-terminal').waitFor();
console.log('Terminal is ready');
```

## Terminal-Specific Patterns

### Waiting for Terminal Output
```typescript
// Wait for specific text in terminal
await page.waitForFunction(
  (searchText) => {
    const terminal = document.querySelector('vibe-terminal');
    return terminal?.textContent?.includes(searchText);
  },
  'Expected output'
);
```

### Waiting for Shell Prompt
```typescript
// Wait for prompt patterns
await page.waitForFunction(() => {
  const terminal = document.querySelector('vibe-terminal');
  const content = terminal?.textContent || '';
  return /[$>#%❯]\s*$/.test(content);
});
```

### Handling Server-Side Terminals

When `spawnWindow` is false, terminals run server-side:

```typescript
// Create session with server-side terminal
await sessionListPage.createNewSession(sessionName, false);

// Wait for WebSocket v3 connection
await page.locator('vibe-terminal').waitFor({ state: 'visible' });

// Terminal content comes through WebSocket - no need for complex waits
```

## Summary

1. **Never use `waitForTimeout()`** - always wait for specific conditions
2. **Use web-first assertions** that auto-wait
3. **Prefer semantic locators** over CSS selectors
4. **Wait for observable conditions** not arbitrary time
5. **Configure appropriate timeouts** for your application
6. **Keep tests isolated** and independent
7. **Use Playwright's built-in debugging tools** for flaky tests

By following these practices, tests will be more reliable, faster, and easier to maintain.

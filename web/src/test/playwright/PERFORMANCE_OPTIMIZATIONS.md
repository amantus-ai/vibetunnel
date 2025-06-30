# Playwright Test Performance Optimizations

This document summarizes the performance optimizations made to the Playwright test suite.

## Key Changes Made

### 1. Parallel Execution Enabled
- **File**: `playwright.config.ts`
- Changed `fullyParallel: false` → `true`
- Increased workers from 1 to 4 locally, 2 on CI
- Enables tests to run concurrently for ~4x speed improvement

### 2. Server Reuse
- **File**: `playwright.config.ts`
- Changed `reuseExistingServer: false` → `!process.env.CI`
- Reuses dev server between test runs locally
- Saves 10-30 seconds per test run

### 3. Optimized Page Fixture
- **File**: `src/test/playwright/fixtures/test.fixture.ts`
- Removed unnecessary page reload after localStorage changes
- Uses storage events to notify app of changes
- Saves ~1-2 seconds per test

### 4. Worker-Scoped Fixtures
- **File**: `src/test/playwright/fixtures/worker-fixtures.ts`
- Created shared API client at worker level
- Reduces setup overhead for API operations
- Enables efficient batch operations

### 5. Batch Operations
- **File**: `src/test/playwright/helpers/test-data-manager.helper.ts`
- Added `createTrackedSessionBatch()` for parallel session creation
- API-based cleanup for faster teardown
- Can create/delete multiple sessions in parallel

### 6. Optimized Wait Utilities
- **File**: `src/test/playwright/utils/wait-utils.ts`
- Consolidated wait patterns into reusable utilities
- Added parallel wait operations (`waitForAll`, `waitForAny`)
- Smart wait with exponential backoff

### 7. Test Sharding for CI
- **File**: `playwright.config.ts`
- Added shard configuration for distributed testing
- Example GitHub Actions workflow for 4-way sharding
- Can reduce CI test time by up to 75%

### 8. Modern Locator Patterns
- **File**: `src/test/playwright/examples/modern-locators.example.ts`
- Examples of resilient locator strategies
- Reduces test flakiness and maintenance

## Performance Impact

Expected improvements:
- **Local Development**: 3-4x faster test execution
- **CI Pipeline**: Up to 4x faster with sharding
- **Test Reliability**: Reduced flakiness with better wait strategies
- **Resource Usage**: More efficient with worker-scoped fixtures

## Usage Examples

### Running Tests Locally
```bash
# Run all tests in parallel
pnpm test:e2e

# Run specific test file
pnpm test:e2e session-management

# Run with specific workers
pnpm test:e2e --workers=8
```

### Using New Fixtures
```typescript
import { test, expect } from '../fixtures/session-fixture';

test('example with optimized fixtures', async ({ 
  page, 
  apiClient, 
  createAndNavigateToSession,
  sessionManager 
}) => {
  // Create session via fixture
  const { sessionId } = await createAndNavigateToSession();
  
  // Use batch operations
  const sessions = await apiClient.createSessionBatch(5);
  
  // Automatic cleanup handled by fixtures
});
```

### CI Configuration
```yaml
# In GitHub Actions
env:
  SHARD_INDEX: ${{ matrix.shardIndex }}
  TOTAL_SHARDS: 4
```

## Best Practices

1. **Use Worker Fixtures**: Share expensive resources across tests
2. **Batch Operations**: Create/delete multiple items in parallel
3. **Smart Waits**: Use `WaitUtils` instead of hard-coded timeouts
4. **Modern Locators**: Prefer `getByRole()` over CSS selectors
5. **Parallel-Safe Tests**: Ensure tests don't interfere with each other

## Monitoring Performance

Track test execution time:
```bash
# Generate timing report
pnpm test:e2e --reporter=json

# Analyze slowest tests
cat test-results/results.json | jq '.suites[].specs[] | select(.duration > 5000) | {title, duration}'
```
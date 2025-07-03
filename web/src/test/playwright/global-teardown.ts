import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  // End performance tracking
  console.timeEnd('Total test duration');

  // Any other cleanup tasks can go here
  console.log('Global teardown complete');
}

export default globalTeardown;

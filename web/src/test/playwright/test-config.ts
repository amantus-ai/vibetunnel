/**
 * Test configuration for Playwright tests
 */

export const testConfig = {
  // Port for the test server - separate from development server (3000)
  port: 4022,

  // Base URL constructed from port
  get baseURL() {
    return `http://localhost:${this.port}`;
  },

  // Timeouts - tuned for stability (Playwright fixture applies these as defaults)
  defaultTimeout: 10_000,
  navigationTimeout: 15_000,
  actionTimeout: 5_000,

  // Session defaults
  defaultSessionName: 'Test Session',
  hideExitedSessions: true,
};

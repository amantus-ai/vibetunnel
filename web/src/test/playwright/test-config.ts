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

  // Timeouts
  defaultTimeout: 5000,
  navigationTimeout: 10000,
  actionTimeout: 4000,

  // Session defaults
  defaultSessionName: 'Test Session',
  hideExitedSessions: true,
};

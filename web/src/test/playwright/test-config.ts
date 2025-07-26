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

  // Timeouts - Optimized for faster test execution
  defaultTimeout: 5000, // 5 seconds for default operations
  navigationTimeout: 5000, // 5 seconds for page navigation
  actionTimeout: 2000, // 2 seconds for UI actions

  // Session defaults
  defaultSessionName: 'Test Session',
  hideExitedSessions: true,
};

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

  // Timeouts - Reduced for faster test execution
  defaultTimeout: 10000, // 10 seconds for default operations
  navigationTimeout: 15000, // 15 seconds for page navigation
  actionTimeout: 5000, // 5 seconds for UI actions

  // Session defaults
  defaultSessionName: 'Test Session',
  hideExitedSessions: true,
};

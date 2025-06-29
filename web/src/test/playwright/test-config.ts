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
  defaultTimeout: 20000, // 20 seconds for default operations
  navigationTimeout: 30000, // 30 seconds for page navigation
  actionTimeout: 15000, // 15 seconds for UI actions

  // Session defaults
  defaultSessionName: 'Test Session',
  hideExitedSessions: true,
};

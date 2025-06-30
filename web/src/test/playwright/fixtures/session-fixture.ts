import { test as base } from '@playwright/test';
import { test as workerTest } from './worker-fixtures';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { SessionListPage } from '../pages/session-list.page';
import { SessionViewPage } from '../pages/session-view.page';

// Combine fixtures
const combinedTest = base.mergeTests(workerTest);

// Test-scoped fixtures that build on worker fixtures
export type SessionFixtures = {
  sessionManager: TestSessionManager;
  createAndNavigateToSession: (name?: string) => Promise<{ sessionId: string; sessionName: string }>;
  cleanupSession: (sessionId: string) => Promise<void>;
};

export const test = combinedTest.extend<SessionFixtures>({
  // Test-scoped session manager
  sessionManager: async ({ page }, use) => {
    const manager = new TestSessionManager(page);
    await use(manager);
    // Automatic cleanup after each test
    await manager.cleanupAllSessions();
  },
  
  // Helper to create session and navigate to it
  createAndNavigateToSession: async ({ page, apiClient, workerId }, use) => {
    const sessionsCreated: string[] = [];
    
    const helper = async (name?: string) => {
      const sessionName = name || `${workerId}-session-${Date.now()}`;
      const session = await apiClient.createSession(sessionName);
      sessionsCreated.push(session.id);
      
      // Navigate to session view
      await page.goto(`/sessions/${session.id}`);
      await page.waitForSelector('session-view', { state: 'visible' });
      
      return { sessionId: session.id, sessionName: session.name };
    };
    
    await use(helper);
    
    // Cleanup all sessions created by this fixture
    for (const id of sessionsCreated) {
      await apiClient.deleteSession(id).catch(() => {});
    }
  },
  
  // Helper for manual session cleanup
  cleanupSession: async ({ apiClient }, use) => {
    await use(async (sessionId: string) => {
      await apiClient.deleteSession(sessionId);
    });
  },
});

// Re-export page object fixtures from test.fixture.ts
export { test as baseTest } from '../fixtures/test.fixture';
export { expect } from '@playwright/test';
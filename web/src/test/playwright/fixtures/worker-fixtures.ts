import { test as base } from '@playwright/test';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// Worker-scoped fixtures for shared resources across tests
export type WorkerFixtures = {
  // Shared API client for direct API calls
  apiClient: {
    createSession: (name?: string) => Promise<{ id: string; name: string }>;
    deleteSession: (id: string) => Promise<void>;
    getSessions: () => Promise<Array<{ id: string; name: string; active: boolean }>>;
    createSessionBatch: (count: number, prefix?: string) => Promise<Array<{ id: string; name: string }>>;
  };
  
  // Worker ID for isolating test data
  workerId: string;
};

export const test = base.extend<{}, WorkerFixtures>({
  // Worker-scoped API client - shared across all tests in the worker
  apiClient: [async ({ baseURL }, use) => {
    const apiClient = {
      createSession: async (name?: string) => {
        const response = await fetch(`${baseURL}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name: name || `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            command: 'echo "test"'
          })
        });
        if (!response.ok) throw new Error(`Failed to create session: ${response.statusText}`);
        return response.json();
      },
      
      deleteSession: async (id: string) => {
        const response = await fetch(`${baseURL}/api/sessions/${id}`, {
          method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`Failed to delete session: ${response.statusText}`);
        }
      },
      
      getSessions: async () => {
        const response = await fetch(`${baseURL}/api/sessions`);
        if (!response.ok) throw new Error(`Failed to get sessions: ${response.statusText}`);
        return response.json();
      },
      
      createSessionBatch: async (count: number, prefix = 'batch') => {
        const promises = Array(count).fill(0).map((_, i) => 
          apiClient.createSession(`${prefix}-${i}-${Date.now()}`)
        );
        return Promise.all(promises);
      }
    };
    
    await use(apiClient);
  }, { scope: 'worker' }],
  
  // Worker ID for data isolation
  workerId: [async ({}, use, workerInfo) => {
    await use(`worker-${workerInfo.workerIndex}`);
  }, { scope: 'worker' }],
});
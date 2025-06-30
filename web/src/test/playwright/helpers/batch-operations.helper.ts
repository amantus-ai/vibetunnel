import type { Page } from '@playwright/test';
import type { SessionInfo } from '../types/session.types';

/**
 * Batch operations helper for efficient test setup/teardown
 * Reduces API call overhead in sequential tests
 */
export class BatchOperations {
  private page: Page;
  private baseUrl: string;

  constructor(page: Page) {
    this.page = page;
    this.baseUrl =
      page
        .url()
        .replace(/\/sessions.*$/, '')
        .replace(/\/$/, '') || 'http://localhost:4022';
  }

  /**
   * Create multiple sessions in a single batch
   */
  async createSessions(
    sessions: Array<{ name: string; command?: string }>
  ): Promise<Array<{ id: string; name: string; success: boolean; error?: string }>> {
    return this.page.evaluate(
      async ({ url, sessions }) => {
        const results = await Promise.allSettled(
          sessions.map(async (session) => {
            try {
              const response = await fetch(`${url}/api/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: session.name,
                  command: session.command || 'bash',
                }),
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              const data = await response.json();
              return { ...data, success: true };
            } catch (error) {
              return {
                id: '',
                name: session.name,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          })
        );

        return results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            return {
              id: '',
              name: sessions[index].name,
              success: false,
              error: result.reason?.message || 'Failed to create session',
            };
          }
        });
      },
      { url: this.baseUrl, sessions }
    );
  }

  /**
   * Delete multiple sessions in a single batch
   */
  async deleteSessions(
    sessionIds: string[]
  ): Promise<{ total: number; deleted: number; failed: number }> {
    if (sessionIds.length === 0) {
      return { total: 0, deleted: 0, failed: 0 };
    }

    const results = await this.page.evaluate(
      async ({ url, ids }) => {
        const results = await Promise.allSettled(
          ids.map((id) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' })
              .then((response) => ({ id, success: response.ok || response.status === 404 }))
              .catch(() => ({ id, success: false }))
          )
        );

        return results.map((r) => (r.status === 'fulfilled' ? r.value : { success: false }));
      },
      { url: this.baseUrl, ids: sessionIds }
    );

    const deleted = results.filter((r) => r.success).length;
    return {
      total: sessionIds.length,
      deleted,
      failed: sessionIds.length - deleted,
    };
  }

  /**
   * Send input to multiple sessions
   */
  async sendInputToSessions(
    inputs: Array<{ sessionId: string; data: string }>
  ): Promise<{ total: number; sent: number; failed: number }> {
    const results = await this.page.evaluate(
      async ({ url, inputs }) => {
        const results = await Promise.allSettled(
          inputs.map(async ({ sessionId, data }) => {
            try {
              const response = await fetch(`${url}/api/sessions/${sessionId}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
              });
              return { sessionId, success: response.ok };
            } catch {
              return { sessionId, success: false };
            }
          })
        );

        return results.map((r) => (r.status === 'fulfilled' ? r.value : { success: false }));
      },
      { url: this.baseUrl, inputs }
    );

    const sent = results.filter((r) => r.success).length;
    return {
      total: inputs.length,
      sent,
      failed: inputs.length - sent,
    };
  }

  /**
   * Resize multiple sessions
   */
  async resizeSessions(
    resizes: Array<{ sessionId: string; cols: number; rows: number }>
  ): Promise<{ total: number; resized: number; failed: number }> {
    const results = await this.page.evaluate(
      async ({ url, resizes }) => {
        const results = await Promise.allSettled(
          resizes.map(async ({ sessionId, cols, rows }) => {
            try {
              const response = await fetch(`${url}/api/sessions/${sessionId}/resize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cols, rows }),
              });
              return { sessionId, success: response.ok };
            } catch {
              return { sessionId, success: false };
            }
          })
        );

        return results.map((r) => (r.status === 'fulfilled' ? r.value : { success: false }));
      },
      { url: this.baseUrl, resizes }
    );

    const resized = results.filter((r) => r.success).length;
    return {
      total: resizes.length,
      resized,
      failed: resizes.length - resized,
    };
  }

  /**
   * Get all sessions with specific status
   */
  async getSessionsByStatus(status: 'RUNNING' | 'EXITED' | 'all' = 'all'): Promise<SessionInfo[]> {
    try {
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      if (status === 'all') {
        return sessions;
      }

      return sessions.filter((s: SessionInfo) => {
        if (status === 'RUNNING') {
          return s.active === true && s.status !== 'EXITED' && s.status !== 'EXIT';
        } else {
          return s.active === false || s.status === 'EXITED' || s.status === 'EXIT';
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Wait for sessions to reach a specific state
   */
  async waitForSessionsState(
    sessionIds: string[],
    expectedState: 'RUNNING' | 'EXITED',
    timeout = 5000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const sessions = await this.getSessionsByStatus('all');
      const targetSessions = sessions.filter((s) => sessionIds.includes(s.id));

      if (targetSessions.length === sessionIds.length) {
        const allMatch = targetSessions.every((s) => {
          if (expectedState === 'RUNNING') {
            return s.active === true && s.status !== 'EXITED';
          } else {
            return s.active === false || s.status === 'EXITED';
          }
        });

        if (allMatch) return true;
      }

      await this.page.waitForTimeout(100);
    }

    return false;
  }
}

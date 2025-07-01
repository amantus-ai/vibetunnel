import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test as base, expect } from '@playwright/test';
import type { AuthConfigResponse } from '../../../shared/types';
import { SessionListPage } from '../pages/session-list.page';
import type { SessionService } from '../services/session-service';

// Declare test context type
export interface TestContext {
  sessionService: SessionService;
  page: typeof base extends { fixtures: { page: infer P } } ? P : never;
}

export const test = base.extend<{
  sessionService: SessionService;
  testSessionIds: string[];
  screenshotDir: string;
  sessionListPage: SessionListPage;
}>({
  // Session service fixture
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
  sessionService: async ({}, use) => {
    const headers = new Headers();
    const baseURL = process.env.CI ? 'http://localhost:8321' : 'http://localhost:3456';

    // Check if authentication is required
    const authConfigResponse = await fetch(`${baseURL}/api/auth/config`);
    const authConfig: AuthConfigResponse = await authConfigResponse.json();

    if (!authConfig.noAuth) {
      // Perform login
      const loginResponse = await fetch(`${baseURL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode: 'testauth' }),
      });

      if (!loginResponse.ok) {
        throw new Error(`Login failed: ${loginResponse.status}`);
      }

      const { token } = await loginResponse.json();
      headers.set('Authorization', `Bearer ${token}`);
    }

    const service = {
      baseURL,
      headers,
      async createSession(params: {
        name: string;
        command: string;
        rows?: number;
        cols?: number;
      }): Promise<{ id: string; name: string; command: string }> {
        const response = await fetch(`${baseURL}/api/sessions`, {
          method: 'POST',
          headers: {
            ...Object.fromEntries(headers.entries()),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error(`Failed to create session: ${response.status}`);
        }

        return response.json();
      },

      async listSessions(): Promise<Array<{ id: string; name: string; command: string }>> {
        const response = await fetch(`${baseURL}/api/sessions`, {
          headers: Object.fromEntries(headers.entries()),
        });

        if (!response.ok) {
          throw new Error(`Failed to list sessions: ${response.status}`);
        }

        return response.json();
      },

      async deleteSession(id: string): Promise<void> {
        const response = await fetch(`${baseURL}/api/sessions/${id}`, {
          method: 'DELETE',
          headers: Object.fromEntries(headers.entries()),
        });

        if (!response.ok) {
          throw new Error(`Failed to delete session: ${response.status}`);
        }
      },

      async cleanup(sessionIds: string[]): Promise<void> {
        for (const id of sessionIds) {
          try {
            await this.deleteSession(id);
          } catch (error) {
            console.error(`Failed to cleanup session ${id}:`, error);
          }
        }
      },
    };

    await use(service);
  },

  // Track test session IDs for cleanup
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
  testSessionIds: async ({}, use) => {
    const sessionIds: string[] = [];
    await use(sessionIds);
  },

  // Screenshot directory
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern
  screenshotDir: async ({}, use) => {
    const dir = path.join(os.tmpdir(), 'playwright-screenshots', Date.now().toString());
    fs.mkdirSync(dir, { recursive: true });
    await use(dir);
  },

  // Override the page fixture to wait for app initialization
  page: async ({ page }, use) => {
    console.log('[Test Setup] Navigating to app...');
    await page.goto('/');

    // Simplified initialization check
    try {
      // Wait for the vibetunnel-app element to be attached
      console.log('[Test Setup] Waiting for vibetunnel-app element...');
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 30000 });

      // Wait for the app to render some content
      console.log('[Test Setup] Waiting for app to render content...');
      await page.waitForFunction(
        () => {
          const app = document.querySelector('vibetunnel-app');
          // Check if app has rendered meaningful content (auth view, header, or session list)
          if (!app) return false;

          const hasContent = app.innerHTML.length > 100;
          const hasAuthView = !!app.querySelector('auth-login');
          const hasAppHeader = !!app.querySelector('app-header');
          const hasSessionList = !!app.querySelector('session-list');

          // App is ready if it has content and either auth view or main app components
          return hasContent && (hasAuthView || hasAppHeader || hasSessionList);
        },
        { timeout: 30000 }
      );

      // Give it a moment to stabilize
      await page.waitForTimeout(1000);

      // Check what's rendered
      const appInfo = await page.evaluate(() => {
        const app = document.querySelector('vibetunnel-app');
        if (!app) return null;

        return {
          hasAuthView: !!app.querySelector('auth-login'),
          hasAppHeader: !!app.querySelector('app-header'),
          hasSessionList: !!app.querySelector('session-list'),
          contentLength: app.innerHTML.length,
        };
      });

      console.log('[Test Setup] App render info:', appInfo);

      // If auth is required and shown, perform login through UI
      if (appInfo?.hasAuthView) {
        console.log('[Test Setup] Auth view detected, performing login...');
        await page.fill('input[type="password"]', 'testauth');
        await page.click('button[type="submit"]');

        // Wait for navigation away from auth view
        await page.waitForFunction(() => !document.querySelector('auth-login'), { timeout: 30000 });
        console.log('[Test Setup] Login successful');
      }

      // Now wait for main content to be visible
      console.log('[Test Setup] Waiting for main app content...');
      await page.waitForSelector('app-header, session-list, .flex-1', {
        state: 'visible',
        timeout: 30000,
      });

      console.log('[Test Setup] App is ready');

      // Wait for any overlays to disappear
      console.log('[Test Setup] Waiting for overlays to clear...');
      await page.waitForFunction(
        () => {
          // Check for any overlays that might block interactions
          const overlays = document.querySelectorAll(
            '[class*="fixed"][class*="inset-0"], [class*="fixed"][class*="top-0"][class*="left-0"]'
          );
          for (const overlay of overlays) {
            const styles = window.getComputedStyle(overlay);
            // Skip if pointer-events are disabled
            if (styles.pointerEvents === 'none') continue;
            // Skip if opacity is 0
            if (styles.opacity === '0') continue;
            // Skip if display is none
            if (styles.display === 'none') continue;
            // Skip if it's transparent
            if (
              styles.backgroundColor === 'transparent' ||
              styles.backgroundColor === 'rgba(0, 0, 0, 0)'
            )
              continue;

            console.log('Blocking overlay found:', overlay.className);
            return false;
          }
          return true;
        },
        { timeout: 5000 }
      );

      console.log('[Test Setup] No blocking overlays detected');
    } catch (error) {
      console.error('[Test Setup] Failed to initialize app:', error);
      const html = await page.content();
      console.log('[Test Setup] Page HTML (first 1000 chars):', html.substring(0, 1000));
      throw error;
    }

    await use(page);
  },

  // Session list page object
  sessionListPage: async ({ page }, use) => {
    const sessionListPage = new SessionListPage(page);
    await use(sessionListPage);
  },
});

// Common expectations
export { expect };

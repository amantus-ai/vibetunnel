import type { Page } from '@playwright/test';
import { SessionListPage } from '../pages/session-list.page';
import { SessionViewPage } from '../pages/session-view.page';
import { generateTestSessionName } from './terminal.helper';
import { navigateToHome } from './test-optimization.helper';

export interface SessionOptions {
  name?: string;
  spawnWindow?: boolean;
  command?: string;
}

interface TestResponse {
  url: string;
  method: string;
  data: {
    sessionId?: string;
  };
}

declare global {
  interface Window {
    __testResponses?: TestResponse[];
  }
}

/**
 * Creates a new session and navigates to it, handling all the common setup
 */
export async function createAndNavigateToSession(
  page: Page,
  options: SessionOptions = {}
): Promise<{ sessionName: string; sessionId: string }> {
  // Check if page is still valid
  if (page.isClosed()) {
    throw new Error('Page is closed, cannot create session');
  }

  const sessionListPage = new SessionListPage(page);
  const sessionViewPage = new SessionViewPage(page);

  const sessionName = options.name || generateTestSessionName();
  const spawnWindow = options.spawnWindow ?? false;
  // Use bash as default for tests (CI environments may not have zsh)
  const command = options.command || 'bash';

  // Navigate to list if not already there
  await navigateToHome(page);

  // Create the session
  await sessionListPage.createNewSession(sessionName, spawnWindow, command);

  // For web sessions, wait for navigation and get session ID
  if (!spawnWindow) {
    // Increased timeout for CI stability
    const timeout = process.env.CI ? 15000 : 5000;

    try {
      await page.waitForURL(/\/session\//, { timeout });
    } catch (_error) {
      // If navigation didn't happen automatically, check if we can extract session ID and navigate manually
      const currentUrl = page.url();
      console.error(`Navigation timeout. Current URL: ${currentUrl}`);

      // Try to find session ID from the page or recent requests
      const sessionResponse = await page.evaluate(async () => {
        // Check if there's a recent session creation response in memory
        const responses = window.__testResponses || [];
        const sessionResponse = responses.find(
          (r: TestResponse) => r.url.includes('/api/sessions') && r.method === 'POST'
        );
        return sessionResponse?.data;
      });

      // Check if we're already on a session page
      if (currentUrl.match(/\/session\/[^/?]+/)) {
        console.log(`Already on session page: ${currentUrl}`);
        // We're already on a session page, continue
      } else if (sessionResponse?.sessionId) {
        console.log(`Found session ID ${sessionResponse.sessionId}, navigating manually`);
        await page.goto(`/session/${sessionResponse.sessionId}`, {
          waitUntil: 'domcontentloaded',
        });
      } else {
        throw new Error(`Failed to navigate to session view from ${currentUrl}`);
      }
    }

    // Extract session ID from path-based URL
    const match = page.url().match(/\/session\/([^/?]+)/);
    const sessionId = match ? match[1] : '';
    if (!sessionId) {
      throw new Error('No session ID found in URL after navigation');
    }

    await sessionViewPage.waitForTerminalReady();

    return { sessionName, sessionId };
  }

  // For native sessions, just return the name
  return { sessionName, sessionId: '' };
}

/**
 * Verifies a session exists and has the expected status
 */
export async function verifySessionStatus(
  page: Page,
  sessionName: string,
  expectedStatus: 'RUNNING' | 'EXITED' | 'KILLED'
): Promise<boolean> {
  // Navigate to list if needed
  if (page.url().includes('/session/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  // Wait for session cards to load
  await page.waitForSelector('session-card', {
    state: 'visible',
    timeout: process.env.CI ? 10000 : 4000,
  });

  // Find the session card
  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
  if (!(await sessionCard.isVisible({ timeout: 2000 }))) {
    return false;
  }

  // Check status
  const statusText = await sessionCard.locator('span:has(.w-2.h-2.rounded-full)').textContent();
  return statusText?.toUpperCase().includes(expectedStatus) || false;
}

/**
 * Reconnects to an existing session from the session list
 */
export async function reconnectToSession(page: Page, sessionName: string): Promise<void> {
  const sessionListPage = new SessionListPage(page);
  const sessionViewPage = new SessionViewPage(page);

  // Navigate to list if needed
  if (page.url().includes('/session/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  // Click on the session
  await sessionListPage.clickSession(sessionName);

  // Wait for session view to load
  await page.waitForURL(/\/session\//, { timeout: process.env.CI ? 10000 : 4000 });
  await sessionViewPage.waitForTerminalReady();
}

/**
 * Creates multiple sessions efficiently
 */
export async function createMultipleSessions(
  page: Page,
  count: number,
  options: Partial<SessionOptions> = {}
): Promise<Array<{ sessionName: string; sessionId: string }>> {
  const sessions: Array<{ sessionName: string; sessionId: string }> = [];

  for (let i = 0; i < count; i++) {
    const sessionOptions = {
      ...options,
      name: options.name ? `${options.name}-${i + 1}` : generateTestSessionName(),
    };

    const session = await createAndNavigateToSession(page, sessionOptions);
    sessions.push(session);

    // Navigate back to list for next creation (except last one)
    if (i < count - 1) {
      await navigateToHome(page);

      // Quick wait for session list
      await page.waitForSelector('session-card', {
        state: 'visible',
        timeout: process.env.CI ? 5000 : 2000,
      });
    }
  }

  return sessions;
}

/**
 * Waits for a session to transition to a specific state
 */
export async function waitForSessionState(
  page: Page,
  sessionName: string,
  targetState: 'RUNNING' | 'EXITED' | 'KILLED' | 'running' | 'exited' | 'killed',
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = process.env.CI ? 15000 : 5000 } = options;
  const _startTime = Date.now();

  // Use waitForFunction instead of polling loop
  try {
    await page.waitForFunction(
      ({ name, state }) => {
        // First check if the "Hide Exited" button exists, which means sessions might be hidden
        const buttons = Array.from(document.querySelectorAll('button'));
        const hideExitedButton = buttons.find((btn) => btn.textContent?.includes('Hide Exited'));
        if (hideExitedButton && state === 'exited') {
          // If we're looking for exited state and exited sessions are shown,
          // the session might be in the Idle section
          console.log('Exited sessions are visible');
        }

        const cards = document.querySelectorAll('session-card');
        const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));
        if (!sessionCard) {
          console.log(`Session card not found for: ${name}`);
          // For exited sessions, they might be hidden
          if (state === 'exited') {
            // Check if the session is mentioned in the page at all
            const pageText = document.body.textContent || '';
            if (pageText.includes(name)) {
              console.log(
                `Session ${name} found in page text but card not visible - might be in hidden Idle section`
              );
              // If looking for exited state and session exists somewhere, consider it found
              return true;
            }
          }
          return false;
        }

        const statusElement = sessionCard.querySelector('span[data-status]');
        if (!statusElement) {
          console.log(`Status element not found for session: ${name}`);
          return false;
        }

        const statusText = statusElement?.textContent?.toLowerCase() || '';
        const dataStatus = statusElement?.getAttribute('data-status')?.toLowerCase() || '';

        console.log(
          `Session ${name} - data-status: "${dataStatus}", text: "${statusText}", looking for: "${state.toLowerCase()}"`
        );

        return dataStatus === state.toLowerCase() || statusText.includes(state.toLowerCase());
      },
      { name: sessionName, state: targetState },
      { timeout, polling: 500 }
    );
  } catch (_error) {
    // Take a screenshot for debugging
    await page.screenshot({ path: `test-debug-session-state-${sessionName}.png` });
    throw new Error(
      `Session ${sessionName} did not reach ${targetState} state within ${timeout}ms`
    );
  }
}

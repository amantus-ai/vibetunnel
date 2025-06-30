import type { Page } from '@playwright/test';
import { SessionListPage } from '../pages/session-list.page';
import { SessionViewPage } from '../pages/session-view.page';
import { generateTestSessionName } from './terminal.helper';

export interface SessionOptions {
  name?: string;
  spawnWindow?: boolean;
  command?: string;
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
  // Always use bash for tests for consistency
  const command = options.command || 'bash';

  // Navigate to list if not already there
  if (!page.url().endsWith('/')) {
    await sessionListPage.navigate();
  }

  // Create the session
  await sessionListPage.createNewSession(sessionName, spawnWindow, command);

  // For web sessions, wait for navigation and get session ID
  if (!spawnWindow) {
    await page.waitForURL(/\?session=/, { timeout: 4000 });
    const sessionId = new URL(page.url()).searchParams.get('session') || '';
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
  if (page.url().includes('?session=')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  // Wait for session cards to load
  await page.waitForSelector('session-card', { state: 'visible', timeout: 4000 });

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
  if (page.url().includes('?session=')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  // Click on the session
  await sessionListPage.clickSession(sessionName);

  // Wait for session view to load
  await page.waitForURL(/\?session=/, { timeout: 4000 });
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
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      // Wait for app to be ready before creating next session
      await page.waitForSelector('button[title="Create New Session"]', {
        state: 'visible',
        timeout: 10000,
      });
      // Add a small delay to avoid race conditions
      await page.waitForTimeout(500);
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
  targetState: 'RUNNING' | 'EXITED' | 'KILLED',
  timeout = 5000
): Promise<void> {
  const _startTime = Date.now();

  // Use waitForFunction instead of polling loop
  try {
    await page.waitForFunction(
      ({ name, state }) => {
        const cards = document.querySelectorAll('session-card');
        const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));
        if (!sessionCard) return false;

        const statusElement = sessionCard.querySelector('span[data-status]');
        const statusText = statusElement?.textContent?.toLowerCase() || '';
        const dataStatus = statusElement?.getAttribute('data-status')?.toLowerCase() || '';

        return dataStatus === state.toLowerCase() || statusText.includes(state.toLowerCase());
      },
      { name: sessionName, state: targetState },
      { timeout, polling: 500 }
    );
  } catch (_error) {
    throw new Error(
      `Session ${sessionName} did not reach ${targetState} state within ${timeout}ms`
    );
  }
}

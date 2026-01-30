import { TIMEOUTS } from '../constants/timeouts';
import { screenshotOnError } from '../helpers/screenshot.helper';
import { TestSessionTracker } from '../helpers/test-session-tracker';
import { validateCommand, validateSessionName } from '../utils/validation.utils';
import { BasePage } from './base.page';

/**
 * Page object for the session list view, handling terminal session management operations.
 *
 * This class provides methods for interacting with the main session list interface,
 * including creating new sessions, managing existing sessions, and navigating between
 * session cards. It handles both web-based sessions and Mac app spawn window sessions,
 * with support for modal interactions and form validation.
 *
 * Key features:
 * - Session creation with configurable options (name, command, spawn window)
 * - Session card interaction (click, kill, status checking)
 * - Modal management for the create session dialog
 * - Support for both web and native Mac app features
 *
 * @example
 * ```typescript
 * // Create a new session
 * const sessionList = new SessionListPage(page);
 * await sessionList.navigate();
 * await sessionList.createNewSession('My Test Session', false, 'echo "Hello"');
 *
 * // Interact with existing sessions
 * await sessionList.clickSession('My Test Session');
 * const isActive = await sessionList.isSessionActive('My Test Session');
 * await sessionList.killSession('My Test Session');
 * ```
 */
export class SessionListPage extends BasePage {
  // Selectors
  private readonly selectors = {
    createButton: '[data-testid="create-session-button"]',
    createButtonFallback: 'button[title="Create New Session"]',
    createButtonFallbackWithShortcut: 'button[title="Create New Session (⌘K)"]',
    sessionNameInput: '[data-testid="session-name-input"]',
    commandInput: '[data-testid="command-input"]',
    workingDirInput: '[data-testid="working-dir-input"]',
    submitButton: '[data-testid="create-session-submit"]',
    sessionCard: 'session-card',
    modal: 'text="New Session"',
    noSessionsMessage: 'text="No active sessions"',
  };
  async navigate() {
    await super.navigate('/');
    await this.waitForLoadComplete();

    // Ensure we can interact with the page
    await this.dismissErrors();

    // Wait for create button to be clickable
    // The button is in the sidebar header, so we need to ensure the sidebar is visible
    const createBtn = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback))
      .or(this.page.locator(this.selectors.createButtonFallbackWithShortcut))
      .first();

    try {
      await createBtn.waitFor({ state: 'visible', timeout: process.env.CI ? 15000 : 10000 });
    } catch (_error) {
      // If button is not visible, the sidebar might be collapsed or not loaded
      console.log('Create button not immediately visible, checking sidebar state...');

      // Check if sidebar exists
      const sidebar = await this.page.locator('sidebar-header').count();
      console.log(`Sidebar header count: ${sidebar}`);

      // Take a screenshot for debugging
      await this.page.screenshot({ path: 'test-results/create-button-not-visible.png' });

      throw new Error(`Create button not visible after navigation. Sidebar count: ${sidebar}`);
    }
  }

  async createNewSession(sessionName?: string, spawnWindow = false, command?: string) {
    // Clear localStorage first for test isolation
    await this.page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.warn('Could not clear storage:', e);
      }
    });

    // IMPORTANT: Set the spawn window preference in localStorage BEFORE opening the modal
    // This ensures the form loads with the correct state
    await this.page.evaluate((shouldSpawnWindow) => {
      // Set the spawn window value we want
      localStorage.setItem('vibetunnel_spawn_window', String(shouldSpawnWindow));
    }, spawnWindow);

    // Dismiss any error messages
    await this.dismissErrors();

    // Add a small delay to ensure localStorage changes are processed
    await this.page.waitForTimeout(100);

    // Click the create session button
    // Try to find the create button in different possible locations
    const createButton = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback))
      .or(this.page.locator(this.selectors.createButtonFallbackWithShortcut))
      .first(); // Use first() in case there are multiple buttons

    try {
      // Wait for button to be visible and stable before clicking
      await createButton.waitFor({ state: 'visible', timeout: process.env.CI ? 10000 : 5000 });

      // Add a small delay to ensure page is stable
      await this.page.waitForTimeout(500);

      // Try regular click first, then force click if needed
      try {
        await createButton.click({ timeout: process.env.CI ? 10000 : 5000 });
      } catch (_clickError) {
        // If regular click fails, try force click
        await createButton.click({ force: true, timeout: process.env.CI ? 10000 : 5000 });
      }

      // Wait for modal to exist first
      await this.page.waitForSelector('session-create-form', {
        state: 'attached',
        timeout: process.env.CI ? 15000 : 10000,
      });

      // Wait for the session name input to be visible - this is what we actually need
      // This approach is more reliable than waiting for the modal wrapper
      await this.page.waitForSelector('[data-testid="session-name-input"]', {
        state: 'visible',
        timeout: process.env.CI ? 20000 : 15000,
      });

      // Additional wait to ensure modal is fully interactive
      await this.page.waitForTimeout(200);
    } catch (error) {
      console.error('Failed to click create button:', error);
      await screenshotOnError(
        this.page,
        new Error('Failed to click create button'),
        'create-button-click-failed'
      );
      throw error;
    }

    // Modal text might not be visible due to view transitions, skip this check

    // Wait for modal to be fully interactive
    await this.page.waitForFunction(
      () => {
        const modalForm = document.querySelector('session-create-form');
        if (!modalForm) return false;

        const input = document.querySelector(
          '[data-testid="session-name-input"], input[placeholder="My Session"]'
        ) as HTMLInputElement;
        // Check that input exists, is visible, and is not disabled
        return input && !input.disabled && input.offsetParent !== null;
      },
      undefined,
      { timeout: TIMEOUTS.UI_UPDATE }
    );

    // Now wait for the session name input to be visible AND stable
    let inputSelector: string;
    try {
      await this.page.waitForSelector('[data-testid="session-name-input"]', {
        state: 'visible',
        timeout: process.env.CI ? 10000 : 5000,
      });
      inputSelector = '[data-testid="session-name-input"]';
    } catch {
      // Fallback to placeholder if data-testid is not found
      await this.page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: process.env.CI ? 10000 : 5000,
      });
      inputSelector = 'input[placeholder="My Session"]';
    }

    // Extra wait to ensure the input is ready for interaction
    await this.page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        return input && !input.disabled && input.offsetParent !== null;
      },
      inputSelector,
      { timeout: 2000 }
    );

    // Only check spawn window toggle if it exists (Mac app connected)
    // First need to expand the options section as toggle is now inside a collapsible options area
    try {
      const optionsButton = this.page.locator('#session-options-button');

      // Options button should always exist in current UI
      await optionsButton.waitFor({ state: 'visible', timeout: 3000 });
      await optionsButton.click();
      await this.page.waitForTimeout(300); // Wait for expansion animation

      // Now look for the spawn window toggle
      const spawnWindowToggle = this.page.locator('[data-testid="spawn-window-toggle"]');

      const toggleExists = (await spawnWindowToggle.count()) > 0;

      if (toggleExists) {
        // Wait for the toggle to be visible after expansion
        await spawnWindowToggle.waitFor({ state: 'visible', timeout: 2000 });

        // Verify the state matches what we expect
        const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';

        // If the state doesn't match, there's an issue with localStorage loading
        if (isSpawnWindowOn !== spawnWindow) {
          console.warn(
            `WARNING: Spawn window toggle state mismatch! Expected ${spawnWindow} but got ${isSpawnWindowOn}`
          );
          // Try clicking to correct it
          await spawnWindowToggle.click();
          await this.page.waitForTimeout(200);
        }
      } else if (spawnWindow) {
        // User requested spawn window but Mac app is not connected
        console.log(
          'INFO: Spawn window requested but Mac app is not connected - toggle not available'
        );
      }
    } catch (error) {
      // Log but don't fail the test if spawn window toggle check fails
      console.log('INFO: Spawn window toggle check skipped:', error);
    }

    // Fill in the session name if provided
    if (sessionName) {
      // Validate session name for security
      validateSessionName(sessionName);

      // Use the selector we found earlier - use force: true to bypass visibility checks
      try {
        await this.page.fill(inputSelector, sessionName, { timeout: 3000, force: true });
      } catch (e) {
        const error = new Error(`Could not fill session name field: ${e}`);
        await screenshotOnError(this.page, error, 'fill-session-name-error');

        // Check if the page is still valid
        try {
          const url = await this.page.url();
          console.log('Current URL:', url);
          const title = await this.page.title();
          console.log('Page title:', title);
        } catch (pageError) {
          console.error('Page appears to be closed:', pageError);
        }

        throw error;
      }
    }

    // Fill in the working directory for CI environments
    if (process.env.CI) {
      try {
        // Use a temp directory for CI to ensure PTY can spawn properly
        const tempDir = require('os').tmpdir();
        await this.page.fill('[data-testid="working-dir-input"]', tempDir, { force: true });
      } catch {
        // Working dir input might not exist in all forms
      }
    }

    // Fill in the command if provided
    if (command) {
      // Validate command for security
      validateCommand(command);

      try {
        await this.page.fill('[data-testid="command-input"]', command, { force: true });
      } catch {
        // Check if page is still valid before trying fallback
        if (this.page.isClosed()) {
          throw new Error('Page was closed unexpectedly');
        }
        // Fallback to placeholder selector
        try {
          await this.page.fill('input[placeholder="zsh"]', command, { force: true });
        } catch (fallbackError) {
          console.error('Failed to fill command input:', fallbackError);
          throw fallbackError;
        }
      }
    }

    // Ensure form is ready for submission
    await this.page.waitForFunction(
      () => {
        // Find the Create button using standard DOM methods
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitButton = buttons.find((btn) => btn.textContent?.includes('Create'));
        // The form is ready if the Create button exists and is not disabled
        // Name is optional, so we don't check for it
        return submitButton && !submitButton.hasAttribute('disabled');
      },
      undefined,
      { timeout: 2000 }
    );

    // Submit the form - click the Create button
    const submitButton = this.page
      .locator('[data-testid="create-session-submit"]')
      .or(this.page.locator('button:has-text("Create")'));

    // Make sure button is not disabled
    await submitButton.waitFor({ state: 'visible', timeout: process.env.CI ? 10000 : 5000 });
    const isDisabled = await submitButton.isDisabled();
    if (isDisabled) {
      throw new Error('Create button is disabled - form may not be valid');
    }

    // Click and wait for response

    // Also log any console errors from the page
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text());
      }
    });

    // Click the submit button and wait for response
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (response) => {
          const isSessionEndpoint = response.url().includes('/api/sessions');
          const isPost = response.request().method() === 'POST';
          return isSessionEndpoint && isPost;
        },
        { timeout: 20000 } // Increased timeout for CI
      ),
      submitButton.click({ timeout: process.env.CI ? 10000 : 5000 }),
    ]);

    // Wait for navigation to session view (only for web sessions)
    if (!spawnWindow) {
      let sessionId: string | undefined;

      try {
        if (response) {
          if (response.status() !== 201 && response.status() !== 200) {
            const body = await response.text();
            console.error(`Session creation failed with status ${response.status()}: ${body}`);
            throw new Error(`Session creation failed with status ${response.status()}: ${body}`);
          }

          // Get session ID from response
          const responseBody = await response.json();
          sessionId = responseBody.sessionId;

          // Log if session ID is missing
          if (!sessionId) {
            console.error('Session created but no sessionId in response:', responseBody);
          } else {
            // Track this session for cleanup
            TestSessionTracker.getInstance().trackSession(sessionId);
            console.log(`Web session created, waiting for navigation to session view...`);
          }
        } else {
          // Check if a session was actually created by looking for it in the DOM
          const _createdSession = await this.page.evaluate((name) => {
            const cards = document.querySelectorAll('session-card');
            for (const card of cards) {
              if (card.textContent?.includes(name)) {
                return true;
              }
            }
            return false;
          }, sessionName);
        }
      } catch (error) {
        console.error('Error waiting for session response:', error);
        // Don't throw yet, check if we navigated anyway
      }

      // Wait for the session to appear in the app's session list before navigation
      // This is important to avoid race conditions where we navigate before the app knows about the session
      if (sessionId) {
        await this.page.waitForFunction(
          ({ id }) => {
            // Check if the app has loaded this session
            const app = document.querySelector('vibetunnel-app') as HTMLElement & {
              sessions?: Array<{ id: string }>;
            };
            if (app?.sessions) {
              return app.sessions.some((s) => s.id === id);
            }
            return false;
          },
          { id: sessionId },
          { timeout: 10000, polling: 100 }
        );

        // Brief wait for session to appear
        await this.page.waitForTimeout(200);
      } else {
        // Brief wait for processing
        await this.page.waitForTimeout(500);
      }

      // Wait for modal to close - check if the form's visible property is false
      await this.page
        .waitForFunction(
          () => {
            const form = document.querySelector('session-create-form');
            // Modal is closed if form doesn't exist or visible is false
            return (
              !form || !form.hasAttribute('visible') || form.getAttribute('visible') === 'false'
            );
          },
          undefined,
          { timeout: 10000 }
        )
        .catch(async (error) => {
          // Log current state for debugging
          const modalState = await this.page.evaluate(() => {
            const form = document.querySelector('session-create-form');
            return {
              exists: !!form,
              visible: form?.getAttribute('visible'),
              dataModalState: form?.getAttribute('data-modal-state'),
              hasVisibleAttribute: form?.hasAttribute('visible'),
            };
          });
          console.error('Modal did not close. Current state:', modalState);
          throw error;
        });

      // Check if we're already on the session page
      const currentUrl = this.page.url();
      if (currentUrl.includes('/session/')) {
        // Already on session page, do nothing
      } else {
        // If we have a session ID, navigate to the session page
        if (sessionId) {
          await this.page.goto(`/session/${sessionId}`, {
            waitUntil: 'domcontentloaded',
            timeout: process.env.CI ? 30000 : 15000, // Increase timeout for CI
          });
        } else {
          // Wait for automatic navigation
          try {
            await this.page.waitForURL(/\/session\//, { timeout: process.env.CI ? 15000 : 10000 });
          } catch (error) {
            const finalUrl = this.page.url();
            console.error(`Failed to navigate to session. Current URL: ${finalUrl}`);
            // Take a screenshot
            await screenshotOnError(
              this.page,
              new Error(`Navigation timeout. URL: ${finalUrl}`),
              'session-navigation-timeout'
            );
            throw error;
          }
        }
      }

      // Debug: Log current URL and page state
      const debugUrl = this.page.url();
      console.log(`[DEBUG] Current URL after navigation: ${debugUrl}`);

      // Wait for the session view to be properly rendered with session data
      await this.page.waitForFunction(
        () => {
          const sessionView = document.querySelector('session-view') as HTMLElement & {
            session?: { id: string };
            shadowRoot?: ShadowRoot;
          };
          if (!sessionView) return false;

          // Check if session-view has the session prop set
          if (!sessionView.session) return false;

          // Check if loading animation is complete
          const loadingElement = sessionView.shadowRoot?.querySelector('.text-2xl');
          if (loadingElement?.textContent?.includes('Loading')) {
            return false;
          }

          // Session view is ready
          return true;
        },
        undefined,
        { timeout: process.env.CI ? 20000 : 15000, polling: 100 }
      );

      // Debug: Check if session view component exists
      const sessionViewExists = await this.page.evaluate(() => {
        const sessionView = document.querySelector('session-view') as HTMLElement & {
          session?: { id: string };
        };
        return {
          exists: !!sessionView,
          visible: sessionView ? window.getComputedStyle(sessionView).display !== 'none' : false,
          hasSession: !!sessionView?.session,
          sessionId: sessionView?.session?.id,
        };
      });
      console.log('[DEBUG] Session view state:', sessionViewExists);

      // Wait for terminal-renderer to be visible first
      await this.page.waitForSelector('#session-terminal', {
        state: 'visible',
        timeout: process.env.CI ? 15000 : 10000,
      });

      // Then wait for the actual terminal component inside to be visible
      await this.page.waitForSelector('#session-terminal vibe-terminal', {
        state: 'visible',
        timeout: process.env.CI ? 15000 : 10000,
      });
    } else {
      // For spawn window, wait for modal to close
      await this.page.waitForSelector('.modal-content', { state: 'hidden', timeout: 4000 });
    }
  }

  async getSessionCards() {
    // Use the element name instead of data-testid
    const cards = await this.page.locator('session-card').all();
    return cards;
  }

  async clickSession(sessionName: string) {
    // First ensure we're on the session list page
    if (this.page.url().includes('/session/')) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('domcontentloaded');
    }

    // Wait for session cards to load
    await this.page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
      },
      undefined,
      { timeout: process.env.CI ? 15000 : 10000 }
    );

    // Check if we have any session cards
    const cardCount = await this.getSessionCount();
    if (cardCount === 0) {
      throw new Error('No session cards found on the page');
    }

    // Look for the specific session card
    const sessionCard = (await this.getSessionCard(sessionName)).first();

    // Wait for the specific session card to be visible
    await sessionCard.waitFor({ state: 'visible', timeout: process.env.CI ? 15000 : 10000 });

    // Scroll into view if needed
    await sessionCard.scrollIntoViewIfNeeded();

    // Click on the session card
    await sessionCard.click();

    // Wait for navigation to session view
    await this.page.waitForURL(/\/session\//, { timeout: process.env.CI ? 10000 : 5000 });
  }

  async isSessionActive(sessionName: string): Promise<boolean> {
    const sessionCard = await this.getSessionCard(sessionName);
    // Look for the status text in the footer area
    const statusText = await sessionCard.locator('span:has(.w-2.h-2.rounded-full)').textContent();
    // Sessions show "RUNNING" when active, not "active"
    return statusText?.toLowerCase() === 'running' || false;
  }

  async killSession(sessionName: string) {
    // Ensure no modal is blocking interaction
    await this.closeAnyOpenModal();

    // First check if the session card exists
    const sessionCardCount = await this.page
      .locator(`session-card:has-text("${sessionName}")`)
      .count();
    if (sessionCardCount === 0) {
      // Session already removed, nothing to do
      return;
    }

    const sessionCard = await this.getSessionCard(sessionName);

    // Wait for the session card to be visible
    try {
      await sessionCard.waitFor({ state: 'visible', timeout: 4000 });
    } catch {
      // Session might have been removed already
      return;
    }

    // The kill button should have data-testid="kill-session-button"
    const killButton = sessionCard.locator('[data-testid="kill-session-button"]');

    // Check if button exists before trying to interact
    const buttonCount = await killButton.count();
    if (buttonCount === 0) {
      // Button not found, session might already be killed
      return;
    }

    // Wait for the button to be visible and enabled
    await killButton.waitFor({ state: 'visible', timeout: 4000 });

    // Only scroll if element is still attached
    try {
      await killButton.scrollIntoViewIfNeeded();
    } catch {
      // Element might have been removed, check again
      if ((await killButton.count()) === 0) {
        return;
      }
    }

    // Set up dialog handler BEFORE clicking to avoid race condition
    // But use Promise.race to handle cases where no dialog appears
    const dialogPromise = this.page.waitForEvent('dialog', { timeout: 2000 });

    // Click the button (this might or might not trigger a dialog)
    // Use force:true to bypass any overlapping elements like sticky footers
    const clickPromise = killButton.click({ force: true });

    // Wait for either dialog or click to complete
    try {
      // Try to handle dialog if it appears
      const dialog = await Promise.race([
        dialogPromise,
        // Also wait a bit to see if dialog will appear
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      if (dialog) {
        await dialog.accept();
      }
    } catch {
      // No dialog appeared, which is fine
    }

    // Wait for the click action to complete
    await clickPromise;
  }

  async waitForEmptyState() {
    await this.page.waitForSelector(this.selectors.noSessionsMessage, { timeout: 4000 });
  }

  async getSessionCount(): Promise<number> {
    const cards = this.page.locator(this.selectors.sessionCard);
    return cards.count();
  }

  async waitForSessionCard(sessionName: string, options?: { timeout?: number }) {
    await this.page.waitForSelector(`${this.selectors.sessionCard}:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: options?.timeout || 5000,
    });
  }

  async getSessionCard(sessionName: string) {
    return this.page.locator(`${this.selectors.sessionCard}:has-text("${sessionName}")`);
  }

  async closeAnyOpenModal() {
    try {
      // Check for multiple modal selectors
      const modalSelectors = ['.modal-content', '[role="dialog"]', '.modal-positioned'];

      for (const selector of modalSelectors) {
        const modal = this.page.locator(selector).first();
        if (await modal.isVisible({ timeout: 500 })) {
          console.log(`Found open modal with selector: ${selector}`);

          // First try Escape key (most reliable)
          await this.page.keyboard.press('Escape');

          // Wait for modal animation to complete
          await this.page.waitForFunction(
            () => {
              const modal = document.querySelector('[role="dialog"], .modal');
              return (
                !modal ||
                getComputedStyle(modal).opacity === '0' ||
                getComputedStyle(modal).display === 'none'
              );
            },
            undefined,
            { timeout: TIMEOUTS.UI_ANIMATION }
          );

          // Check if modal is still visible
          if (await modal.isVisible({ timeout: 500 })) {
            console.log('Escape key did not close modal, trying close button');
            // Try to close via cancel button or X button
            const closeButton = this.page
              .locator('button[aria-label="Close modal"]')
              .or(this.page.locator('button:has-text("Cancel")'))
              .or(this.page.locator('.modal-content button:has(svg)'))
              .first();

            if (await closeButton.isVisible({ timeout: 500 })) {
              await closeButton.click({ force: true });
            }
          }

          // Wait for modal to disappear
          await this.page.waitForSelector(selector, { state: 'hidden', timeout: 2000 });
          console.log(`Successfully closed modal with selector: ${selector}`);
        }
      }
    } catch (_error) {
      // Modal might not exist or already closed, which is fine
      console.log('No modal to close or already closed');
    }
  }

  async closeAnyOpenModals() {
    // Alias for backward compatibility
    await this.closeAnyOpenModal();
  }
}

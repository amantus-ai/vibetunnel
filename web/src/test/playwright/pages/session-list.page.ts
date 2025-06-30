import { screenshotOnError } from '../helpers/screenshot.helper';
import { BasePage } from './base.page';

export class SessionListPage extends BasePage {
  // Selectors
  private readonly selectors = {
    createButton: '[data-testid="create-session-button"]',
    createButtonFallback: 'button[title="Create New Session"]',
    sessionNameInput: '[data-testid="session-name-input"]',
    commandInput: '[data-testid="command-input"]',
    workingDirInput: '[data-testid="working-dir-input"]',
    submitButton: '[data-testid="create-session-submit"]',
    sessionCard: 'session-card',
    modal: '.modal-content',
    noSessionsMessage: 'text="No active sessions"',
  };
  async navigate() {
    await super.navigate('/');
    await this.waitForLoadComplete();

    // Ensure we can interact with the page
    await this.dismissErrors();

    // Wait for create button to be clickable
    const createBtn = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback));
    await createBtn.waitFor({ state: 'visible', timeout: 5000 });
  }

  async createNewSession(sessionName?: string, spawnWindow = false, command?: string) {
    console.log(`Creating session: name="${sessionName}", spawnWindow=${spawnWindow}`);

    // Dismiss any error messages
    await this.dismissErrors();

    // Click the create session button
    const createButton = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback));

    console.log('Clicking create session button...');
    try {
      await createButton.click({ timeout: 5000 });
      console.log('Create button clicked successfully');
    } catch (error) {
      console.error('Failed to click create button:', error);
      await screenshotOnError(
        this.page,
        new Error('Failed to click create button'),
        'create-button-click-failed'
      );
      throw error;
    }

    // Wait for the modal to appear and be ready
    try {
      await this.page.waitForSelector(this.selectors.modal, { state: 'visible', timeout: 4000 });
    } catch (_e) {
      const error = new Error('Modal did not appear after clicking create button');
      await screenshotOnError(this.page, error, 'no-modal-after-click');
      throw error;
    }

    // Wait for modal to be fully rendered and interactive
    await this.page.waitForFunction(
      () => {
        const modal = document.querySelector('.modal-content');
        return modal && modal.getBoundingClientRect().width > 0;
      },
      { timeout: 2000 }
    );

    // Now wait for the session name input to be visible AND stable
    let inputSelector: string;
    try {
      await this.page.waitForSelector('[data-testid="session-name-input"]', {
        state: 'visible',
        timeout: 2000,
      });
      inputSelector = '[data-testid="session-name-input"]';
    } catch {
      // Fallback to placeholder if data-testid is not found
      await this.page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: 2000,
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

    // IMPORTANT: Set spawn window toggle to create web sessions, not native terminals
    let spawnWindowToggle = this.page.locator('[data-testid="spawn-window-toggle"]');

    // Check if toggle exists with data-testid, if not use role selector
    if (!(await spawnWindowToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
      spawnWindowToggle = this.page.locator('button[role="switch"]');
    }

    // Wait for the toggle to be ready
    await spawnWindowToggle.waitFor({ state: 'visible', timeout: 2000 });

    const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';

    // If current state doesn't match desired state, click to toggle
    if (isSpawnWindowOn !== spawnWindow) {
      await spawnWindowToggle.click();

      // Wait for the toggle state to update
      await this.page.waitForFunction(
        (expectedState) => {
          const toggle = document.querySelector('button[role="switch"]');
          return toggle?.getAttribute('aria-checked') === (expectedState ? 'true' : 'false');
        },
        spawnWindow,
        { timeout: 1000 }
      );
    }

    // Fill in the session name if provided
    if (sessionName) {
      // Use the selector we found earlier
      try {
        await this.page.fill(inputSelector, sessionName, { timeout: 3000 });
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

    // Fill in the command if provided
    if (command) {
      try {
        await this.page.fill('[data-testid="command-input"]', command);
      } catch {
        // Fallback to placeholder selector
        await this.page.fill('input[placeholder="zsh"]', command);
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
      { timeout: 2000 }
    );

    // Submit the form - click the Create button
    const submitButton = this.page
      .locator('[data-testid="create-session-submit"]')
      .or(this.page.locator('button:has-text("Create")'));

    // Make sure button is not disabled
    await submitButton.waitFor({ state: 'visible' });
    const isDisabled = await submitButton.isDisabled();
    if (isDisabled) {
      throw new Error('Create button is disabled - form may not be valid');
    }

    // Click and wait for response
    const responsePromise = this.page.waitForResponse(
      (response) => response.url().includes('/api/sessions'),
      { timeout: 4000 }
    );

    await submitButton.click();

    // Wait for navigation to session view (only for web sessions)
    if (!spawnWindow) {
      try {
        const response = await responsePromise;
        console.log(`Session creation response status: ${response.status()}`);

        if (response.status() !== 201 && response.status() !== 200) {
          const body = await response.text();
          throw new Error(`Session creation failed with status ${response.status()}: ${body}`);
        }

        // Log the response body for debugging
        const responseBody = await response.json();
        console.log('Session created:', responseBody);
      } catch (error) {
        console.error('Error waiting for session response:', error);
        // If waitForResponse times out, check if we navigated anyway
        const currentUrl = this.page.url();
        if (!currentUrl.includes('?session=')) {
          // Take a screenshot for debugging
          await screenshotOnError(
            this.page,
            error instanceof Error ? error : new Error(String(error)),
            'session-creation-response-error'
          );
          throw error;
        }
      }

      // Wait for modal to close
      await this.page
        .waitForSelector('.modal-content', { state: 'hidden', timeout: 2000 })
        .catch(() => {
          // Modal might have already closed
        });

      // Wait for navigation - the URL should change to include session ID
      try {
        await this.page.waitForURL(/\?session=/, { timeout: 8000 });
        console.log('Successfully navigated to session view');
      } catch (error) {
        const currentUrl = this.page.url();
        console.error(`Failed to navigate to session. Current URL: ${currentUrl}`);
        // Take a screenshot
        await screenshotOnError(
          this.page,
          new Error(`Navigation timeout. URL: ${currentUrl}`),
          'session-navigation-timeout'
        );
        throw error;
      }

      await this.page.waitForSelector('vibe-terminal', { state: 'visible' });
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
    if (this.page.url().includes('?session=')) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle');
    }

    // Wait for session cards to load
    await this.page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
      },
      { timeout: 10000 }
    );

    // Check if we have any session cards
    const cardCount = await this.getSessionCount();
    if (cardCount === 0) {
      throw new Error('No session cards found on the page');
    }

    // Look for the specific session card
    const sessionCard = (await this.getSessionCard(sessionName)).first();

    // Wait for the specific session card to be visible
    await sessionCard.waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view if needed
    await sessionCard.scrollIntoViewIfNeeded();

    // Click on the session card
    await sessionCard.click();

    // Wait for navigation to session view
    await this.page.waitForURL(/\?session=/, { timeout: 5000 });
  }

  async isSessionActive(sessionName: string): Promise<boolean> {
    const sessionCard = await this.getSessionCard(sessionName);
    // Look for the status text in the footer area
    const statusText = await sessionCard.locator('span:has(.w-2.h-2.rounded-full)').textContent();
    // Sessions show "RUNNING" when active, not "active"
    return statusText?.toUpperCase().includes('RUNNING') || false;
  }

  async killSession(sessionName: string) {
    const sessionCard = await this.getSessionCard(sessionName);

    // Wait for the session card to be visible
    await sessionCard.waitFor({ state: 'visible', timeout: 4000 });

    // The kill button should have data-testid="kill-session-button"
    const killButton = sessionCard.locator('[data-testid="kill-session-button"]');

    // Wait for the button to be visible and enabled
    await killButton.waitFor({ state: 'visible', timeout: 4000 });

    // Scroll into view if needed
    await killButton.scrollIntoViewIfNeeded();

    // Set up dialog handler BEFORE clicking to avoid race condition
    // But use Promise.race to handle cases where no dialog appears
    const dialogPromise = this.page.waitForEvent('dialog', { timeout: 2000 });

    // Click the button (this might or might not trigger a dialog)
    const clickPromise = killButton.click();

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
      console.log('No confirmation dialog appeared for kill action');
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
      // Check if modal is visible
      const modal = this.page.locator('.modal-content');
      if (await modal.isVisible({ timeout: 1000 })) {
        // Try to close via cancel button or X button
        const closeButton = this.page
          .locator('button[aria-label="Close modal"]')
          .or(this.page.locator('button:has-text("Cancel")'))
          .or(this.page.locator('.modal-content button:has(svg)'));

        if (await closeButton.isVisible({ timeout: 500 })) {
          await closeButton.click();
          await this.page.waitForSelector('.modal-content', { state: 'hidden', timeout: 2000 });
        } else {
          // Fallback: press Escape key
          await this.page.keyboard.press('Escape');
          await this.page.waitForSelector('.modal-content', { state: 'hidden', timeout: 2000 });
        }
      }
    } catch (_error) {
      // Modal might not exist or already closed, which is fine
      console.log('No modal to close or already closed');
    }
  }
}

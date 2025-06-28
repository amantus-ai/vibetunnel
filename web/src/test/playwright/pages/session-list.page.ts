import { BasePage } from './base.page';

export class SessionListPage extends BasePage {
  async navigate() {
    await super.navigate('/');
    await this.waitForLoadComplete();
  }

  async createNewSession(sessionName?: string, spawnWindow = false) {
    // Click the create session button - try data-testid first, fallback to title
    try {
      await this.page.click('[data-testid="create-session-button"]', { timeout: 5000 });
    } catch {
      // Fallback to using the title attribute if data-testid is not found
      await this.page.click('button[title="Create New Session"]');
    }

    // Wait for the modal to appear by checking for the session name input
    try {
      await this.page.waitForSelector('[data-testid="session-name-input"]', { state: 'visible', timeout: 5000 });
    } catch {
      // Fallback to placeholder if data-testid is not found
      await this.page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });
    }

    // IMPORTANT: Set spawn window toggle to create web sessions, not native terminals
    let spawnWindowToggle = this.page.locator('[data-testid="spawn-window-toggle"]');
    
    // Check if toggle exists with data-testid, if not use role selector
    if (!(await spawnWindowToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
      spawnWindowToggle = this.page.locator('button[role="switch"]');
    }
    
    const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';

    // If current state doesn't match desired state, click to toggle
    if (isSpawnWindowOn !== spawnWindow) {
      await spawnWindowToggle.click();
      // Verify the toggle state changed
      await this.page.waitForFunction(
        (expectedState) => {
          const toggle = document.querySelector('[data-testid="spawn-window-toggle"]') || 
                        document.querySelector('button[role="switch"]');
          return toggle?.getAttribute('aria-checked') === expectedState;
        },
        spawnWindow ? 'true' : 'false',
        { timeout: 2000 }
      );
    }

    // Fill in the session name if provided
    if (sessionName) {
      try {
        await this.page.fill('[data-testid="session-name-input"]', sessionName);
      } catch {
        // Fallback to placeholder selector
        await this.page.fill('input[placeholder="My Session"]', sessionName);
      }
    }

    // Submit the form - click the Create button
    try {
      await this.page.click('[data-testid="create-session-submit"]', { timeout: 2000 });
    } catch {
      // Fallback to button text
      await this.page.click('button:has-text("Create")');
    }

    // Wait for navigation to session view (only for web sessions)
    if (!spawnWindow) {
      await this.page.waitForURL(/\?session=/, { timeout: 10000 });
      await this.page.waitForSelector('vibe-terminal', { state: 'visible' });
    }
  }

  async getSessionCards() {
    return this.page.locator('[data-testid="session-card"]').all();
  }

  async getSessionCount(): Promise<number> {
    const cards = await this.getSessionCards();
    return cards.length;
  }

  async clickSession(sessionName: string) {
    await this.page.click(`[data-testid="session-card"]:has-text("${sessionName}")`);
  }

  async isSessionActive(sessionName: string): Promise<boolean> {
    const sessionCard = this.page.locator(
      `[data-testid="session-card"]:has-text("${sessionName}")`
    );
    const statusText = await sessionCard.locator('.status').textContent();
    return statusText?.toLowerCase().includes('active') || false;
  }

  async killSession(sessionName: string) {
    const sessionCard = this.page.locator(
      `[data-testid="session-card"]:has-text("${sessionName}")`
    );
    await sessionCard.locator('[data-testid="kill-session-button"]').click();

    // Confirm in dialog if it appears
    this.page.on('dialog', (dialog) => dialog.accept());
  }

  async waitForEmptyState() {
    await this.page.waitForSelector('text="No active sessions"', { timeout: 5000 });
  }
}

import { BasePage } from './base.page';

export class SessionListPage extends BasePage {
  async navigate() {
    await super.navigate('/');
    await this.waitForLoadComplete();
  }

  async createNewSession(sessionName?: string) {
    // Click the create session button (it's an icon button with title)
    await this.page.click('button[title="Create New Session"]');

    // Wait for the modal to appear by checking for the session name input
    await this.page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Fill in the session name if provided
    if (sessionName) {
      await this.page.fill('input[placeholder="My Session"]', sessionName);
    }

    // Submit the form - click the Create button
    await this.page.click('button:has-text("Create")');

    // Wait for navigation to session view
    await this.page.waitForSelector('session-view', { state: 'visible' });
  }

  async getSessionCards() {
    return this.page.locator('session-card').all();
  }

  async getSessionCount(): Promise<number> {
    const cards = await this.getSessionCards();
    return cards.length;
  }

  async clickSession(sessionName: string) {
    await this.page.click(`session-card:has-text("${sessionName}")`);
  }

  async isSessionActive(sessionName: string): Promise<boolean> {
    const sessionCard = this.page.locator(`session-card:has-text("${sessionName}")`);
    const statusText = await sessionCard.locator('.status').textContent();
    return statusText?.toLowerCase().includes('active') || false;
  }

  async killSession(sessionName: string) {
    const sessionCard = this.page.locator(`session-card:has-text("${sessionName}")`);
    await sessionCard.locator('button:has-text("Kill")').click();

    // Confirm in dialog if it appears
    this.page.on('dialog', (dialog) => dialog.accept());
  }

  async waitForEmptyState() {
    await this.page.waitForSelector('text="No active sessions"', { timeout: 5000 });
  }
}

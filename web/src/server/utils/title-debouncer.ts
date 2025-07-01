/**
 * Title update debouncer
 *
 * Limits title updates to once per second to avoid excessive terminal updates
 */

export class TitleDebouncer {
  private pendingTitle: string | null = null;
  private lastUpdateTime = 0;
  private updateTimer: NodeJS.Timeout | null = null;
  private readonly updateInterval = 1000; // 1 second

  /**
   * Schedule a title update
   * @param title The title sequence to send
   * @param callback Function to call with the title when ready
   */
  scheduleUpdate(title: string, callback: (title: string) => void): void {
    this.pendingTitle = title;

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    // If enough time has passed, update immediately
    if (timeSinceLastUpdate >= this.updateInterval) {
      this.sendUpdate(callback);
      return;
    }

    // Otherwise, schedule the update
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    const delay = this.updateInterval - timeSinceLastUpdate;
    this.updateTimer = setTimeout(() => {
      this.sendUpdate(callback);
    }, delay);
  }

  /**
   * Force an immediate update if there's a pending title
   * @param callback Function to call with the title
   */
  flush(callback: (title: string) => void): void {
    if (this.pendingTitle) {
      this.sendUpdate(callback);
    }
  }

  /**
   * Clear any pending updates
   */
  clear(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.pendingTitle = null;
  }

  private sendUpdate(callback: (title: string) => void): void {
    if (this.pendingTitle) {
      callback(this.pendingTitle);
      this.lastUpdateTime = Date.now();
      this.pendingTitle = null;
    }

    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }
}

/**
 * Loading Animation Manager
 *
 * Manages loading state and animation for session view components.
 * Provides a centralized way to start/stop loading animations with
 * consistent visual feedback.
 */

/**
 * Manages loading state and animation for session views
 */
export class LoadingAnimationManager {
  private loading = false;
  private loadingFrame = 0;
  private loadingInterval: number | null = null;

  /**
   * Check if currently in loading state
   */
  isLoading(): boolean {
    return this.loading;
  }

  /**
   * Get current loading frame for animation
   */
  getLoadingFrame(): number {
    return this.loadingFrame;
  }

  /**
   * Start loading animation with callback for updates
   */
  startLoading(onUpdate?: () => void): void {
    this.loading = true;
    this.loadingFrame = 0;
    this.loadingInterval = window.setInterval(() => {
      this.loadingFrame = (this.loadingFrame + 1) % 4;
      if (onUpdate) {
        onUpdate();
      }
    }, 200) as unknown as number; // Update every 200ms for smooth animation
  }

  /**
   * Stop loading animation
   */
  stopLoading(): void {
    this.loading = false;
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
  }

  /**
   * Get current loading animation text frame
   */
  getLoadingText(): string {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[this.loadingFrame % frames.length];
  }

  /**
   * Clean up any active intervals
   */
  cleanup(): void {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
  }
}

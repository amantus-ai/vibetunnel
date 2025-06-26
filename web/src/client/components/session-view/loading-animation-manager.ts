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
   * Clean up any active intervals
   */
  cleanup(): void {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
  }
}

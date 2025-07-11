/**
 * Resize Coordinator
 *
 * Centralizes and coordinates all terminal resize requests to prevent multiple
 * resize events from causing terminal reflows. Essential for mobile stability.
 */

export interface ResizeDimensions {
  cols: number;
  rows: number;
}

export class ResizeCoordinator {
  private pendingResize: number | null = null;
  private lastDimensions: ResizeDimensions | null = null;
  private resizeCallback: ((source: string) => void) | null = null;
  private initialResizeComplete = false;
  private resizeSources = new Set<string>();

  /**
   * Set the callback function to be called when resize should happen
   */
  setResizeCallback(callback: (source: string) => void) {
    this.resizeCallback = callback;
  }

  /**
   * Request a resize from a specific source
   * All resize requests are coalesced into a single animation frame
   */
  requestResize(source: string) {
    this.resizeSources.add(source);

    // Cancel any pending resize
    if (this.pendingResize) {
      cancelAnimationFrame(this.pendingResize);
    }

    // Schedule resize for next animation frame
    this.pendingResize = requestAnimationFrame(() => {
      const sources = Array.from(this.resizeSources).join(', ');
      this.resizeSources.clear();

      if (this.resizeCallback) {
        this.resizeCallback(sources);
      }

      this.pendingResize = null;
    });
  }

  /**
   * Check if dimensions have actually changed
   */
  shouldResize(cols: number, rows: number): boolean {
    const isMobile = this.getIsMobile();

    // On mobile, after initial resize, never resize again
    // This prevents rotation and keyboard events from causing reflows
    if (isMobile && this.initialResizeComplete) {
      return false;
    }

    if (!this.lastDimensions) {
      this.lastDimensions = { cols, rows };
      return true;
    }

    const changed = this.lastDimensions.cols !== cols || this.lastDimensions.rows !== rows;

    if (changed) {
      this.lastDimensions = { cols, rows };
    }

    return changed;
  }

  /**
   * Mark initial resize as complete
   * After this, mobile will only resize on width changes
   */
  markInitialResizeComplete() {
    this.initialResizeComplete = true;
  }

  /**
   * Get last known dimensions
   */
  getLastDimensions(): ResizeDimensions | null {
    return this.lastDimensions;
  }

  /**
   * Force update dimensions (for explicit user actions)
   */
  forceUpdateDimensions(cols: number, rows: number) {
    this.lastDimensions = { cols, rows };
  }

  /**
   * Check if running on mobile (dynamically checks on each call)
   */
  getIsMobile(): boolean {
    // Check viewport width and touch capability dynamically
    // This handles orientation changes and window resizing
    return window.innerWidth < 768 && 'ontouchstart' in window;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.pendingResize) {
      cancelAnimationFrame(this.pendingResize);
    }
    this.resizeCallback = null;
    this.resizeSources.clear();
  }
}

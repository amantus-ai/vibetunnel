import { BREAKPOINTS } from './constants.js';

export interface MediaQueryState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * Creates a responsive utility that uses ResizeObserver for efficient viewport tracking
 */
export class ResponsiveObserver {
  private callbacks = new Set<(state: MediaQueryState) => void>();
  private currentState: MediaQueryState;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.currentState = this.getMediaQueryState();

    try {
      // Use ResizeObserver on document.documentElement for efficient viewport tracking
      this.resizeObserver = new ResizeObserver(() => {
        try {
          const newState = this.getMediaQueryState();

          if (this.hasStateChanged(this.currentState, newState)) {
            this.currentState = newState;
            this.notifyCallbacks(newState);
          }
        } catch (error) {
          console.error('Error in ResizeObserver callback:', error);
        }
      });

      this.resizeObserver.observe(document.documentElement);
    } catch (error) {
      console.error('Failed to initialize ResizeObserver:', error);
      // Fallback to window resize events
      this.setupFallbackResizeListener();
    }
  }

  private setupFallbackResizeListener(): void {
    let timeoutId: number;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const newState = this.getMediaQueryState();
        if (this.hasStateChanged(this.currentState, newState)) {
          this.currentState = newState;
          this.notifyCallbacks(newState);
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);
  }

  private getMediaQueryState(): MediaQueryState {
    const width = window.innerWidth;
    return {
      isMobile: width < BREAKPOINTS.MOBILE,
      isTablet: width >= BREAKPOINTS.MOBILE && width < BREAKPOINTS.DESKTOP,
      isDesktop: width >= BREAKPOINTS.DESKTOP,
    };
  }

  private hasStateChanged(oldState: MediaQueryState, newState: MediaQueryState): boolean {
    return (
      oldState.isMobile !== newState.isMobile ||
      oldState.isTablet !== newState.isTablet ||
      oldState.isDesktop !== newState.isDesktop
    );
  }

  private notifyCallbacks(state: MediaQueryState): void {
    this.callbacks.forEach((callback) => callback(state));
  }

  subscribe(callback: (state: MediaQueryState) => void): () => void {
    this.callbacks.add(callback);
    // Immediately call with current state
    callback(this.currentState);

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  getCurrentState(): MediaQueryState {
    return { ...this.currentState };
  }

  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.callbacks.clear();
  }
}

// Singleton instance for global use
export const responsiveObserver = new ResponsiveObserver();

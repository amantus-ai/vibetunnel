/**
 * Lifecycle & Event Manager for Session View
 *
 * Manages the lifecycle events, keyboard/touch handlers, preferences, and
 * overall event coordination for the session view component.
 */
import { createLogger } from '../../utils/logger.js';
import type { AppPreferences } from '../app-settings.js';
import type { Session } from '../session-list.js';

const logger = createLogger('lifecycle-event-manager');

export interface LifecycleEventManagerCallbacks {
  requestUpdate(): void;
  handleBack(): void;
  handleKeyboardInput(e: KeyboardEvent): Promise<void>;
  getIsMobile(): boolean;
  getUseDirectKeyboard(): boolean;
  setUseDirectKeyboard(value: boolean): void;
  getDirectKeyboardManager(): {
    getShowQuickKeys(): boolean;
    ensureHiddenInputVisible(): void;
    cleanup(): void;
  };
  setShowQuickKeys(value: boolean): void;
  setShowFileBrowser(value: boolean): void;
  getInputManager(): {
    isKeyboardShortcut(e: KeyboardEvent): boolean;
  } | null;
}

export class LifecycleEventManager {
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: LifecycleEventManagerCallbacks | null = null;
  private session: Session | null = null;
  private touchStartX = 0;
  private touchStartY = 0;

  constructor() {
    logger.log('LifecycleEventManager initialized');
  }

  setSessionViewElement(element: HTMLElement): void {
    this.sessionViewElement = element;
  }

  setCallbacks(callbacks: LifecycleEventManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  setSession(session: Session | null): void {
    this.session = session;
  }

  handlePreferencesChanged = (e: Event): void => {
    if (!this.callbacks) return;

    const event = e as CustomEvent;
    const preferences = event.detail as AppPreferences;
    this.callbacks.setUseDirectKeyboard(preferences.useDirectKeyboard);

    // Update hidden input based on preference
    const isMobile = this.callbacks.getIsMobile();
    const useDirectKeyboard = this.callbacks.getUseDirectKeyboard();
    const directKeyboardManager = this.callbacks.getDirectKeyboardManager();

    if (isMobile && useDirectKeyboard && !directKeyboardManager.getShowQuickKeys()) {
      directKeyboardManager.ensureHiddenInputVisible();
    } else if (!useDirectKeyboard) {
      // Cleanup direct keyboard manager when disabled
      directKeyboardManager.cleanup();
      this.callbacks.setShowQuickKeys(false);
    }
  };

  keyboardHandler = (e: KeyboardEvent): void => {
    if (!this.callbacks) return;

    // Handle Cmd+O / Ctrl+O to open file browser
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
      e.preventDefault();
      this.callbacks.setShowFileBrowser(true);
      return;
    }

    if (!this.session) return;

    // Check if this is a browser shortcut we should allow
    const inputManager = this.callbacks.getInputManager();
    if (inputManager?.isKeyboardShortcut(e)) {
      return;
    }

    // Handle Escape key specially for exited sessions
    if (e.key === 'Escape' && this.session.status === 'exited') {
      this.callbacks.handleBack();
      return;
    }

    // Only prevent default for keys we're actually going to handle
    e.preventDefault();
    e.stopPropagation();

    this.callbacks.handleKeyboardInput(e);
  };

  touchStartHandler = (e: TouchEvent): void => {
    if (!this.callbacks) return;

    const isMobile = this.callbacks.getIsMobile();
    if (!isMobile) return;

    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  };

  touchEndHandler = (e: TouchEvent): void => {
    if (!this.callbacks) return;

    const isMobile = this.callbacks.getIsMobile();
    if (!isMobile) return;

    const touch = e.changedTouches[0];
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;

    const deltaX = touchEndX - this.touchStartX;
    const deltaY = touchEndY - this.touchStartY;

    // Check for horizontal swipe from left edge (back gesture)
    const isSwipeRight = deltaX > 100;
    const isVerticallyStable = Math.abs(deltaY) < 100;
    const startedFromLeftEdge = this.touchStartX < 50;

    if (isSwipeRight && isVerticallyStable && startedFromLeftEdge) {
      // Trigger back navigation
      this.callbacks.handleBack();
    }
  };

  cleanup(): void {
    logger.log('LifecycleEventManager cleanup');
    this.sessionViewElement = null;
    this.callbacks = null;
    this.session = null;
  }
}

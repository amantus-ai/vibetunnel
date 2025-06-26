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
}

export class LifecycleEventManager {
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: LifecycleEventManagerCallbacks | null = null;
  private session: Session | null = null;

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

  cleanup(): void {
    logger.log('LifecycleEventManager cleanup');
    this.sessionViewElement = null;
    this.callbacks = null;
    this.session = null;
  }
}

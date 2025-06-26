/**
 * Lifecycle & Event Manager for Session View
 *
 * Manages the lifecycle events, keyboard/touch handlers, preferences, and
 * overall event coordination for the session view component.
 */
import { createLogger } from '../../utils/logger.js';
import type { Session } from '../session-list.js';

const logger = createLogger('lifecycle-event-manager');

export interface LifecycleEventManagerCallbacks {
  requestUpdate(): void;
  handleBack(): void;
  handleKeyboardInput(e: KeyboardEvent): Promise<void>;
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

  cleanup(): void {
    logger.log('LifecycleEventManager cleanup');
    this.sessionViewElement = null;
    this.callbacks = null;
    this.session = null;
  }
}

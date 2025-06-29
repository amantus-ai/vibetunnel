/**
 * Lightweight state machine for managing session transitions in SessionView.
 * Replaces complex boolean flag logic with a single source of truth.
 */

import type { Session } from '../session-list.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('session-state-machine');

// Session state types
export type SessionState = 
  | 'idle'           // No session
  | 'ready'          // Session active and connected
  | 'connecting'     // Initial connection to session
  | 'switching'      // Switching between sessions
  | 'leaving';       // Cleaning up (session → null)

// Context for state transitions
export interface StateContext {
  fromSession: Session | null;
  toSession: Session | null;
  expectedSessionId?: string;
  error?: Error;
}

// Transition event types
export type TransitionEvent =
  | { type: 'CONNECT'; session: Session }
  | { type: 'CONNECTED' }
  | { type: 'SWITCH'; session: Session }
  | { type: 'SWITCHED' }
  | { type: 'DISCONNECT' }
  | { type: 'DISCONNECTED' }
  | { type: 'ERROR'; error: Error };

// Callbacks for state actions
export interface StateActions {
  onEnterConnecting?: (context: StateContext) => void | Promise<void>;
  onEnterSwitching?: (context: StateContext) => void | Promise<void>;
  onEnterLeaving?: (context: StateContext) => void | Promise<void>;
  onEnterReady?: (context: StateContext) => void | Promise<void>;
  onEnterIdle?: (context: StateContext) => void | Promise<void>;
  onError?: (error: Error) => void;
}

// Valid state transitions
const TRANSITIONS: Record<SessionState, Partial<Record<TransitionEvent['type'], SessionState>>> = {
  idle: {
    CONNECT: 'connecting',
  },
  connecting: {
    CONNECTED: 'ready',
    ERROR: 'idle',
    DISCONNECT: 'idle',
  },
  ready: {
    SWITCH: 'switching',
    DISCONNECT: 'leaving',
  },
  switching: {
    SWITCHED: 'ready',
    ERROR: 'ready',
    DISCONNECT: 'leaving',
  },
  leaving: {
    DISCONNECTED: 'idle',
    ERROR: 'idle',
  },
};

export class SessionStateMachine {
  private state: SessionState = 'idle';
  private context: StateContext = {
    fromSession: null,
    toSession: null,
  };
  private actions: StateActions;
  private transitionInProgress = false;
  private deferredEvent: TransitionEvent | null = null;
  private switchingTimeout?: ReturnType<typeof setTimeout>;

  constructor(actions: StateActions = {}) {
    this.actions = actions;
  }

  getState(): SessionState {
    return this.state;
  }

  getContext(): StateContext {
    return { ...this.context };
  }

  // Check if a transition is valid
  canTransition(event: TransitionEvent): boolean {
    const validNextState = TRANSITIONS[this.state][event.type];
    return validNextState !== undefined;
  }

  // Main transition method
  async transition(event: TransitionEvent): Promise<boolean> {
    // If already transitioning, defer the event
    if (this.transitionInProgress) {
      logger.warn(`Transition in progress, deferring ${event.type} event`);
      this.deferredEvent = event;
      return false;
    }

    const fromState = this.state;
    const nextState = TRANSITIONS[fromState][event.type];

    if (!nextState) {
      logger.warn(`Invalid transition: ${fromState} → ${event.type}`);
      return false;
    }

    logger.log(`State transition: ${fromState} → ${nextState} (${event.type})`);
    this.transitionInProgress = true;

    try {
      // Update context based on event
      this.updateContext(event);

      // Update state
      this.state = nextState;

      // Execute state entry actions
      await this.executeStateActions(nextState);

      return true;
    } catch (error) {
      logger.error('State transition error:', error);
      if (this.actions.onError) {
        this.actions.onError(error as Error);
      }
      // On error, try to recover to a stable state
      if (this.state === 'switching' || this.state === 'connecting') {
        this.state = 'ready';
      } else if (this.state === 'leaving') {
        this.state = 'idle';
      }
      return false;
    } finally {
      this.transitionInProgress = false;

      // Process deferred event if any
      if (this.deferredEvent) {
        const event = this.deferredEvent;
        this.deferredEvent = null;
        logger.log(`Processing deferred ${event.type} event`);
        // Use setTimeout to avoid stack overflow
        setTimeout(() => this.transition(event), 0);
      }
    }
  }

  // Update context based on event
  private updateContext(event: TransitionEvent): void {
    switch (event.type) {
      case 'CONNECT':
        this.context.fromSession = null;
        this.context.toSession = event.session;
        this.context.expectedSessionId = event.session.id;
        break;

      case 'SWITCH':
        this.context.fromSession = this.context.toSession;
        this.context.toSession = event.session;
        this.context.expectedSessionId = event.session.id;
        break;

      case 'DISCONNECT':
        this.context.fromSession = this.context.toSession;
        this.context.toSession = null;
        this.context.expectedSessionId = undefined;
        break;

      case 'ERROR':
        this.context.error = event.error;
        break;

      // CONNECTED, SWITCHED, DISCONNECTED don't change context
    }
  }

  // Execute actions for entering a state
  private async executeStateActions(state: SessionState): Promise<void> {
    switch (state) {
      case 'connecting':
        if (this.actions.onEnterConnecting) {
          await this.actions.onEnterConnecting(this.context);
        }
        break;

      case 'switching':
        // Clear any existing timeout
        if (this.switchingTimeout) {
          clearTimeout(this.switchingTimeout);
        }
        
        // Set a timeout to prevent being stuck in switching state
        this.switchingTimeout = setTimeout(() => {
          logger.warn('Switching state timeout - forcing transition to ready');
          this.state = 'ready';
          this.transitionInProgress = false;
          if (this.actions.onEnterReady) {
            this.actions.onEnterReady(this.context);
          }
        }, 5000); // 5 second timeout
        
        if (this.actions.onEnterSwitching) {
          await this.actions.onEnterSwitching(this.context);
        }
        break;

      case 'leaving':
        if (this.actions.onEnterLeaving) {
          await this.actions.onEnterLeaving(this.context);
        }
        break;

      case 'ready':
        // Clear switching timeout if transitioning to ready
        if (this.switchingTimeout) {
          clearTimeout(this.switchingTimeout);
          this.switchingTimeout = undefined;
        }
        
        if (this.actions.onEnterReady) {
          await this.actions.onEnterReady(this.context);
        }
        break;

      case 'idle':
        if (this.actions.onEnterIdle) {
          await this.actions.onEnterIdle(this.context);
        }
        break;
    }
  }

  // Helper methods for common checks
  isTransitioning(): boolean {
    return this.state === 'connecting' || this.state === 'switching';
  }

  isConnected(): boolean {
    return this.state === 'ready';
  }

  canAcceptInput(): boolean {
    return this.state === 'ready';
  }

  // Reset to initial state (useful for testing)
  reset(): void {
    this.state = 'idle';
    this.context = {
      fromSession: null,
      toSession: null,
    };
    this.transitionInProgress = false;
    this.deferredEvent = null;
  }
}
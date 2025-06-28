/**
 * Robot State Machine Interpreter
 *
 * Provides an interpreter for Robot state machines that integrates
 * with async operations and provides subscription capabilities.
 */

import { interpret as robotInterpret, type Service } from 'robot3';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('robot-interpreter');

export class RobotInterpreter<Context = any> {
  private service: Service<any>;
  private listeners = new Set<(state: string, context: Context) => void>();
  private currentState: string;
  private context: Context;

  constructor(
    private machine: any,
    initialContext: Context
  ) {
    this.context = initialContext;
    this.currentState = 'idle'; // Robot machines start in the first defined state

    // Create the service
    this.service = robotInterpret(
      this.machine,
      (service: Service<any>) => {
        const newState = service.machine.current;
        const newContext = service.context;

        if (newState !== this.currentState) {
          logger.log(`State transition: ${this.currentState} → ${newState}`);
        }

        this.currentState = newState;
        this.context = newContext;

        // Notify all listeners
        this.listeners.forEach((listener) => listener(newState, newContext));
      },
      initialContext
    );
  }

  /**
   * Send an event to the state machine
   *
   * TRICKY: Robot's send is synchronous, but invoke handlers are async.
   * The service handles this internally, so we don't need to await.
   * Errors from async handlers will trigger error transitions.
   */
  send(event: any): void {
    logger.log(`Sending event: ${event.type}`, event);

    try {
      this.service.send(event);
    } catch (error) {
      logger.error(`Error processing event ${event.type}:`, error);
      // Send error event if needed
      if (event.type !== 'error') {
        this.service.send({ type: 'error', error });
      }
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: string, context: Context) => void): () => void {
    this.listeners.add(listener);

    // Call immediately with current state
    listener(this.currentState, this.context);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state
   */
  getState(): string {
    return this.currentState;
  }

  /**
   * Get current context
   */
  getContext(): Context {
    return this.context;
  }

  /**
   * Update context (for external managers)
   */
  updateContext(updates: Partial<Context>): void {
    this.context = { ...this.context, ...updates };
    this.listeners.forEach((listener) => listener(this.currentState, this.context));
  }

  /**
   * Check if in a specific state
   */
  isInState(state: string): boolean {
    return this.currentState === state;
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.listeners.clear();
    // Robot doesn't have explicit cleanup, but we clear our references
    this.service = null as any;
  }
}

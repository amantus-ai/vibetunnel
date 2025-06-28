/**
 * Session State Machine using Robot
 *
 * Manages the complex state transitions for terminal sessions including:
 * - Session initialization and cleanup
 * - Session switching with debouncing
 * - Error handling and recovery
 *
 * State Flow:
 * 1. idle -> loading: When session is set
 * 2. loading -> active: When managers are initialized
 * 3. active -> debouncing: When switching to different session
 * 4. debouncing -> cleaningUp -> initializing -> active: Full switch flow
 * 5. any -> error: On failures (with retry capability)
 * 6. any -> cleanup -> idle: When session is cleared
 */

import { createMachine, guard, invoke, reduce, state, transition } from 'robot3';
import { createLogger } from '../../utils/logger.js';
import type { Session } from '../session-list.js';

const logger = createLogger('session-state-machine');

import type { Terminal } from '../terminal.js';
// Import types for proper typing
import type { ConnectionManager } from './connection-manager.js';
import type { TerminalLifecycleManager } from './terminal-lifecycle-manager.js';

// State machine context type
export interface SessionContext {
  session: Session | null;
  previousSession: Session | null;
  error: Error | null;
  connectionManager: ConnectionManager | null;
  terminalLifecycleManager: TerminalLifecycleManager | null;
  terminal: Terminal | null;
}

// Events
export type SessionEvent =
  | { type: 'setSession'; session: Session | null }
  | { type: 'debounceComplete' }
  | { type: 'done' }
  | { type: 'error'; error: Error }
  | { type: 'retry' }
  | { type: 'clearSession' };

// Define the state machine
export const sessionMachine = createMachine(
  {
    idle: state(
      transition(
        'setSession',
        'loading',
        guard(
          (_context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' && event.session !== null
        ),
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession') {
            logger.log('Transitioning to loading state', event.session);
            return { ...context, session: event.session, error: null };
          }
          return context;
        })
      )
    ),

    loading: invoke(
      async (context: SessionContext) => {
        logger.log('Loading session', context.session);
        if (!context.session) throw new Error('No session');

        // Setup terminal and connect to stream
        if (context.terminalLifecycleManager) {
          context.terminalLifecycleManager.setupTerminal();
        }
        if (context.connectionManager) {
          context.connectionManager.connectToStream();
        }
        logger.log('Session loaded successfully');
      },
      transition('done', 'active'),
      transition(
        'error',
        'error',
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'error') {
            logger.error('Failed to load session', event.error);
            return { ...context, error: event.error };
          }
          return context;
        })
      ),
      // TRICKY: Handle rapid switching during initial loading
      // If user switches session while first one is still loading,
      // we transition to debouncing state to cancel the first load
      transition(
        'setSession',
        'debouncing',
        guard(
          (context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' &&
            event.session !== null &&
            event.session.id !== context.session?.id
        ),
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession') {
            logger.log('Switching session during loading');
            return {
              ...context,
              previousSession: context.session,
              session: event.session,
            };
          }
          return context;
        })
      )
    ),

    active: state(
      // Same session update - just update properties
      transition(
        'setSession',
        'active',
        guard(
          (context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' &&
            event.session !== null &&
            context.session?.id === event.session?.id
        ),
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession') {
            logger.log('Updating session properties');
            return { ...context, session: event.session };
          }
          return context;
        })
      ),
      // Different session - switch
      transition(
        'setSession',
        'debouncing',
        guard(
          (context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' &&
            event.session !== null &&
            context.session?.id !== event.session?.id
        ),
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession') {
            logger.log('Switching to new session', event.session);
            return {
              ...context,
              previousSession: context.session,
              session: event.session,
            };
          }
          return context;
        })
      ),
      transition('clearSession', 'cleanup'),
      transition(
        'setSession',
        'cleanup',
        guard(
          (_context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' && event.session === null
        )
      )
    ),

    debouncing: state(
      // TRICKY: Allow updating target session during debounce period
      // This handles rapid session switches where user changes selection
      // before the debounce timer fires. We keep the latest selection.
      transition(
        'setSession',
        'debouncing',
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession' && event.session) {
            logger.log('Updating target session during debounce');
            return { ...context, session: event.session };
          }
          return context;
        })
      ),
      // After 50ms debounce (set by component), proceed to cleanup
      transition('debounceComplete', 'cleaningUp')
    ),

    cleaningUp: invoke(
      async (context: SessionContext) => {
        logger.log('Cleaning up previous session');
        try {
          if (context.connectionManager) {
            await context.connectionManager.cleanupStreamConnection();
          }
          if (context.terminal) {
            context.terminal.clear();
          }
        } catch (error) {
          logger.error('Cleanup error (continuing)', error);
          // Continue even if cleanup fails
        }
      },
      transition('done', 'initializing'),
      transition('error', 'initializing') // Continue on error
    ),

    initializing: invoke(
      async (context: SessionContext) => {
        logger.log('Initializing new session', context.session);
        if (!context.session) throw new Error('No session to initialize');

        // Setup terminal and connect to stream for new session
        if (context.terminalLifecycleManager) {
          context.terminalLifecycleManager.setupTerminal();
        }
        if (context.connectionManager) {
          context.connectionManager.connectToStream();
        }
        logger.log('Session initialized successfully');
      },
      transition('done', 'active'),
      transition(
        'error',
        'error',
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'error') {
            logger.error('Failed to initialize session', event.error);
            return { ...context, error: event.error };
          }
          return context;
        })
      )
    ),

    cleanup: invoke(
      async (context: SessionContext) => {
        logger.log('Cleaning up session');
        try {
          if (context.connectionManager) {
            await context.connectionManager.cleanupStreamConnection();
          }
          if (context.terminal) {
            context.terminal.clear();
          }
        } catch (error) {
          logger.error('Cleanup error', error);
        }
      },
      transition(
        'done',
        'idle',
        reduce((context: SessionContext) => ({
          ...context,
          session: null,
          previousSession: null,
          error: null,
        }))
      ),
      transition(
        'error',
        'idle',
        reduce((context: SessionContext) => ({
          ...context,
          session: null,
          previousSession: null,
          error: null,
        }))
      )
    ),

    error: state(
      transition('retry', 'loading'),
      transition('clearSession', 'cleanup'),
      transition(
        'setSession',
        'loading',
        guard(
          (_context: SessionContext, event: SessionEvent) =>
            event.type === 'setSession' && event.session !== null
        ),
        reduce((context: SessionContext, event: SessionEvent) => {
          if (event.type === 'setSession') {
            logger.log('Recovering from error with new session');
            return { ...context, session: event.session, error: null };
          }
          return context;
        })
      )
    ),
  },
  () => ({
    session: null,
    previousSession: null,
    error: null,
    connectionManager: null,
    terminalLifecycleManager: null,
    terminal: null,
  })
);

// Export state names for easy reference
export const SessionStates = {
  IDLE: 'idle',
  LOADING: 'loading',
  ACTIVE: 'active',
  DEBOUNCING: 'debouncing',
  CLEANING_UP: 'cleaningUp',
  INITIALIZING: 'initializing',
  CLEANUP: 'cleanup',
  ERROR: 'error',
} as const;

export type SessionState = (typeof SessionStates)[keyof typeof SessionStates];

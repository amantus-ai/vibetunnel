import { interpret } from 'robot3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../client/components/session-list.js';
import {
  SessionStates,
  sessionMachine,
} from '../client/components/session-view/session-state-machine.js';

describe('SessionStateMachine', () => {
  let mockConnectionManager: any;
  let mockTerminalLifecycleManager: any;
  let mockTerminal: any;
  let mockSession: Session;

  beforeEach(() => {
    // Create mock managers
    mockConnectionManager = {
      connectToStream: vi.fn(),
      cleanupStreamConnection: vi.fn().mockResolvedValue(undefined),
    };

    mockTerminalLifecycleManager = {
      setupTerminal: vi.fn(),
    };

    mockTerminal = {
      clear: vi.fn(),
    };

    mockSession = {
      id: 'session-1',
      name: 'Test Session',
      status: 'running',
      pid: 1234,
      command: ['bash'],
      startTime: new Date().toISOString(),
    };
  });

  describe('State transitions', () => {
    it('should start in idle state', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: null,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      expect(service.machine.current).toBe('idle');
    });

    it('should transition from idle to loading when session is set', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: null,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      service.send({ type: 'setSession', session: mockSession });
      expect(service.machine.current).toBe('loading');
      expect(service.context.session).toBe(mockSession);
    });

    it('should not transition from idle when session is null', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: null,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      service.send({ type: 'setSession', session: null });
      expect(service.machine.current).toBe('idle');
    });

    it('should update session properties in active state for same session', () => {
      const updatedSession = { ...mockSession, name: 'Updated Name' };

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to active state
      service.machine.current = 'active';

      service.send({ type: 'setSession', session: updatedSession });
      expect(service.machine.current).toBe('active');
      expect(service.context.session?.name).toBe('Updated Name');
    });

    it('should transition to debouncing when switching to different session', () => {
      const newSession = { ...mockSession, id: 'session-2' };

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to active state
      service.machine.current = 'active';

      service.send({ type: 'setSession', session: newSession });
      expect(service.machine.current).toBe('debouncing');
      expect(service.context.previousSession).toBe(mockSession);
      expect(service.context.session).toBe(newSession);
    });

    it('should handle rapid session switches during debouncing', () => {
      const session2 = { ...mockSession, id: 'session-2' };
      const session3 = { ...mockSession, id: 'session-3' };

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to debouncing state
      service.machine.current = 'debouncing';
      service.context.session = session2;

      // Switch again during debounce
      service.send({ type: 'setSession', session: session3 });
      expect(service.machine.current).toBe('debouncing');
      expect(service.context.session).toBe(session3);
    });

    it('should transition from debouncing to cleaningUp on debounceComplete', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to debouncing state
      service.machine.current = 'debouncing';

      service.send({ type: 'debounceComplete' });
      expect(service.machine.current).toBe('cleaningUp');
    });

    it('should transition to cleanup when session is cleared', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to active state
      service.machine.current = 'active';

      service.send({ type: 'clearSession' });
      expect(service.machine.current).toBe('cleanup');
    });

    it('should handle errors and allow retry', () => {
      const error = new Error('Test error');

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to error state
      service.machine.current = 'error';
      service.context.error = error;

      service.send({ type: 'retry' });
      expect(service.machine.current).toBe('loading');
    });

    it('should recover from error with new session', () => {
      const newSession = { ...mockSession, id: 'session-2' };

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: new Error('Test error'),
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to error state
      service.machine.current = 'error';

      service.send({ type: 'setSession', session: newSession });
      expect(service.machine.current).toBe('loading');
      expect(service.context.session).toBe(newSession);
      expect(service.context.error).toBeNull();
    });
  });

  describe('Manager interactions', () => {
    it('should call setupTerminal and connectToStream on loading', async () => {
      const service = interpret(sessionMachine, () => {}, {
        session: null,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      service.send({ type: 'setSession', session: mockSession });

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTerminalLifecycleManager.setupTerminal).toHaveBeenCalled();
      expect(mockConnectionManager.connectToStream).toHaveBeenCalled();
    });

    it('should cleanup managers when transitioning to cleanup', async () => {
      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to cleanup state and trigger the invoke
      service.machine.current = 'cleanup';
      const cleanupInvoke = sessionMachine.states.cleanup.invoke;
      if (cleanupInvoke) {
        await cleanupInvoke.fn(service.context);
      }

      expect(mockConnectionManager.cleanupStreamConnection).toHaveBeenCalled();
      expect(mockTerminal.clear).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockConnectionManager.cleanupStreamConnection.mockRejectedValue(new Error('Cleanup failed'));

      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to cleanup state and trigger the invoke
      service.machine.current = 'cleanup';
      const cleanupInvoke = sessionMachine.states.cleanup.invoke;
      if (cleanupInvoke) {
        // Should not throw even if cleanup fails
        await expect(cleanupInvoke.fn(service.context)).resolves.not.toThrow();
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid session switching during initial load', () => {
      const session2 = { ...mockSession, id: 'session-2' };

      const service = interpret(sessionMachine, () => {}, {
        session: null,
        previousSession: null,
        error: null,
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Start loading first session
      service.send({ type: 'setSession', session: mockSession });
      expect(service.machine.current).toBe('loading');

      // Switch to second session before first completes
      service.send({ type: 'setSession', session: session2 });
      expect(service.machine.current).toBe('debouncing');
      expect(service.context.previousSession).toBe(mockSession);
      expect(service.context.session).toBe(session2);
    });

    it('should handle missing managers gracefully', async () => {
      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: null,
        error: null,
        connectionManager: null,
        terminalLifecycleManager: null,
        terminal: null,
      });

      // Force to loading state and trigger the invoke
      service.machine.current = 'loading';
      const loadingInvoke = sessionMachine.states.loading.invoke;
      if (loadingInvoke) {
        // Should not throw even with null managers
        await expect(loadingInvoke.fn(service.context)).resolves.not.toThrow();
      }
    });

    it('should clear all state when returning to idle', () => {
      const service = interpret(sessionMachine, () => {}, {
        session: mockSession,
        previousSession: mockSession,
        error: new Error('Test'),
        connectionManager: mockConnectionManager,
        terminalLifecycleManager: mockTerminalLifecycleManager,
        terminal: mockTerminal,
      });

      // Force to cleanup state
      service.machine.current = 'cleanup';

      // Trigger done transition
      service.send({ type: 'done' });

      // Check context is cleared
      const finalContext = service.context;
      expect(finalContext.session).toBeNull();
      expect(finalContext.previousSession).toBeNull();
      expect(finalContext.error).toBeNull();
    });
  });
});

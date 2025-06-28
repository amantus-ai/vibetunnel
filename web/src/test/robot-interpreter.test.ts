import { createMachine, reduce, state, transition } from 'robot3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RobotInterpreter } from '../client/components/session-view/robot-interpreter.js';

describe('RobotInterpreter', () => {
  // Simple test machine
  const testMachine = createMachine(
    {
      idle: state(
        transition(
          'start',
          'active',
          reduce((context: any) => ({ ...context, started: true }))
        ),
        transition('error', 'error')
      ),
      active: state(
        transition(
          'stop',
          'idle',
          reduce((context: any) => ({ ...context, started: false }))
        ),
        transition(
          'update',
          'active',
          reduce((context: any, event: any) => ({ ...context, value: event.value }))
        )
      ),
      error: state(
        transition(
          'reset',
          'idle',
          reduce(() => ({ started: false, value: null }))
        )
      ),
    },
    () => ({ started: false, value: null })
  );

  let interpreter: RobotInterpreter<any>;
  let mockListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    interpreter = new RobotInterpreter(testMachine, { started: false, value: null });
    mockListener = vi.fn();
  });

  describe('State management', () => {
    it('should start in initial state', () => {
      expect(interpreter.getState()).toBe('idle');
    });

    it('should return current context', () => {
      expect(interpreter.getContext()).toEqual({ started: false, value: null });
    });

    it('should transition states on events', () => {
      interpreter.send({ type: 'start' });
      expect(interpreter.getState()).toBe('active');
      expect(interpreter.getContext().started).toBe(true);
    });

    it('should update context with event data', () => {
      interpreter.send({ type: 'start' });
      interpreter.send({ type: 'update', value: 'test-value' });

      expect(interpreter.getState()).toBe('active');
      expect(interpreter.getContext().value).toBe('test-value');
    });

    it('should handle multiple state transitions', () => {
      interpreter.send({ type: 'start' });
      expect(interpreter.getState()).toBe('active');

      interpreter.send({ type: 'stop' });
      expect(interpreter.getState()).toBe('idle');
      expect(interpreter.getContext().started).toBe(false);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state change', () => {
      const unsubscribe = interpreter.subscribe(mockListener);

      // Should be called immediately with current state
      expect(mockListener).toHaveBeenCalledWith('idle', { started: false, value: null });
      expect(mockListener).toHaveBeenCalledTimes(1);

      // Should be called on state change
      interpreter.send({ type: 'start' });
      expect(mockListener).toHaveBeenCalledTimes(2);
      expect(mockListener).toHaveBeenLastCalledWith('active', { started: true, value: null });

      unsubscribe();
    });

    it('should support multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      interpreter.subscribe(listener1);
      interpreter.subscribe(listener2);

      interpreter.send({ type: 'start' });

      expect(listener1).toHaveBeenCalledTimes(2); // Initial + transition
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it('should stop notifying after unsubscribe', () => {
      const unsubscribe = interpreter.subscribe(mockListener);

      interpreter.send({ type: 'start' });
      expect(mockListener).toHaveBeenCalledTimes(2);

      unsubscribe();

      interpreter.send({ type: 'stop' });
      expect(mockListener).toHaveBeenCalledTimes(2); // No new calls
    });
  });

  describe('Context updates', () => {
    it('should update context externally', () => {
      interpreter.subscribe(mockListener);

      interpreter.updateContext({ value: 'external-update' });

      expect(interpreter.getContext().value).toBe('external-update');
      expect(mockListener).toHaveBeenCalledTimes(2); // Initial + update
      expect(mockListener).toHaveBeenLastCalledWith('idle', {
        started: false,
        value: 'external-update',
      });
    });

    it('should merge context updates', () => {
      interpreter.send({ type: 'start' });
      interpreter.updateContext({ value: 'test' });

      const context = interpreter.getContext();
      expect(context.started).toBe(true); // Preserved
      expect(context.value).toBe('test'); // Updated
    });
  });

  describe('Error handling', () => {
    it('should handle send errors gracefully', () => {
      // Create a machine that throws on certain events
      const errorMachine = createMachine({
        idle: state(
          transition('boom', 'idle', () => {
            throw new Error('Boom!');
          })
        ),
      });

      const errorInterpreter = new RobotInterpreter(errorMachine, {});

      // Should not throw
      expect(() => errorInterpreter.send({ type: 'boom' })).not.toThrow();
    });

    it('should send error event on failure', () => {
      const errorListener = vi.fn();
      interpreter.subscribe(errorListener);

      // Force an error by sending to error state
      interpreter.send({ type: 'error' });

      expect(interpreter.getState()).toBe('error');
    });
  });

  describe('State checking', () => {
    it('should check if in specific state', () => {
      expect(interpreter.isInState('idle')).toBe(true);
      expect(interpreter.isInState('active')).toBe(false);

      interpreter.send({ type: 'start' });

      expect(interpreter.isInState('idle')).toBe(false);
      expect(interpreter.isInState('active')).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      const listener = vi.fn();
      interpreter.subscribe(listener);

      interpreter.destroy();

      // Should not notify after destroy
      expect(() => interpreter.send({ type: 'start' })).not.toThrow();
      expect(listener).toHaveBeenCalledTimes(1); // Only initial call
    });

    it('should clear all listeners on destroy', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      interpreter.subscribe(listener1);
      interpreter.subscribe(listener2);

      interpreter.destroy();

      // Try to update context - should not notify
      interpreter.updateContext({ value: 'after-destroy' });

      expect(listener1).toHaveBeenCalledTimes(1); // Only initial
      expect(listener2).toHaveBeenCalledTimes(1); // Only initial
    });
  });

  describe('Integration with async machines', () => {
    it('should handle synchronous send for async invocations', () => {
      // Robot handles async internally, our send is always sync
      const asyncMachine = createMachine({
        idle: state(transition('load', 'loading')),
        loading: state(transition('done', 'loaded'), transition('error', 'failed')),
        loaded: state(),
        failed: state(),
      });

      const asyncInterpreter = new RobotInterpreter(asyncMachine, {});

      // Send is synchronous
      asyncInterpreter.send({ type: 'load' });
      expect(asyncInterpreter.getState()).toBe('loading');

      // Simulate async completion
      asyncInterpreter.send({ type: 'done' });
      expect(asyncInterpreter.getState()).toBe('loaded');
    });
  });
});

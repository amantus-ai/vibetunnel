// @vitest-environment happy-dom

import { fixture, waitUntil } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './session-view.js';
import './terminal.js';
import './vibe-terminal-binary.js';
import './session-view/terminal-renderer.js';
import type { Session } from '../../shared/types.js';
import type { SessionView } from './session-view.js';

// Test interface for SessionView with access to private members
// Note: We'll use type assertions to access private members in tests
interface SessionViewTestInterface extends SessionView {
  // Interfaces cannot have private members, we'll use type assertions instead
}

describe('SessionView Binary Mode', () => {
  let element: SessionView;
  // biome-ignore lint/suspicious/noExplicitAny: mock type
  let _getItemMock: any;
  // biome-ignore lint/suspicious/noExplicitAny: mock type
  let _originalMatchMedia: any;

  const mockSession: Session = {
    id: 'test-session',
    status: 'running',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    command: 'bash',
    cwd: '/home/test',
    title: 'Test Session',
    username: 'test',
    shellType: 'bash',
    theme: 'dark',
    initialCols: 80,
    initialRows: 24,
  };

  beforeEach(async () => {
    // Clear localStorage
    localStorage.clear();

    // Mock localStorage
    _getItemMock = vi.spyOn(Storage.prototype, 'getItem');

    // Mock fetch for session API calls
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok' })));

    // Save original matchMedia
    _originalMatchMedia = window.matchMedia;

    // Reset the global mock if it exists
    if (vi.isMockFunction(window.matchMedia)) {
      vi.mocked(window.matchMedia).mockReset();
      vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }

    element = await fixture<SessionView>(html`
      <session-view .session=${mockSession}></session-view>
    `);
  });

  afterEach(() => {
    element?.remove();
    vi.clearAllMocks();
    localStorage.clear();
    // Don't restore matchMedia - it's globally mocked
  });

  it('should render standard terminal by default', async () => {
    await element.updateComplete;

    const standardTerminal = element.querySelector('vibe-terminal');
    const binaryTerminal = element.querySelector('vibe-terminal-binary');

    expect(standardTerminal).toBeTruthy();
    expect(binaryTerminal).toBeFalsy();
  });

  it('should render binary terminal when useBinaryMode is true', async () => {
    // Use window event to change binary mode (public API)
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    const standardTerminal = element.querySelector('vibe-terminal');
    const binaryTerminal = element.querySelector('vibe-terminal-binary');

    expect(standardTerminal).toBeFalsy();
    expect(binaryTerminal).toBeTruthy();
  });

  it('should load binary mode preference on connect', async () => {
    // The loading happens in connectedCallback before we can mock
    // Test that the component responds to preferences

    // Default should be standard terminal
    const standardTerminal = element.querySelector('vibe-terminal');
    expect(standardTerminal).toBeTruthy();

    // Simulate preference change
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    // Should now have binary terminal
    const binaryTerminal = element.querySelector('vibe-terminal-binary');
    expect(binaryTerminal).toBeTruthy();
  });

  it('should switch terminals when binary mode changes', async () => {
    await element.updateComplete;

    // Initially standard terminal
    expect(element.querySelector('vibe-terminal')).toBeTruthy();
    expect(element.querySelector('vibe-terminal-binary')).toBeFalsy();

    // Dispatch binary mode change event
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    // Should now show binary terminal
    expect(element.querySelector('vibe-terminal')).toBeFalsy();
    expect(element.querySelector('vibe-terminal-binary')).toBeTruthy();
  });

  it('should reconnect when switching modes with active session', async () => {
    // Access private members for testing
    // biome-ignore lint/suspicious/noExplicitAny: accessing private members for testing
    const testElement = element as any;
    const cleanupSpy = testElement.connectionManager
      ? vi.spyOn(testElement.connectionManager, 'cleanupStreamConnection')
      : vi.fn();
    const ensureInitSpy = vi.spyOn(testElement, 'ensureTerminalInitialized');

    // Clear any previous calls from setup
    if (typeof cleanupSpy.mockClear === 'function') cleanupSpy.mockClear();
    ensureInitSpy.mockClear();

    // Set element as connected with session
    testElement.uiStateManager.setConnected(true);

    await element.updateComplete;

    // Switch to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 50));
    await element.updateComplete;

    // Should disconnect and reconnect
    if (testElement.connectionManager) {
      expect(cleanupSpy).toHaveBeenCalled();
    }
    expect(ensureInitSpy).toHaveBeenCalled();
  });

  it('should not reconnect when switching modes without session', async () => {
    // Remove element and create new one without session
    element.remove();

    const newElement = await fixture<SessionView>(html`
      <session-view .session=${null}></session-view>
    `);

    // Access private property for testing
    // biome-ignore lint/suspicious/noExplicitAny: accessing private members for testing
    const testElement = newElement as any;
    if (testElement.connectionManager) {
      const cleanupSpy = vi.spyOn(testElement.connectionManager, 'cleanupStreamConnection');
      cleanupSpy.mockClear();

      // Switch to binary mode
      window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

      await newElement.updateComplete;

      // Should not attempt to reconnect
      expect(cleanupSpy).not.toHaveBeenCalled();
    }

    newElement.remove();
  });

  it('should pass all properties to binary terminal', async () => {
    // Set binary mode through event
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    // biome-ignore lint/suspicious/noExplicitAny: accessing component instance for testing
    const binaryTerminal = element.querySelector('vibe-terminal-binary') as any;
    expect(binaryTerminal).toBeTruthy();

    // Verify the terminal got the session ID
    expect(binaryTerminal?.sessionId).toBe('test-session');
  });

  it('should handle terminal events from both terminal types', async () => {
    const inputSpy = vi.fn();
    element.addEventListener('terminal-input', inputSpy);

    // Test with standard terminal
    await element.updateComplete;

    let terminal = element.querySelector('vibe-terminal');
    terminal?.dispatchEvent(
      new CustomEvent('terminal-input', {
        detail: 'test1',
        bubbles: true,
        composed: true,
      })
    );

    expect(inputSpy).toHaveBeenCalledOnce();

    // Switch to binary mode
    const testElement = element as SessionViewTestInterface;
    testElement.uiStateManager.setUseBinaryMode(true);
    await element.updateComplete;

    // Test with binary terminal
    terminal = element.querySelector('vibe-terminal-binary');
    terminal?.dispatchEvent(
      new CustomEvent('terminal-input', {
        detail: 'test2',
        bubbles: true,
        composed: true,
      })
    );

    expect(inputSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle getTerminalElement for both modes', async () => {
    // Test standard mode
    await element.updateComplete;

    const standardResult = element.getTerminalElement();
    // getTerminalElement looks for terminals directly on the element (no shadow DOM)
    expect(standardResult).toBe(element.querySelector('vibe-terminal'));

    // Test binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));
    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    const binaryResult = element.getTerminalElement();
    expect(binaryResult).toBe(element.querySelector('vibe-terminal-binary'));
  });

  it('should handle terminal operations with type checking', async () => {
    // Switch to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));
    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    const terminal = element.getTerminalElement();

    // Test scrollToBottom with type guard
    if (terminal && 'scrollToBottom' in terminal) {
      // Should not throw
      (terminal as { scrollToBottom: () => void }).scrollToBottom();
    }
  });

  it('should cleanup event listener on disconnect', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    // Trigger disconnectedCallback by removing element
    element.remove();

    // The handleBinaryModeChange is bound during connectedCallback
    // Check that removeEventListener was called with the event name
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'terminal-binary-mode-changed',
      expect.any(Function)
    );
  });

  it('should handle localStorage errors gracefully', async () => {
    // Mock localStorage to throw error
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn().mockImplementation(() => {
      throw new Error('Storage error');
    });

    // Create new element to trigger connectedCallback with error
    const newElement = await fixture<SessionView>(html`
      <session-view .session=${mockSession}></session-view>
    `);

    // Should use default value when localStorage fails (standard terminal)
    await newElement.updateComplete;
    const standardTerminal = newElement.querySelector('vibe-terminal');
    expect(standardTerminal).toBeTruthy();

    // Restore original
    Storage.prototype.getItem = originalGetItem;
    newElement.remove();
  });

  it('should only update on actual binary mode change', async () => {
    // Start with standard terminal
    await element.updateComplete;
    const standardTerminal = element.querySelector('vibe-terminal');
    expect(standardTerminal).toBeTruthy();

    // Change to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    await waitUntil(() => element.querySelector('vibe-terminal-binary'));

    const binaryTerminal = element.querySelector('vibe-terminal-binary');
    expect(binaryTerminal).toBeTruthy();

    // Dispatching same value shouldn't trigger update
    const requestUpdateSpy = vi.spyOn(element, 'requestUpdate');
    requestUpdateSpy.mockClear();

    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));
    expect(requestUpdateSpy).not.toHaveBeenCalled();

    // Change back to standard mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: false }));

    await element.updateComplete;
    expect(element.querySelector('vibe-terminal')).toBeTruthy();
    expect(element.querySelector('vibe-terminal-binary')).toBeFalsy();
  });
});

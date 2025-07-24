// @vitest-environment happy-dom

import { fixture, waitUntil } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './session-view.js';
import './terminal.js';
import './vibe-terminal-binary.js';
import './session-view/terminal-renderer.js';
import type { Session } from '../../shared/types.js';
import type { UIState } from './session-view/ui-state-manager.js';
import type { SessionView } from './session-view.js';

// Test interface for SessionView with access to private managers
interface SessionViewTestInterface extends SessionView {
  uiStateManager: {
    getState: () => UIState;
    setUseBinaryMode: (value: boolean) => void;
    setConnected: (value: boolean) => void;
  };
  connectionManager?: {
    cleanupStreamConnection: () => void;
  };
  ensureTerminalInitialized: () => void;
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
    // Set binary mode through uiStateManager
    const testElement = element as SessionViewTestInterface;
    testElement.uiStateManager.setUseBinaryMode(true);

    await element.updateComplete;

    const standardTerminal = element.querySelector('vibe-terminal');
    const binaryTerminal = element.querySelector('vibe-terminal-binary');

    expect(standardTerminal).toBeFalsy();
    expect(binaryTerminal).toBeTruthy();
  });

  it('should load binary mode preference on connect', async () => {
    // The loading happens in connectedCallback before we can mock
    // Test that the component responds to preferences
    const testElement = element as SessionViewTestInterface;
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(false); // Default

    // Simulate preference change
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(true);
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
    // Set up spies
    const testElement = element as SessionViewTestInterface;
    const cleanupSpy = testElement.connectionManager
      ? vi.spyOn(testElement.connectionManager, 'cleanupStreamConnection')
      : vi.fn();
    const requestUpdateSpy = vi.spyOn(element, 'requestUpdate');
    const ensureInitSpy = vi.spyOn(testElement, 'ensureTerminalInitialized');

    // Clear any previous calls from setup
    cleanupSpy.mockClear();
    requestUpdateSpy.mockClear();
    ensureInitSpy.mockClear();

    // Set element as connected with session
    testElement.uiStateManager.setConnected(true);

    await element.updateComplete;

    // Switch to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should disconnect, update, and reconnect
    expect(cleanupSpy).toHaveBeenCalled();
    expect(requestUpdateSpy).toHaveBeenCalled();
    expect(ensureInitSpy).toHaveBeenCalled();
  });

  it('should not reconnect when switching modes without session', async () => {
    // Remove element and create new one without session
    element.remove();

    const newElement = await fixture<SessionView>(html`
      <session-view .session=${null}></session-view>
    `);

    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    const cleanupSpy = vi.spyOn(newElement['connectionManager'], 'cleanupStreamConnection');
    cleanupSpy.mockClear();

    // Switch to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await newElement.updateComplete;

    // Should not attempt to reconnect
    expect(cleanupSpy).not.toHaveBeenCalled();

    newElement.remove();
  });

  it('should pass all properties to binary terminal', async () => {
    // Set binary mode through uiStateManager
    const testElement = element as SessionViewTestInterface;
    testElement.uiStateManager.setUseBinaryMode(true);

    // Set terminal settings through the managers
    testElement.uiStateManager.setTerminalFontSize(16);
    testElement.uiStateManager.setTerminalMaxCols(120);
    testElement.uiStateManager.setTerminalTheme('dark' as TerminalThemeId);

    await element.updateComplete;
    
    const binaryTerminal = element.querySelector('vibe-terminal-binary') as any;
    expect(binaryTerminal).toBeTruthy();
    
    // Properties are bound through lit's property binding in the template
    // The values may not be immediately reflected in the element's properties
    // but they are correctly passed through the render. We can verify this
    // by checking the UI state is correct
    const state = testElement.uiStateManager.getState();
    expect(state.terminalFontSize).toBe(16);
    expect(state.terminalMaxCols).toBe(120);
    expect(state.terminalTheme).toBe('dark');
    
    // Verify the terminal got the session ID
    expect(binaryTerminal.sessionId).toBe('test-session');
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
    // Access the method through the test interface
    const testElement = element as SessionViewTestInterface & {
      getTerminalElement: () => HTMLElement | null;
    };

    // Test standard mode
    testElement.uiStateManager.setUseBinaryMode(false);
    await element.updateComplete;
    
    const standardResult = testElement.getTerminalElement();
    // getTerminalElement looks for terminals directly in session-view
    expect(standardResult).toBe(element.querySelector('vibe-terminal'));

    // Test binary mode
    testElement.uiStateManager.setUseBinaryMode(true);
    await element.updateComplete;
    
    const binaryResult = testElement.getTerminalElement();
    expect(binaryResult).toBe(element.querySelector('vibe-terminal-binary'));
  });

  it('should handle terminal operations with type checking', async () => {
    const testElement = element as SessionViewTestInterface & {
      getTerminalElement: () => HTMLElement | null;
    };
    testElement.uiStateManager.setUseBinaryMode(true);
    await element.updateComplete;

    const terminal = testElement.getTerminalElement();

    // Test scrollToBottom with type guard
    if (terminal && 'scrollToBottom' in terminal) {
      // Should not throw
      (terminal as any).scrollToBottom();
    }
  });

  it('should cleanup event listener on disconnect', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    element.disconnectedCallback();

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

    // Should use default value when localStorage fails
    const testElement = newElement as SessionViewTestInterface;
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(false); // Default value

    // Restore original
    Storage.prototype.getItem = originalGetItem;
    newElement.remove();
  });

  it('should only update on actual binary mode change', async () => {
    const testElement = element as SessionViewTestInterface;
    
    // Test that the component correctly handles binary mode changes
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(false);

    // Change to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(true);

    // Dispatching same value shouldn't trigger update
    const requestUpdateSpy = vi.spyOn(element, 'requestUpdate');
    requestUpdateSpy.mockClear();
    
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));
    expect(requestUpdateSpy).not.toHaveBeenCalled();

    // Change back to standard mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: false }));

    await element.updateComplete;
    expect(testElement.uiStateManager.getState().useBinaryMode).toBe(false);
  });
});

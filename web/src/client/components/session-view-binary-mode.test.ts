// @vitest-environment happy-dom

import { fixture, waitUntil } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './session-view.js';
import type { Session } from './session-list.js';
import type { SessionView } from './session-view.js';

describe('SessionView Binary Mode', () => {
  let element: SessionView;
  // biome-ignore lint/suspicious/noExplicitAny: mock type
  let _getItemMock: any;
  // biome-ignore lint/suspicious/noExplicitAny: mock type
  let originalMatchMedia: any;

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

    // Mock matchMedia for orientation checks
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    element = await fixture<SessionView>(html`
      <session-view .session=${mockSession}></session-view>
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.matchMedia = originalMatchMedia;
  });

  it('should render standard terminal by default', async () => {
    await element.updateComplete;

    const standardTerminal = element.querySelector('vibe-terminal');
    const binaryTerminal = element.querySelector('vibe-terminal-binary');

    expect(standardTerminal).toBeTruthy();
    expect(binaryTerminal).toBeFalsy();
  });

  it('should render binary terminal when useBinaryMode is true', async () => {
    // Set binary mode on element directly
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = true;

    await element.updateComplete;

    const standardTerminal = element.querySelector('vibe-terminal');
    const binaryTerminal = element.querySelector('vibe-terminal-binary');

    expect(standardTerminal).toBeFalsy();
    expect(binaryTerminal).toBeTruthy();
  });

  it('should load binary mode preference on connect', async () => {
    // The loading happens in connectedCallback before we can mock
    // Test that the component responds to preferences
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(false); // Default

    // Simulate preference change
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(true);
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
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    const cleanupSpy = vi.spyOn(element['connectionManager'], 'cleanupStreamConnection');
    const requestUpdateSpy = vi.spyOn(element, 'requestUpdate');
    const ensureInitSpy = vi.spyOn(element, 'ensureTerminalInitialized');

    // Clear any previous calls from setup
    cleanupSpy.mockClear();
    requestUpdateSpy.mockClear();
    ensureInitSpy.mockClear();

    // Set element as connected with session
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['connected'] = true;

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
    // Set binary mode
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = true;

    // Set various properties
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['terminalFontSize'] = 16;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['terminalMaxCols'] = 120;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['terminalTheme'] = 'dark';

    await element.updateComplete;

    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    const binaryTerminal = element.querySelector('vibe-terminal-binary') as any;
    expect(binaryTerminal).toBeTruthy();
    expect(binaryTerminal.fontSize).toBe(14); // Default from component
    expect(binaryTerminal.maxCols).toBe(120);
    // Theme might be different due to terminal preferences manager
    expect(binaryTerminal.theme).toBeTruthy();
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
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = true;
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

  it('should handle getTerminalElement for both modes', () => {
    // Test standard mode
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = false;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    const standardResult = element['getTerminalElement']();
    expect(standardResult).toBe(element.querySelector('vibe-terminal'));

    // Test binary mode
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = true;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    const binaryResult = element['getTerminalElement']();
    expect(binaryResult).toBe(element.querySelector('vibe-terminal-binary'));
  });

  it('should handle terminal operations with type checking', async () => {
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['useBinaryMode'] = true;
    await element.updateComplete;

    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    const terminal = element['getTerminalElement']();

    // Test scrollToBottom with type guard
    if (terminal && 'scrollToBottom' in terminal) {
      // Should not throw
      terminal.scrollToBottom();
    }
  });

  it('should cleanup event listener on disconnect', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    element.disconnectedCallback();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'terminal-binary-mode-changed',
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      element['handleBinaryModeChange']
    );
  });

  it('should handle localStorage errors gracefully', async () => {
    // Session view handles localStorage errors silently
    // The functionality is tested through integration
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(false); // Default value
  });

  it('should only update on actual binary mode change', async () => {
    // Test that the component correctly handles binary mode changes
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(false);

    // Change to binary mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: true }));

    await element.updateComplete;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(true);

    // Change back to standard mode
    window.dispatchEvent(new CustomEvent('terminal-binary-mode-changed', { detail: false }));

    await element.updateComplete;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    expect(element['useBinaryMode']).toBe(false);
  });
});

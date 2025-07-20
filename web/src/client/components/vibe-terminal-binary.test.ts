// @vitest-environment happy-dom

import { fixture } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './vibe-terminal-binary.js';
import { authClient } from '../services/auth-client.js';
import type { VibeTerminalBinary } from './vibe-terminal-binary.js';

describe('VibeTerminalBinary', () => {
  let element: VibeTerminalBinary;

  beforeEach(async () => {
    // Mock fetch
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response());

    // Mock auth client
    vi.spyOn(authClient, 'getCurrentUser').mockReturnValue({
      email: 'test@example.com',
      token: 'test-token',
    });

    element = await fixture<VibeTerminalBinary>(html`
      <vibe-terminal-binary
        .sessionId=${'test-session-id'}
        .cols=${80}
        .rows=${24}
        .fontSize=${14}
      ></vibe-terminal-binary>
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render terminal container', () => {
    const container = element.querySelector('#terminal-container');
    expect(container).toBeTruthy();
    expect(container?.classList.contains('terminal-scroll-container')).toBe(true);
  });

  it('should initialize with default properties', () => {
    expect(element.sessionStatus).toBe('running');
    expect(element.cols).toBe(80);
    expect(element.rows).toBe(24);
    expect(element.fontSize).toBe(14);
    expect(element.userOverrideWidth).toBe(false);
  });

  it('should dispatch terminal-ready event on first update', async () => {
    // Create a fresh element to capture the event
    const readyHandler = vi.fn();

    const freshElement = await fixture<VibeTerminalBinary>(html`
      <vibe-terminal-binary
        .sessionId=${'test-session-id-2'}
        .cols=${80}
        .rows=${24}
        .fontSize=${14}
        @terminal-ready=${readyHandler}
      ></vibe-terminal-binary>
    `);

    // Wait for update to complete
    await freshElement.updateComplete;

    // Event should have been dispatched
    expect(readyHandler).toHaveBeenCalledTimes(1);
    expect(readyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'terminal-ready',
      })
    );

    freshElement.remove();
  });

  it('should handle font size changes', async () => {
    const newFontSize = 18;

    // Dispatch font size change event
    window.dispatchEvent(new CustomEvent('terminal-font-size-changed', { detail: newFontSize }));

    await element.updateComplete;
    expect(element.fontSize).toBe(newFontSize);
  });

  it('should handle theme changes', async () => {
    const newTheme = 'dark';

    // Dispatch theme change event
    window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: newTheme }));

    await element.updateComplete;
    expect(element.theme).toBe(newTheme);
  });

  it('should send input text via HTTP POST', async () => {
    const testText = 'test input';

    // Call sendInputText directly (it's private, so we access it via any)
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    await (element as any).sendInputText(testText);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(window.fetch).toHaveBeenCalledWith('/api/sessions/test-session-id/input', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ text: testText }),
    });
  });

  it('should dispatch terminal-input event after sending input', async () => {
    const testText = 'test input';
    const inputPromise = new Promise<string>((resolve) => {
      element.addEventListener(
        'terminal-input',
        (e: Event) => {
          resolve((e as CustomEvent).detail);
        },
        { once: true }
      );
    });

    // Call sendInputText
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    await (element as any).sendInputText(testText);

    const detail = await inputPromise;
    expect(detail).toBe(testText);
  });

  it('should handle special keys in keydown', () => {
    const preventDefaultMock = vi.fn();
    const stopPropagationMock = vi.fn();

    // Test Enter key
    let event = new KeyboardEvent('keydown', { key: 'Enter' });
    event.preventDefault = preventDefaultMock;
    event.stopPropagation = stopPropagationMock;

    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    (element as any).handleKeydown(event);

    expect(preventDefaultMock).toHaveBeenCalled();
    expect(stopPropagationMock).toHaveBeenCalled();
    expect(window.fetch).toHaveBeenCalledWith(
      '/api/sessions/test-session-id/input',
      expect.objectContaining({
        body: JSON.stringify({ text: '\r' }),
      })
    );

    // Reset mocks
    vi.clearAllMocks();

    // Test Arrow Up
    event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    event.preventDefault = preventDefaultMock;
    event.stopPropagation = stopPropagationMock;

    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    (element as any).handleKeydown(event);

    expect(window.fetch).toHaveBeenCalledWith(
      '/api/sessions/test-session-id/input',
      expect.objectContaining({
        body: JSON.stringify({ text: '\x1b[A' }),
      })
    );
  });

  it('should handle Ctrl key combinations', () => {
    // Test Ctrl+C
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    event.preventDefault = vi.fn();
    event.stopPropagation = vi.fn();

    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    (element as any).handleKeydown(event);

    expect(window.fetch).toHaveBeenCalledWith(
      '/api/sessions/test-session-id/input',
      expect.objectContaining({
        body: JSON.stringify({ text: '\x03' }), // Ctrl+C = ASCII 3
      })
    );
  });

  it('should show scroll to bottom button when not at bottom', async () => {
    // Set up scroll state
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['showScrollToBottomButton'] = true;
    await element.updateComplete;

    const button = element.querySelector('button[title="Scroll to bottom"]');
    expect(button).toBeTruthy();
  });

  it('should hide scroll to bottom button when hideScrollButton is true', async () => {
    element.hideScrollButton = true;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['showScrollToBottomButton'] = true;
    await element.updateComplete;

    const button = element.querySelector('button[title="Scroll to bottom"]');
    expect(button).toBeFalsy();
  });

  it('should scroll to bottom when button is clicked', async () => {
    // Mock scroll container
    const scrollContainer = element.querySelector('.terminal-scroll-container') as HTMLElement;
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        value: 1000,
        writable: true,
      });

      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      element['showScrollToBottomButton'] = true;
      await element.updateComplete;

      const button = element.querySelector('button[title="Scroll to bottom"]') as HTMLButtonElement;
      button?.click();

      // scrollToBottom should set scrollTop to scrollHeight
      expect(scrollContainer.scrollTop).toBe(1000);
    }
  });

  it('should handle resize events', async () => {
    const resizePromise = new Promise<{ cols: number; rows: number }>((resolve) => {
      element.addEventListener(
        'terminal-resize',
        (e: Event) => {
          resolve((e as CustomEvent).detail);
        },
        { once: true }
      );
    });

    // Update dimensions
    element.cols = 100;
    element.rows = 30;
    await element.updateComplete;

    // Force size update
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    (element as any).updateTerminalSize();

    const detail = await resizePromise;
    expect(typeof detail.cols).toBe('number');
    expect(typeof detail.rows).toBe('number');
  });

  it('should apply max columns constraint', () => {
    element.maxCols = 120;
    element.fitHorizontally = true; // Enable horizontal fitting to apply maxCols constraint

    // Mock terminal container dimensions
    const container = element.querySelector('#terminal-container') as HTMLElement;
    if (container) {
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        width: 1000, // Wide enough for more than 120 columns
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

      // biome-ignore lint/suspicious/noExplicitAny: casting for testing
      (element as any).updateTerminalSize();

      // Should be capped at maxCols (or very close due to rounding)
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      expect(element['currentCols']).toBeLessThanOrEqual(120);
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      expect(element['currentCols']).toBeGreaterThanOrEqual(119);
    }
  });

  it('should focus hidden input when focus is called', () => {
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    const hiddenInput = (element as any).hiddenInput as HTMLInputElement;
    const focusMock = vi.spyOn(hiddenInput, 'focus');

    element.focus();

    expect(focusMock).toHaveBeenCalledTimes(1);
  });

  it('should blur hidden input when blur is called', () => {
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    const hiddenInput = (element as any).hiddenInput as HTMLInputElement;
    const blurMock = vi.spyOn(hiddenInput, 'blur');

    element.blur();

    expect(blurMock).toHaveBeenCalledTimes(1);
  });

  it('should handle input event from hidden input', () => {
    // biome-ignore lint/suspicious/noExplicitAny: casting for testing
    const hiddenInput = (element as any).hiddenInput as HTMLInputElement;
    hiddenInput.value = 'test text';

    // Trigger input event
    hiddenInput.dispatchEvent(new Event('input'));

    // Should clear input and send text
    expect(hiddenInput.value).toBe('');
    expect(window.fetch).toHaveBeenCalledWith(
      '/api/sessions/test-session-id/input',
      expect.objectContaining({
        body: JSON.stringify({ text: 'test text' }),
      })
    );
  });

  it('should set user override width', () => {
    expect(element.userOverrideWidth).toBe(false);

    element.setUserOverrideWidth(true);

    expect(element.userOverrideWidth).toBe(true);
  });

  it('should log warning for unsupported methods', () => {
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

    element.clear();
    expect(warnMock).toHaveBeenCalledWith(
      '[vibe-terminal-binary]',
      'Clear not supported in binary mode'
    );

    element.write('test');
    expect(warnMock).toHaveBeenCalledWith(
      '[vibe-terminal-binary]',
      'Direct write not supported in binary mode',
      'test'
    );

    element.handleFitToggle();
    expect(warnMock).toHaveBeenCalledWith(
      '[vibe-terminal-binary]',
      'Fit toggle not supported in binary mode'
    );
  });
});

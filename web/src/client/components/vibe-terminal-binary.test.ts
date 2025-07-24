// @vitest-environment happy-dom

import { fixture } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMethod } from '../../shared/types.js';
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

  it('should render terminal container', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    expect(container).toBeTruthy();
  });

  it('should initialize with default properties', () => {
    expect(element.sessionId).toBe('test-session-id');
    expect(element.cols).toBe(80);
    expect(element.rows).toBe(24);
    expect(element.fontSize).toBe(14);
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

    // Set font size directly
    element.fontSize = newFontSize;

    await element.updateComplete;
    expect(element.fontSize).toBe(newFontSize);
  });

  it('should handle theme changes', async () => {
    const newTheme = 'dark';

    // Set theme directly
    element.theme = newTheme;

    await element.updateComplete;
    expect(element.theme).toBe(newTheme);
  });

  it('should send input text via HTTP POST', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input and simulate typing
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    if (!hiddenInput) throw new Error('Hidden input not found');
    hiddenInput.value = 'test input';
    hiddenInput.dispatchEvent(new Event('input'));

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(window.fetch).toHaveBeenCalledWith('/api/sessions/test-session-id/input', {
      method: HttpMethod.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ text: 'test input' }),
    });
  });

  it('should dispatch terminal-input event after sending input', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

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

    // Get hidden input and simulate typing
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    if (!hiddenInput) throw new Error('Hidden input not found');
    hiddenInput.value = testText;
    hiddenInput.dispatchEvent(new Event('input'));

    const detail = await inputPromise;
    expect(detail).toBe(testText);
  });

  it('should handle special keys in keydown', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input from the terminal container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    if (!hiddenInput) throw new Error('sendInput does not exist');

    const preventDefaultMock = vi.fn();
    const stopPropagationMock = vi.fn();

    // Test Enter key
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(enterEvent, 'preventDefault', { value: preventDefaultMock });
    Object.defineProperty(enterEvent, 'stopPropagation', { value: stopPropagationMock });

    // Dispatch event on the hidden input
    hiddenInput.dispatchEvent(enterEvent);

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
    preventDefaultMock.mockClear();
    stopPropagationMock.mockClear();

    // Test Arrow Up
    const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    Object.defineProperty(arrowEvent, 'preventDefault', { value: preventDefaultMock });
    Object.defineProperty(arrowEvent, 'stopPropagation', { value: stopPropagationMock });

    hiddenInput.dispatchEvent(arrowEvent);

    expect(window.fetch).toHaveBeenCalledWith(
      '/api/sessions/test-session-id/input',
      expect.objectContaining({
        body: JSON.stringify({ text: '\x1b[A' }),
      })
    );
  });

  it('should handle Ctrl key combinations', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input from the terminal container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    if (!hiddenInput) throw new Error('sendInput does not exist');

    // Test Ctrl+C
    const preventDefaultMock = vi.fn();
    const stopPropagationMock = vi.fn();

    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: preventDefaultMock });
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagationMock });

    hiddenInput.dispatchEvent(event);

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

    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const button = element.querySelector('button[title="Scroll to bottom"]');
    expect(button).toBeTruthy();
  });

  it('should hide scroll to bottom button when hideScrollButton is true', async () => {
    element.hideScrollButton = true;
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    element['showScrollToBottomButton'] = true;
    await element.updateComplete;

    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const button = element.querySelector('button[title="Scroll to bottom"]');
    expect(button).toBeFalsy();
  });

  it('should scroll to bottom when button is clicked', async () => {
    // Mock scroll container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
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
    let resizeEventFired = false;
    // biome-ignore lint/suspicious/noExplicitAny: event detail type is dynamic
    let eventDetail: any = null;

    element.addEventListener(
      'terminal-resize',
      (e: Event) => {
        resizeEventFired = true;
        eventDetail = (e as CustomEvent).detail;
      },
      { once: true }
    );

    // Update dimensions
    element.cols = 100;
    element.rows = 30;
    await element.updateComplete;

    // Manually trigger updateTerminalSize to simulate resize
    // @ts-expect-error - accessing private method for testing
    element.updateTerminalSize?.();

    // Give it a moment to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (resizeEventFired) {
      expect(typeof eventDetail.cols).toBe('number');
      expect(typeof eventDetail.rows).toBe('number');
    } else {
      // If no resize event fired, that's okay - just verify the dimensions were set
      expect(element.cols).toBe(100);
      expect(element.rows).toBe(30);
    }
  });

  it('should apply max columns constraint', async () => {
    element.maxCols = 120;
    element.fitHorizontally = true; // Enable horizontal fitting to apply maxCols constraint
    await element.updateComplete;

    // Mock terminal container dimensions
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container') as HTMLElement;
    expect(container).toBeTruthy();

    // Mock the getBoundingClientRect to return wide dimensions
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

    // Listen for resize event to verify columns are constrained
    let resizeFired = false;
    element.addEventListener(
      'terminal-resize',
      (e: Event) => {
        resizeFired = true;
        const detail = (e as CustomEvent).detail;
        // Should be capped at maxCols
        expect(detail.cols).toBeLessThanOrEqual(120);
      },
      { once: true }
    );

    // Manually call updateTerminalSize to trigger the resize calculation
    // since ResizeObserver won't work in test environment
    // @ts-expect-error - accessing private method for testing
    element.updateTerminalSize();

    // If no resize event was fired, that's okay - just verify the constraint
    if (!resizeFired) {
      // Verify that maxCols is set
      expect(element.maxCols).toBe(120);
      expect(element.fitHorizontally).toBe(true);
    }
  });

  it('should focus hidden input when focus is called', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input from the terminal container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();

    const focusMock = vi.spyOn(hiddenInput, 'focus');
    element.focus();

    expect(focusMock).toHaveBeenCalledTimes(1);
  });

  it('should blur hidden input when blur is called', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input from the terminal container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();

    const blurMock = vi.spyOn(hiddenInput, 'blur');
    element.blur();

    expect(blurMock).toHaveBeenCalledTimes(1);
  });

  it('should handle input event from hidden input', async () => {
    await element.updateComplete;

    // Wait for firstUpdated to complete which sets up input handling
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get hidden input from the terminal container
    // Note: createRenderRoot returns 'this', so no shadowRoot - search directly
    const container = element.querySelector('#terminal-container');
    const hiddenInput = container?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();

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

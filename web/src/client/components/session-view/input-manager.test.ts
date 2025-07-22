// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../../shared/types.js';
import { InputManager } from './input-manager.js';

// Mock fetch globally
global.fetch = vi.fn();

// Mock websocket input client
vi.mock('../../services/websocket-input-client.js', () => ({
  websocketInputClient: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    sendInput: vi.fn().mockReturnValue(false), // Return false to fall back to HTTP
  },
}));

// We don't need to mock browser-shortcuts because the tests should verify
// the actual behavior of the module

describe('InputManager', () => {
  let inputManager: InputManager;
  let mockSession: Session;
  let mockCallbacks: { requestUpdate: vi.Mock };

  beforeEach(() => {
    inputManager = new InputManager();
    mockSession = {
      id: 'test-session-id',
      name: 'Test Session',
      status: 'running',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      command: 'bash',
      pid: 12345,
    };

    mockCallbacks = {
      requestUpdate: vi.fn(),
      getKeyboardCaptureActive: vi.fn().mockReturnValue(false), // Default to capture OFF for browser shortcut tests
    };

    inputManager.setSession(mockSession);
    inputManager.setCallbacks(mockCallbacks);

    // Reset fetch mock
    vi.mocked(global.fetch).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Option/Alt + Arrow key navigation', () => {
    it('should send Escape+b for Alt+Left arrow', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bb' }),
        })
      );
    });

    it('should send Escape+f for Alt+Right arrow', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bf' }),
        })
      );
    });

    it('should send regular arrow keys without Alt modifier', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'arrow_left' }),
        })
      );
    });
  });

  describe('Option/Alt + Backspace word deletion', () => {
    it('should send Ctrl+W for Alt+Backspace', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x17' }),
        })
      );
    });

    it('should send regular Backspace without Alt modifier', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'backspace' }),
        })
      );
    });
  });

  describe('Cross-platform consistency', () => {
    it('should not interfere with standard copy/paste shortcuts', async () => {
      // Mock navigator.userAgent for macOS
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        configurable: true,
      });

      // Test Cmd+C on macOS (should not send anything)
      const copyEvent = new KeyboardEvent('keydown', {
        key: 'c',
        metaKey: true,
      });
      await inputManager.handleKeyboardInput(copyEvent);

      // Test Cmd+V on macOS (should not send anything)
      const pasteEvent = new KeyboardEvent('keydown', {
        key: 'v',
        metaKey: true,
      });
      await inputManager.handleKeyboardInput(pasteEvent);

      // Should not have called fetch for copy/paste
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Session state handling', () => {
    it('should not send input to exited sessions', async () => {
      mockSession.status = 'exited';

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should update session status when receiving 400 response', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({}),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'a',
      });

      await inputManager.handleKeyboardInput(event);

      expect(mockSession.status).toBe('exited');
      expect(mockCallbacks.requestUpdate).toHaveBeenCalled();
    });
  });

  describe('Browser shortcut detection', () => {
    it('should detect Cmd+Shift+A as browser shortcut on macOS', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

      const event = new KeyboardEvent('keydown', {
        key: 'A',
        metaKey: true,
        shiftKey: true,
      });
      // Mock a target element (simulating event fired on document body)
      Object.defineProperty(event, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      expect(inputManager.isKeyboardShortcut(event)).toBe(true);
    });

    it('should detect Cmd+1-9 as browser shortcuts on macOS', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

      for (let i = 1; i <= 9; i++) {
        const event = new KeyboardEvent('keydown', {
          key: i.toString(),
          metaKey: true,
        });
        // Mock a target element
        Object.defineProperty(event, 'target', {
          value: document.createElement('div'),
          configurable: true,
        });

        expect(inputManager.isKeyboardShortcut(event)).toBe(true);
      }
    });

    it('should detect Cmd+Option+Left/Right as browser shortcuts on macOS', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

      const leftEvent = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        metaKey: true,
        altKey: true,
      });
      Object.defineProperty(leftEvent, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      const rightEvent = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        metaKey: true,
        altKey: true,
      });
      Object.defineProperty(rightEvent, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      expect(inputManager.isKeyboardShortcut(leftEvent)).toBe(true);
      expect(inputManager.isKeyboardShortcut(rightEvent)).toBe(true);
    });
  });

  describe('Mobile Detection', () => {
    it('should skip IME input setup on mobile devices', async () => {
      // Mock mobile environment
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        value: 5,
      });

      // Create terminal container
      const terminalContainer = document.createElement('div');
      terminalContainer.id = 'terminal-container';
      document.body.appendChild(terminalContainer);

      const mobileInputManager = new InputManager();
      const mockSession: Session = {
        id: 'test-session',
        status: 'running',
        title: 'Test Session',
        createdAt: new Date().toISOString(),
      };

      // Set session (which triggers setupIMEInput)
      mobileInputManager.setSession(mockSession);

      // Should not create any IME input element on mobile
      const imeInput = terminalContainer.querySelector('input');
      expect(imeInput).toBeNull();

      // Cleanup
      mobileInputManager.cleanup();
      document.body.removeChild(terminalContainer);
    });
  });

  describe('CJK IME Input', () => {
    let terminalContainer: HTMLElement;
    let mockTerminalElement: {
      getCursorInfo: ReturnType<typeof vi.fn>;
      getBoundingClientRect: ReturnType<typeof vi.fn>;
      getDOMElement: ReturnType<typeof vi.fn>;
    };
    let mockTerminalDOMElement: HTMLElement;
    let cjkInputManager: InputManager;

    beforeEach(() => {
      // Mock non-mobile environment for IME tests
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        value: 0,
      });

      // Setup DOM for testing
      terminalContainer = document.createElement('div');
      terminalContainer.id = 'terminal-container';
      document.body.appendChild(terminalContainer);

      // Create a mock DOM element for the terminal
      mockTerminalDOMElement = document.createElement('div');
      mockTerminalDOMElement.style.width = '800px';
      mockTerminalDOMElement.style.height = '480px';
      mockTerminalDOMElement.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 100,
        top: 100,
        width: 800,
        height: 480,
      });
      terminalContainer.appendChild(mockTerminalDOMElement);

      // Mock terminal element with cursor info
      mockTerminalElement = {
        getCursorInfo: vi.fn().mockReturnValue({
          cursorX: 10,
          cursorY: 5,
          cols: 80,
          rows: 24,
        }),
        getBoundingClientRect: vi.fn().mockReturnValue({
          left: 100,
          top: 100,
          width: 800,
          height: 480,
        }),
        getDOMElement: vi.fn().mockReturnValue(mockTerminalDOMElement),
      };

      // Create a fresh InputManager instance for CJK tests
      cjkInputManager = new InputManager();

      // Setup input manager with terminal element callback
      cjkInputManager.setCallbacks({
        requestUpdate: mockCallbacks.requestUpdate,
        getTerminalElement: () => mockTerminalElement,
      });

      // Set session AFTER the terminal container is set up to allow IME input creation
      cjkInputManager.setSession(mockSession);
    });

    afterEach(() => {
      cjkInputManager.cleanup();
      document.body.removeChild(terminalContainer);
    });

    describe('IME Input Setup', () => {
      it('should create invisible IME input element', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;

        expect(imeInput).toBeTruthy();
        expect(imeInput.placeholder).toBe('CJK Input');
        expect(imeInput.style.opacity).toBe('0');
        expect(imeInput.style.width).toBe('1px');
        expect(imeInput.style.height).toBe('1px');
        expect(imeInput.style.pointerEvents).toBe('none');
      });

      it('should position IME input at cursor location', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;

        // Trigger position update
        const clickEvent = new Event('click');
        Object.defineProperty(clickEvent, 'target', {
          value: terminalContainer,
          configurable: true,
        });
        document.dispatchEvent(clickEvent);

        // Check if position was calculated (exact values depend on mocked dimensions)
        expect(imeInput.style.left).toMatch(/^\d+px$/);
        expect(imeInput.style.top).toMatch(/^\d+px$/);
        expect(mockTerminalElement.getCursorInfo).toHaveBeenCalled();
      });
    });

    describe('IME Composition Events', () => {
      let imeInput: HTMLInputElement;

      beforeEach(() => {
        imeInput = terminalContainer.querySelector('input') as HTMLInputElement;
      });

      it('should handle compositionstart event', () => {
        const compositionEvent = new CompositionEvent('compositionstart', {
          data: '',
        });

        imeInput.dispatchEvent(compositionEvent);

        expect(document.body.getAttribute('data-ime-composing')).toBe('true');
      });

      it.skip('should handle compositionend and send text to terminal', async () => {
        const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

        // Spy on the sendInputText method BEFORE triggering events
        const sendInputTextSpy = vi.spyOn(cjkInputManager, 'sendInputText');

        // Ensure IME input exists
        expect(imeInput).toBeTruthy();

        // Start composition
        imeInput.dispatchEvent(new CompositionEvent('compositionstart'));
        expect(document.body.getAttribute('data-ime-composing')).toBe('true');

        // Create a proper CompositionEvent with data
        const compositionEndEvent = new CompositionEvent('compositionend', {
          data: '你好',
        });

        // Manually verify the event has the right data
        expect(compositionEndEvent.data).toBe('你好');

        imeInput.dispatchEvent(compositionEndEvent);

        // Wait for async operations to complete
        await vi.waitFor(() => {
          expect(sendInputTextSpy).toHaveBeenCalledWith('你好');
        });

        expect(document.body.getAttribute('data-ime-composing')).toBeNull();
        expect(imeInput.value).toBe('');
      });

      it('should block keyboard events during composition', async () => {
        const fetchMock = vi.mocked(fetch);

        // Start composition
        imeInput.dispatchEvent(new CompositionEvent('compositionstart'));

        // Try to send keyboard input during composition
        const keyboardEvent = new KeyboardEvent('keydown', { key: 'a' });
        await cjkInputManager.handleKeyboardInput(keyboardEvent);

        // Should not send any input
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe('Global Paste Handler', () => {
      it('should handle paste events globally', async () => {
        const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: new DataTransfer(),
        });
        pasteEvent.clipboardData?.setData('text', 'pasted text');

        // Set target to document body (not an input)
        Object.defineProperty(pasteEvent, 'target', {
          value: document.body,
          configurable: true,
        });

        document.dispatchEvent(pasteEvent);

        // Wait for async operations to complete
        await vi.waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/sessions/test-session-id/input',
            expect.objectContaining({
              method: 'POST',
              body: JSON.stringify({ text: 'pasted text' }),
            })
          );
        });
      });

      it('should not interfere with paste in other input elements', () => {
        const fetchMock = vi.mocked(fetch);

        const otherInput = document.createElement('input');
        document.body.appendChild(otherInput);

        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: new DataTransfer(),
        });
        pasteEvent.clipboardData?.setData('text', 'should not be handled');

        Object.defineProperty(pasteEvent, 'target', {
          value: otherInput,
          configurable: true,
        });

        document.dispatchEvent(pasteEvent);

        expect(fetchMock).not.toHaveBeenCalled();
        document.body.removeChild(otherInput);
      });
    });

    describe('Focus Management', () => {
      let imeInput: HTMLInputElement;

      beforeEach(() => {
        imeInput = terminalContainer.querySelector('input') as HTMLInputElement;
      });

      it('should focus IME input when clicking in terminal area', async () => {
        const focusSpy = vi.spyOn(imeInput, 'focus');

        const clickEvent = new Event('click');
        Object.defineProperty(clickEvent, 'target', {
          value: terminalContainer,
          configurable: true,
        });

        document.dispatchEvent(clickEvent);

        // Wait for requestAnimationFrame to complete
        await vi.waitFor(() => {
          expect(focusSpy).toHaveBeenCalled();
        });
      });

      it('should not focus IME input when clicking outside terminal area', () => {
        const focusSpy = vi.spyOn(imeInput, 'focus');

        const otherElement = document.createElement('div');
        document.body.appendChild(otherElement);

        const clickEvent = new Event('click');
        Object.defineProperty(clickEvent, 'target', {
          value: otherElement,
          configurable: true,
        });

        document.dispatchEvent(clickEvent);

        expect(focusSpy).not.toHaveBeenCalled();
        document.body.removeChild(otherElement);
      });

      it('should set focus state attributes correctly', async () => {
        imeInput.dispatchEvent(new Event('focus'));
        expect(document.body.getAttribute('data-ime-input-focused')).toBe('true');

        // Before triggering blur, we need to stop the focus retention interval
        // to prevent it from interfering with the test
        const imeInputComponent = cjkInputManager.getIMEInputForTesting();
        if (imeInputComponent) {
          imeInputComponent.stopFocusRetentionForTesting();
        }

        // Mock that active element is NOT the IME input to simulate real blur
        Object.defineProperty(document, 'activeElement', {
          value: document.body,
          configurable: true,
        });

        imeInput.dispatchEvent(new Event('blur'));
        // Wait for delayed blur logic (50ms timeout)
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(document.body.getAttribute('data-ime-input-focused')).toBeNull();
      });
    });

    describe('Keyboard Shortcut Detection', () => {
      it('should allow copy/paste shortcuts even when IME input is focused', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;

        const ctrlVEvent = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
        });
        Object.defineProperty(ctrlVEvent, 'target', {
          value: imeInput,
          configurable: true,
        });

        expect(cjkInputManager.isKeyboardShortcut(ctrlVEvent)).toBe(true);

        const ctrlCEvent = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
        });
        Object.defineProperty(ctrlCEvent, 'target', {
          value: imeInput,
          configurable: true,
        });

        expect(cjkInputManager.isKeyboardShortcut(ctrlCEvent)).toBe(true);
      });
    });

    describe('Cursor Position Updates', () => {
      it('should update IME input position when cursor moves', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;

        // Change cursor position
        mockTerminalElement.getCursorInfo.mockReturnValue({
          cursorX: 20,
          cursorY: 10,
          cols: 80,
          rows: 24,
        });

        // Trigger position update
        const clickEvent = new Event('click');
        Object.defineProperty(clickEvent, 'target', {
          value: terminalContainer,
          configurable: true,
        });
        document.dispatchEvent(clickEvent);

        expect(mockTerminalElement.getCursorInfo).toHaveBeenCalled();
        // Position should be updated (exact values depend on calculations)
        expect(imeInput.style.left).toMatch(/^\d+px$/);
        expect(imeInput.style.top).toMatch(/^\d+px$/);
      });

      it('should fallback to safe positioning when cursor info unavailable', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;

        // Mock terminal element to return null
        mockTerminalElement.getCursorInfo.mockReturnValue(null);

        // Trigger position update
        const clickEvent = new Event('click');
        Object.defineProperty(clickEvent, 'target', {
          value: terminalContainer,
          configurable: true,
        });
        document.dispatchEvent(clickEvent);

        // Should fallback to safe positioning
        expect(imeInput.style.left).toBe('10px');
        expect(imeInput.style.top).toBe('10px');
      });
    });

    describe('Cleanup', () => {
      it('should properly cleanup IME input and event listeners', () => {
        const imeInput = terminalContainer.querySelector('input') as HTMLInputElement;
        const removeSpy = vi.spyOn(imeInput, 'remove');

        cjkInputManager.cleanup();

        expect(removeSpy).toHaveBeenCalled();
        expect(document.body.getAttribute('data-ime-input-focused')).toBeNull();
        expect(document.body.getAttribute('data-ime-composing')).toBeNull();
        expect(terminalContainer.querySelector('input')).toBeNull();
      });
    });
  });
});

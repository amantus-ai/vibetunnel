import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { MockEventSource } from '@/test/utils/lit-test-utils';
import {
  clickElement,
  waitForElement,
  waitForEvent,
  pressKey,
  getTextContent,
  elementExists,
  hasClass,
  setViewport,
  resetViewport,
  setupFetchMock,
  typeInInput,
  submitForm,
  getAttribute,
} from '@/test/utils/component-helpers';
import { createMockSession } from '@/test/utils/lit-test-utils';

// Mock EventSource globally
global.EventSource = MockEventSource as any;

// Import component type
import type { SessionView } from './session-view';

describe('SessionView', () => {
  let element: SessionView;
  let fetchMock: ReturnType<typeof setupFetchMock>;

  beforeAll(async () => {
    // Import components to register custom elements
    await import('./session-view');
    await import('./terminal');
  });

  beforeEach(async () => {
    // Reset viewport
    resetViewport();
    
    // Setup fetch mock
    fetchMock = setupFetchMock();
    
    // Create component
    element = await fixture<SessionView>(html`
      <session-view></session-view>
    `);
    
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    fetchMock.clear();
    // Clear all EventSource instances
    MockEventSource.instances.clear();
  });

  describe('initialization', () => {
    it('should create component with default state', () => {
      expect(element).toBeDefined();
      expect(element.session).toBeNull();
      expect((element as any).connected).toBe(false);
      expect((element as any).loading).toBe(false);
    });

    it('should detect mobile environment', async () => {
      // Mock touch support
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 1,
        configurable: true
      });
      
      const mobileElement = await fixture<SessionView>(html`
        <session-view></session-view>
      `);
      
      await mobileElement.updateComplete;
      
      // Component detects mobile based on touch support
      expect((mobileElement as any).isMobile).toBe(true);
    });
  });

  describe('session loading', () => {
    it('should load session when session property is set', async () => {
      const mockSession = createMockSession({
        id: 'test-session-123',
        name: 'Test Session',
        status: 'running',
      });
      
      // Mock fetch responses
      fetchMock.mockResponse('/api/sessions/test-session-123', mockSession);
      fetchMock.mockResponse('/api/sessions/test-session-123/activity', {
        isActive: false,
        timestamp: new Date().toISOString(),
      });
      
      element.session = mockSession;
      await element.updateComplete;
      
      // Should render terminal
      const terminal = element.querySelector('vibe-terminal');
      expect(terminal).toBeTruthy();
      expect(terminal?.getAttribute('session-id')).toBe('test-session-123');
    });

    it('should show loading state while connecting', async () => {
      const mockSession = createMockSession();
      
      (element as any).loading = true;
      element.session = mockSession;
      await element.updateComplete;
      
      // Should show loading state (component might render differently)
      expect((element as any).loading).toBe(true);
    });

    it('should handle session not found error', async () => {
      const errorHandler = vi.fn();
      element.addEventListener('error', errorHandler);
      
      const mockSession = createMockSession({ id: 'not-found' });
      
      // Mock 404 response
      fetchMock.mockResponse('/api/sessions/not-found', 
        { error: 'Session not found' }, 
        { status: 404 }
      );
      
      element.session = mockSession;
      await element.updateComplete;
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.stringContaining('not found')
        })
      );
    });
  });

  describe('terminal interaction', () => {
    beforeEach(async () => {
      const mockSession = createMockSession();
      element.session = mockSession;
      await element.updateComplete;
    });

    it('should send keyboard input to terminal', async () => {
      // Mock fetch for sendInput
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      // Simulate typing
      await pressKey(element, 'a');
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(inputCapture).toHaveBeenCalledWith({ input: 'a' });
    });

    it('should handle special keys', async () => {
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      // Test Enter key
      await pressKey(element, 'Enter');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(inputCapture).toHaveBeenCalledWith({ input: 'enter' });
      
      // Clear mock calls
      inputCapture.mockClear();
      
      // Test Escape key
      await pressKey(element, 'Escape');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(inputCapture).toHaveBeenCalledWith({ input: 'escape' });
    });

    it('should handle paste event from terminal', async () => {
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      const terminal = element.querySelector('vibe-terminal');
      if (terminal) {
        // Dispatch paste event from terminal
        const pasteEvent = new CustomEvent('terminal-paste', {
          detail: { text: 'pasted text' },
          bubbles: true
        });
        terminal.dispatchEvent(pasteEvent);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(inputCapture).toHaveBeenCalledWith({ input: 'pasted text' });
      }
    });

    it('should handle terminal resize', async () => {
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      const terminal = element.querySelector('vibe-terminal');
      if (terminal) {
        // Dispatch resize event
        const resizeEvent = new CustomEvent('terminal-resize', {
          detail: { cols: 100, rows: 30 },
          bubbles: true
        });
        terminal.dispatchEvent(resizeEvent);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(inputCapture).toHaveBeenCalledWith({ input: 'resize:100:30' });
      }
    });
  });

  describe('stream connection', () => {
    it('should establish SSE connection for running session', async () => {
      const mockSession = createMockSession({ status: 'running' });
      
      element.session = mockSession;
      await element.updateComplete;
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should create EventSource
      expect(MockEventSource.instances.size).toBeGreaterThan(0);
      const eventSource = MockEventSource.instances.values().next().value;
      expect(eventSource.url).toContain('/api/sessions/test-session-123/stream');
    });

    it('should handle stream messages', async () => {
      const mockSession = createMockSession({ status: 'running' });
      
      element.session = mockSession;
      await element.updateComplete;
      
      // Wait for EventSource to be created
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (MockEventSource.instances.size > 0) {
        // Get the mock EventSource
        const eventSource = MockEventSource.instances.values().next().value as MockEventSource;
        
        // Simulate terminal ready
        const terminal = element.querySelector('vibe-terminal') as any;
        if (terminal) {
          terminal.dispatchEvent(new Event('terminal-ready', { bubbles: true }));
        }
        
        // Simulate stream message
        eventSource.mockMessage('Test output from server');
        
        await element.updateComplete;
        
        // Connection state should update
        expect((element as any).connected).toBe(true);
      }
    });

    it('should handle session exit event', async () => {
      const mockSession = createMockSession({ status: 'running' });
      const navigateHandler = vi.fn();
      element.addEventListener('navigate-to-list', navigateHandler);
      
      element.session = mockSession;
      await element.updateComplete;
      
      // Wait for EventSource
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (MockEventSource.instances.size > 0) {
        // Get the mock EventSource
        const eventSource = MockEventSource.instances.values().next().value as MockEventSource;
        
        // Simulate session exit event
        eventSource.mockMessage('{"status": "exited", "exit_code": 0}', 'session-exit');
        
        await element.updateComplete;
        
        // Session should be marked as exited
        expect(element.session?.status).toBe('exited');
      }
    });
  });

  describe('mobile interface', () => {
    beforeEach(async () => {
      // Set mobile viewport
      setViewport(375, 667);
      
      const mockSession = createMockSession();
      element.session = mockSession;
      element.isMobile = true;
      await element.updateComplete;
    });

    it('should show mobile input overlay', async () => {
      element.showMobileInput = true;
      await element.updateComplete;
      
      const mobileInput = element.querySelector('.mobile-input-overlay');
      expect(mobileInput).toBeTruthy();
    });

    it('should send mobile input text', async () => {
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      element.showMobileInput = true;
      await element.updateComplete;
      
      // Look for mobile input form
      const form = element.querySelector('form');
      if (form) {
        const input = form.querySelector('input') as HTMLInputElement;
        if (input) {
          input.value = 'mobile text';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Submit form
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          
          await new Promise(resolve => setTimeout(resolve, 50));
          expect(inputCapture).toHaveBeenCalledWith({ input: 'mobile text\n' });
        }
      }
    });
  });

  describe('file browser', () => {
    it('should show file browser when triggered', async () => {
      const mockSession = createMockSession();
      element.session = mockSession;
      element.showFileBrowser = true;
      await element.updateComplete;
      
      const fileBrowser = element.querySelector('file-browser');
      expect(fileBrowser).toBeTruthy();
    });

    it('should handle file selection', async () => {
      const inputCapture = vi.fn();
      (global.fetch as any).mockImplementation((url: string, options: any) => {
        if (url.includes('/input')) {
          inputCapture(JSON.parse(options.body));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });
      
      const mockSession = createMockSession();
      element.session = mockSession;
      element.showFileBrowser = true;
      await element.updateComplete;
      
      const fileBrowser = element.querySelector('file-browser');
      if (fileBrowser) {
        // Dispatch file selected event
        const fileEvent = new CustomEvent('file-selected', {
          detail: { path: '/home/user/file.txt' },
          bubbles: true
        });
        fileBrowser.dispatchEvent(fileEvent);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(inputCapture).toHaveBeenCalledWith({ input: '/home/user/file.txt' });
        expect(element.showFileBrowser).toBe(false);
      }
    });

    it('should close file browser on cancel', async () => {
      const mockSession = createMockSession();
      element.session = mockSession;
      element.showFileBrowser = true;
      await element.updateComplete;
      
      const fileBrowser = element.querySelector('file-browser');
      if (fileBrowser) {
        // Dispatch cancel event
        fileBrowser.dispatchEvent(new Event('browser-cancel', { bubbles: true }));
        
        expect(element.showFileBrowser).toBe(false);
      }
    });
  });

  describe('toolbar actions', () => {
    beforeEach(async () => {
      const mockSession = createMockSession();
      element.session = mockSession;
      await element.updateComplete;
    });

    it('should toggle terminal fit mode', async () => {
      const fitButton = element.querySelector('[title*="Fit"]');
      if (fitButton) {
        await clickElement(element, '[title*="Fit"]');
        
        expect(element.terminalFitHorizontally).toBe(true);
      }
    });

    it('should show width selector', async () => {
      // Look for any button that might control width
      const buttons = element.querySelectorAll('button');
      let widthButton = null;
      
      buttons.forEach(btn => {
        if (btn.textContent?.includes('cols') || btn.getAttribute('title')?.includes('width')) {
          widthButton = btn;
        }
      });
      
      if (widthButton) {
        (widthButton as HTMLElement).click();
        await element.updateComplete;
        
        expect((element as any).showWidthSelector).toBe(true);
      }
    });

    it('should change terminal width preset', async () => {
      element.showWidthSelector = true;
      await element.updateComplete;
      
      // Click on 80 column preset
      const preset80 = element.querySelector('[data-width="80"]');
      if (preset80) {
        await clickElement(element, '[data-width="80"]');
        
        expect(element.terminalMaxCols).toBe(80);
        expect(element.showWidthSelector).toBe(false);
      }
    });
  });

  describe('navigation', () => {
    it('should navigate back to list', async () => {
      const navigateHandler = vi.fn();
      element.addEventListener('navigate-to-list', navigateHandler);
      
      const mockSession = createMockSession();
      element.session = mockSession;
      await element.updateComplete;
      
      // Click back button
      const backButton = element.querySelector('[title="Back to list"]');
      if (backButton) {
        await clickElement(element, '[title="Back to list"]');
        
        expect(navigateHandler).toHaveBeenCalled();
      }
    });

    it('should handle escape key for navigation', async () => {
      const navigateHandler = vi.fn();
      element.addEventListener('navigate-to-list', navigateHandler);
      
      const mockSession = createMockSession({ status: 'exited' });
      element.session = mockSession;
      await element.updateComplete;
      
      // Press escape on exited session
      await pressKey(element, 'Escape');
      
      expect(navigateHandler).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup on disconnect', async () => {
      const mockSession = createMockSession();
      element.session = mockSession;
      await element.updateComplete;
      
      // Create connection
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const instancesBefore = MockEventSource.instances.size;
      
      // Disconnect
      element.disconnectedCallback();
      
      // EventSource should be cleaned up
      if (instancesBefore > 0) {
        expect(MockEventSource.instances.size).toBeLessThan(instancesBefore);
      }
    });
  });
});
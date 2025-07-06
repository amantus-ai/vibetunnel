// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayInfo, ProcessGroup, WindowInfo } from '../types/screencap';
import type { ScreencapView } from './screencap-view';

// Mock API response type
interface MockApiResponse {
  type: 'api-response';
  requestId: string;
  result?: unknown;
  error?: string;
}

// Mock API request type
interface MockApiRequest {
  method: string;
  endpoint: string;
  requestId: string;
  params?: unknown;
}

// Mock data storage
let mockProcessGroups: ProcessGroup[];
let mockDisplays: DisplayInfo[];

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string) {
    const request = JSON.parse(data) as MockApiRequest;
    let response: MockApiResponse;

    // Handle different API endpoints
    if (request.method === 'GET' && request.endpoint === '/processes') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { processes: mockProcessGroups },
      };
    } else if (request.method === 'GET' && request.endpoint === '/displays') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { displays: mockDisplays },
      };
    } else if (request.method === 'POST' && request.endpoint === '/capture') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { sessionId: 'mock-session-123' },
      };
    } else if (request.method === 'POST' && request.endpoint === '/capture-window') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { sessionId: 'mock-session-456' },
      };
    } else if (request.method === 'POST' && request.endpoint === '/stop') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { success: true },
      };
    } else if (request.method === 'POST' && request.endpoint === '/click') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { success: true },
      };
    } else if (request.method === 'POST' && request.endpoint === '/key') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { success: true },
      };
    } else if (request.method === 'GET' && request.endpoint === '/frame') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { frame: 'mockBase64ImageData' },
      };
    } else {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        error: 'Unknown endpoint',
      };
    }

    // Send response asynchronously
    setTimeout(() => {
      if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
        this.onmessage(new MessageEvent('message', { data: JSON.stringify(response) }));
      }
    }, 10);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }
}

describe.skip('ScreencapView', () => {
  let element: ScreencapView;

  async function createReadyElement(): Promise<ScreencapView> {
    const el = await fixture<ScreencapView>(html`<screencap-view></screencap-view>`);
    await new Promise<void>((resolve) => {
      const originalOnReady = el.wsClient.onReady;
      el.wsClient.onReady = (event) => {
        originalOnReady(event);
        resolve();
      };
    });
    await el.updateComplete;
    return el;
  }

  const mockWindows: WindowInfo[] = [
    {
      cgWindowID: 123,
      title: 'Test Window 1',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    },
    {
      cgWindowID: 456,
      title: 'Test Window 2',
      x: 100,
      y: 100,
      width: 1024,
      height: 768,
    },
  ];

  // Initialize mock data for global access
  mockProcessGroups = [
    {
      processName: 'Test App',
      pid: 1234,
      bundleIdentifier: 'com.test.app',
      iconData: 'data:image/png;base64,test',
      windows: [mockWindows[0]],
    },
    {
      processName: 'Another App',
      pid: 5678,
      bundleIdentifier: 'com.another.app',
      iconData: null,
      windows: [mockWindows[1]],
    },
  ];

  mockDisplays = [
    {
      id: '0',
      width: 1920,
      height: 1080,
      scaleFactor: 2.0,
      refreshRate: 60.0,
      x: 0,
      y: 0,
      name: 'Display 1',
    },
    {
      id: '1',
      width: 2560,
      height: 1440,
      scaleFactor: 2.0,
      refreshRate: 60.0,
      x: 1920,
      y: 0,
      name: 'Display 2',
    },
  ];

  beforeAll(async () => {
    // Mock window dimensions for happy-dom
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });

    // Mock WebSocket globally
    vi.stubGlobal('WebSocket', MockWebSocket);

    // Mock fetch for auth config
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/auth/config')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                enabled: false,
                providers: [],
              }),
          } as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);
      })
    );

    // Import component to register custom element
    await import('./screencap-view');
  });

  beforeEach(async () => {
    // Create component and wait for it to be ready
    element = await createReadyElement();
    await element.updateComplete;

    // Disable WebRTC for tests to use JPEG mode
    element.useWebRTC = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should load windows and display info on connectedCallback', async () => {
      // Check that data was loaded
      expect(element.processGroups).toHaveLength(2);
      expect(element.displays).toEqual(mockDisplays);
      expect(element.status).toBe('ready');
    });

    it('should handle loading errors gracefully', async () => {
      // Create a new MockWebSocket class that returns errors
      class ErrorMockWebSocket extends MockWebSocket {
        send(data: string) {
          const request = JSON.parse(data);
          const response = {
            type: 'api-response',
            requestId: request.requestId,
            error: 'Service unavailable',
          };
          setTimeout(() => {
            if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
              this.onmessage(new MessageEvent('message', { data: JSON.stringify(response) }));
            }
          }, 10);
        }
      }

      vi.stubGlobal('WebSocket', ErrorMockWebSocket);

      element = await fixture<ScreencapView>(html`<screencap-view></screencap-view>`);
      await element.updateComplete;

      expect(element.status).toBe('error');
      expect(element.error).toContain('Failed to load capture sources');

      // Restore original mock
      vi.stubGlobal('WebSocket', MockWebSocket);
    });
  });

  describe('window selection', () => {
    it('should display window list in sidebar', async () => {
      // Get sidebar element
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      expect(sidebar).toBeTruthy();

      // Find display items in sidebar's shadow root
      const displayElements = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayElements).toBeTruthy();
      expect(displayElements?.length).toBe(2); // 2 displays

      // All Displays button is currently commented out in implementation
      // Just verify display items exist

      // Expand processes to see windows
      const processHeaders = sidebar?.shadowRoot?.querySelectorAll('.process-header');
      expect(processHeaders?.length).toBe(2); // 2 process groups

      // Click first process to expand it
      (processHeaders?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      // Now find window items in the expanded process
      const windowElements = sidebar?.shadowRoot?.querySelectorAll('.window-item');
      expect(windowElements).toBeTruthy();
      expect(windowElements?.length).toBeGreaterThan(0);

      const allText = Array.from(windowElements || []).map((el) => el.textContent);

      // Check that windows are displayed
      expect(allText.some((text) => text?.includes('Test Window 1'))).toBeTruthy();
      // Note: Second window is in different process group

      // Process names are now in process headers, not window items
      const processText = Array.from(processHeaders || []).map((el) => el.textContent);
      expect(processText.some((text) => text?.includes('Test App'))).toBeTruthy();
      expect(processText.some((text) => text?.includes('Another App'))).toBeTruthy();
    });

    it('should select window and start capture on click', async () => {
      // Get sidebar element
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      expect(sidebar).toBeTruthy();

      // First expand a process to show windows
      const processHeaders = sidebar?.shadowRoot?.querySelectorAll('.process-header');
      (processHeaders?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      // Find a non-desktop window item
      const windowElements = sidebar?.shadowRoot?.querySelectorAll('.window-item');
      let windowElement: HTMLElement | null = null;

      windowElements?.forEach((item) => {
        if (item.textContent?.includes('Test Window 1')) {
          windowElement = item as HTMLElement;
        }
      });

      expect(windowElement).toBeTruthy();

      // Click window to select
      windowElement?.click();
      await element.updateComplete;

      // Check window was selected
      expect(element.selectedWindow).toEqual(mockWindows[0]);
      expect(element.captureMode).toBe('window');

      // Now click start button to begin capture
      const startBtn = element.shadowRoot?.querySelector('.btn.primary') as HTMLElement;
      expect(startBtn).toBeTruthy();
      expect(startBtn?.textContent).toContain('Start');
      startBtn?.click();

      // Check capture was started (wait for async operations)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(element.isCapturing).toBe(true);
    });

    it('should select desktop mode on display item click', async () => {
      // Get sidebar element
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      expect(sidebar).toBeTruthy();

      // Find a display item (All Displays button is currently commented out)
      const displayItems = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayItems).toBeTruthy();
      expect(displayItems?.length).toBeGreaterThan(0);

      // Click first display item
      (displayItems?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      expect(element.captureMode).toBe('desktop');
      expect(element.selectedWindow).toBeNull();
      expect(element.selectedDisplay).toBeTruthy();
      expect(element.selectedDisplay?.id).toBe(mockDisplays[0].id);

      // Now click start button to begin capture
      const startBtn = element.shadowRoot?.querySelector('.btn.primary') as HTMLElement;
      expect(startBtn).toBeTruthy();
      expect(startBtn?.textContent).toContain('Start');
      startBtn?.click();

      // Check desktop capture was started
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(element.isCapturing).toBe(true);
    });
  });

  describe('capture controls', () => {
    beforeEach(async () => {
      // Get sidebar and start desktop capture - find All Displays button
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      const displayItems = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayItems).toBeTruthy();
      expect(displayItems?.length).toBeGreaterThan(0);
      (displayItems?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      // Now click start button to begin capture
      const startBtn = element.shadowRoot?.querySelector('.btn.primary') as HTMLElement;
      expect(startBtn).toBeTruthy();
      startBtn?.click();

      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;
    });

    it('should restart capture when clicking same mode', async () => {
      // First verify capture started
      expect(element.isCapturing).toBe(true);
      const initialDisplay = element.selectedDisplay;
      expect(initialDisplay).toBeTruthy();

      // Click desktop button again - should restart capture
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      const displayItems = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayItems).toBeTruthy();
      expect(displayItems?.length).toBeGreaterThan(0);
      (displayItems?.[0] as HTMLElement)?.click();

      // Wait for restart to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
      await element.updateComplete;

      // Should still be capturing after restart
      expect(element.isCapturing).toBe(true);
      expect(element.selectedDisplay).toBeTruthy();
    });

    it('should update frame URL periodically', async () => {
      expect(element.isCapturing).toBe(true);

      // Mock the WebSocket response for frame requests
      const originalSend = MockWebSocket.prototype.send;
      MockWebSocket.prototype.send = function (data: string) {
        const request = JSON.parse(data) as MockApiRequest;
        if (request.method === 'GET' && request.endpoint === '/frame') {
          const response = {
            type: 'api-response',
            requestId: request.requestId,
            result: { frame: 'mockBase64ImageData' },
          };
          setTimeout(() => {
            if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
              this.onmessage(new MessageEvent('message', { data: JSON.stringify(response) }));
            }
          }, 10);
        } else {
          originalSend.call(this, data);
        }
      };

      // Wait for the frame interval to kick in
      await new Promise((resolve) => setTimeout(resolve, 150));
      await element.updateComplete;

      // Frame URL should be set as base64 data URL
      expect(element.frameUrl).toContain('data:image/jpeg;base64,');

      const _initialFrame = element.frameUrl;

      // Wait for another frame update
      await new Promise((resolve) => setTimeout(resolve, 150));
      await element.updateComplete;

      // Frame counter should have increased
      expect(element.frameCounter).toBeGreaterThan(0);

      // Restore original send
      MockWebSocket.prototype.send = originalSend;
    });
  });

  describe('input handling', () => {
    beforeEach(async () => {
      // Get sidebar and start desktop capture - find All Displays button
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      const displayItems = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayItems).toBeTruthy();
      expect(displayItems?.length).toBeGreaterThan(0);
      (displayItems?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      // Now click start button to begin capture
      const startBtn = element.shadowRoot?.querySelector('.btn.primary') as HTMLElement;
      expect(startBtn).toBeTruthy();
      startBtn?.click();

      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;
    });

    it.skip('should handle keyboard input when focused', async () => {
      // Set focus on the capture area
      const captureArea = element.shadowRoot?.querySelector('.capture-area') as HTMLElement;
      captureArea?.click();
      await element.updateComplete;

      // We need to track WebSocket sends
      let lastPostRequest: MockApiRequest | null = null;
      const originalSend = MockWebSocket.prototype.send;
      MockWebSocket.prototype.send = function (data: string) {
        const request = JSON.parse(data) as MockApiRequest;
        if (request.method === 'POST') {
          lastPostRequest = request;
        }
        originalSend.call(this, data);
      };

      // Simulate key press
      const keyEvent = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
      });

      document.dispatchEvent(keyEvent);
      await element.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lastPostRequest).toBeTruthy();
      expect(lastPostRequest?.method).toBe('POST');
      expect(lastPostRequest?.endpoint).toBe('/key');
      expect(lastPostRequest?.params).toEqual({
        key: 'a',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      });

      // Restore original send
      MockWebSocket.prototype.send = originalSend;
    });
  });

  describe('error handling', () => {
    it('should display error when capture fails', async () => {
      // Create a MockWebSocket that fails capture
      class CaptureMockWebSocket extends MockWebSocket {
        send(data: string) {
          const request = JSON.parse(data) as MockApiRequest;
          let response: MockApiResponse;

          if (request.method === 'POST' && request.endpoint === '/capture') {
            response = {
              type: 'api-response',
              requestId: request.requestId,
              error: 'Capture service error',
            };
          } else if (request.method === 'GET' && request.endpoint === '/processes') {
            response = {
              type: 'api-response',
              requestId: request.requestId,
              result: { processes: mockProcessGroups },
            };
          } else if (request.method === 'GET' && request.endpoint === '/displays') {
            response = {
              type: 'api-response',
              requestId: request.requestId,
              result: { displays: mockDisplays },
            };
          } else {
            response = {
              type: 'api-response',
              requestId: request.requestId,
              error: 'Unknown endpoint',
            };
          }

          setTimeout(() => {
            if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
              this.onmessage(new MessageEvent('message', { data: JSON.stringify(response) }));
            }
          }, 10);
        }
      }

      vi.stubGlobal('WebSocket', CaptureMockWebSocket);

      // Create new element
      element = await fixture<ScreencapView>(html`<screencap-view></screencap-view>`);
      await element.updateComplete;

      // Try to start capture - find All Displays button in sidebar
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      const displayItems = sidebar?.shadowRoot?.querySelectorAll('.display-item');
      expect(displayItems).toBeTruthy();
      expect(displayItems?.length).toBeGreaterThan(0);
      (displayItems?.[0] as HTMLElement)?.click();
      await element.updateComplete;

      // Now click start button
      const startBtn = element.shadowRoot?.querySelector('.btn.primary') as HTMLElement;
      expect(startBtn).toBeTruthy();
      startBtn?.click();

      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      expect(element.status).toBe('error');
      expect(element.error).toContain('Capture service error');

      // Restore original mock
      vi.stubGlobal('WebSocket', MockWebSocket);
    });
  });

  describe('UI state', () => {
    it('should show loading state initially', async () => {
      // Create new element without waiting
      const newElement = await fixture<ScreencapView>(html`<screencap-view></screencap-view>`);

      const statusElement = newElement.shadowRoot?.querySelector('.status-message');
      expect(statusElement?.textContent).toContain('Loading');
      expect(statusElement?.classList.contains('loading')).toBe(true);
    });

    it('should show window count when loaded', async () => {
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      const sectionTitles = sidebar?.shadowRoot?.querySelectorAll('.section-title');
      let windowsSection: Element | null = null;
      sectionTitles?.forEach((title) => {
        if (title.textContent?.includes('Windows')) {
          windowsSection = title;
        }
      });
      expect(windowsSection).toBeTruthy();

      // Check that we have 2 process groups in the process list
      const processHeaders = sidebar?.shadowRoot?.querySelectorAll('.process-header');
      expect(processHeaders?.length).toBe(2);
    });

    it('should highlight selected window', async () => {
      // Get sidebar element
      const sidebar = element.shadowRoot?.querySelector('screencap-sidebar');
      expect(sidebar).toBeTruthy();

      // Click a display item instead of window-item
      const firstDisplay = sidebar?.shadowRoot?.querySelector('.display-item') as HTMLElement;
      firstDisplay?.click();
      await element.updateComplete;

      expect(firstDisplay?.classList.contains('selected')).toBe(true);
    });
  });
});

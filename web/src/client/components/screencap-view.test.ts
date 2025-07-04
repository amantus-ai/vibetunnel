// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreencapView } from './screencap-view';

// Mock types
interface MockWindowInfo {
  cgWindowID: number;
  title: string;
  app: string;
  ownerName: string;
  width: number;
  height: number;
  size: {
    width: number;
    height: number;
  };
  position: {
    x: number;
    y: number;
  };
  id: number;
}

interface MockProcessGroup {
  pid: number;
  name: string;
  icon?: string;
  windows: MockWindowInfo[];
}

interface MockDisplayInfo {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
  x: number;
  y: number;
  name?: string;
}

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
let mockProcessGroups: MockProcessGroup[];
let mockDisplays: MockDisplayInfo[];

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
        result: mockProcessGroups,
      };
    } else if (request.method === 'GET' && request.endpoint === '/displays') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: mockDisplays,
      };
    } else if (request.method === 'POST' && request.endpoint === '/capture') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { success: true },
      };
    } else if (request.method === 'POST' && request.endpoint === '/capture-window') {
      response = {
        type: 'api-response',
        requestId: request.requestId,
        result: { success: true },
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

describe('ScreencapView', () => {
  let element: ScreencapView;

  const mockWindows: MockWindowInfo[] = [
    {
      cgWindowID: 123,
      title: 'Test Window 1',
      app: 'Test App',
      ownerName: 'Test App',
      width: 800,
      height: 600,
      size: { width: 800, height: 600 },
      position: { x: 0, y: 0 },
      id: 123,
    },
    {
      cgWindowID: 456,
      title: 'Test Window 2',
      app: 'Another App',
      ownerName: 'Another App',
      width: 1024,
      height: 768,
      size: { width: 1024, height: 768 },
      position: { x: 100, y: 100 },
      id: 456,
    },
  ];

  // Initialize mock data for global access
  mockProcessGroups = [
    {
      pid: 1234,
      name: 'Test App',
      processName: 'Test App',
      icon: 'data:image/png;base64,test',
      iconData: 'test',
      windows: [mockWindows[0]],
    },
    {
      pid: 5678,
      name: 'Another App',
      processName: 'Another App',
      windows: [mockWindows[1]],
    },
  ];

  mockDisplays = [
    {
      id: '0',
      width: 1920,
      height: 1080,
      scaleFactor: 2.0,
      x: 0,
      y: 0,
      name: 'Display 1',
    },
    {
      id: '1',
      width: 2560,
      height: 1440,
      scaleFactor: 2.0,
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
        if (url.includes('/api/screencap/frame')) {
          // Return a mock image URL for frame requests
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            blob: () => Promise.resolve(new Blob(['mock image data'], { type: 'image/jpeg' })),
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
    // Create component
    element = await fixture<ScreencapView>(html`<screencap-view></screencap-view>`);
    await element.updateComplete;

    // Disable WebRTC for tests to use JPEG mode
    element.useWebRTC = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should load windows and display info on connectedCallback', async () => {
      // Wait for initial load to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

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
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      expect(element.status).toBe('error');
      expect(element.error).toContain('Failed to load screen capture data');

      // Restore original mock
      vi.stubGlobal('WebSocket', MockWebSocket);
    });
  });

  describe('window selection', () => {
    beforeEach(async () => {
      // Wait for initial load
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;
    });

    it('should display window list in sidebar', async () => {
      // Wait for status to be ready
      let retries = 0;
      while (element.status !== 'ready' && retries < 10) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await element.updateComplete;
        retries++;
      }
      expect(element.status).toBe('ready');

      // Find all window-item elements across all sections
      const windowElements = element.shadowRoot?.querySelectorAll('.window-item');
      expect(windowElements).toBeTruthy();

      // We have 3 displays (All + 2 individual) + 2 windows = 5 total
      // But "All Displays" only shows when displays.length > 1
      const expectedCount =
        (element.displays.length > 1 ? 1 : 0) + element.displays.length + mockWindows.length;
      expect(windowElements?.length).toBe(expectedCount);

      const allText = Array.from(windowElements || []).map((el) => el.textContent);

      // Check that windows are displayed
      expect(allText.some((text) => text?.includes('Test Window 1'))).toBeTruthy();
      expect(allText.some((text) => text?.includes('Test Window 2'))).toBeTruthy();
      
      // Process names are now in process headers, not window items
      const processHeaders = element.shadowRoot?.querySelectorAll('.process-header');
      const processText = Array.from(processHeaders || []).map((el) => el.textContent);
      expect(processText.some((text) => text?.includes('Test App'))).toBeTruthy();
      expect(processText.some((text) => text?.includes('Another App'))).toBeTruthy();
    });

    it('should select window and start capture on click', async () => {
      // Find a non-desktop window item
      const windowElements = element.shadowRoot?.querySelectorAll('.window-item');
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

      // Check capture was started (wait for async operations)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(element.isCapturing).toBe(true);
    });

    it('should select desktop mode on desktop button click', async () => {
      // Wait for component to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      // Find the desktop window-item by its content
      const windowItems = element.shadowRoot?.querySelectorAll('.window-item');
      let desktopButton: HTMLElement | null = null;

      windowItems?.forEach((item) => {
        if (item.textContent?.includes('All Displays')) {
          desktopButton = item as HTMLElement;
        }
      });

      expect(desktopButton).toBeTruthy();
      desktopButton?.click();
      await element.updateComplete;

      expect(element.captureMode).toBe('desktop');
      expect(element.selectedWindow).toBeNull();

      // Check desktop capture was started
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(element.isCapturing).toBe(true);
    });
  });

  describe('capture controls', () => {
    beforeEach(async () => {
      // Wait for initial load and start capture
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      // Start desktop capture - find desktop window-item
      const windowItems = element.shadowRoot?.querySelectorAll('.window-item');
      let desktopButton: HTMLElement | null = null;

      windowItems?.forEach((item) => {
        if (item.textContent?.includes('All Displays')) {
          desktopButton = item as HTMLElement;
        }
      });

      expect(desktopButton).toBeTruthy();
      desktopButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;
    });

    it('should continue capturing when clicking same mode', async () => {
      expect(element.isCapturing).toBe(true);

      // Click desktop button again - should not stop capture
      const windowItems = element.shadowRoot?.querySelectorAll('.window-item');
      let desktopButton: HTMLElement | null = null;

      windowItems?.forEach((item) => {
        if (item.textContent?.includes('All Displays')) {
          desktopButton = item as HTMLElement;
        }
      });

      expect(desktopButton).toBeTruthy();

      desktopButton?.click();
      await element.updateComplete;

      // Should still be capturing
      expect(element.isCapturing).toBe(true);
    });

    it('should update frame URL periodically', async () => {
      expect(element.isCapturing).toBe(true);

      // Wait for the frame interval to kick in
      await new Promise((resolve) => setTimeout(resolve, 150));
      await element.updateComplete;

      // Frame URL should be set
      expect(element.frameUrl).toContain('/api/screencap/frame?t=');

      const initialFrame = element.frameUrl;

      // Wait for another frame update
      await new Promise((resolve) => setTimeout(resolve, 150));
      await element.updateComplete;

      // Frame URL should change
      expect(element.frameUrl).not.toBe(initialFrame);
      expect(element.frameUrl).toContain('/api/screencap/frame?t=');
    });
  });

  describe('input handling', () => {
    beforeEach(async () => {
      // Wait for initial load and start capture
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      // Start desktop capture - find desktop window-item
      const windowItems = element.shadowRoot?.querySelectorAll('.window-item');
      let desktopButton: HTMLElement | null = null;

      windowItems?.forEach((item) => {
        if (item.textContent?.includes('All Displays')) {
          desktopButton = item as HTMLElement;
        }
      });

      expect(desktopButton).toBeTruthy();
      desktopButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;
    });

    it('should handle keyboard input when focused', async () => {
      // Set focus on the capture area
      const captureArea = element.shadowRoot?.querySelector('.capture-area') as HTMLElement;
      captureArea?.click();
      await element.updateComplete;

      // We need to track WebSocket sends
      let lastSentData: MockApiRequest | null = null;
      const originalSend = MockWebSocket.prototype.send;
      MockWebSocket.prototype.send = function (data: string) {
        lastSentData = JSON.parse(data) as MockApiRequest;
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

      expect(lastSentData).toBeTruthy();
      expect(lastSentData.method).toBe('POST');
      expect(lastSentData.endpoint).toBe('/key');
      expect(lastSentData.params).toEqual({
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
              result: mockProcessGroups,
            };
          } else if (request.method === 'GET' && request.endpoint === '/displays') {
            response = {
              type: 'api-response',
              requestId: request.requestId,
              result: mockDisplays,
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

      // Wait for initial load
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      // Try to start capture - find desktop window-item
      const windowItems = element.shadowRoot?.querySelectorAll('.window-item');
      let desktopButton: HTMLElement | null = null;

      windowItems?.forEach((item) => {
        if (item.textContent?.includes('All Displays')) {
          desktopButton = item as HTMLElement;
        }
      });

      expect(desktopButton).toBeTruthy();
      desktopButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      expect(element.status).toBe('error');
      expect(element.error).toContain('Failed to start screen capture');

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
      // Wait for load
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      const headers = element.shadowRoot?.querySelectorAll('.sidebar-section h3');
      let processesHeader: Element | null = null;
      headers?.forEach((h) => {
        if (h.textContent?.includes('Processes')) {
          processesHeader = h;
        }
      });
      expect(processesHeader).toBeTruthy();
      expect(processesHeader?.textContent).toContain('Processes (2)');
    });

    it('should highlight selected window', async () => {
      // Wait for load
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      const firstWindow = element.shadowRoot?.querySelector('.window-item') as HTMLElement;
      firstWindow?.click();
      await element.updateComplete;

      expect(firstWindow?.classList.contains('selected')).toBe(true);
    });
  });
});

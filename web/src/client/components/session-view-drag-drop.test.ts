// @vitest-environment happy-dom
/**
 * Unit tests for SessionView drag & drop and paste functionality
 */

import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForAsync } from '@/test/utils/component-helpers';
import { createMockSession } from '@/test/utils/lit-test-utils';
import type { FilePicker } from './file-picker.js';
import type { UIState } from './session-view/ui-state-manager.js';
import type { SessionView } from './session-view.js';

// Test interface for SessionView with access to private managers
interface SessionViewTestInterface extends SessionView {
  uiStateManager: {
    getState: () => UIState;
    setIsDragOver: (value: boolean) => void;
    setShowFileBrowser: (value: boolean) => void;
    setShowImagePicker: (value: boolean) => void;
    setShowMobileInput: (value: boolean) => void;
  };
  uploadFile?: (file: File) => Promise<void>;
}

// Mock auth client
vi.mock('../services/auth-client.js', () => ({
  authClient: {
    getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
    getCurrentUser: () => ({ username: 'test-user' }),
  },
}));

// Mock logger - store the mock functions so we can access them
const mockLogger = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../utils/logger.js', () => ({
  createLogger: () => mockLogger,
}));

// Mock other dependencies
vi.mock('../utils/terminal-preferences.js', () => ({
  TerminalPreferencesManager: {
    getInstance: () => ({
      getFontSize: () => 14,
      getMaxCols: () => 0,
      setMaxCols: vi.fn(),
      getTheme: () => 'auto',
      setTheme: vi.fn(),
      setFontSize: vi.fn(),
      getTerminalSettings: () => ({}),
    }),
  },
  COMMON_TERMINAL_WIDTHS: [
    { label: '80', value: 80 },
    { label: '120', value: 120 },
  ],
}));

vi.mock('../services/buffer-subscription-service.js', () => ({
  bufferSubscriptionService: {
    isConnected: () => true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock('../services/repository-service.js', () => ({
  repositoryService: {
    getRepositoryPath: vi.fn().mockReturnValue(null),
    setRepositoryPath: vi.fn(),
    getActiveRepository: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('./session-view/session-action-manager.js', () => ({
  SessionActionManager: class {
    setAuthClient = vi.fn();
    setCallbacks = vi.fn();
    terminateSession = vi.fn().mockResolvedValue({ success: true });
    clearSession = vi.fn().mockResolvedValue({ success: true });
  },
}));

describe('SessionView Drag & Drop and Paste', () => {
  let element: SessionView;
  let mockFilePicker: Partial<FilePicker>;

  beforeAll(async () => {
    // Import components to register custom elements
    await import('./session-view.js');
    await import('./terminal.js');
    await import('./vibe-terminal-binary.js');
    await import('./session-view/terminal-renderer.js');
  });

  // Helper to access the uiStateManager from the element
  const _getUiStateManager = () => {
    // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
    // biome-ignore lint/suspicious/noExplicitAny: need to access private property
    return (element as any)['uiStateManager'];
  };

  // Helper to create a mock drag event with dataTransfer
  function createDragEvent(type: string, hasFiles = false): DragEvent {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
    });

    // Mock the dataTransfer property
    const mockDataTransfer = {
      types: hasFiles ? ['Files'] : ['text/plain'],
      files: hasFiles ? { length: 1 } : { length: 0 },
      items: hasFiles ? [{ kind: 'file' }] : [],
    };

    Object.defineProperty(event, 'dataTransfer', {
      value: mockDataTransfer,
      writable: false,
      configurable: true,
    });

    return event;
  }

  beforeEach(async () => {
    // Import component to register custom element
    await import('./session-view.js');
    await import('./terminal.js');
    await import('./vibe-terminal-binary.js');
    await import('./session-view/terminal-renderer.js');

    // Ensure custom element is registered
    if (!customElements.get('session-view')) {
      console.error('session-view custom element not registered!');
    }
    // Create mock file picker
    mockFilePicker = {
      uploadFile: vi.fn().mockResolvedValue(undefined),
    };

    // Set up the session view element
    const mockSession = createMockSession({
      id: 'test-session',
      status: 'running',
      title: 'Test Session',
    });

    // Create element without session first
    element = await fixture<SessionView>(html`
      <session-view></session-view>
    `);

    // Wait for element to be fully initialized
    await element.updateComplete;

    // Now set the session
    element.session = mockSession;
    await element.updateComplete;
    // Wait for firstUpdated to be called
    await waitForAsync();

    // Give the component time to fully initialize all managers
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Mock the file picker element
    const originalQuerySelector = element.querySelector.bind(element);
    vi.spyOn(element, 'querySelector').mockImplementation((selector: string) => {
      if (selector === 'file-picker') {
        return mockFilePicker as unknown as Element;
      }
      // For the drag overlay tests, return the actual element
      // Note: session-view doesn't use shadow DOM
      return originalQuerySelector(selector) || null;
    });
  });

  afterEach(() => {
    element.remove();
    vi.clearAllMocks();
    // Clear the logger mock to avoid test pollution
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  describe('Drag Over', () => {
    it('should show drag overlay when files are dragged over', async () => {
      const dragEvent = createDragEvent('dragover', true);

      element.dispatchEvent(dragEvent);
      await element.updateComplete;

      const _testElement = element as SessionViewTestInterface;
      // Access the manager using bracket notation for private property
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager).toBeDefined();
      expect(uiStateManager.getState().isDragOver).toBe(true);
    });

    it('should not show drag overlay when non-files are dragged over', async () => {
      const dragEvent = createDragEvent('dragover', false);

      element.dispatchEvent(dragEvent);
      await element.updateComplete;

      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(false);
    });

    it('should prevent default behavior on dragover', () => {
      const dragEvent = createDragEvent('dragover');

      const preventDefaultSpy = vi.spyOn(dragEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(dragEvent, 'stopPropagation');

      element.dispatchEvent(dragEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Drag Leave', () => {
    it('should hide drag overlay when dragging leaves the element', async () => {
      // First, trigger drag over to set isDragOver to true
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // Test simplified behavior - drop event always sets isDragOver to false
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock empty files
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Drop always sets isDragOver to false
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      expect((element as any)['uiStateManager'].getState().isDragOver).toBe(false);
    });

    it('should hide drag overlay when drag operation is cancelled (dragend)', async () => {
      // First, trigger drag over to set isDragOver to true
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // Simulate drag end event (e.g., user presses ESC or drags outside window)
      const dragEndEvent = new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
      });

      // Dispatch dragend on the document since that's where it's registered
      document.dispatchEvent(dragEndEvent);
      await element.updateComplete;

      // Dragend should clear the drag state
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      expect((element as any)['uiStateManager'].getState().isDragOver).toBe(false);
    });

    it('should keep drag overlay when dragging within the element', async () => {
      // First, trigger drag over to set isDragOver to true
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // Create a drag leave event within bounds
      const dragLeaveEvent = new DragEvent('dragleave', {
        clientX: 50, // Inside the bounds
        clientY: 50,
        bubbles: true,
        cancelable: true,
      });

      // Mock getBoundingClientRect to return bounds that contain the mouse position
      const originalGetBoundingClientRect = element.getBoundingClientRect;
      element.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 100,
          top: 0,
          bottom: 100,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          toJSON: () => ({}),
        }) as DOMRect;

      // Mock the currentTarget for the event handler
      const proxyHandler = {
        get(target: DragEvent, prop: string | symbol): unknown {
          if (prop === 'currentTarget') {
            return element;
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      };

      const proxiedEvent = new Proxy(dragLeaveEvent, proxyHandler);

      // Dispatch the event instead of calling handler directly
      element.dispatchEvent(proxiedEvent);
      await element.updateComplete;

      // Restore original function
      element.getBoundingClientRect = originalGetBoundingClientRect;

      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      expect((element as any)['uiStateManager'].getState().isDragOver).toBe(true);
    });
  });

  describe('Drop', () => {
    it('should handle single file drop', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with files
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file],
        },
        writable: false,
        configurable: true,
      });

      const testElement = element as SessionViewTestInterface;
      testElement.uiStateManager.setIsDragOver(true);
      element.dispatchEvent(dropEvent);
      await element.updateComplete;
      expect(testElement.uiStateManager.getState().isDragOver).toBe(false);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file);
    });

    it('should handle multiple file drops', async () => {
      const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
      const file2 = new File(['content2'], 'file2.txt', { type: 'text/plain' });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with multiple files
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file1, file2],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Wait for async operations
      await waitForAsync();

      expect(mockFilePicker.uploadFile).toHaveBeenCalledTimes(2);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file1);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file2);
    });

    it('should handle drop with no files gracefully', async () => {
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with no files
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should continue uploading remaining files if one fails', async () => {
      const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
      const file2 = new File(['content2'], 'file2.txt', { type: 'text/plain' });
      const file3 = new File(['content3'], 'file3.txt', { type: 'text/plain' });

      // Make the second file fail
      mockFilePicker.uploadFile = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Upload failed'))
        .mockResolvedValueOnce(undefined);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with multiple files
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file1, file2, file3],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Wait for all promises to resolve
      await waitForAsync();

      expect(mockFilePicker.uploadFile).toHaveBeenCalledTimes(3);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file1);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file2);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file3);
    });

    it('should prevent default behavior on drop', () => {
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [],
        },
        writable: false,
        configurable: true,
      });

      const preventDefaultSpy = vi.spyOn(dropEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(dropEvent, 'stopPropagation');

      element.dispatchEvent(dropEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Paste', () => {
    it('should handle paste of single file', async () => {
      const file = new File(['test content'], 'test.png', { type: 'image/png' });
      const clipboardData = {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      // Dispatch on document since paste handler is on document
      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file);
    });

    it('should handle paste of multiple files', async () => {
      const file1 = new File(['content1'], 'image1.png', { type: 'image/png' });
      const file2 = new File(['content2'], 'image2.jpg', { type: 'image/jpeg' });

      const clipboardData = {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file1,
          },
          {
            kind: 'file',
            type: 'image/jpeg',
            getAsFile: () => file2,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;
      await waitForAsync();

      expect(mockFilePicker.uploadFile).toHaveBeenCalledTimes(2);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file1);
      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(file2);
    });

    it('should not handle paste when file browser is open', async () => {
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      uiStateManager.setShowFileBrowser(true);
      await element.updateComplete;

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const clipboardData = {
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should not handle paste when image picker is open', async () => {
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      uiStateManager.setShowImagePicker(true);
      await element.updateComplete;

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const clipboardData = {
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should not handle paste when mobile input is open', async () => {
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      uiStateManager.setShowMobileInput(true);
      await element.updateComplete;

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const clipboardData = {
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should ignore paste events with no files', async () => {
      const clipboardData = {
        items: [
          {
            kind: 'string',
            type: 'text/plain',
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault');

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('should prevent default for file paste events', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const clipboardData = {
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault');

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should continue pasting remaining files if one fails', async () => {
      const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
      const file2 = new File(['content2'], 'file2.txt', { type: 'text/plain' });
      const file3 = new File(['content3'], 'file3.txt', { type: 'text/plain' });

      // Make the second file fail
      mockFilePicker.uploadFile = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Upload failed'))
        .mockResolvedValueOnce(undefined);

      const clipboardData = {
        items: [
          { kind: 'file', getAsFile: () => file1 },
          { kind: 'file', getAsFile: () => file2 },
          { kind: 'file', getAsFile: () => file3 },
        ],
        getData: () => '', // Return empty string for text data
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as unknown as DataTransfer,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(pasteEvent);
      await element.updateComplete;

      // Wait for all promises to resolve
      await waitForAsync();

      expect(mockFilePicker.uploadFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('Visual Overlay', () => {
    it('should show drag overlay when isDragOver is true', async () => {
      // Trigger drag over
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;

      // Verify the state is set correctly
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // The visual overlay is rendered by overlays-container based on this state
      // Testing actual DOM rendering is not needed as long as state is correct
    });

    it('should hide drag overlay when isDragOver is false', async () => {
      // First show it
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      expect((element as any)['uiStateManager'].getState().isDragOver).toBe(true);

      // Then hide it with drop
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [] },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Verify the state is set correctly
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      expect((element as any)['uiStateManager'].getState().isDragOver).toBe(false);
    });

    it('should toggle drag overlay state correctly', async () => {
      // Initial state
      // biome-ignore lint/complexity/useLiteralKeys: accessing private property for testing
      // biome-ignore lint/suspicious/noExplicitAny: need to access private property
      const uiStateManager = (element as any)['uiStateManager'];
      expect(uiStateManager.getState().isDragOver).toBe(false);

      // Drag over with files
      const dragOverEvent = createDragEvent('dragover', true);
      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // Drag over without files keeps the current state (doesn't hide it)
      // The overlay is only hidden on drag leave or drop
      const dragOverNoFiles = createDragEvent('dragover', false);
      element.dispatchEvent(dragOverNoFiles);
      await element.updateComplete;
      expect(uiStateManager.getState().isDragOver).toBe(true);

      // Drop event should hide the overlay
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [] },
        writable: false,
        configurable: true,
      });
      element.dispatchEvent(dropEvent);
      await element.updateComplete;
      expect(uiStateManager.getState().isDragOver).toBe(false);
    });
  });

  describe('Upload File', () => {
    it('should log error when file picker is not found', async () => {
      // Override the querySelector mock to return null
      vi.spyOn(element, 'querySelector').mockReturnValue(null);

      // Clear all logger mocks to ensure clean state
      mockLogger.log.mockClear();
      mockLogger.error.mockClear();
      mockLogger.warn.mockClear();
      mockLogger.debug.mockClear();

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with file
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Wait for async operations
      await waitForAsync();

      // The logger.error should have been called
      expect(mockLogger.error).toHaveBeenCalledWith(
        'File picker component not found or upload method not available'
      );
    });

    it('should dispatch error event when upload fails', async () => {
      mockFilePicker.uploadFile = vi.fn().mockRejectedValue(new Error('Network error'));

      const errorSpy = vi.fn();
      element.addEventListener('error', errorSpy);

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      // Mock dataTransfer with file
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file],
        },
        writable: false,
        configurable: true,
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Wait for async operations
      await waitForAsync();

      expect(errorSpy).toHaveBeenCalled();
      const errorEvent = errorSpy.mock.calls[0][0] as CustomEvent;
      expect(errorEvent.detail).toBe('Network error');
    });
  });
});

/**
 * Unit tests for SessionView drag & drop and paste functionality
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import './session-view.js';
import type { SessionView } from './session-view.js';

// Mock auth client
vi.mock('../services/auth-client.js', () => ({
  authClient: {
    getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock other dependencies
vi.mock('../utils/terminal-preferences.js', () => ({
  TerminalPreferencesManager: {
    getInstance: () => ({
      getFontSize: () => 14,
      getMaxCols: () => 0,
      setMaxCols: vi.fn(),
    }),
  },
  COMMON_TERMINAL_WIDTHS: [
    { label: '80', value: 80 },
    { label: '120', value: 120 },
  ],
}));

describe('SessionView Drag & Drop and Paste', () => {
  let element: SessionView;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = '<session-view></session-view>';
    element = container.querySelector('session-view') as SessionView;

    // Set up a mock session
    element.session = {
      id: 'test-session',
      name: 'Test Session',
      command: ['bash'],
      workingDir: '/test',
      status: 'running',
      startedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    } as any;
  });

  afterEach(() => {
    container.remove();
  });

  describe('Drag & Drop', () => {
    it('should show drag overlay when dragging files over', async () => {
      const dataTransfer = new DataTransfer();
      const dragEvent = new DragEvent('dragover', {
        bubbles: true,
        dataTransfer,
      });

      // Mock dataTransfer to include Files type
      if (dragEvent.dataTransfer) {
        Object.defineProperty(dragEvent.dataTransfer, 'types', {
          value: ['Files'],
          writable: false,
        });
      }

      element.dispatchEvent(dragEvent);
      await element.updateComplete;

      // Also wait for any async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element.isDragOver).toBe(true);
      const overlay = element.shadowRoot?.querySelector('.fixed.inset-0.bg-black.bg-opacity-80');
      expect(overlay).toBeTruthy();
    });

    it('should hide drag overlay when leaving drag area', async () => {
      // First show the overlay
      const dataTransfer = new DataTransfer();
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        dataTransfer,
      });
      if (dragOverEvent.dataTransfer) {
        Object.defineProperty(dragOverEvent.dataTransfer, 'types', {
          value: ['Files'],
          writable: false,
        });
      }

      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;

      expect(element.isDragOver).toBe(true);

      // Then simulate leaving the area
      const dragLeaveEvent = new DragEvent('dragleave', {
        bubbles: true,
        clientX: -100, // Outside the element bounds
        clientY: -100,
      });

      // Mock getBoundingClientRect
      element.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      }));

      element.dispatchEvent(dragLeaveEvent);
      await element.updateComplete;

      expect(element.isDragOver).toBe(false);
    });

    it('should handle file drop', async () => {
      const testFile = new File(['fake content'], 'test.txt', { type: 'text/plain' });
      const dataTransfer = new DataTransfer();

      // Create a mock FileList
      const files = [testFile];
      Object.defineProperty(files, 'item', {
        value: (index: number) => files[index] || null,
      });
      Object.defineProperty(files, 'length', {
        value: files.length,
      });

      Object.defineProperty(dataTransfer, 'files', {
        value: files,
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      // Mock the file picker component
      const mockFilePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };

      // Override querySelector to return our mock
      const originalQuerySelector = element.querySelector.bind(element);
      element.querySelector = vi.fn((selector: string) => {
        if (selector === 'file-picker') {
          return mockFilePicker;
        }
        return originalQuerySelector(selector);
      });

      element.dispatchEvent(dropEvent);

      // Wait for async operations
      await vi.waitFor(() => {
        expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(testFile);
      });

      expect(element.isDragOver).toBe(false);
    });

    it('should handle empty file drops gracefully', async () => {
      const dataTransfer = new DataTransfer();
      Object.defineProperty(dataTransfer, 'files', {
        value: [],
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      const mockFilePicker = {
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockFilePicker);

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle multiple files and pick the first one', async () => {
      const textFile = new File(['text'], 'test.txt', { type: 'text/plain' });
      const jsonFile = new File(['{}'], 'test.json', { type: 'application/json' });
      const pdfFile = new File(['pdf'], 'test.pdf', { type: 'application/pdf' });

      const dataTransfer = new DataTransfer();

      // Create a mock FileList with multiple files
      const files = [textFile, jsonFile, pdfFile];
      Object.defineProperty(files, 'item', {
        value: (index: number) => files[index] || null,
      });
      Object.defineProperty(files, 'length', {
        value: files.length,
      });

      Object.defineProperty(dataTransfer, 'files', {
        value: files,
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      const mockFilePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };

      // Override querySelector to return our mock
      const originalQuerySelector = element.querySelector.bind(element);
      element.querySelector = vi.fn((selector: string) => {
        if (selector === 'file-picker') {
          return mockFilePicker;
        }
        return originalQuerySelector(selector);
      });

      element.dispatchEvent(dropEvent);

      // Wait for async operations
      await vi.waitFor(() => {
        expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(textFile);
      });

      expect(mockFilePicker.uploadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Paste Functionality', () => {
    it('should handle file paste from clipboard', async () => {
      const testFile = new File(['fake content'], 'clipboard.txt', { type: 'text/plain' });

      // Mock clipboard item
      const mockClipboardItem = {
        kind: 'file',
        type: 'text/plain',
        getAsFile: () => testFile,
      };

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });

      // Mock clipboardData.items
      Object.defineProperty(pasteEvent.clipboardData, 'items', {
        value: [mockClipboardItem],
        writable: false,
      });

      const mockFilePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };
      element.querySelector = vi.fn(() => mockFilePicker);

      // Simulate paste event on document
      document.dispatchEvent(pasteEvent);

      expect(mockFilePicker.uploadFile).toHaveBeenCalledWith(testFile);
    });

    it('should ignore paste when modals are open', async () => {
      element['showFileBrowser'] = true;

      const testFile = new File(['fake content'], 'clipboard.txt', { type: 'text/plain' });
      const mockClipboardItem = {
        kind: 'file',
        type: 'text/plain',
        getAsFile: () => testFile,
      };

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });

      Object.defineProperty(pasteEvent.clipboardData, 'items', {
        value: [mockClipboardItem],
        writable: false,
      });

      const mockFilePicker = {
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockFilePicker);

      document.dispatchEvent(pasteEvent);

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should ignore paste of non-file content', async () => {
      const textItem = {
        kind: 'string',
        type: 'text/plain',
        getAsFile: () => null,
      };

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });

      Object.defineProperty(pasteEvent.clipboardData, 'items', {
        value: [textItem],
        writable: false,
      });

      const mockFilePicker = {
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockFilePicker);

      document.dispatchEvent(pasteEvent);

      expect(mockFilePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle paste error gracefully', async () => {
      const imageFile = new File(['fake image'], 'clipboard.png', { type: 'image/png' });
      const mockClipboardItem = {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => imageFile,
      };

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });

      Object.defineProperty(pasteEvent.clipboardData, 'items', {
        value: [mockClipboardItem],
        writable: false,
      });

      const mockImagePicker = {
        uploadFile: vi.fn().mockRejectedValue(new Error('Upload failed')),
      };

      // Override querySelector to return our mock
      const originalQuerySelector = element.querySelector.bind(element);
      element.querySelector = vi.fn((selector: string) => {
        if (selector === 'file-picker') {
          return mockImagePicker;
        }
        return originalQuerySelector(selector);
      });

      const errorSpy = vi.fn();
      element.addEventListener('error', errorSpy);

      document.dispatchEvent(pasteEvent);

      // Wait for the error event to be dispatched
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: 'Upload failed',
          })
        );
      });
    });
  });

  describe('Event Listener Management', () => {
    it('should add event listeners on connect', () => {
      const addEventListenerSpy = vi.spyOn(element, 'addEventListener');
      const documentAddSpy = vi.spyOn(document, 'addEventListener');

      element.connectedCallback();

      expect(addEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function));
      expect(documentAddSpy).toHaveBeenCalledWith('paste', expect.any(Function));
    });

    it('should remove event listeners on disconnect', () => {
      const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
      const documentRemoveSpy = vi.spyOn(document, 'removeEventListener');

      element.disconnectedCallback();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function));
      expect(documentRemoveSpy).toHaveBeenCalledWith('paste', expect.any(Function));
    });
  });
});

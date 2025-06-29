/**
 * Unit tests for SessionView drag & drop and paste functionality
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../client/components/session-view.js';
import type { SessionView } from '../../client/components/session-view.js';

// Mock auth client
vi.mock('../../client/services/auth-client.js', () => ({
  authClient: {
    getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
  },
}));

// Mock logger
vi.mock('../../client/utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock other dependencies
vi.mock('../../client/utils/terminal-preferences.js', () => ({
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
      const dragEvent = new DragEvent('dragover', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });

      // Mock dataTransfer to include Files type
      Object.defineProperty(dragEvent.dataTransfer, 'types', {
        value: ['Files'],
        writable: false,
      });

      element.dispatchEvent(dragEvent);
      await element.updateComplete;

      const overlay = element.querySelector('.fixed.inset-0.bg-black.bg-opacity-80');
      expect(overlay).toBeTruthy();
    });

    it('should hide drag overlay when leaving drag area', async () => {
      // First show the overlay
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      Object.defineProperty(dragOverEvent.dataTransfer, 'types', {
        value: ['Files'],
        writable: false,
      });

      element.dispatchEvent(dragOverEvent);
      await element.updateComplete;

      expect(element['isDragOver']).toBe(true);

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

      expect(element['isDragOver']).toBe(false);
    });

    it('should handle image file drop', async () => {
      const imageFile = new File(['fake image'], 'test.png', { type: 'image/png' });
      const dataTransfer = new DataTransfer();
      Object.defineProperty(dataTransfer, 'files', {
        value: [imageFile],
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      // Mock the image picker component
      const mockImagePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };
      element.querySelector = vi.fn((selector) => {
        if (selector === 'image-picker') {
          return mockImagePicker;
        }
        return null;
      });

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      expect(mockImagePicker.uploadFile).toHaveBeenCalledWith(imageFile);
      expect(element['isDragOver']).toBe(false);
    });

    it('should ignore non-image file drops', async () => {
      const textFile = new File(['text'], 'test.txt', { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      Object.defineProperty(dataTransfer, 'files', {
        value: [textFile],
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      const mockImagePicker = {
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockImagePicker);

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      expect(mockImagePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle multiple files and pick the first image', async () => {
      const textFile = new File(['text'], 'test.txt', { type: 'text/plain' });
      const imageFile1 = new File(['image1'], 'test1.png', { type: 'image/png' });
      const imageFile2 = new File(['image2'], 'test2.jpg', { type: 'image/jpeg' });

      const dataTransfer = new DataTransfer();
      Object.defineProperty(dataTransfer, 'files', {
        value: [textFile, imageFile1, imageFile2],
        writable: false,
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
      });

      const mockImagePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };
      element.querySelector = vi.fn(() => mockImagePicker);

      element.dispatchEvent(dropEvent);
      await element.updateComplete;

      expect(mockImagePicker.uploadFile).toHaveBeenCalledWith(imageFile1);
      expect(mockImagePicker.uploadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Paste Functionality', () => {
    it('should handle image paste from clipboard', async () => {
      const imageFile = new File(['fake image'], 'clipboard.png', { type: 'image/png' });

      // Mock clipboard item
      const mockClipboardItem = {
        type: 'image/png',
        getAsFile: () => imageFile,
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

      const mockImagePicker = {
        uploadFile: vi.fn().mockResolvedValue(undefined),
      };
      element.querySelector = vi.fn(() => mockImagePicker);

      // Simulate paste event on document
      document.dispatchEvent(pasteEvent);

      expect(mockImagePicker.uploadFile).toHaveBeenCalledWith(imageFile);
    });

    it('should ignore paste when modals are open', async () => {
      element['showFileBrowser'] = true;

      const imageFile = new File(['fake image'], 'clipboard.png', { type: 'image/png' });
      const mockClipboardItem = {
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
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockImagePicker);

      document.dispatchEvent(pasteEvent);

      expect(mockImagePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should ignore paste of non-image content', async () => {
      const textItem = {
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

      const mockImagePicker = {
        uploadFile: vi.fn(),
      };
      element.querySelector = vi.fn(() => mockImagePicker);

      document.dispatchEvent(pasteEvent);

      expect(mockImagePicker.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle paste error gracefully', async () => {
      const imageFile = new File(['fake image'], 'clipboard.png', { type: 'image/png' });
      const mockClipboardItem = {
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
      element.querySelector = vi.fn(() => mockImagePicker);

      const errorSpy = vi.fn();
      element.addEventListener('error', errorSpy);

      document.dispatchEvent(pasteEvent);

      // Wait for async error handling
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: 'Upload failed',
        })
      );
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

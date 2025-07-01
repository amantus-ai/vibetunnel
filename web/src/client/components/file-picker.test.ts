/**
 * Unit tests for FilePicker component
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import './file-picker.js';
import type { FilePicker } from './file-picker.js';

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

describe('FilePicker Component', () => {
  let element: FilePicker;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = '<file-picker></file-picker>';
    element = container.querySelector('file-picker') as FilePicker;
  });

  afterEach(() => {
    container.remove();
  });

  it('should render when visible', async () => {
    element.visible = true;
    await element.updateComplete;

    const modal = element.querySelector('.fixed');
    expect(modal).toBeTruthy();
  });

  it('should not render when not visible', async () => {
    element.visible = false;
    await element.updateComplete;

    const modal = element.querySelector('.fixed');
    expect(modal).toBeFalsy();
  });

  it('should show upload progress when uploading', async () => {
    element.visible = true;
    element.uploading = true;
    element.uploadProgress = 50;
    await element.updateComplete;

    const progressText = element.querySelector('span');
    expect(progressText?.textContent).toContain('Uploading...');

    const progressBar = element.querySelector('.bg-blue-500');
    expect(progressBar).toBeTruthy();
  });

  it('should show file selection button when not uploading', async () => {
    element.visible = true;
    element.uploading = false;
    await element.updateComplete;

    const buttons = element.querySelectorAll('button');
    const fileButton = Array.from(buttons).find((btn) => btn.textContent?.includes('Choose File'));
    expect(fileButton).toBeTruthy();
  });

  it('should emit file-cancel event when cancel button is clicked', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('file-cancel', cancelEventSpy);

    const buttons = element.querySelectorAll('button');
    const cancelButton = Array.from(buttons).find((btn) => btn.textContent?.includes('Cancel'));

    expect(cancelButton).toBeTruthy();
    cancelButton?.click();

    expect(cancelEventSpy).toHaveBeenCalledOnce();
  });

  it('should emit file-cancel when clicking outside modal', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('file-cancel', cancelEventSpy);

    const backdrop = element.querySelector('.fixed');
    expect(backdrop).toBeTruthy();

    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(cancelEventSpy).toHaveBeenCalledOnce();
  });

  it('should not emit file-cancel when clicking inside modal', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('file-cancel', cancelEventSpy);

    const modal = element.querySelector('.bg-white');
    expect(modal).toBeTruthy();

    modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(cancelEventSpy).not.toHaveBeenCalled();
  });

  it('should disable cancel button when uploading', async () => {
    element.visible = true;
    element.uploading = true;
    await element.updateComplete;

    const buttons = element.querySelectorAll('button');
    const cancelButton = Array.from(buttons).find((btn) => btn.textContent?.includes('Cancel'));

    expect(cancelButton?.hasAttribute('disabled')).toBe(true);
  });

  it('should create file input element on connect', () => {
    // The file input should be created when the component connects
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);
  });

  it('should handle file input click', async () => {
    element.visible = true;
    await element.updateComplete;

    const fileButton = Array.from(element.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Choose File')
    );

    expect(fileButton).toBeTruthy();

    // Mock file input
    const mockFileInput = {
      removeAttribute: vi.fn(),
      click: vi.fn(),
      remove: vi.fn(),
    };
    element.fileInput = mockFileInput as any;

    fileButton?.click();

    expect(mockFileInput.removeAttribute).toHaveBeenCalledWith('capture');
    expect(mockFileInput.click).toHaveBeenCalled();
  });

  it('should accept any file type', () => {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const fileInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    expect(fileInput.accept).toBe('*/*');
  });

  it('should clean up file input on disconnect', () => {
    const initialInputCount = document.querySelectorAll('input[type="file"]').length;

    element.remove();

    const finalInputCount = document.querySelectorAll('input[type="file"]').length;
    expect(finalInputCount).toBeLessThan(initialInputCount);
  });

  it('should have uploadFile method for programmatic uploads', () => {
    expect(typeof element.uploadFile).toBe('function');
  });

  it('should accept any file type in uploadFile method', async () => {
    const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });

    // Mock the XMLHttpRequest for this test
    const mockXHR = {
      upload: { addEventListener: vi.fn() },
      addEventListener: vi.fn((event, callback) => {
        if (event === 'load') {
          setTimeout(() => callback(), 0);
        }
      }),
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      status: 200,
      responseText: JSON.stringify({
        success: true,
        filename: 'test.txt',
        originalName: 'test.txt',
        size: 100,
        mimetype: 'text/plain',
        path: '/path/to/test.txt',
        relativePath: 'test.txt',
      }),
    };

    // @ts-expect-error - Mocking XMLHttpRequest
    global.XMLHttpRequest = vi.fn(() => mockXHR);

    // Should not throw an error for any file type
    await expect(element.uploadFile(textFile)).resolves.toBeUndefined();
  });

  it('should accept image files in uploadFile method', async () => {
    // Mock the XMLHttpRequest for this test
    const mockXHR = {
      upload: { addEventListener: vi.fn() },
      addEventListener: vi.fn(),
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      status: 200,
      responseText: JSON.stringify({
        success: true,
        filename: 'test.png',
        originalName: 'test.png',
        size: 100,
        mimetype: 'image/png',
        path: '/path/to/test.png',
        relativePath: 'uploads/test.png',
      }),
    };

    // @ts-ignore
    global.XMLHttpRequest = vi.fn(() => mockXHR);

    const imageFile = new File(['fake image'], 'test.png', { type: 'image/png' });

    const fileSelectedSpy = vi.fn();
    element.addEventListener('file-selected', fileSelectedSpy);

    const uploadPromise = element.uploadFile(imageFile);

    // Simulate successful upload
    const loadHandler = mockXHR.addEventListener.mock.calls.find((call) => call[0] === 'load')[1];
    loadHandler();

    await uploadPromise;

    expect(fileSelectedSpy).toHaveBeenCalledOnce();
  });
});

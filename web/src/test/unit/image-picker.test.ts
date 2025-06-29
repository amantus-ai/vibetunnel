/**
 * Unit tests for ImagePicker component
 */

import { html } from 'lit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../client/components/image-picker.js';
import type { ImagePicker } from '../../client/components/image-picker.js';

// Mock auth client
vi.mock('../../client/services/auth-client.js', () => ({
  authClient: {
    getAuthHeader: () => ({ 'Authorization': 'Bearer test-token' }),
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

describe('ImagePicker Component', () => {
  let element: ImagePicker;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = '<image-picker></image-picker>';
    element = container.querySelector('image-picker') as ImagePicker;
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
    element['uploading'] = true;
    element['uploadProgress'] = 50;
    await element.updateComplete;

    const progressText = element.querySelector('span');
    expect(progressText?.textContent).toContain('Uploading...');
    
    const progressBar = element.querySelector('.bg-blue-500');
    expect(progressBar).toBeTruthy();
  });

  it('should show camera and gallery buttons when not uploading', async () => {
    element.visible = true;
    element['uploading'] = false;
    await element.updateComplete;

    const buttons = element.querySelectorAll('button');
    const cameraButton = Array.from(buttons).find(btn => btn.textContent?.includes('Take Photo'));
    const galleryButton = Array.from(buttons).find(btn => btn.textContent?.includes('Choose from Gallery'));
    
    expect(cameraButton).toBeTruthy();
    expect(galleryButton).toBeTruthy();
  });

  it('should emit image-cancel event when cancel button is clicked', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('image-cancel', cancelEventSpy);

    const buttons = element.querySelectorAll('button');
    const cancelButton = Array.from(buttons).find(btn => btn.textContent?.includes('Cancel'));
    
    expect(cancelButton).toBeTruthy();
    cancelButton?.click();
    
    expect(cancelEventSpy).toHaveBeenCalledOnce();
  });

  it('should emit image-cancel when clicking outside modal', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('image-cancel', cancelEventSpy);

    const backdrop = element.querySelector('.fixed');
    expect(backdrop).toBeTruthy();
    
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    
    expect(cancelEventSpy).toHaveBeenCalledOnce();
  });

  it('should not emit image-cancel when clicking inside modal', async () => {
    element.visible = true;
    await element.updateComplete;

    const cancelEventSpy = vi.fn();
    element.addEventListener('image-cancel', cancelEventSpy);

    const modal = element.querySelector('.bg-white');
    expect(modal).toBeTruthy();
    
    modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    
    expect(cancelEventSpy).not.toHaveBeenCalled();
  });

  it('should disable cancel button when uploading', async () => {
    element.visible = true;
    element['uploading'] = true;
    await element.updateComplete;

    const buttons = element.querySelectorAll('button');
    const cancelButton = Array.from(buttons).find(btn => btn.textContent?.includes('Cancel'));
    
    expect(cancelButton?.hasAttribute('disabled')).toBe(true);
  });

  it('should create file input element on connect', () => {
    // The file input should be created when the component connects
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);
  });

  it('should set correct file input attributes for camera', async () => {
    element.visible = true;
    await element.updateComplete;

    const cameraButton = Array.from(element.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('Take Photo'));
    
    expect(cameraButton).toBeTruthy();
    
    // Mock file input
    const mockFileInput = {
      capture: '',
      click: vi.fn(),
    };
    element['fileInput'] = mockFileInput as any;

    cameraButton?.click();

    expect(mockFileInput.capture).toBe('environment');
    expect(mockFileInput.click).toHaveBeenCalled();
  });

  it('should remove capture attribute for gallery', async () => {
    element.visible = true;
    await element.updateComplete;

    const galleryButton = Array.from(element.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('Choose from Gallery'));
    
    expect(galleryButton).toBeTruthy();
    
    // Mock file input
    const mockFileInput = {
      removeAttribute: vi.fn(),
      click: vi.fn(),
    };
    element['fileInput'] = mockFileInput as any;

    galleryButton?.click();

    expect(mockFileInput.removeAttribute).toHaveBeenCalledWith('capture');
    expect(mockFileInput.click).toHaveBeenCalled();
  });

  it('should clean up file input on disconnect', () => {
    const initialInputCount = document.querySelectorAll('input[type="file"]').length;
    
    element.remove();
    
    const finalInputCount = document.querySelectorAll('input[type="file"]').length;
    expect(finalInputCount).toBeLessThan(initialInputCount);
  });
});
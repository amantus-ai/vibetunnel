// @vitest-environment happy-dom

import { fixture, html } from '@open-wc/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageUploadMenu } from './image-upload-menu.js';
import './image-upload-menu.js';

describe('ImageUploadMenu', () => {
  let element: ImageUploadMenu;
  let mockCallbacks: {
    onPasteImage: ReturnType<typeof vi.fn>;
    onSelectImage: ReturnType<typeof vi.fn>;
    onOpenCamera: ReturnType<typeof vi.fn>;
    onBrowseFiles: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Reset clipboard API mock
    vi.clearAllMocks();

    // Create mock callbacks
    mockCallbacks = {
      onPasteImage: vi.fn(),
      onSelectImage: vi.fn(),
      onOpenCamera: vi.fn(),
      onBrowseFiles: vi.fn(),
    };

    // Create element with callbacks
    element = await fixture(html`
      <image-upload-menu
        .onPasteImage=${mockCallbacks.onPasteImage}
        .onSelectImage=${mockCallbacks.onSelectImage}
        .onOpenCamera=${mockCallbacks.onOpenCamera}
        .onBrowseFiles=${mockCallbacks.onBrowseFiles}
      ></image-upload-menu>
    `);
  });

  describe('Menu Toggle', () => {
    it('should initially have menu closed', () => {
      expect(element.shadowRoot).toBeNull(); // No shadow DOM
      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });

    it('should open menu when button is clicked', async () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      expect(button).toBeTruthy();

      button.click();
      await element.updateComplete;

      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeTruthy();
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('should close menu when button is clicked again', async () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;

      // Open menu
      button.click();
      await element.updateComplete;

      // Close menu
      button.click();
      await element.updateComplete;

      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('should apply active styles when menu is open', async () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;

      button.click();
      await element.updateComplete;

      expect(button.className).toContain('bg-surface-hover');
      expect(button.className).toContain('border-primary');
      expect(button.className).toContain('text-primary');
    });
  });

  describe('Clipboard Detection', () => {
    it('should show paste option when clipboard has image', async () => {
      // Mock clipboard API with image
      const mockClipboardItem = {
        types: ['image/png'],
      };

      Object.defineProperty(navigator, 'clipboard', {
        value: {
          read: vi.fn().mockResolvedValue([mockClipboardItem]),
        },
        configurable: true,
      });

      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Wait for clipboard check
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      const pasteButton = element.querySelector('button[data-action="paste"]');
      expect(pasteButton).toBeTruthy();
      expect(pasteButton?.textContent).toContain('Paste from Clipboard');
    });

    it('should not show paste option when clipboard has no image', async () => {
      // Mock clipboard API without image
      const mockClipboardItem = {
        types: ['text/plain'],
      };

      Object.defineProperty(navigator, 'clipboard', {
        value: {
          read: vi.fn().mockResolvedValue([mockClipboardItem]),
        },
        configurable: true,
      });

      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Wait for clipboard check
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      const pasteButton = element.querySelector('button[data-action="paste"]');
      expect(pasteButton).toBeNull();
    });

    it('should handle clipboard API errors gracefully', async () => {
      // Mock clipboard API to throw error
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          read: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
      });

      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Wait for clipboard check
      await new Promise((resolve) => setTimeout(resolve, 100));
      await element.updateComplete;

      // Should not show paste option when clipboard check fails
      const pasteButton = element.querySelector('button[data-action="paste"]');
      expect(pasteButton).toBeNull();
    });
  });

  describe('Menu Items', () => {
    beforeEach(async () => {
      // Open menu for all menu item tests
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;
    });

    it('should always show Select Image option', () => {
      const selectButton = element.querySelector('button[data-action="select"]');
      expect(selectButton).toBeTruthy();
      expect(selectButton?.textContent).toContain('Select Image');
      expect(selectButton?.getAttribute('aria-label')).toBe('Select image from device');
    });

    it('should always show Browse Files option', () => {
      const browseButton = element.querySelector('button[data-action="browse"]');
      expect(browseButton).toBeTruthy();
      expect(browseButton?.textContent).toContain('Browse Files');
      expect(browseButton?.getAttribute('aria-label')).toBe('Browse files on device');
    });

    it('should show Camera option only on mobile devices with cameras', async () => {
      // Test desktop (default) - should not show camera
      let cameraButton = element.querySelector('button[data-action="camera"]');
      expect(cameraButton).toBeNull();

      // Set mobile mode but no camera - should still not show
      element.isMobile = true;
      element.hasCamera = false;
      await element.updateComplete;

      cameraButton = element.querySelector('button[data-action="camera"]');
      expect(cameraButton).toBeNull();

      // Set both mobile mode and hasCamera - should now show
      element.hasCamera = true;
      await element.updateComplete;

      cameraButton = element.querySelector('button[data-action="camera"]');
      expect(cameraButton).toBeTruthy();
      expect(cameraButton?.textContent).toContain('Camera');
      expect(cameraButton?.getAttribute('aria-label')).toBe('Take photo with camera');

      // Test desktop with camera - should not show
      element.isMobile = false;
      element.hasCamera = true;
      await element.updateComplete;

      cameraButton = element.querySelector('button[data-action="camera"]');
      expect(cameraButton).toBeNull();
    });

    it('should show divider only when there are items above Browse Files', async () => {
      // Initially no divider (no paste, no camera on desktop)
      let divider = element.querySelector('.border-t.border-border');
      expect(divider).toBeNull();

      // Set mobile mode but no camera - still no divider
      element.isMobile = true;
      element.hasCamera = false;
      await element.updateComplete;

      divider = element.querySelector('.border-t.border-border');
      expect(divider).toBeNull();

      // Set both mobile mode and hasCamera - should now have divider
      element.hasCamera = true;
      await element.updateComplete;

      divider = element.querySelector('.border-t.border-border');
      expect(divider).toBeTruthy();
    });
  });

  describe('Action Callbacks', () => {
    beforeEach(async () => {
      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;
    });

    it('should call onSelectImage callback and close menu', async () => {
      const selectButton = element.querySelector(
        'button[data-action="select"]'
      ) as HTMLButtonElement;
      selectButton.click();

      // Wait for animation delay
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockCallbacks.onSelectImage).toHaveBeenCalledOnce();

      // Menu should be closed
      await element.updateComplete;
      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });

    it('should call onBrowseFiles callback and close menu', async () => {
      const browseButton = element.querySelector(
        'button[data-action="browse"]'
      ) as HTMLButtonElement;
      browseButton.click();

      // Wait for animation delay
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockCallbacks.onBrowseFiles).toHaveBeenCalledOnce();

      // Menu should be closed
      await element.updateComplete;
      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });

    it('should call onOpenCamera callback on mobile with camera', async () => {
      element.isMobile = true;
      element.hasCamera = true;
      await element.updateComplete;

      const cameraButton = element.querySelector(
        'button[data-action="camera"]'
      ) as HTMLButtonElement;
      cameraButton.click();

      // Wait for animation delay
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockCallbacks.onOpenCamera).toHaveBeenCalledOnce();
    });
  });

  describe('Keyboard Navigation', () => {
    beforeEach(async () => {
      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;
    });

    it('should close menu on Escape key', async () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      await element.updateComplete;

      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });

    it('should navigate menu items with arrow keys', async () => {
      // Press down arrow
      let event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      document.dispatchEvent(event);
      await element.updateComplete;

      // First item should be focused
      const buttons = element.querySelectorAll('button[data-action]');
      expect(buttons[0]?.className).toContain('bg-secondary');

      // Press down arrow again
      event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      document.dispatchEvent(event);
      await element.updateComplete;

      // Second item should be focused
      expect(buttons[1]?.className).toContain('bg-secondary');

      // Press up arrow
      event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      document.dispatchEvent(event);
      await element.updateComplete;

      // First item should be focused again
      expect(buttons[0]?.className).toContain('bg-secondary');
    });

    it('should select focused item on Enter key', async () => {
      // Navigate to first item
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      document.dispatchEvent(downEvent);
      await element.updateComplete;

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      // Wait for animation delay
      await new Promise((resolve) => setTimeout(resolve, 60));

      // First action should have been called
      expect(mockCallbacks.onSelectImage).toHaveBeenCalledOnce();
    });

    it('should focus first item when pressing down arrow on menu button', async () => {
      // Close menu first
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Reopen menu
      button.click();
      await element.updateComplete;

      // Focus the button
      button.focus();

      // Press down arrow on the button
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
      });
      button.dispatchEvent(event);
      await element.updateComplete;

      // First menu item should be focused
      const firstButton = element.querySelector('button[data-action]');
      expect(firstButton?.className).toContain('bg-secondary');
    });
  });

  describe('Outside Click', () => {
    it('should close menu when clicking outside', async () => {
      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Click outside
      document.body.click();
      await element.updateComplete;

      const dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });

    it('should not close menu when clicking inside dropdown', async () => {
      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Click inside dropdown
      const dropdown = element.querySelector('[style*="z-index"]') as HTMLElement;
      dropdown.click();
      await element.updateComplete;

      // Menu should still be open
      const dropdownAfter = element.querySelector('[style*="z-index"]');
      expect(dropdownAfter).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on menu button', () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Upload image menu');
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('should update aria-expanded when menu opens', async () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('should have aria-labels on all menu items', async () => {
      element.isMobile = true;
      element.hasCamera = true;
      await element.updateComplete;

      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      const menuButtons = element.querySelectorAll('button[data-action]');
      menuButtons.forEach((btn) => {
        expect(btn.getAttribute('aria-label')).toBeTruthy();
      });
    });

    it('should have aria-hidden on decorative icons', async () => {
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      const icons = element.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Component Cleanup', () => {
    it('should remove event listeners on disconnect', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      element.disconnectedCallback();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should close menu on disconnect if open', async () => {
      // Open menu
      const button = element.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await element.updateComplete;

      // Verify menu is open
      let dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeTruthy();

      // Disconnect
      element.disconnectedCallback();
      await element.updateComplete;

      // Menu should be closed
      dropdown = element.querySelector('[style*="z-index"]');
      expect(dropdown).toBeNull();
    });
  });

  describe('Camera Detection', () => {
    it('should detect camera availability', async () => {
      // Mock mediaDevices API
      const mockDevices = [{ kind: 'videoinput', deviceId: 'camera1', label: 'Camera 1' }];

      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        },
        configurable: true,
      });

      // Create new element to trigger camera check
      const newElement = await fixture(html`
        <image-upload-menu .isMobile=${true}></image-upload-menu>
      `);

      // Wait for camera check
      await new Promise((resolve) => setTimeout(resolve, 100));
      await newElement.updateComplete;

      // Open menu
      const button = newElement.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button.click();
      await newElement.updateComplete;

      // Camera option should be visible
      const cameraButton = newElement.querySelector('button[data-action="camera"]');
      expect(cameraButton).toBeTruthy();
    });

    it('should handle camera detection errors', async () => {
      // Mock mediaDevices API to throw error
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
      });

      // Create new element to trigger camera check
      const newElement = await fixture(html`
        <image-upload-menu .isMobile=${true}></image-upload-menu>
      `);

      // Wait for camera check
      await new Promise((resolve) => setTimeout(resolve, 100));
      await newElement.updateComplete;

      // Should still render without errors
      expect(newElement).toBeTruthy();
    });
  });
});

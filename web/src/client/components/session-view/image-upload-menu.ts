/**
 * Image Upload Menu Component
 *
 * Provides a dropdown menu for various image upload options including
 * paste, file selection, camera access, and file browsing.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../../utils/constants.js';

// Delay to ensure menu close animation completes before action
const MENU_CLOSE_ANIMATION_DELAY = 50;

@customElement('image-upload-menu')
export class ImageUploadMenu extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Function }) onPasteImage?: () => void;
  @property({ type: Function }) onSelectImage?: () => void;
  @property({ type: Function }) onOpenCamera?: () => void;
  @property({ type: Function }) onBrowseFiles?: () => void;
  @property({ type: Boolean }) isMobile = false;
  @property({ type: Boolean }) hasCamera = false;

  @state() private showMenu = false;
  @state() private focusedIndex = -1;
  @state() private hasClipboardImage = false;

  private toggleMenu(e: Event) {
    e.stopPropagation();
    this.showMenu = !this.showMenu;
    if (!this.showMenu) {
      this.focusedIndex = -1;
    } else {
      // Check clipboard when menu opens
      this.checkClipboardContent();
    }
  }

  private handleAction(callback?: () => void) {
    if (callback) {
      // Close menu immediately
      this.showMenu = false;
      this.focusedIndex = -1;
      // Call the callback after a brief delay to ensure menu is closed
      setTimeout(() => {
        callback();
      }, MENU_CLOSE_ANIMATION_DELAY);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Close menu when clicking outside
    document.addEventListener('click', this.handleOutsideClick);
    // Add keyboard support
    document.addEventListener('keydown', this.handleKeyDown);
    // Check if device has camera
    this.checkCameraAvailability();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Always clean up event listeners
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    // Close menu if it's open when component is disconnected
    if (this.showMenu) {
      this.showMenu = false;
      this.focusedIndex = -1;
    }
  }

  private async checkCameraAvailability() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.hasCamera = devices.some((device) => device.kind === 'videoinput');
    } catch {
      this.hasCamera = false;
    }
  }

  private async checkClipboardContent() {
    try {
      // Check if clipboard API is available and we have permission
      if (!navigator.clipboard || !navigator.clipboard.read) {
        this.hasClipboardImage = false;
        return;
      }

      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        // Check if any of the types are image types
        const hasImage = item.types.some((type) => type.startsWith('image/'));
        if (hasImage) {
          this.hasClipboardImage = true;
          return;
        }
      }
      this.hasClipboardImage = false;
    } catch {
      // If we can't access clipboard (no permission or other error), assume no image
      this.hasClipboardImage = false;
    }
  }

  private handleOutsideClick = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(this)) {
      this.showMenu = false;
      this.focusedIndex = -1;
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    // Only handle if menu is open
    if (!this.showMenu) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.showMenu = false;
      this.focusedIndex = -1;
      // Focus the menu button
      const button = this.querySelector(
        'button[aria-label="Upload image menu"]'
      ) as HTMLButtonElement;
      button?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.navigateMenu(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && this.focusedIndex >= 0) {
      e.preventDefault();
      this.selectFocusedItem();
    }
  };

  private navigateMenu(direction: number) {
    const menuItems = this.getMenuItems();
    if (menuItems.length === 0) return;

    // Calculate new index
    let newIndex = this.focusedIndex + direction;

    // Handle wrapping
    if (newIndex < 0) {
      newIndex = menuItems.length - 1;
    } else if (newIndex >= menuItems.length) {
      newIndex = 0;
    }

    this.focusedIndex = newIndex;

    // Focus the element
    const focusedItem = menuItems[newIndex];
    if (focusedItem) {
      focusedItem.focus();
    }
  }

  private getMenuItems(): HTMLButtonElement[] {
    if (!this.showMenu) return [];

    // Find all menu buttons
    const buttons = Array.from(this.querySelectorAll('button[data-action]')) as HTMLButtonElement[];

    return buttons.filter((btn) => btn.tagName === 'BUTTON');
  }

  private selectFocusedItem() {
    const menuItems = this.getMenuItems();
    const focusedItem = menuItems[this.focusedIndex];
    if (focusedItem) {
      focusedItem.click();
    }
  }

  private getAvailableMenuItems() {
    const items = [];
    if (this.hasClipboardImage) {
      items.push({
        id: 'paste',
        label: 'Paste from Clipboard',
        ariaLabel: 'Paste image from clipboard',
        action: () => this.handleAction(this.onPasteImage),
        icon: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M5.75 1a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-3a.75.75 0 00-.75-.75h-4.5zM6.5 4V2.5h3V4h-3z"/>
          <path d="M1.75 5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h12.5a.75.75 0 00.75-.75v-8.5a.75.75 0 00-.75-.75H11v1.5h2.5v6.5h-11v-6.5H5V5H1.75z"/>
          <path d="M8.5 9.5a.5.5 0 10-1 0V11H6a.5.5 0 000 1h1.5v1.5a.5.5 0 001 0V12H10a.5.5 0 000-1H8.5V9.5z"/>
        </svg>`,
      });
    }
    items.push({
      id: 'select',
      label: 'Select Image',
      ariaLabel: 'Select image from device',
      action: () => this.handleAction(this.onSelectImage),
      icon: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zM5.5 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM13 11H3l2.5-3L7 10l2.5-3L13 11z"/>
      </svg>`,
    });
    if (this.isMobile && this.hasCamera) {
      items.push({
        id: 'camera',
        label: 'Camera',
        ariaLabel: 'Take photo with camera',
        action: () => this.handleAction(this.onOpenCamera),
        icon: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M10.5 2.5a.5.5 0 00-.5-.5H6a.5.5 0 00-.5.5V3H3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2h-2.5v-.5zM6.5 3h3v.5h-3V3zM13 4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h10z"/>
          <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 8a2 2 0 114 0 2 2 0 01-4 0z"/>
        </svg>`,
      });
    }
    if (this.hasClipboardImage || (this.isMobile && this.hasCamera)) {
      items.push({ id: 'divider', isDivider: true });
    }
    items.push({
      id: 'browse',
      label: 'Browse Files',
      ariaLabel: 'Browse files on device',
      action: () => this.handleAction(this.onBrowseFiles),
      icon: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"/>
      </svg>`,
    });
    return items;
  }

  private handleMenuButtonKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && this.showMenu) {
      e.preventDefault();
      // Focus first menu item when pressing down on the menu button
      this.focusedIndex = 0;
      const menuItems = this.getMenuItems();
      if (menuItems[0]) {
        menuItems[0].focus();
      }
    }
  };

  render() {
    return html`
      <div class="relative">
        <vt-tooltip content="Upload Image (⌘U)" .show=${!this.isMobile}>
          <button
            class="bg-bg-tertiary border border-border rounded-lg p-2 font-mono text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0"
            @click=${this.toggleMenu}
            @keydown=${this.handleMenuButtonKeyDown}
            title="Upload Image"
            aria-label="Upload image menu"
            aria-expanded=${this.showMenu}
            data-testid="image-upload-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zM5.5 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM13 11H3l2.5-3L7 10l2.5-3L13 11z"/>
            </svg>
          </button>
        </vt-tooltip>
        
        ${this.showMenu ? this.renderDropdown() : nothing}
      </div>
    `;
  }

  private renderDropdown() {
    // Use immutable index tracking for menu items
    const menuItems = this.getAvailableMenuItems();
    let buttonIndex = 0;

    return html`
      <div 
        class="absolute right-0 top-full mt-2 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[240px]"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        ${menuItems.map((item) => {
          if (item.isDivider) {
            return html`<div class="border-t border-border my-1"></div>`;
          }
          const currentIndex = buttonIndex++;
          return html`
            <button
              class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${
                this.focusedIndex === currentIndex ? 'bg-secondary text-primary' : ''
              }"
              @click=${item.action}
              data-action=${item.id}
              tabindex="${this.showMenu ? '0' : '-1'}"
              aria-label=${item.ariaLabel}
            >
              ${item.icon}
              ${item.label}
            </button>
          `;
        })}
      </div>
    `;
  }
}

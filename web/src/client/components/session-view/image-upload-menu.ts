/**
 * Image Upload Menu Component
 *
 * Provides a dropdown menu for various image upload options including
 * paste, file selection, camera access, and file browsing.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../../utils/constants.js';

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

  private toggleMenu(e: Event) {
    e.stopPropagation();
    this.showMenu = !this.showMenu;
    if (!this.showMenu) {
      this.focusedIndex = -1;
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
      }, 50);
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
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private async checkCameraAvailability() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.hasCamera = devices.some((device) => device.kind === 'videoinput');
    } catch {
      this.hasCamera = false;
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
    let menuItemIndex = 0;
    return html`
      <div 
        class="absolute right-0 top-full mt-2 bg-surface border border-base rounded-lg shadow-xl py-1 min-w-[200px]"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        
        <!-- Paste from Clipboard -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onPasteImage)}
          data-action="paste"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <span class="text-base">📋</span>
          Paste from Clipboard
        </button>
        
        <!-- Select Image -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onSelectImage)}
          data-action="select"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <span class="text-base">🖼️</span>
          Select Image
        </button>
        
        <!-- Camera (only if available) -->
        ${
          this.hasCamera || this.isMobile
            ? html`
          <button
            class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
            @click=${() => this.handleAction(this.onOpenCamera)}
            data-action="camera"
            tabindex="${this.showMenu ? '0' : '-1'}"
          >
            <span class="text-base">📷</span>
            Camera
          </button>
        `
            : nothing
        }
        
        <div class="border-t border-base my-1"></div>
        
        <!-- Browse Files -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onBrowseFiles)}
          data-action="browse"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <span class="text-base">📁</span>
          Browse Files
        </button>
      </div>
    `;
  }
}

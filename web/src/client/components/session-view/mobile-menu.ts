/**
 * Mobile Menu Component
 *
 * Consolidates session header actions into a single dropdown menu for mobile devices.
 * Includes file browser, screenshare, width settings, and other controls.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../../utils/constants.js';
import type { Session } from '../session-list.js';
import type { Theme } from '../theme-toggle-icon.js';

@customElement('mobile-menu')
export class MobileMenu extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: String }) widthLabel = '';
  @property({ type: String }) widthTooltip = '';
  @property({ type: Function }) onCreateSession?: () => void;
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onScreenshare?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onOpenSettings?: () => void;
  @property({ type: String }) currentTheme: Theme = 'system';
  @property({ type: Boolean }) macAppConnected = false;

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
      // Close menu immediately to ensure it doesn't block modals
      this.showMenu = false;
      this.focusedIndex = -1;
      // Call the callback after a brief delay to ensure menu is closed
      setTimeout(() => {
        callback();
      }, 50);
    }
  }

  private handleThemeChange() {
    // Cycle through themes: light -> dark -> system
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const newTheme = themes[nextIndex];

    // Update theme
    this.currentTheme = newTheme;
    localStorage.setItem('vibetunnel-theme', newTheme);

    // Apply theme
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    let effectiveTheme: 'light' | 'dark';

    if (newTheme === 'system') {
      effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
    } else {
      effectiveTheme = newTheme;
    }

    root.setAttribute('data-theme', effectiveTheme);

    // Update meta theme-color
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa');
    }

    // Dispatch event
    this.dispatchEvent(
      new CustomEvent('theme-changed', {
        detail: { theme: newTheme },
        bubbles: true,
        composed: true,
      })
    );

    // Close menu
    this.showMenu = false;
    this.focusedIndex = -1;
  }

  private getThemeIcon() {
    switch (this.currentTheme) {
      case 'light':
        return html`<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/>
        </svg>`;
      case 'dark':
        return html`<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
        </svg>`;
      case 'system':
        return html`<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clip-rule="evenodd"/>
        </svg>`;
    }
  }

  private getThemeLabel() {
    return this.currentTheme.charAt(0).toUpperCase() + this.currentTheme.slice(1);
  }

  connectedCallback() {
    super.connectedCallback();
    // Close menu when clicking outside
    document.addEventListener('click', this.handleOutsideClick);
    // Add keyboard support
    document.addEventListener('keydown', this.handleKeyDown);
    // Load saved theme preference
    const saved = localStorage.getItem('vibetunnel-theme') as Theme | null;
    this.currentTheme = saved || 'system';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
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
        'button[aria-label="More actions menu"]'
      ) as HTMLButtonElement;
      button?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Add arrow key navigation logic
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

    // Find all menu buttons (excluding dividers)
    const buttons = Array.from(this.querySelectorAll('button[data-testid]')) as HTMLButtonElement[];

    return buttons.filter((btn) => btn.tagName === 'BUTTON');
  }

  private selectFocusedItem() {
    const menuItems = this.getMenuItems();
    const focusedItem = menuItems[this.focusedIndex];
    if (focusedItem) {
      focusedItem.click();
    }
  }

  render() {
    return html`
      <div class="relative w-[44px] flex-shrink-0">
        <button
          class="p-2 ${this.showMenu ? 'text-primary border-primary' : 'text-primary border-base'} hover:border-primary hover:text-primary rounded-lg"
          @click=${this.toggleMenu}
          @keydown=${this.handleMenuButtonKeyDown}
          title="More actions"
          aria-label="More actions menu"
          aria-expanded=${this.showMenu}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
        
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
        
        <!-- New Session -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onCreateSession)}
          data-testid="mobile-new-session"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z" clip-rule="evenodd"/>
          </svg>
          New Session
        </button>
        
        <div class="border-t border-base my-1"></div>
        
        <!-- File Browser -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onOpenFileBrowser)}
          data-testid="mobile-file-browser"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"/>
          </svg>
          Browse Files
        </button>
        
        <!-- Screenshare - only show if Mac app is connected -->
        ${
          this.macAppConnected
            ? html`
              <button
                class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
                @click=${() => this.handleAction(this.onScreenshare)}
                data-testid="mobile-screenshare"
                tabindex="${this.showMenu ? '0' : '-1'}"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                  <circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/>
                </svg>
                Screenshare
              </button>
            `
            : ''
        }
        
        <!-- Width Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onMaxWidthToggle)}
          data-testid="mobile-width-settings"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z"/>
          </svg>
          Width: ${this.widthLabel}
        </button>
        
        <!-- Theme Toggle -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleThemeChange()}
          data-testid="mobile-theme-toggle"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          ${this.getThemeIcon()}
          Theme: ${this.getThemeLabel()}
        </button>
        
        <!-- Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onOpenSettings)}
          data-testid="mobile-settings"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
          </svg>
          Settings
        </button>
      </div>
    `;
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
}

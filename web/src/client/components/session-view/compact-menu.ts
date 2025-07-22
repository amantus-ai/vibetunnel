/**
 * Compact Menu Component
 *
 * Consolidates session header actions into a single dropdown menu when space is limited.
 * Used on mobile devices and desktop when the header doesn't have enough space for individual buttons.
 * Includes file browser, width settings, image upload, theme toggle, and other controls.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import { Z_INDEX } from '../../utils/constants.js';
import type { Theme } from '../theme-toggle-icon.js';

@customElement('compact-menu')
export class CompactMenu extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: String }) widthLabel = '';
  @property({ type: String }) widthTooltip = '';
  @property({ type: Function }) onCreateSession?: () => void;
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onUploadImage?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onOpenSettings?: () => void;
  @property({ type: String }) currentTheme: Theme = 'system';
  @property({ type: Boolean }) macAppConnected = false;
  @property({ type: Function }) onTerminateSession?: () => void;
  @property({ type: Function }) onClearSession?: () => void;
  @property({ type: Boolean }) hasGitRepo = false;
  @property({ type: String }) viewMode: 'terminal' | 'worktree' = 'terminal';
  @property({ type: Function }) onToggleViewMode?: () => void;

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
        class="absolute right-0 top-full mt-2 bg-surface border border-base rounded-lg shadow-xl py-1 min-w-[250px]"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        
        <!-- New Session -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onCreateSession)}
          data-testid="compact-new-session"
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
          data-testid="compact-file-browser"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"/>
          </svg>
          Browse Files
        </button>
        
        <!-- Upload Image -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onUploadImage)}
          data-testid="compact-upload-image"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zM5.5 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM13 11H3l2.5-3L7 10l2.5-3L13 11z"/>
          </svg>
          Upload Image
        </button>
        
        <!-- Width Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onMaxWidthToggle)}
          data-testid="compact-width-settings"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z"/>
          </svg>
          Width: ${this.widthLabel}
        </button>
        
        <!-- Git Worktree Toggle (only for git repos) -->
        ${
          this.hasGitRepo
            ? html`
              <button
                class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
                @click=${() => this.handleAction(this.onToggleViewMode)}
                data-testid="compact-worktree-toggle"
                tabindex="${this.showMenu ? '0' : '-1'}"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/>
                </svg>
                ${this.viewMode === 'terminal' ? 'Show Worktrees' : 'Show Terminal'}
              </button>
            `
            : nothing
        }
        
        <!-- Theme Toggle -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleThemeChange()}
          data-testid="compact-theme-toggle"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          ${this.getThemeIcon()}
          Theme: ${this.getThemeLabel()}
        </button>
        
        <!-- Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-primary hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
          @click=${() => this.handleAction(this.onOpenSettings)}
          data-testid="compact-settings"
          tabindex="${this.showMenu ? '0' : '-1'}"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
          </svg>
          Settings
        </button>
        
        ${
          this.session
            ? html`
          <div class="border-t border-base my-1"></div>
          
          <!-- Session Actions -->
          ${
            this.session.status === 'running'
              ? html`
            <button
              class="w-full text-left px-4 py-3 text-sm font-mono text-status-error hover:bg-secondary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary' : ''}"
              @click=${() => this.handleAction(this.onTerminateSession)}
              data-testid="compact-terminate-session"
              tabindex="${this.showMenu ? '0' : '-1'}"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.5 7.5a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7z"/>
              </svg>
              Terminate Session
            </button>
          `
              : html`
            <button
              class="w-full text-left px-4 py-3 text-sm font-mono text-muted hover:bg-secondary hover:text-primary flex items-center gap-3 ${this.focusedIndex === menuItemIndex++ ? 'bg-secondary text-primary' : ''}"
              @click=${() => this.handleAction(this.onClearSession)}
              data-testid="compact-clear-session"
              tabindex="${this.showMenu ? '0' : '-1'}"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
              </svg>
              Clear Session
            </button>
          `
          }
        `
            : nothing
        }
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

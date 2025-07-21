/**
 * Session Status Dropdown Component
 *
 * Displays session status with a dropdown menu for actions.
 * Shows "Terminate Session" for running sessions and "Clear Session" for exited sessions.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import { Z_INDEX } from '../../utils/constants.js';

@customElement('session-status-dropdown')
export class SessionStatusDropdown extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Function }) onTerminate?: () => void;
  @property({ type: Function }) onClear?: () => void;

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
        'button[aria-label="Session actions menu"]'
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

  private getStatusText(): string {
    if (!this.session) return '';
    if ('active' in this.session && this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (!this.session) return 'text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'text-muted';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getStatusDotColor(): string {
    if (!this.session) return 'bg-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'bg-muted';
    }
    return this.session.status === 'running' ? 'bg-status-success' : 'bg-status-warning';
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
    if (!this.session) return null;

    const isRunning = this.session.status === 'running';
    const statusText = this.getStatusText();

    return html`
      <div class="relative">
        <button
          class="flex items-center gap-2 bg-bg-tertiary border border-border rounded-lg px-3 py-2 transition-all duration-200 hover:bg-surface-hover hover:border-primary hover:shadow-sm ${
            this.showMenu ? 'border-primary shadow-sm' : ''
          }"
          @click=${this.toggleMenu}
          @keydown=${this.handleMenuButtonKeyDown}
          title="${isRunning ? 'Running - Click for actions' : 'Exited - Click for actions'}"
          aria-label="Session actions menu"
          aria-expanded=${this.showMenu}
        >
          <span class="text-xs flex items-center gap-2 font-medium ${this.getStatusColor()}">
            <div class="relative">
              <div class="w-2 h-2 rounded-full ${this.getStatusDotColor()}"></div>
              ${
                statusText === 'running'
                  ? html`<div class="absolute inset-0 w-2 h-2 rounded-full bg-status-success animate-ping opacity-50"></div>`
                  : ''
              }
            </div>
            ${statusText.toUpperCase()}
          </span>
          <!-- Dropdown arrow -->
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            class="transition-transform text-muted ${this.showMenu ? 'rotate-180' : ''}"
          >
            <path d="M5 7L1 3h8z" />
          </svg>
        </button>
        
        ${this.showMenu ? this.renderDropdown(isRunning) : nothing}
      </div>
    `;
  }

  private renderDropdown(isRunning: boolean) {
    let menuItemIndex = 0;

    return html`
      <div 
        class="absolute right-0 top-full mt-2 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[250px]"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        ${
          isRunning
            ? html`
            <button
              class="w-full text-left px-6 py-3 text-sm font-mono text-status-error hover:bg-bg-secondary flex items-center gap-3 ${
                this.focusedIndex === menuItemIndex++ ? 'bg-bg-secondary' : ''
              }"
              @click=${() => this.handleAction(this.onTerminate)}
              data-action="terminate"
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
              class="w-full text-left px-6 py-3 text-sm font-mono text-muted hover:bg-bg-secondary hover:text-primary flex items-center gap-3 ${
                this.focusedIndex === menuItemIndex++ ? 'bg-bg-secondary text-primary' : ''
              }"
              @click=${() => this.handleAction(this.onClear)}
              data-action="clear"
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
      </div>
    `;
  }
}

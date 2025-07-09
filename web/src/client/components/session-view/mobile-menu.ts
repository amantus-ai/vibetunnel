/**
 * Mobile Menu Component
 *
 * Consolidates session header actions into a single dropdown menu for mobile devices.
 * Includes file browser, screenshare, width settings, and other controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../session-list.js';

@customElement('mobile-menu')
export class MobileMenu extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: String }) widthLabel = '';
  @property({ type: String }) widthTooltip = '';
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onScreenshare?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onOpenSettings?: () => void;
  @property({ type: Function }) onCreateSession?: () => void;
  @property({ type: Function }) onSidebarToggle?: () => void;
  @property({ type: Boolean }) showSidebarToggle = false;
  @property({ type: Boolean }) sidebarCollapsed = false;

  @state() private showMenu = false;

  private toggleMenu(e: Event) {
    e.stopPropagation();
    this.showMenu = !this.showMenu;
  }

  private handleAction(callback?: () => void) {
    if (callback) {
      callback();
    }
    this.showMenu = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Close menu when clicking outside
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    document.addEventListener('click', this.handleOutsideClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
  }

  private handleOutsideClick(e: MouseEvent) {
    const path = e.composedPath();
    if (!path.includes(this)) {
      this.showMenu = false;
    }
  }

  render() {
    return html`
      <div class="relative">
        <button
          class="p-2 ${this.showMenu ? 'text-accent-green border-accent-green' : 'text-dark-text border-dark-border'} hover:border-accent-green hover:text-accent-green rounded-lg transition-all duration-200"
          @click=${this.toggleMenu}
          title="More actions"
          aria-label="More actions menu"
          aria-expanded=${this.showMenu}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
        
        ${this.showMenu ? this.renderDropdown() : ''}
      </div>
    `;
  }

  private renderDropdown() {
    return html`
      <div class="absolute right-0 top-full mt-2 bg-dark-surface border border-dark-border rounded-lg shadow-xl py-1 z-50 min-w-[200px]">
        <!-- Create Session (when sidebar is collapsed) -->
        ${
          this.showSidebarToggle && this.sidebarCollapsed
            ? html`
          <button
            class="w-full text-left px-4 py-3 text-sm font-mono text-dark-text hover:bg-dark-bg-secondary hover:text-accent-green flex items-center gap-3"
            @click=${() => this.handleAction(this.onCreateSession)}
            data-testid="mobile-create-session"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" class="text-accent-green">
              <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"/>
            </svg>
            New Session
          </button>
          <div class="border-t border-dark-border my-1"></div>
        `
            : ''
        }
        
        <!-- File Browser -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-dark-text hover:bg-dark-bg-secondary hover:text-accent-green flex items-center gap-3"
          @click=${() => this.handleAction(this.onOpenFileBrowser)}
          data-testid="mobile-file-browser"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"/>
          </svg>
          Browse Files
        </button>
        
        <!-- Screenshare -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-dark-text hover:bg-dark-bg-secondary hover:text-accent-green flex items-center gap-3"
          @click=${() => this.handleAction(this.onScreenshare)}
          data-testid="mobile-screenshare"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/>
          </svg>
          Screenshare
        </button>
        
        <!-- Width Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-dark-text hover:bg-dark-bg-secondary hover:text-accent-green flex items-center gap-3"
          @click=${() => this.handleAction(this.onMaxWidthToggle)}
          data-testid="mobile-width-settings"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z"/>
          </svg>
          Width: ${this.widthLabel}
        </button>
        
        <div class="border-t border-dark-border my-1"></div>
        
        <!-- Settings -->
        <button
          class="w-full text-left px-4 py-3 text-sm font-mono text-dark-text hover:bg-dark-bg-secondary hover:text-accent-green flex items-center gap-3"
          @click=${() => this.handleAction(this.onOpenSettings)}
          data-testid="mobile-settings"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
          </svg>
          Settings
        </button>
      </div>
    `;
  }
}

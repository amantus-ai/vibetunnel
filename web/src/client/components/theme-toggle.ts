import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Z_INDEX } from '../utils/constants';

export type Theme = 'light' | 'dark' | 'system';

@customElement('theme-toggle')
export class ThemeToggle extends LitElement {
  @property({ type: String })
  theme: Theme = 'system';

  @property({ type: Boolean })
  expanded = false;

  private readonly STORAGE_KEY = 'vibetunnel-theme';
  private mediaQuery?: MediaQueryList;

  connectedCallback() {
    super.connectedCallback();

    // Load saved theme preference
    const saved = localStorage.getItem(this.STORAGE_KEY) as Theme | null;
    this.theme = saved || 'system';

    // Set up system preference listener
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);

    // Apply initial theme
    this.applyTheme();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.mediaQuery?.removeEventListener('change', this.handleSystemThemeChange);
  }

  private handleSystemThemeChange = () => {
    if (this.theme === 'system') {
      this.applyTheme();
    }
  };

  private applyTheme() {
    const root = document.documentElement;
    let effectiveTheme: 'light' | 'dark';

    if (this.theme === 'system') {
      effectiveTheme = this.mediaQuery?.matches ? 'dark' : 'light';
    } else {
      effectiveTheme = this.theme;
    }

    // Set data-theme attribute
    root.setAttribute('data-theme', effectiveTheme);

    // Update meta theme-color for mobile browsers
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa');
    }
  }

  private selectTheme(theme: Theme) {
    this.theme = theme;
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.applyTheme();
    this.expanded = false;

    // Dispatch event for other components that might need to react
    this.dispatchEvent(
      new CustomEvent('theme-changed', {
        detail: { theme },
        bubbles: true,
        composed: true,
      })
    );
  }

  private toggleExpanded() {
    this.expanded = !this.expanded;
  }

  private handleClickOutside = (e: Event) => {
    if (!this.contains(e.target as Node)) {
      this.expanded = false;
    }
  };

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('expanded')) {
      if (this.expanded) {
        document.addEventListener('click', this.handleClickOutside);
      } else {
        document.removeEventListener('click', this.handleClickOutside);
      }
    }
  }

  static styles = css``;

  createRenderRoot() {
    return this;
  }

  render() {
    const currentIcon = this.theme === 'light' ? 'sun' : this.theme === 'dark' ? 'moon' : 'laptop';

    return html`
      <div class="relative">
        <button
          @click=${this.toggleExpanded}
          class="p-2 text-text border border-border hover:border-primary hover:text-primary rounded-lg transition-all duration-200"
          aria-label="Theme toggle"
          aria-expanded=${this.expanded}
        >
          <iconify-icon 
            icon="ph:${currentIcon}" 
            class="text-xl"
          ></iconify-icon>
        </button>
        
        ${
          this.expanded
            ? html`
          <div 
            class="absolute right-0 mt-2 w-36 bg-elevated border border-border rounded-lg shadow-lg overflow-hidden"
            style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN}"
          >
            <button
              @click=${() => this.selectTheme('light')}
              class="w-full px-4 py-2 text-left hover:bg-tertiary transition-colors flex items-center gap-3 ${this.theme === 'light' ? 'text-primary' : 'text-text'}"
            >
              <iconify-icon icon="ph:sun" class="text-lg"></iconify-icon>
              <span class="text-sm">Light</span>
            </button>
            <button
              @click=${() => this.selectTheme('dark')}
              class="w-full px-4 py-2 text-left hover:bg-tertiary transition-colors flex items-center gap-3 ${this.theme === 'dark' ? 'text-primary' : 'text-text'}"
            >
              <iconify-icon icon="ph:moon" class="text-lg"></iconify-icon>
              <span class="text-sm">Dark</span>
            </button>
            <button
              @click=${() => this.selectTheme('system')}
              class="w-full px-4 py-2 text-left hover:bg-tertiary transition-colors flex items-center gap-3 ${this.theme === 'system' ? 'text-primary' : 'text-text'}"
            >
              <iconify-icon icon="ph:laptop" class="text-lg"></iconify-icon>
              <span class="text-sm">System</span>
            </button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'theme-toggle': ThemeToggle;
  }
}

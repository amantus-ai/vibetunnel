import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Icon-only theme toggle button component
 * Cycles through light -> dark -> system themes
 */
@customElement('theme-toggle-icon')
export class ThemeToggleIcon extends LitElement {
  @property({ type: String })
  theme: Theme = 'system';

  private readonly STORAGE_KEY = 'vibetunnel-theme';
  private mediaQuery?: MediaQueryList;

  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

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

  private cycleTheme() {
    // Cycle through: light -> dark -> system
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(this.theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.theme = themes[nextIndex];

    localStorage.setItem(this.STORAGE_KEY, this.theme);
    this.applyTheme();

    // Dispatch event for other components that might need to react
    this.dispatchEvent(
      new CustomEvent('theme-changed', {
        detail: { theme: this.theme },
        bubbles: true,
        composed: true,
      })
    );
  }

  private getIcon() {
    switch (this.theme) {
      case 'light':
        return html`
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/>
          </svg>
        `;
      case 'dark':
        return html`
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
          </svg>
        `;
      case 'system':
        return html`
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clip-rule="evenodd"/>
          </svg>
        `;
    }
  }

  private getTooltip() {
    const current = this.theme.charAt(0).toUpperCase() + this.theme.slice(1);
    const next = this.theme === 'light' ? 'Dark' : this.theme === 'dark' ? 'System' : 'Light';
    return `Theme: ${current} (click for ${next})`;
  }

  render() {
    return html`
      <button
        @click=${this.cycleTheme}
        class="bg-elevated border border-base rounded-lg p-2 font-mono text-muted transition-all duration-200 hover:text-primary hover:bg-hover hover:border-primary hover:shadow-sm flex-shrink-0"
        title="${this.getTooltip()}"
        aria-label="Toggle theme"
      >
        ${this.getIcon()}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'theme-toggle-icon': ThemeToggleIcon;
  }
}

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Common special keys not available on mobile keyboards
const QUICK_KEYS = [
  { key: 'Tab', label: 'Tab' },
  { key: 'Escape', label: 'Esc' },
  { key: '`', label: '`' },
  { key: '~', label: '~' },
  { key: '|', label: '|' },
  { key: '\\', label: '\\' },
  { key: '{', label: '{' },
  { key: '}', label: '}' },
  { key: '[', label: '[' },
  { key: ']', label: ']' },
  { key: '<', label: '<' },
  { key: '>', label: '>' },
];

@customElement('auth-quick-keys')
export class AuthQuickKeys extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Function }) onKeyPress?: (key: string) => void;

  private handleKeyPress(key: string) {
    if (this.onKeyPress) {
      this.onKeyPress(key);
    }
  }

  render() {
    return html`
      <div class="quick-keys-bar bg-dark-bg-secondary border-t border-dark-border p-2">
        <div class="flex gap-1 overflow-x-auto scrollbar-hide">
          ${QUICK_KEYS.map(
            ({ key, label }) => html`
              <button
                type="button"
                class="quick-key-btn px-3 py-1.5 bg-dark-bg-tertiary text-dark-text text-xs font-mono rounded border border-dark-border hover:bg-dark-surface hover:border-primary transition-all whitespace-nowrap flex-shrink-0"
                @click=${() => this.handleKeyPress(key)}
              >
                ${label}
              </button>
            `
          )}
        </div>
      </div>
      <style>
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      </style>
    `;
  }
}

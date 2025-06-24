import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

@customElement('vt-button')
export class VtButton extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
    }

    button {
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      outline: none;
      position: relative;
    }

    button:focus-visible {
      box-shadow: 0 0 0 3px var(--accent-glow, rgba(16, 185, 129, 0.5));
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Sizes */
    button.small {
      padding: 6px 12px;
      font-size: 12px;
      min-width: 64px;
    }

    button.medium {
      padding: 10px 20px;
      font-size: 14px;
      min-width: 80px;
    }

    button.large {
      padding: 14px 28px;
      font-size: 16px;
      min-width: 120px;
    }

    /* Variants */
    button.primary {
      background: var(--accent, #10b981);
      color: white;
    }

    button.primary:hover:not(:disabled) {
      background: var(--accent-hover, #0ea671);
    }

    button.primary:active:not(:disabled) {
      transform: translateY(1px);
    }

    button.secondary {
      background: var(--bg-secondary, rgba(255, 255, 255, 0.08));
      color: var(--text-primary, #fff);
      border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.1));
    }

    button.secondary:hover:not(:disabled) {
      background: var(--bg-hover, rgba(255, 255, 255, 0.12));
      border-color: var(--border-secondary, rgba(255, 255, 255, 0.15));
    }

    button.danger {
      background: var(--error, #ef4444);
      color: white;
    }

    button.danger:hover:not(:disabled) {
      background: var(--error-hover, #dc2626);
    }

    button.ghost {
      background: transparent;
      color: var(--text-primary, #fff);
    }

    button.ghost:hover:not(:disabled) {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
    }

    /* Loading state */
    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: inherit;
      border-radius: inherit;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .content {
      visibility: hidden;
    }

    :host([loading]) .content {
      visibility: hidden;
    }

    :host(:not([loading])) .loading {
      display: none;
    }
  `;

  @property({ type: String })
  variant: ButtonVariant = 'primary';

  @property({ type: String })
  size: ButtonSize = 'medium';

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean, reflect: true })
  loading = false;

  override render() {
    return html`
      <button
        class="${this.variant} ${this.size}"
        ?disabled=${this.disabled || this.loading}
        @click=${this.handleClick}
      >
        <span class="content">
          <slot></slot>
        </span>
        ${this.loading ? html`
          <div class="loading">
            <div class="spinner"></div>
          </div>
        ` : ''}
      </button>
    `;
  }

  private handleClick(e: Event) {
    if (this.disabled || this.loading) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vt-button': VtButton;
  }
}
EOF < /dev/null
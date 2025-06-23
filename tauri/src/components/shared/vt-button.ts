import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { buttonStyles } from './styles';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@customElement('vt-button')
export class VTButton extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: inline-block;
      }

      .btn {
        width: 100%;
      }

      .loading-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: currentColor;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `
  ];

  @property({ type: String })
  variant: ButtonVariant = 'primary';

  @property({ type: String })
  size: ButtonSize = 'md';

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  loading = false;

  @property({ type: Boolean })
  icon = false;

  @property({ type: String })
  href?: string;

  private _handleClick(e: Event): void {
    if (this.loading || this.disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this.href) {
      e.preventDefault();
      window.open(this.href, '_blank', 'noopener,noreferrer');
    }
  }

  override render() {
    const classes = {
      'btn': true,
      [`btn-${this.variant}`]: true,
      [`btn-${this.size}`]: this.size !== 'md',
      'btn-icon': this.icon
    };

    const content = this.loading 
      ? html`<span class="loading-spinner"></span>`
      : html`<slot></slot>`;

    const isDisabled = this.disabled || this.loading;

    if (this.href) {
      return html`
        <a 
          href=${this.href}
          class=${classMap(classes)}
          ?disabled=${isDisabled}
          @click=${this._handleClick}
          tabindex=${isDisabled ? '-1' : '0'}
          aria-disabled=${isDisabled ? 'true' : 'false'}
        >
          ${content}
        </a>
      `;
    }

    return html`
      <button 
        class=${classMap(classes)}
        ?disabled=${isDisabled}
        @click=${this._handleClick}
        aria-busy=${this.loading ? 'true' : 'false'}
      >
        ${content}
      </button>
    `;
  }
}
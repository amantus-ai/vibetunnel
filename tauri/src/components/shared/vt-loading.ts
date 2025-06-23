import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { loadingStyles } from './styles';

export type LoadingState = 'loading' | 'error' | 'empty';

export interface EmptyAction {
  label: string;
  handler: () => void;
}

@customElement('vt-loading')
export class VTLoading extends LitElement {
  static override styles = [
    loadingStyles,
    css`
      :host {
        display: block;
      }

      .container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
      }
    `
  ];

  @property({ type: String })
  state: LoadingState = 'loading';

  @property({ type: String })
  message = 'Loading...';

  @property({ type: String })
  errorDetails?: string;

  @property({ type: String })
  emptyIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
  </svg>`;

  @property({ type: Object })
  emptyAction?: EmptyAction;

  private _renderLoading() {
    return html`
      <div class="loading">
        <span class="spinner"></span>
        <span>${this.message}</span>
      </div>
    `;
  }

  private _renderError() {
    return html`
      <div class="error">
        <svg class="error-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>${this.message || 'An error occurred'}</div>
        ${this.errorDetails ? html`<div class="text-sm mt-2">${this.errorDetails}</div>` : nothing}
        <slot name="error-action"></slot>
      </div>
    `;
  }

  private _renderEmpty() {
    return html`
      <div class="empty-state">
        <div class="empty-state-icon">${unsafeHTML(this.emptyIcon)}</div>
        <div class="empty-state-title">${this.message || 'No data'}</div>
        <slot name="empty-text"></slot>
        ${this.emptyAction ? html`
          <vt-button 
            class="mt-4" 
            size="sm" 
            @click=${this.emptyAction.handler}
          >
            ${this.emptyAction.label}
          </vt-button>
        ` : html`<slot name="empty-action"></slot>`}
      </div>
    `;
  }

  override render() {
    return html`
      <div class="container">
        ${this.state === 'loading' ? this._renderLoading() : nothing}
        ${this.state === 'error' ? this._renderError() : nothing}
        ${this.state === 'empty' ? this._renderEmpty() : nothing}
      </div>
    `;
  }
}
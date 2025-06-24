import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('copy-icon')
export class CopyIcon extends LitElement {
  @property({ type: Number }) size = 16;

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.4;
      transition: opacity 0.2s ease;
    }

    :host(:hover) {
      opacity: 0.8;
    }

    svg {
      display: block;
      width: var(--icon-size, 16px);
      height: var(--icon-size, 16px);
    }
  `;

  render() {
    return html`
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="--icon-size: ${this.size}px"
        class="copy-icon"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }
}

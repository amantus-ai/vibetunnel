import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('terminal-icon')
export class TerminalIcon extends LitElement {
  @property({ type: Number }) size = 24;

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    svg {
      display: block;
      width: var(--icon-size, 24px);
      height: var(--icon-size, 24px);
    }

    .terminal-icon {
      border-radius: 20%;
      box-shadow:
        0 2px 8px rgb(var(--color-bg-base) / 0.3),
        0 1px 3px rgb(var(--color-bg-base) / 0.2);
      background: rgb(var(--color-text-bright) / 0.05);
      padding: 2px;
    }
  `;

  render() {
    return html`
      <img
        src="/apple-touch-icon.png"
        alt="VibeTunnel"
        style="width: ${this.size}px; height: ${this.size}px"
        class="terminal-icon"
      />
    `;
  }
}

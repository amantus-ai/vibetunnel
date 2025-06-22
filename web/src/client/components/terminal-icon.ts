import { LitElement, html, css } from 'lit';
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

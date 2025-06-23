import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('settings-tab')
export class SettingsTab extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      padding: 12px 24px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      font-size: 13px;
      position: relative;
      user-select: none;
      -webkit-user-select: none;
      color: var(--text-secondary, rgba(255, 255, 255, 0.6));
      font-weight: 500;
      letter-spacing: 0.2px;
    }

    :host(:hover) {
      background: var(--bg-hover, rgba(255, 255, 255, 0.05));
      color: var(--text-primary, #fff);
    }

    :host([active]) {
      background: var(--bg-active, rgba(16, 185, 129, 0.1));
      color: var(--text-primary, #fff);
    }

    :host([active])::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent, #10b981);
      box-shadow: 0 0 10px var(--accent-glow, rgba(16, 185, 129, 0.5));
    }

    .icon {
      width: 18px;
      height: 18px;
      margin-right: 12px;
      fill: var(--text-secondary, rgba(255, 255, 255, 0.6));
      flex-shrink: 0;
      pointer-events: none;
      transition: all 0.2s;
    }

    :host(:hover) .icon {
      fill: var(--text-primary, #fff);
    }

    :host([active]) .icon {
      fill: var(--accent, #10b981);
      filter: drop-shadow(0 0 4px var(--accent-glow, rgba(16, 185, 129, 0.5)));
    }

    span {
      pointer-events: none;
    }
  `;

  @property({ type: String })
  name = '';

  @property({ type: Object })
  icon?: TemplateResult;

  @property({ type: Boolean, reflect: true })
  active = false;

  override render() {
    return html`
      <svg class="icon" viewBox="0 0 24 24">
        ${this.icon}
      </svg>
      <span>${this.name}</span>
    `;
  }
}
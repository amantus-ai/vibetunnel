import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('settings-checkbox')
export class SettingsCheckbox extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: flex-start;
      cursor: pointer;
      padding: 8px 0;
      position: relative;
    }

    input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    .checkbox-indicator {
      width: 20px;
      height: 20px;
      background: var(--bg-hover, rgba(255, 255, 255, 0.05));
      border: 2px solid var(--border-secondary, rgba(255, 255, 255, 0.12));
      border-radius: 6px;
      transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      position: relative;
      flex-shrink: 0;
      margin-right: 12px;
      margin-top: 2px;
    }

    :host(:hover) .checkbox-indicator {
      background: var(--bg-input-hover, rgba(255, 255, 255, 0.08));
      border-color: var(--text-tertiary, rgba(255, 255, 255, 0.4));
    }

    input[type="checkbox"]:checked + .checkbox-indicator {
      background: var(--accent, #10b981);
      border-color: var(--accent, #10b981);
    }

    input[type="checkbox"]:checked + .checkbox-indicator::after {
      content: '✓';
      position: absolute;
      color: var(--text-primary, #fff);
      font-size: 14px;
      font-weight: bold;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    .setting-info {
      flex: 1;
    }

    .label {
      display: block;
      font-weight: 500;
      margin-bottom: 4px;
      font-size: 14px;
      color: var(--text-primary, #fff);
      letter-spacing: 0.1px;
    }

    .help {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary, rgba(255, 255, 255, 0.4));
      line-height: 1.5;
    }
  `;

  @property({ type: Boolean, reflect: true })
  checked = false;

  @property({ type: String })
  label = '';

  @property({ type: String })
  help = '';

  @property({ type: String })
  settingKey = '';

  private _handleChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.checked = input.checked;
    this.dispatchEvent(new CustomEvent('change', {
      detail: { checked: this.checked, settingKey: this.settingKey },
      bubbles: true,
      composed: true
    }));
  }

  override render() {
    return html`
      <label>
        <input 
          type="checkbox" 
          .checked=${this.checked}
          @change=${this._handleChange}
        >
        <span class="checkbox-indicator"></span>
        <div class="setting-info">
          <span class="label">${this.label}</span>
          ${this.help ? html`<span class="help">${this.help}</span>` : ''}
        </div>
      </label>
    `;
  }
}
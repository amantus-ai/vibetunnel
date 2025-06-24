import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface SelectChangeEvent extends CustomEvent {
  detail: {
    settingKey: string;
    value: string;
  };
}

@customElement('settings-select')
export class SettingsSelect extends LitElement {
  @property({ type: Boolean })
  private isOpen = false;
  static override styles = css`
    :host {
      display: block;
    }

    .form-group {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .select-wrapper {
      position: relative;
      display: inline-block;
      width: 100%;
    }

    .custom-select {
      position: relative;
      width: 100%;
      padding: 8px 32px 8px 12px;
      font-size: 14px;
      color: var(--text-primary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
    }

    .custom-select:hover {
      border-color: var(--border-secondary);
      background: var(--bg-hover);
    }

    .custom-select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .custom-select.open {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .selected-option {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .option-icon {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }

    .arrow {
      position: absolute;
      top: 50%;
      right: 12px;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-secondary);
      transition: transform 0.2s ease;
    }

    .arrow.open {
      transform: translateY(-50%) rotate(180deg);
    }

    .dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      z-index: 1000;
      opacity: 0;
      transform: translateY(-8px);
      pointer-events: none;
      transition: all 0.2s ease;
      max-height: 200px;
      overflow-y: auto;
    }

    .dropdown.open {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .option:hover {
      background: var(--bg-hover);
    }

    .option.selected {
      background: var(--bg-active);
      color: var(--accent);
    }

    .help {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    /* Fallback select for accessibility */
    select {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
  `;

  @property({ type: String })
  label = '';

  @property({ type: String })
  value = '';

  @property({ type: String })
  settingKey = '';

  @property({ type: String })
  help = '';

  @property({ type: Array })
  options: Array<{ value: string; label: string; icon?: string }> = [];

  private toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    this.requestUpdate();
  }

  private selectOption(option: { value: string; label: string; icon?: string }): void {
    this.value = option.value;
    this.isOpen = false;
    
    this.dispatchEvent(new CustomEvent('change', {
      detail: {
        settingKey: this.settingKey,
        value: option.value
      },
      bubbles: true,
      composed: true
    }) as SelectChangeEvent);
  }

  override connectedCallback() {
    super.connectedCallback();
    // Close dropdown when clicking outside
    document.addEventListener('click', this.handleOutsideClick);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
  }

  private handleOutsideClick = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(this)) {
      this.isOpen = false;
      this.requestUpdate();
    }
  };

  private getTerminalIcon(terminalId: string): string {
    // Return base64 encoded terminal icons
    const icons: Record<string, string> = {
      'terminal': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEUSURBVDiNpZOxSgNBEIa/2b2LRhQsLCwUBAtBEBtLH8DKV7CwsfABfAILC4s8gI2FhYKIoIWgqIWIiHiJ5s7d7c3uWFzucjFBT5zizDL/N/PPzsCfI4Bms/kghPhMkmQ7TdMNEe0AoKg+CCFaQRA8RlF0rarqMcZaKeU1Y2xERJeklGhFl3Nec85PAKwA6CqlJgE0VFWlyV1EtCwiCwAmReQYAN5zuVxL13U3ADQBfNi2XQOwCqBXRJ5M02yYpvkqpazbtr2jlJoBcJfNZo8A9IvIG4AezvmciNwZYzRjrFsI8WKa5oVt2+u6rnsKheJxzjkP6O12+76/cDjaqrquK3K53HShQKFQaPU1+DP+5Re+ALfGb6TvCXEsAAAAAElFTkSuQmCC',
      'iterm2': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAJrSURBVDiNjZPPa1NXFMQ/5733kpdfYhJNYtTGKBZEpBRc6EIpblxYuhGX/gHddeG2G1cuBEH8A1y4sYu60oJ0I1IoFKRQsLQIpTG1mqZJmjTJe++9e2fxXhJj1YEH7/I+853vzJwDHwgppcnn86O2bdcmJia2CSEkgABwAE9K6SUSiYemaR5/L0AI4QghTMdxLheLxWvlcvmnVqsVAEgkEu5gNpuNbG5uTgFIKdnZ2fm1Xq9fW11dvSWlNCzL6jpgGMav9Xr9yvLy8i0ppQAQQgS2ZDLZ0DQtBKhWq6iq2gIQQqBpmrIPoGkaiqK0q9UqpmkihCAMwzZQJSB0XddVFEXoui6i0agKEI1GEULoHYf2Psdx9jnGGBhjuK6L67qMjY0xOjrK+Pg44+PjjI2NdQCCINhHFQQBSilKpRKlUonV1VWEEORyOcbHxykUCszNzeF5Hp7nsb6+TqFQIJfLkUqlEFLKbiDf9wHI5/OcPXuW5eVl5ufnWVpawvM8PM9jYWGBmZkZTp8+TT6fRynVnR6A7/sAXLhwgZMnTzI9Pc3W1lYHYGtri6mpKU6cOMH58+cBcF23+41u4Pr164yMjHDv3j3m5+fpdDqez+e5e/cuQ0NDXLt2DcMwaLVaRzOwubmJaZosLi52+r6wsIBhGBSLxQ5QK5FI7Gqa5vdqJBJJaZpmHTl9dXWVIAhYWlrqnF9K+S2bzeZs234GnAYGu4CyLOt+Z5ajo6MApNNpent7iUajnDlzhoGBAer1OtlsFoCDg4OfarXahK7rfcdW0Ov1vmazeTkajX7VT6FQ+AXgl7+RlNLv7SN/r3S4Tko5+jf6Gy8s7ym5xQA6AAAAAElFTkSuQmCC',
      'warp': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAJdSURBVDiNjZNPSFRRFMZ/5743b8bJmRlnZkZHR8tSKyqiTVBEtGjRJqJFi6BFQRAUQdCiRUG0CIIWQYuIaBEU1KZFRBAUVJvQQivLyszUGWfmzXvv3NsiHWuUvtXhHu75fud+5/yBZSKlFIqiSCmlUBRFLPdMSimSySRCCAzDwLIsXNclFAohpSSfzxOJRBaJC+PQ8sVisQN+v7+ju7v7RiwWE7Is85OUklKpRDQapVgsEolE0HV9UVEI0T4xMXFxcHDwVj6f71heJp/PL0/I5/OoqjpTKBSy4XB4QVMI0T42Nnah+9GjW7IsSykFsizPTdHf339aVdWGqamp1pWilUql1qqqqt8/f36ufQqArutomrYQRQjx++joaFc8Hr9RKpXmdxwOh9F1HYDa2lrC4TCVlZVEo1GCwSCapi1I1HWdxsbGo36//5fkOgBYlsXQ0BCpVAqA7u5uxsfHSSQS5HI5kskkAI7j8O3bN6anp1FVdWGp2traHCklPgBZlvnw4QPT09Pouk5TUxNuthtXcyGgUJIKJMsllErLcnF1jUwmg+M4AOi6jsvKyh44jlNTW1v7bmpqarVlWRw6dAjLsvD5fPh9Pvx+Hz6/H7/fh8/vx+fz4fX6CAaDNDY24jgOmqaRTqeprq7+mEgkTlVUVLx5P5V6DlBVXU1vby8Ar169orOzEwDHtv/KcZ2/J8/Ozua8Xs+Murm5GWD2N3fu3EksFmPPnj0AbNy4ca4xZGwb2zt7iqJgGkamra3tzKKd7N+/f/PHj4liLBb7/PnzZ7xe77/3YJpmfUNDw7u2tra7wWDw9X8Aa49VkZvp8isAAAAASUVORK5CYII='
    };
    return icons[terminalId] || '';
  }

  override render() {
    const selectedOption = this.options.find(opt => opt.value === this.value) || this.options[0];
    
    return html`
      <div class="form-group">
        ${this.label ? html`<label for="${this.settingKey}">${this.label}</label>` : ''}
        <div class="select-wrapper">
          <div 
            class="custom-select ${this.isOpen ? 'open' : ''}"
            @click=${this.toggleDropdown}
            tabindex="0"
            role="button"
            aria-expanded=${this.isOpen}
            aria-haspopup="listbox"
          >
            <div class="selected-option">
              ${selectedOption?.icon || this.getTerminalIcon(selectedOption?.value || '') ? html`
                <img 
                  class="option-icon" 
                  src="${selectedOption?.icon || this.getTerminalIcon(selectedOption?.value || '')}" 
                  alt="${selectedOption?.label}"
                />
              ` : ''}
              <span>${selectedOption?.label || ''}</span>
            </div>
            <svg class="arrow ${this.isOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          
          <div class="dropdown ${this.isOpen ? 'open' : ''}" role="listbox">
            ${this.options.map(option => html`
              <div 
                class="option ${this.value === option.value ? 'selected' : ''}"
                @click=${() => this.selectOption(option)}
                role="option"
                aria-selected=${this.value === option.value}
              >
                ${option.icon || this.getTerminalIcon(option.value) ? html`
                  <img 
                    class="option-icon" 
                    src="${option.icon || this.getTerminalIcon(option.value)}" 
                    alt="${option.label}"
                  />
                ` : ''}
                <span>${option.label}</span>
              </div>
            `)}
          </div>
        </div>
        ${this.help ? html`<small class="help">${this.help}</small>` : ''}
      </div>
    `;
  }
}
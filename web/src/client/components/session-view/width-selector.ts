/**
 * Width Selector Component
 *
 * Dropdown menu for selecting terminal width constraints.
 * Includes common presets and custom width input with font size controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { COMMON_TERMINAL_WIDTHS } from '../../utils/terminal-preferences.js';

@customElement('width-selector')
export class WidthSelector extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: String }) customWidth = '';
  @property({ type: Function }) onWidthSelect?: (width: number) => void;
  @property({ type: Function }) onFontSizeChange?: (size: number) => void;
  @property({ type: Function }) onClose?: () => void;

  private handleCustomWidthInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.customWidth = input.value;
    this.requestUpdate();
  }

  private handleCustomWidthSubmit() {
    const width = Number.parseInt(this.customWidth, 10);
    if (!Number.isNaN(width) && width >= 20 && width <= 500) {
      this.onWidthSelect?.(width);
      this.customWidth = '';
    }
  }

  private handleCustomWidthKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.handleCustomWidthSubmit();
    } else if (e.key === 'Escape') {
      this.customWidth = '';
      this.onClose?.();
    }
  }

  render() {
    if (!this.visible) return null;

    return html`
      <div
        class="width-selector-container absolute top-8 right-0 bg-dark-bg-secondary border border-dark-border rounded-md shadow-lg z-50 min-w-48"
      >
        <div class="p-2">
          <div class="text-xs text-dark-text-muted mb-2 px-2">Terminal Width</div>
          ${COMMON_TERMINAL_WIDTHS.map(
            (width) => html`
              <button
                class="w-full text-left px-2 py-1 text-xs hover:bg-dark-border rounded-sm flex justify-between items-center
                  ${
                    this.terminalMaxCols === width.value
                      ? 'bg-dark-border text-accent-green'
                      : 'text-dark-text'
                  }"
                @click=${() => this.onWidthSelect?.(width.value)}
              >
                <span class="font-mono">${width.label}</span>
                <span class="text-dark-text-muted text-xs">${width.description}</span>
              </button>
            `
          )}
          <div class="border-t border-dark-border mt-2 pt-2">
            <div class="text-xs text-dark-text-muted mb-1 px-2">Custom (20-500)</div>
            <div class="flex gap-1">
              <input
                type="number"
                min="20"
                max="500"
                placeholder="80"
                .value=${this.customWidth}
                @input=${this.handleCustomWidthInput}
                @keydown=${this.handleCustomWidthKeydown}
                @click=${(e: Event) => e.stopPropagation()}
                class="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono text-dark-text"
              />
              <button
                class="btn-secondary text-xs px-2 py-1"
                @click=${this.handleCustomWidthSubmit}
                ?disabled=${
                  !this.customWidth ||
                  Number.parseInt(this.customWidth) < 20 ||
                  Number.parseInt(this.customWidth) > 500
                }
              >
                Set
              </button>
            </div>
          </div>
          <div class="border-t border-dark-border mt-2 pt-2">
            <div class="text-xs text-dark-text-muted mb-2 px-2">Font Size</div>
            <div class="flex items-center gap-2 px-2">
              <button
                class="btn-secondary text-xs px-2 py-1"
                @click=${() => this.onFontSizeChange?.(this.terminalFontSize - 1)}
                ?disabled=${this.terminalFontSize <= 8}
              >
                −
              </button>
              <span class="font-mono text-xs text-dark-text min-w-8 text-center">
                ${this.terminalFontSize}px
              </span>
              <button
                class="btn-secondary text-xs px-2 py-1"
                @click=${() => this.onFontSizeChange?.(this.terminalFontSize + 1)}
                ?disabled=${this.terminalFontSize >= 32}
              >
                +
              </button>
              <button
                class="btn-ghost text-xs px-2 py-1 ml-auto"
                @click=${() => this.onFontSizeChange?.(14)}
                ?disabled=${this.terminalFontSize === 14}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

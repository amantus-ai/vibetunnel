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
        class="width-selector-container absolute top-full mt-2 right-0 bg-dark-bg-elevated border border-dark-border rounded-lg shadow-elevated z-50 min-w-[280px] animate-fade-in"
      >
        <div class="p-4">
          <div class="text-sm font-semibold text-dark-text mb-3">Terminal Width</div>
          ${COMMON_TERMINAL_WIDTHS.map(
            (width) => html`
              <button
                class="w-full text-left px-3 py-2 text-sm rounded-md flex justify-between items-center transition-all duration-200
                  ${
                    this.terminalMaxCols === width.value
                      ? 'bg-accent-primary bg-opacity-10 text-accent-primary border border-accent-primary'
                      : 'text-dark-text hover:bg-dark-surface-hover hover:text-dark-text-bright border border-transparent'
                  }"
                @click=${() => this.onWidthSelect?.(width.value)}
              >
                <span class="font-mono font-medium">${width.label}</span>
                <span class="text-dark-text-muted text-xs ml-4">${width.description}</span>
              </button>
            `
          )}
          <div class="border-t border-dark-border mt-3 pt-3">
            <div class="text-sm font-semibold text-dark-text mb-2">Custom (20-500)</div>
            <div class="flex gap-2">
              <input
                type="number"
                min="20"
                max="500"
                placeholder="80"
                .value=${this.customWidth}
                @input=${this.handleCustomWidthInput}
                @keydown=${this.handleCustomWidthKeydown}
                @click=${(e: Event) => e.stopPropagation()}
                class="flex-1 bg-dark-bg-secondary border border-dark-border rounded-md px-3 py-2 text-sm font-mono text-dark-text placeholder:text-dark-text-dim focus:border-accent-primary focus:shadow-glow-primary-sm transition-all"
              />
              <button
                class="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200
                  ${
                    !this.customWidth ||
                    Number.parseInt(this.customWidth) < 20 ||
                    Number.parseInt(this.customWidth) > 500
                      ? 'bg-dark-bg-secondary border border-dark-border text-dark-text-muted cursor-not-allowed'
                      : 'bg-accent-primary text-dark-bg hover:bg-accent-primary-light active:scale-95'
                  }"
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
          <div class="border-t border-dark-border mt-3 pt-3">
            <div class="text-sm font-semibold text-dark-text mb-3">Font Size</div>
            <div class="flex items-center gap-3">
              <button
                class="w-10 h-10 rounded-md border transition-all duration-200 flex items-center justify-center
                  ${
                    this.terminalFontSize <= 8
                      ? 'border-dark-border bg-dark-bg-secondary text-dark-text-muted cursor-not-allowed'
                      : 'border-dark-border bg-dark-bg-elevated text-dark-text hover:border-accent-primary hover:text-accent-primary active:scale-95'
                  }"
                @click=${() => this.onFontSizeChange?.(this.terminalFontSize - 1)}
                ?disabled=${this.terminalFontSize <= 8}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
                </svg>
              </button>
              <span class="font-mono text-lg font-medium text-dark-text min-w-[60px] text-center">
                ${this.terminalFontSize}px
              </span>
              <button
                class="w-10 h-10 rounded-md border transition-all duration-200 flex items-center justify-center
                  ${
                    this.terminalFontSize >= 32
                      ? 'border-dark-border bg-dark-bg-secondary text-dark-text-muted cursor-not-allowed'
                      : 'border-dark-border bg-dark-bg-elevated text-dark-text hover:border-accent-primary hover:text-accent-primary active:scale-95'
                  }"
                @click=${() => this.onFontSizeChange?.(this.terminalFontSize + 1)}
                ?disabled=${this.terminalFontSize >= 32}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
                </svg>
              </button>
              <button
                class="ml-auto px-3 py-2 rounded-md text-sm transition-all duration-200
                  ${
                    this.terminalFontSize === 14
                      ? 'text-dark-text-muted cursor-not-allowed'
                      : 'text-dark-text-muted hover:text-dark-text hover:bg-dark-surface-hover'
                  }"
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

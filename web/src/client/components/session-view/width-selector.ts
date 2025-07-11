/**
 * Width Selector Component
 *
 * Dropdown menu for selecting terminal width constraints.
 * Includes common presets and custom width input with font size controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Z_INDEX } from '../../utils/constants.js';
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
  @property({ type: Boolean }) isMobile = false;

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
      <!-- Backdrop to close on outside click -->
      <div 
        class="fixed inset-0 z-40" 
        @click=${() => this.onClose?.()}
      ></div>
      
      <!-- Width selector modal -->
      <div
        class="width-selector-container fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-dark-bg-elevated border border-dark-border rounded-lg shadow-elevated min-w-[280px] max-w-[90vw] animate-fade-in"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-dark-text">Terminal Width</div>
            <!-- Close button for mobile -->
            <button
              class="sm:hidden p-1.5 rounded-md text-dark-text-muted hover:text-dark-text hover:bg-dark-surface-hover transition-all duration-200"
              @click=${() => this.onClose?.()}
              aria-label="Close width selector"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
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

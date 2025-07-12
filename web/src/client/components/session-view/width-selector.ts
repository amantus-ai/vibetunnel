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
import { TERMINAL_THEMES, type TerminalThemeId } from '../../utils/terminal-themes.js';

@customElement('width-selector')
export class WidthSelector extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: String }) terminalTheme: TerminalThemeId = 'auto';
  @property({ type: String }) customWidth = '';
  @property({ type: Function }) onWidthSelect?: (width: number) => void;
  @property({ type: Function }) onFontSizeChange?: (size: number) => void;
  @property({ type: Function }) onThemeChange?: (theme: TerminalThemeId) => void;
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
        class="width-selector-container fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg shadow-elevated min-w-[280px] max-w-[90vw] animate-fade-in"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-text-bright">Terminal Width</div>
            <!-- Close button for mobile -->
            <button
              class="sm:hidden p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface transition-all duration-200"
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
                      ? 'bg-primary bg-opacity-20 text-primary font-semibold border border-primary'
                      : 'text-text hover:bg-surface hover:text-text-bright border border-transparent'
                  }"
                @click=${() => this.onWidthSelect?.(width.value)}
              >
                <span class="font-mono font-medium">${width.label}</span>
                <span class="text-text-muted text-xs ml-4">${width.description}</span>
              </button>
            `
          )}
          <div class="border-t border-border mt-3 pt-3">
            <div class="text-sm font-semibold text-text-bright mb-2">Custom (20-500)</div>
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
                class="flex-1 bg-bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono text-text placeholder:text-text-dim focus:border-primary focus:shadow-glow-sm transition-all"
              />
              <button
                class="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200
                  ${
                    !this.customWidth ||
                    Number.parseInt(this.customWidth) < 20 ||
                    Number.parseInt(this.customWidth) > 500
                      ? 'bg-bg-secondary border border-border text-text-muted cursor-not-allowed'
                      : 'bg-primary text-text-bright hover:bg-primary-hover active:scale-95'
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
          <div class="border-t border-border mt-3 pt-3">
          <div class="text-sm font-semibold text-text-bright mb-3">Font Size</div>
          <div class="flex items-center gap-3">
              <button
                class="w-10 h-10 rounded-md border transition-all duration-200 flex items-center justify-center
                  ${
                    this.terminalFontSize <= 8
                      ? 'border-border bg-bg-secondary text-text-muted cursor-not-allowed'
                      : 'border-border bg-bg-elevated text-text hover:border-primary hover:text-primary active:scale-95'
                  }"
                @click=${() => this.onFontSizeChange?.(this.terminalFontSize - 1)}
                ?disabled=${this.terminalFontSize <= 8}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
                </svg>
              </button>
              <span class="font-mono text-lg font-medium text-text-bright min-w-[60px] text-center">
                ${this.terminalFontSize}px
              </span>
              <button
                class="w-10 h-10 rounded-md border transition-all duration-200 flex items-center justify-center
                  ${
                    this.terminalFontSize >= 32
                      ? 'border-border bg-bg-secondary text-text-muted cursor-not-allowed'
                      : 'border-border bg-bg-elevated text-text hover:border-primary hover:text-primary active:scale-95'
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
                      ? 'text-text-muted cursor-not-allowed'
                      : 'text-text-muted hover:text-text hover:bg-surface'
                  }"
                @click=${() => this.onFontSizeChange?.(14)}
                ?disabled=${this.terminalFontSize === 14}
              >
                Reset
              </button>
            </div>
          </div>
          <div class="border-t border-border mt-3 pt-3">
            <div class="text-sm font-semibold text-text-bright mb-3">Theme</div>
            <select
              class="w-full bg-bg-secondary border border-border rounded-md p-2 text-sm font-mono text-text focus:border-primary focus:shadow-glow-sm"
              .value=${this.terminalTheme}
              @change=${(e: Event) => this.onThemeChange?.((e.target as HTMLSelectElement).value as TerminalThemeId)}
            >
              ${TERMINAL_THEMES.map(
                (t) =>
                  html`<option value=${t.id} ?selected=${this.terminalTheme === t.id}>${t.name}</option>`
              )}
            </select>
          </div>
        </div>
      </div>
    `;
  }
}

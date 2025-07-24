/**
 * Terminal Settings Modal Component
 *
 * Modal for configuring terminal settings including:
 * - Terminal width/columns
 * - Font size
 * - Theme selection
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Z_INDEX } from '../utils/constants.js';
import { COMMON_TERMINAL_WIDTHS } from '../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';
import { TERMINAL_THEMES } from '../utils/terminal-themes.js';

@customElement('terminal-settings-modal')
export class TerminalSettingsModal extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: String }) terminalTheme: TerminalThemeId = 'auto';
  @property({ type: String }) customWidth = '';
  @property({ type: Boolean }) isMobile = false;

  // Callbacks
  @property({ type: Object }) onWidthSelect?: (width: number) => void;
  @property({ type: Object }) onFontSizeChange?: (size: number) => void;
  @property({ type: Object }) onThemeChange?: (theme: TerminalThemeId) => void;
  @property({ type: Object }) onClose?: () => void;

  private handleCustomWidthSubmit() {
    const width = Number.parseInt(this.customWidth, 10);
    if (!Number.isNaN(width) && width > 0 && width <= 500) {
      this.onWidthSelect?.(width);
    }
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        style="z-index: ${Z_INDEX.MODAL_BACKDROP}"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this.onClose?.();
          }
        }}
      >
        <div
          class="bg-bg-elevated rounded-lg shadow-elevated max-w-lg w-full max-h-[90vh] overflow-y-auto"
          style="z-index: ${Z_INDEX.FILE_PICKER}"
        >
          <div class="p-6">
            <h2 class="text-lg font-semibold text-primary mb-6">Terminal Settings</h2>
            
            <!-- Width Settings -->
            <div class="mb-6">
              <h3 class="text-sm font-medium text-text-muted mb-3">Terminal Width</h3>
              <div class="grid grid-cols-3 gap-2 mb-3">
                ${COMMON_TERMINAL_WIDTHS.map(
                  (preset) => html`
                    <button
                      class="px-3 py-2 rounded text-sm font-mono transition-all ${
                        this.terminalMaxCols === preset.value
                          ? 'bg-primary text-white'
                          : 'bg-surface text-text hover:bg-surface-hover'
                      }"
                      @click=${() => this.onWidthSelect?.(preset.value)}
                    >
                      ${preset.label}
                    </button>
                  `
                )}
              </div>
              
              <!-- Custom width input -->
              <div class="flex gap-2">
                <input
                  type="number"
                  class="flex-1 px-3 py-2 bg-surface text-text rounded font-mono text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Custom width (e.g., 120)"
                  .value=${this.customWidth}
                  @input=${(e: Event) => {
                    this.customWidth = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      this.handleCustomWidthSubmit();
                    }
                  }}
                />
                <button
                  class="px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors"
                  @click=${this.handleCustomWidthSubmit}
                >
                  Set
                </button>
              </div>
            </div>
            
            <!-- Font Size Settings -->
            <div class="mb-6">
              <h3 class="text-sm font-medium text-text-muted mb-3">Font Size</h3>
              <div class="flex items-center gap-4">
                <button
                  class="w-8 h-8 rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text transition-colors"
                  @click=${() => this.onFontSizeChange?.(this.terminalFontSize - 1)}
                >
                  -
                </button>
                <span class="font-mono text-primary w-12 text-center text-lg">${this.terminalFontSize}</span>
                <button
                  class="w-8 h-8 rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text transition-colors"
                  @click=${() => this.onFontSizeChange?.(this.terminalFontSize + 1)}
                >
                  +
                </button>
                <span class="text-xs text-text-muted ml-2">(8-32)</span>
              </div>
            </div>
            
            <!-- Theme Settings -->
            <div class="mb-6">
              <h3 class="text-sm font-medium text-text-muted mb-3">Theme</h3>
              <div class="grid grid-cols-2 gap-2">
                ${Object.entries(TERMINAL_THEMES).map(
                  ([id, theme]) => html`
                    <button
                      class="px-3 py-2 rounded text-sm transition-all ${
                        this.terminalTheme === id
                          ? 'bg-primary text-white'
                          : 'bg-surface text-text hover:bg-surface-hover'
                      }"
                      @click=${() => this.onThemeChange?.(id as TerminalThemeId)}
                    >
                      ${theme.name}
                    </button>
                  `
                )}
              </div>
            </div>
            
            <!-- Close button -->
            <div class="flex justify-end">
              <button
                class="px-4 py-2 bg-surface text-primary rounded text-sm font-medium hover:bg-surface-hover transition-colors"
                @click=${() => this.onClose?.()}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

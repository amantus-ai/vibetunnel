/**
 * Terminal Settings Component
 *
 * Modal for configuring terminal width, font size, and theme.
 * Features a grid-based layout with conditional custom width input.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Z_INDEX } from '../../utils/constants.js';
import { createLogger } from '../../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../../utils/terminal-preferences.js';
import { TERMINAL_THEMES, type TerminalThemeId } from '../../utils/terminal-themes.js';
import { getTextColorEncoded } from '../../utils/theme-utils.js';

const logger = createLogger('terminal-settings-modal');

@customElement('terminal-settings-modal')
export class TerminalSettingsModal extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();

    // Clean up old conflicting localStorage key if it exists
    if (localStorage.getItem('terminal-theme')) {
      const oldTheme = localStorage.getItem('terminal-theme') as TerminalThemeId;
      // Migrate to TerminalPreferencesManager if it's a valid theme
      if (
        oldTheme &&
        ['auto', 'light', 'dark', 'vscode-dark', 'dracula', 'nord'].includes(oldTheme)
      ) {
        this.preferencesManager.setTheme(oldTheme);
      }
      localStorage.removeItem('terminal-theme');
    }

    // Load theme from TerminalPreferencesManager
    this.terminalTheme = this.preferencesManager.getTheme();
  }

  private preferencesManager = TerminalPreferencesManager.getInstance();

  @property({ type: Boolean }) visible = false;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;

  private _terminalTheme: TerminalThemeId = 'auto';
  @property({ type: String })
  get terminalTheme(): TerminalThemeId {
    return this._terminalTheme;
  }
  set terminalTheme(value: TerminalThemeId) {
    logger.debug('Terminal theme set to:', value);
    this._terminalTheme = value;
    this.requestUpdate();
  }
  @property({ type: String }) customWidth = '';
  @property({ type: Boolean }) showCustomInput = false;
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
      this.showCustomInput = false;
    }
  }

  private handleClose() {
    this.showCustomInput = false;
    this.customWidth = '';
    this.onClose?.();
  }

  private handleCustomWidthKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.handleCustomWidthSubmit();
    } else if (e.key === 'Escape') {
      this.handleClose();
    }
  }

  private getArrowColor(): string {
    // Return URL-encoded text color from CSS custom properties
    return getTextColorEncoded();
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);

    // Force update the theme select value when terminalTheme property changes OR when visible changes
    if (changedProperties.has('terminalTheme') || changedProperties.has('visible')) {
      // Use requestAnimationFrame to ensure DOM is fully updated
      requestAnimationFrame(() => {
        const themeSelect = this.querySelector('#theme-select') as HTMLSelectElement;
        if (themeSelect && this.terminalTheme) {
          logger.debug('Updating theme select value to:', this.terminalTheme);
          themeSelect.value = this.terminalTheme;
        }
      });
    }
  }

  render() {
    if (!this.visible) return null;

    // Debug localStorage when dialog opens
    logger.debug('Dialog opening, terminal theme:', this.terminalTheme);

    // Check if we're showing a custom value that doesn't match presets
    const isCustomValue =
      this.terminalMaxCols > 0 &&
      !COMMON_TERMINAL_WIDTHS.find((w) => w.value === this.terminalMaxCols);

    return html`
      <!-- Backdrop to close on outside click -->
      <div 
        class="fixed inset-0 z-40" 
        role="dialog"
        aria-modal="true"
        aria-labelledby="terminal-settings-title"
        @click=${() => this.handleClose()}
      ></div>
      
      <!-- Terminal settings modal -->
      <div
        class="width-selector-container fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg shadow-elevated w-[400px] max-w-[90vw] animate-fade-in"
        style="z-index: ${Z_INDEX.WIDTH_SELECTOR_DROPDOWN};"
      >
        <div class="p-6">
          <div class="flex items-center justify-between mb-6">
            <h2 id="terminal-settings-title" class="text-lg font-semibold text-text-bright">Terminal Settings</h2>
            <button
              class="text-muted hover:text-primary transition-colors p-1"
              @click=${() => this.handleClose()}
              title="Close"
              aria-label="Close terminal settings"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <!-- Settings grid -->
          <div class="space-y-4">
            <!-- Width setting -->
            <div class="grid grid-cols-[120px_1fr] gap-4 items-center">
              <label class="text-sm font-medium text-text-bright text-right">Width</label>
              <select
                class="w-full bg-bg-secondary border border-border rounded-md pl-4 pr-10 py-3 text-sm font-mono text-text focus:border-primary focus:shadow-glow-sm cursor-pointer appearance-none"
                style="background-image: url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22${this.getArrowColor()}%22%3e%3cpath fill-rule=%22evenodd%22 d=%22M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z%22 clip-rule=%22evenodd%22/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-repeat: no-repeat; background-size: 1.25em 1.25em;"
                .value=${isCustomValue || this.showCustomInput ? 'custom' : String(this.terminalMaxCols)}
                @change=${(e: Event) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value === 'custom') {
                    this.showCustomInput = true;
                    this.customWidth = isCustomValue ? String(this.terminalMaxCols) : '';
                  } else {
                    this.showCustomInput = false;
                    this.customWidth = '';
                    this.onWidthSelect?.(Number.parseInt(value));
                  }
                }}
              >
                <option value="0">Fit to Window</option>
                ${COMMON_TERMINAL_WIDTHS.slice(1).map(
                  (width) => html`
                    <option value=${width.value}>
                      ${width.description} (${width.value})
                    </option>
                  `
                )}
                <option value="custom">Custom...</option>
              </select>
            </div>
            
            <!-- Custom width input (conditional) -->
            ${
              this.showCustomInput
                ? html`
              <div class="grid grid-cols-[120px_1fr] gap-4 items-center">
                <div></div>
                <div class="flex gap-2">
                  <input
                    type="number"
                    min="20"
                    max="500"
                    placeholder="Enter width (20-500)"
                    .value=${this.customWidth}
                    @input=${this.handleCustomWidthInput}
                    @keydown=${this.handleCustomWidthKeydown}
                    @click=${(e: Event) => e.stopPropagation()}
                    class="flex-1 bg-bg-secondary border border-border rounded-md px-4 py-3 text-sm font-mono text-text placeholder:text-text-dim focus:border-primary focus:shadow-glow-sm transition-all"
                    autofocus
                  />
                  <button
                    class="px-4 py-3 rounded-md text-sm font-medium transition-all duration-200
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
            `
                : ''
            }
          
            <!-- Font size setting -->
            <div class="grid grid-cols-[120px_1fr] gap-4 items-center">
              <label class="text-sm font-medium text-text-bright text-right">Font Size</label>
              <div class="flex items-center gap-3 bg-bg-secondary border border-border rounded-md px-4 py-2">
                <button
                  class="w-8 h-8 rounded-md border transition-all duration-200 flex items-center justify-center
                    ${
                      this.terminalFontSize <= 8
                        ? 'border-border bg-bg-tertiary text-text-muted cursor-not-allowed'
                        : 'border-border bg-bg-elevated text-text hover:border-primary hover:text-primary active:scale-95'
                    }"
                  @click=${() => this.onFontSizeChange?.(this.terminalFontSize - 1)}
                  ?disabled=${this.terminalFontSize <= 8}
                  title="Decrease font size"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
                  </svg>
                </button>
                <span class="font-mono text-base font-medium text-text-bright min-w-[60px] text-center">
                  ${this.terminalFontSize}px
                </span>
                <button
                  class="w-8 h-8 rounded-md border transition-all duration-200 flex items-center justify-center
                    ${
                      this.terminalFontSize >= 32
                        ? 'border-border bg-bg-tertiary text-text-muted cursor-not-allowed'
                        : 'border-border bg-bg-elevated text-text hover:border-primary hover:text-primary active:scale-95'
                    }"
                  @click=${() => this.onFontSizeChange?.(this.terminalFontSize + 1)}
                  ?disabled=${this.terminalFontSize >= 32}
                  title="Increase font size"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
                  </svg>
                </button>
                <div class="flex-1"></div>
              </div>
            </div>
            
            <!-- Theme setting -->
            <div class="grid grid-cols-[120px_1fr] gap-4 items-center">
              <label class="text-sm font-medium text-text-bright text-right">Theme</label>
              <select
                id="theme-select"
                class="w-full bg-bg-secondary border border-border rounded-md pl-4 pr-10 py-3 text-sm font-mono text-text focus:border-primary focus:shadow-glow-sm cursor-pointer appearance-none"
                style="background-image: url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22${this.getArrowColor()}%22%3e%3cpath fill-rule=%22evenodd%22 d=%22M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z%22 clip-rule=%22evenodd%22/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-repeat: no-repeat; background-size: 1.25em 1.25em;"
                @change=${(e: Event) => {
                  e.stopPropagation();
                  const value = (e.target as HTMLSelectElement).value as TerminalThemeId;
                  logger.debug('Theme changed to:', value);
                  // Save theme using TerminalPreferencesManager
                  this.preferencesManager.setTheme(value);
                  // Dispatch custom event to notify other components
                  window.dispatchEvent(
                    new CustomEvent('terminal-theme-changed', { detail: value })
                  );
                  this.onThemeChange?.(value);
                }}
                @click=${(e: Event) => e.stopPropagation()}
              >
                ${TERMINAL_THEMES.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

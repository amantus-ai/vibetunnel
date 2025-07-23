/**
 * Quick Start Section Component
 *
 * Displays quick start command buttons and manages editing mode
 * for customizing quick start commands.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { QuickStartCommand } from '../../../types/config.js';
import '../quick-start-editor.js';

export interface QuickStartItem {
  label: string;
  command: string;
}

@customElement('quick-start-section')
export class QuickStartSection extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) commands: QuickStartItem[] = [];
  @property({ type: String }) selectedCommand = '';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) isCreating = false;

  @state() private editMode = false;

  private handleQuickStartClick(command: string) {
    this.dispatchEvent(
      new CustomEvent('quick-start-selected', {
        detail: { command },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleQuickStartChanged(e: CustomEvent<QuickStartCommand[]>) {
    this.dispatchEvent(
      new CustomEvent('quick-start-changed', {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleEditingChanged(e: CustomEvent) {
    this.editMode = e.detail.editing;
  }

  render() {
    return html`
      <div class="${this.editMode ? '' : 'mb-3 sm:mb-4'}">
        ${
          this.editMode
            ? html`
            <!-- Full width editor when in edit mode -->
            <div class="-mx-3 sm:-mx-4 lg:-mx-6">
              <quick-start-editor
                .commands=${this.commands.map((cmd) => ({
                  name: cmd.label === cmd.command ? undefined : cmd.label,
                  command: cmd.command,
                }))}
                .editing=${true}
                @quick-start-changed=${this.handleQuickStartChanged}
                @editing-changed=${this.handleEditingChanged}
              ></quick-start-editor>
            </div>
          `
            : html`
            <!-- Normal mode with Edit button -->
            <div class="flex items-center justify-between mb-1 sm:mb-2 mt-3 sm:mt-4">
              <label class="form-label text-text-muted uppercase text-[9px] sm:text-[10px] lg:text-xs tracking-wider">
                Quick Start
              </label>
              <quick-start-editor
                .commands=${this.commands.map((cmd) => ({
                  name: cmd.label === cmd.command ? undefined : cmd.label,
                  command: cmd.command,
                }))}
                .editing=${false}
                @quick-start-changed=${this.handleQuickStartChanged}
                @editing-changed=${this.handleEditingChanged}
              ></quick-start-editor>
            </div>
          `
        }
        ${
          !this.editMode
            ? html`
            <div class="grid grid-cols-2 gap-2 sm:gap-2.5 lg:gap-3 mt-1.5 sm:mt-2">
              ${this.commands.map(
                ({ label, command }) => html`
                  <button
                    @click=${() => this.handleQuickStartClick(command)}
                    class="${
                      this.selectedCommand === command
                        ? 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-primary bg-opacity-10 border-primary/50 text-primary hover:bg-opacity-20 font-medium text-[10px] sm:text-xs lg:text-sm'
                        : 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-bg-elevated border-border/50 text-text hover:bg-hover hover:border-primary/50 hover:text-primary text-[10px] sm:text-xs lg:text-sm'
                    }"
                    ?disabled=${this.disabled || this.isCreating}
                    type="button"
                  >
                    ${label}
                  </button>
                `
              )}
            </div>
          `
            : ''
        }
      </div>
    `;
  }
}

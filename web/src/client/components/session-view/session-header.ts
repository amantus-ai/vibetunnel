/**
 * Session Header Component
 *
 * Header bar for session view with navigation, session info, status, and controls.
 * Includes back button, sidebar toggle, session details, and terminal controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { COMMON_TERMINAL_WIDTHS } from '../../utils/terminal-preferences.js';
import type { Session } from '../session-list.js';
import '../clickable-path.js';
import './width-selector.js';

@customElement('session-header')
export class SessionHeader extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) showBackButton = true;
  @property({ type: Boolean }) showSidebarToggle = false;
  @property({ type: Boolean }) sidebarCollapsed = false;
  @property({ type: Number }) terminalCols = 0;
  @property({ type: Number }) terminalRows = 0;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: String }) customWidth = '';
  @property({ type: Boolean }) showWidthSelector = false;
  @property({ type: Function }) onBack?: () => void;
  @property({ type: Function }) onSidebarToggle?: () => void;
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onWidthSelect?: (width: number) => void;
  @property({ type: Function }) onFontSizeChange?: (size: number) => void;

  private getStatusText(): string {
    if (!this.session) return '';
    if ('active' in this.session && this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (!this.session) return 'text-dark-text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'text-dark-text-muted';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getStatusDotColor(): string {
    if (!this.session) return 'bg-dark-text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'bg-dark-text-muted';
    }
    return this.session.status === 'running' ? 'bg-status-success' : 'bg-status-warning';
  }

  private getCurrentWidthLabel(): string {
    const width = COMMON_TERMINAL_WIDTHS.find((w) => w.value === this.terminalMaxCols);
    return width?.label || this.terminalMaxCols.toString();
  }

  private handleCloseWidthSelector() {
    this.dispatchEvent(
      new CustomEvent('close-width-selector', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.session) return null;

    return html`
      <!-- Compact Header -->
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-dark-border text-sm min-w-0 bg-dark-bg-secondary"
        style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(0.75rem, env(safe-area-inset-left)); padding-right: max(0.75rem, env(safe-area-inset-right));"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <!-- Mobile Hamburger Menu Button (only on phones, only when session is shown) -->
          ${
            this.showSidebarToggle && this.sidebarCollapsed
              ? html`
                <button
                  class="sm:hidden bg-dark-bg-tertiary border border-dark-border rounded-lg p-1 font-mono text-accent-green transition-all duration-300 hover:bg-dark-bg hover:border-accent-green flex-shrink-0"
                  @click=${() => this.onSidebarToggle?.()}
                  title="Show sessions"
                >
                  <!-- Hamburger menu icon -->
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </button>
              `
              : ''
          }
          ${
            this.showBackButton
              ? html`
                <button
                  class="btn-secondary font-mono text-xs px-3 py-1 flex-shrink-0"
                  @click=${() => this.onBack?.()}
                >
                  Back
                </button>
              `
              : ''
          }
          <div class="text-dark-text min-w-0 flex-1 overflow-hidden max-w-[50vw] sm:max-w-none">
            <div
              class="text-accent-green text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
              title="${
                this.session.name ||
                (Array.isArray(this.session.command)
                  ? this.session.command.join(' ')
                  : this.session.command)
              }"
            >
              ${
                this.session.name ||
                (Array.isArray(this.session.command)
                  ? this.session.command.join(' ')
                  : this.session.command)
              }
            </div>
            <div class="text-xs opacity-75 mt-0.5 overflow-hidden">
              <clickable-path 
                .path=${this.session.workingDir} 
                .iconSize=${12}
              ></clickable-path>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs flex-shrink-0 ml-2 relative">
          <button
            class="btn-secondary font-mono text-xs p-1 flex-shrink-0"
            @click=${() => this.onOpenFileBrowser?.()}
            title="Browse Files (⌘O)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
              />
            </svg>
          </button>
          <button
            class="btn-secondary font-mono text-xs px-2 py-1 flex-shrink-0 width-selector-button"
            @click=${() => this.onMaxWidthToggle?.()}
            title="Terminal width: ${
              this.terminalMaxCols === 0 ? 'Unlimited' : `${this.terminalMaxCols} columns`
            }"
          >
            ${this.getCurrentWidthLabel()}
          </button>
          <width-selector
            .visible=${this.showWidthSelector}
            .terminalMaxCols=${this.terminalMaxCols}
            .terminalFontSize=${this.terminalFontSize}
            .customWidth=${this.customWidth}
            .onWidthSelect=${(width: number) => this.onWidthSelect?.(width)}
            .onFontSizeChange=${(size: number) => this.onFontSizeChange?.(size)}
            .onClose=${() => this.handleCloseWidthSelector()}
          ></width-selector>
          <div class="flex flex-col items-end gap-0">
            <span class="${this.getStatusColor()} text-xs flex items-center gap-1">
              <div class="w-2 h-2 rounded-full ${this.getStatusDotColor()}"></div>
              ${this.getStatusText().toUpperCase()}
            </span>
            ${
              this.terminalCols > 0 && this.terminalRows > 0
                ? html`
                  <span
                    class="text-dark-text-muted text-xs opacity-60"
                    style="font-size: 10px; line-height: 1;"
                  >
                    ${this.terminalCols}×${this.terminalRows}
                  </span>
                `
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }
}

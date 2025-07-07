/**
 * Session Header Component
 *
 * Header bar for session view with navigation, session info, status, and controls.
 * Includes back button, sidebar toggle, session details, and terminal controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../session-list.js';
import '../clickable-path.js';
import './width-selector.js';
import '../inline-edit.js';
import '../notification-status.js';

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
  @property({ type: String }) widthLabel = '';
  @property({ type: String }) widthTooltip = '';
  @property({ type: Function }) onBack?: () => void;
  @property({ type: Function }) onSidebarToggle?: () => void;
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onCreateSession?: () => void;
  @property({ type: Function }) onOpenImagePicker?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onWidthSelect?: (width: number) => void;
  @property({ type: Function }) onFontSizeChange?: (size: number) => void;
  @property({ type: Function }) onScreenshare?: () => void;
  @property({ type: Function }) onOpenSettings?: () => void;

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
      <!-- Enhanced Header with gradient background -->
      <div
        class="flex items-center justify-between border-b border-dark-border text-sm min-w-0 bg-gradient-to-r from-dark-bg-secondary to-dark-bg-tertiary px-4 py-2 shadow-sm"
        style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(1rem, env(safe-area-inset-left)); padding-right: max(1rem, env(safe-area-inset-right));"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <!-- Sidebar Toggle and Create Session Buttons (shown when sidebar is collapsed) -->
          ${
            this.showSidebarToggle && this.sidebarCollapsed
              ? html`
                <div class="flex items-center gap-2">
                  <button
                    class="bg-dark-bg-elevated border border-dark-border rounded-lg p-2 font-mono text-dark-text-muted transition-all duration-200 hover:text-accent-primary hover:bg-dark-surface-hover hover:border-accent-primary hover:shadow-sm flex-shrink-0"
                    @click=${() => this.onSidebarToggle?.()}
                    title="Show sidebar (⌘B)"
                    aria-label="Show sidebar"
                    aria-expanded="false"
                    aria-controls="sidebar"
                  >
                    <!-- Right chevron icon to expand sidebar -->
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/>
                    </svg>
                  </button>
                  
                  <!-- Create Session button with primary color -->
                  <button
                    class="bg-accent-primary bg-opacity-10 border border-accent-primary text-accent-primary rounded-lg p-2 font-mono transition-all duration-200 hover:bg-accent-primary hover:text-dark-bg hover:shadow-glow-primary-sm flex-shrink-0"
                    @click=${() => this.onCreateSession?.()}
                    title="Create New Session (⌘K)"
                    data-testid="create-session-button"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"/>
                    </svg>
                  </button>
                </div>
              `
              : ''
          }
          ${
            this.showBackButton
              ? html`
                <button
                  class="bg-dark-bg-elevated border border-dark-border rounded-lg px-3 py-1.5 font-mono text-xs text-dark-text-muted transition-all duration-200 hover:text-accent-primary hover:bg-dark-surface-hover hover:border-accent-primary hover:shadow-sm flex-shrink-0"
                  @click=${() => this.onBack?.()}
                >
                  Back
                </button>
              `
              : ''
          }
          <div class="text-dark-text min-w-0 flex-1 overflow-hidden max-w-[50vw] sm:max-w-none">
            <div class="text-dark-text-bright font-medium text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap">
              <inline-edit
                .value=${
                  this.session.name ||
                  (Array.isArray(this.session.command)
                    ? this.session.command.join(' ')
                    : this.session.command)
                }
                .placeholder=${
                  Array.isArray(this.session.command)
                    ? this.session.command.join(' ')
                    : this.session.command
                }
                .onSave=${(newName: string) => this.handleRename(newName)}
              ></inline-edit>
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
            class="bg-dark-bg-elevated border border-dark-border rounded-lg p-2 font-mono text-dark-text-muted transition-all duration-200 hover:text-accent-primary hover:bg-dark-surface-hover hover:border-accent-primary hover:shadow-sm flex-shrink-0"
            @click=${() => this.onOpenFileBrowser?.()}
            title="Browse Files (⌘O)"
            data-testid="file-browser-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
              />
            </svg>
          </button>
          <notification-status
            @open-settings=${() => this.onOpenSettings?.()}
          ></notification-status>
          <button
            class="bg-dark-bg-elevated border border-dark-border rounded-lg p-2 font-mono text-dark-text-muted transition-all duration-200 hover:text-accent-primary hover:bg-dark-surface-hover hover:border-accent-primary hover:shadow-sm flex-shrink-0"
            @click=${() => this.onScreenshare?.()}
            title="Start Screenshare"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
              <circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          <button
            class="bg-dark-bg-elevated border border-dark-border rounded-lg px-3 py-2 font-mono text-xs text-dark-text-muted transition-all duration-200 hover:text-accent-primary hover:bg-dark-surface-hover hover:border-accent-primary hover:shadow-sm flex-shrink-0 width-selector-button"
            @click=${() => this.onMaxWidthToggle?.()}
            title="${this.widthTooltip}"
          >
            ${this.widthLabel}
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
            <span class="text-xs flex items-center gap-2 font-medium ${
              this.getStatusText() === 'running' ? 'text-status-success' : 'text-status-warning'
            }">
              <div class="relative">
                <div class="w-2.5 h-2.5 rounded-full ${this.getStatusDotColor()}"></div>
                ${
                  this.getStatusText() === 'running'
                    ? html`<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-success animate-ping opacity-50"></div>`
                    : ''
                }
              </div>
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

  private handleRename(newName: string) {
    if (!this.session) return;

    // Dispatch event to parent component to handle the rename
    this.dispatchEvent(
      new CustomEvent('session-rename', {
        detail: {
          sessionId: this.session.id,
          newName: newName,
        },
        bubbles: true,
        composed: true,
      })
    );
  }
}

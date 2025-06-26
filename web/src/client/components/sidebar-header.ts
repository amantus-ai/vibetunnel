/**
 * Sidebar Header Component
 *
 * Compact header for sidebar/split view with vertical layout
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeaderBase } from './header-base.js';
import type { Session } from './session-list.js';
import './terminal-icon.js';

@customElement('sidebar-header')
export class SidebarHeader extends HeaderBase {
  render() {
    const runningSessions = this.runningSessions;

    return html`
      <div
        class="app-header sidebar-header bg-dark-bg-secondary border-b border-dark-border p-3"
        style="padding-top: max(0.75rem, calc(0.75rem + env(safe-area-inset-top)));"
      >
        <!-- Compact vertical layout for sidebar -->
        <div class="flex flex-col gap-2">
          <!-- Title and logo with user menu -->
          <div class="flex items-center justify-between">
            <a
              href="/"
              class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group"
              title="Go to home"
            >
              <terminal-icon size="20"></terminal-icon>
              <div class="min-w-0">
                <h1
                  class="text-sm font-bold text-accent-green font-mono group-hover:underline truncate"
                >
                  VibeTunnel
                </h1>
                <p class="text-dark-text-muted text-xs font-mono">
                  ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
                </p>
              </div>
            </a>
            ${this.renderCompactUserMenu()}
          </div>

          <!-- Action buttons -->
          <div class="flex flex-col gap-2">
            <!-- Create Session button -->
            <button
              class="btn-primary font-mono text-xs px-3 py-1.5 vt-create-button text-center w-full"
              @click=${this.handleCreateSession}
            >
              Create Session
            </button>
            
            <!-- Kill All button -->
            ${this.renderKillAllButton(runningSessions)}
            
            <!-- Show/Hide Exited button -->
            ${this.renderExitedToggleButton(this.exitedSessions, true)}
          </div>
        </div>
      </div>
    `;
  }

  private renderExitedToggleButton(exitedSessions: Session[], compact: boolean) {
    if (exitedSessions.length === 0) return '';

    const buttonClass = compact
      ? 'relative font-mono text-xs px-3 py-1.5 w-full rounded-lg border transition-all duration-200'
      : 'relative font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200';

    const stateClass = this.hideExited
      ? 'border-dark-border bg-dark-bg-tertiary text-dark-text hover:border-accent-green-darker'
      : 'border-accent-green bg-accent-green text-dark-bg hover:bg-accent-green-darker';

    return html`
      <button
        class="${buttonClass} ${stateClass}"
        @click=${this.handleHideExitedToggle}
        title="${
          this.hideExited
            ? `Show ${exitedSessions.length} exited sessions`
            : `Hide ${exitedSessions.length} exited sessions`
        }"
      >
        <div class="flex items-center justify-between">
          <span>${this.hideExited ? 'Show' : 'Hide'} Exited</span>
          <div class="flex items-center gap-2">
            <span class="text-xs opacity-75">(${exitedSessions.length})</span>
            <div
              class="w-8 h-4 rounded-full transition-colors duration-200 ${
                this.hideExited ? 'bg-dark-border' : 'bg-dark-bg'
              }"
            >
              <div
                class="w-3 h-3 rounded-full transition-transform duration-200 mt-0.5 ${
                  this.hideExited
                    ? 'translate-x-0.5 bg-dark-text-muted'
                    : 'translate-x-4 bg-dark-bg'
                }"
              ></div>
            </div>
          </div>
        </div>
      </button>
    `;
  }

  private renderKillAllButton(runningSessions: Session[]) {
    // Only show Kill button if there are running sessions
    if (runningSessions.length === 0) return '';

    // Matching the same style as Show Exited button for consistency
    const buttonClass =
      'relative font-mono text-xs px-3 py-1.5 w-full rounded-lg border transition-all duration-200';
    const stateClass = this.killingAll
      ? 'border-status-error bg-status-error text-dark-bg cursor-not-allowed'
      : 'border-dark-border bg-dark-bg-tertiary text-status-error hover:border-status-error hover:bg-dark-bg-secondary';

    return html`
      <button
        class="${buttonClass} ${stateClass}"
        @click=${this.handleKillAll}
        ?disabled=${this.killingAll}
      >
        ${
          this.killingAll
            ? html`
              <div class="flex items-center justify-center gap-2">
                <div
                  class="w-3 h-3 border-2 border-dark-bg border-t-transparent rounded-full animate-spin"
                ></div>
                <span>Killing...</span>
              </div>
            `
            : `Kill All (${runningSessions.length})`
        }
      </button>
    `;
  }

  private renderCompactUserMenu() {
    // When no user (no-auth mode), show just a settings icon
    if (!this.currentUser) {
      return html`
        <button
          class="font-mono text-xs px-2 py-1 text-dark-text-muted hover:text-dark-text rounded border border-dark-border hover:bg-dark-bg-tertiary transition-all duration-200"
          @click=${this.handleOpenSettings}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
          </svg>
        </button>
      `;
    }

    return html`
      <div class="user-menu-container relative">
        <button
          class="font-mono text-xs px-2 py-1 text-dark-text-muted hover:text-dark-text rounded border border-dark-border hover:bg-dark-bg-tertiary transition-all duration-200"
          @click=${this.toggleUserMenu}
          title="User menu"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            />
          </svg>
        </button>
        ${
          this.showUserMenu
            ? html`
              <div
                class="absolute right-0 top-full mt-1 bg-dark-surface border border-dark-border rounded-lg shadow-lg py-1 z-50 min-w-32"
              >
                <div
                  class="px-3 py-1.5 text-xs text-dark-text-muted border-b border-dark-border font-mono"
                >
                  ${this.currentUser}
                </div>
                <button
                  class="w-full text-left px-3 py-1.5 text-xs font-mono text-dark-text hover:bg-dark-bg-secondary"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    console.log('🔧 Settings button clicked in sidebar header');
                    this.handleOpenSettings();
                  }}
                >
                  Settings
                </button>
                <div class="border-t border-dark-border"></div>
                <button
                  class="w-full text-left px-3 py-1.5 text-xs font-mono text-status-warning hover:bg-dark-bg-secondary hover:text-status-error"
                  @click=${this.handleLogout}
                >
                  Logout
                </button>
              </div>
            `
            : ''
        }
      </div>
    `;
  }
}

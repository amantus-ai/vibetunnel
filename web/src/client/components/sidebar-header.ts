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
    const exitedSessions = this.exitedSessions;

    return html`
      <div
        class="app-header sidebar-header bg-dark-bg-secondary border-b border-dark-border p-3"
        style="padding-top: max(0.75rem, calc(0.75rem + env(safe-area-inset-top)));"
      >
        <!-- Compact vertical layout for sidebar -->
        <div class="flex flex-col gap-3">
          <!-- Title and logo -->
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

          <!-- Compact action buttons -->
          <div class="flex flex-col gap-2 items-center">
            <button
              class="btn-primary font-mono text-xs px-3 py-1.5 vt-create-button text-center max-w-[200px] w-full"
              @click=${this.handleCreateSession}
            >
              Create Session
            </button>

            <div class="flex flex-col gap-1 w-full max-w-[200px]">
              ${this.renderUtilityAndKillButtons(runningSessions)}
              ${this.renderExitedToggleButton(exitedSessions, true)}
              ${!this.hideExited && exitedSessions.length > 0
                ? html`
                    <button
                      class="btn-ghost font-mono text-xs px-3 py-1.5 w-full text-status-warning"
                      @click=${this.handleCleanExited}
                    >
                      Clean Exited (${exitedSessions.length})
                    </button>
                  `
                : ''}
            </div>
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
        title="${this.hideExited
          ? `Show ${exitedSessions.length} exited sessions`
          : `Hide ${exitedSessions.length} exited sessions`}"
      >
        <div class="flex items-center ${compact ? 'justify-between' : 'gap-2'}">
          <span>${compact ? 'Show Exited' : `Show Exited (${exitedSessions.length})`}</span>
          <div class="flex items-center gap-2">
            ${compact
              ? html`<span class="text-xs opacity-75">(${exitedSessions.length})</span>`
              : ''}
            <div
              class="w-${compact ? '8' : '6'} h-${compact
                ? '4'
                : '3'} rounded-full transition-colors duration-200 ${this.hideExited
                ? 'bg-dark-border'
                : 'bg-dark-bg'}"
            >
              <div
                class="w-${compact ? '3' : '2'} h-${compact
                  ? '3'
                  : '2'} rounded-full transition-transform duration-200 mt-0.5 ${this.hideExited
                  ? `translate-x-0.5 bg-dark-text-muted`
                  : `translate-x-${compact ? '4' : '3'} bg-dark-bg`}"
              ></div>
            </div>
          </div>
        </div>
      </button>
    `;
  }

  private renderUtilityAndKillButtons(runningSessions: Session[]) {
    return html`
      <div class="flex gap-1 w-full">
        <button
          class="btn-ghost font-mono text-xs px-3 py-1.5 flex-1"
          @click=${this.handleOpenFileBrowser}
          title="Browse files"
        >
          Browse Files
        </button>
        ${runningSessions.length > 0 && !this.killingAll
          ? html`
              <button
                class="btn-ghost font-mono text-xs px-3 py-1.5 flex-1 text-status-error"
                @click=${this.handleKillAll}
              >
                Kill (${runningSessions.length})
              </button>
            `
          : ''}
      </div>
    `;
  }
}

/**
 * Full Header Component
 *
 * Full-width header for list view with horizontal layout
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeaderBase } from './header-base.js';
import type { Session } from './session-list.js';
import './terminal-icon.js';
import './notification-status.js';

@customElement('full-header')
export class FullHeader extends HeaderBase {
  render() {
    const runningSessions = this.runningSessions;
    const exitedSessions = this.exitedSessions;

    return html`
      <div
        class="app-header bg-dark-bg-secondary border-b border-dark-border p-6"
        style="padding-top: max(1.5rem, calc(1.5rem + env(safe-area-inset-top)));"
      >
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div class="flex items-center gap-4">
            <a
              href="/"
              class="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer group"
              title="Go to home"
            >
              <terminal-icon size="32"></terminal-icon>
              <div>
                <h1 class="text-2xl font-bold text-accent-green font-mono group-hover:underline">
                  VibeTunnel
                </h1>
                <p class="text-dark-text-muted text-sm font-mono">
                  ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
                  running
                </p>
              </div>
            </a>
          </div>

          <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
            <button
              class="btn-primary font-mono text-sm px-6 py-3 vt-create-button"
              @click=${this.handleCreateSession}
            >
              Create Session
            </button>

            <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
              ${this.renderExitedToggleButton(exitedSessions)}
              ${this.renderActionButtons(exitedSessions, runningSessions)}
              ${this.renderUtilityButtons()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderExitedToggleButton(exitedSessions: Session[]) {
    if (exitedSessions.length === 0) return '';

    return html`
      <button
        class="relative font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 ${this
          .hideExited
          ? 'border-dark-border bg-dark-bg-tertiary text-dark-text hover:border-accent-green-darker'
          : 'border-accent-green bg-accent-green text-dark-bg hover:bg-accent-green-darker'}"
        @click=${this.handleHideExitedToggle}
      >
        <div class="flex items-center gap-3">
          <span>Show Exited (${exitedSessions.length})</span>
          <div
            class="w-8 h-4 rounded-full transition-colors duration-200 ${this.hideExited
              ? 'bg-dark-border'
              : 'bg-dark-bg'}"
          >
            <div
              class="w-3 h-3 rounded-full transition-transform duration-200 mt-0.5 ${this.hideExited
                ? 'translate-x-0.5 bg-dark-text-muted'
                : 'translate-x-4 bg-dark-bg'}"
            ></div>
          </div>
        </div>
      </button>
    `;
  }

  private renderActionButtons(exitedSessions: Session[], runningSessions: Session[]) {
    return html`
      ${!this.hideExited && exitedSessions.length > 0
        ? html`
            <button
              class="btn-ghost font-mono text-xs px-4 py-2 text-status-warning"
              @click=${this.handleCleanExited}
            >
              Clean Exited (${exitedSessions.length})
            </button>
          `
        : ''}
      ${runningSessions.length > 0 && !this.killingAll
        ? html`
            <button
              class="btn-ghost font-mono text-xs px-4 py-2 text-status-error"
              @click=${this.handleKillAll}
            >
              Kill All (${runningSessions.length})
            </button>
          `
        : ''}
      ${this.killingAll
        ? html`
            <div class="flex items-center gap-2 px-4 py-2">
              <div
                class="w-4 h-4 border-2 border-status-error border-t-transparent rounded-full animate-spin"
              ></div>
              <span class="text-status-error font-mono text-xs">Killing...</span>
            </div>
          `
        : ''}
    `;
  }

  private renderUtilityButtons() {
    return html`
      <button
        class="btn-ghost font-mono text-xs px-4 py-2"
        @click=${this.handleOpenFileBrowser}
        title="Browse files"
      >
        Browse Files
      </button>
      <button
        class="btn-ghost font-mono text-xs px-4 py-2"
        @click=${this.handleOpenNotificationSettings}
        title="Notification settings"
      >
        <notification-status></notification-status>
      </button>
      ${this.currentUser
        ? html`
            <button
              class="btn-ghost font-mono text-xs px-4 py-2"
              @click=${this.handleLogout}
              title="Logout ${this.currentUser}"
            >
              Logout
            </button>
          `
        : ''}
    `;
  }
}

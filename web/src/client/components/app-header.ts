/**
 * App Header Component
 *
 * Displays the VibeTunnel logo, session statistics, and control buttons.
 * Provides controls for creating sessions, toggling exited sessions visibility,
 * killing all sessions, and cleaning up exited sessions.
 *
 * @fires create-session - When create button is clicked
 * @fires hide-exited-change - When hide/show exited toggle is clicked (detail: boolean)
 * @fires kill-all-sessions - When kill all button is clicked
 * @fires clean-exited-sessions - When clean exited button is clicked
 * @fires open-file-browser - When browse button is clicked
 */
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from './session-list.js';
import './terminal-icon.js';

@customElement('app-header')
export class AppHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) hideExited = true;
  @state() private killingAll = false;

  private handleCreateSession(e: MouseEvent) {
    // Capture button position for view transition
    const button = e.currentTarget as HTMLButtonElement;
    const rect = button.getBoundingClientRect();

    // Store position in CSS custom properties for the transition
    document.documentElement.style.setProperty('--vt-button-x', `${rect.left + rect.width / 2}px`);
    document.documentElement.style.setProperty('--vt-button-y', `${rect.top + rect.height / 2}px`);
    document.documentElement.style.setProperty('--vt-button-width', `${rect.width}px`);
    document.documentElement.style.setProperty('--vt-button-height', `${rect.height}px`);

    this.dispatchEvent(new CustomEvent('create-session'));
  }

  private handleKillAll() {
    if (this.killingAll) return;

    this.killingAll = true;
    this.requestUpdate();

    this.dispatchEvent(new CustomEvent('kill-all-sessions'));

    // Reset the state after a delay to allow for the kill operations to complete
    setTimeout(() => {
      this.killingAll = false;
      this.requestUpdate();
    }, 3000); // 3 seconds should be enough for most kill operations
  }

  private handleCleanExited() {
    this.dispatchEvent(new CustomEvent('clean-exited-sessions'));
  }

  private handleOpenFileBrowser() {
    this.dispatchEvent(new CustomEvent('open-file-browser'));
  }

  render() {
    const runningSessions = this.sessions.filter((session) => session.status === 'running');
    const exitedSessions = this.sessions.filter((session) => session.status === 'exited');

    // Reset killing state if no more running sessions
    if (this.killingAll && runningSessions.length === 0) {
      this.killingAll = false;
    }

    return html`
      <div
        class="app-header bg-dark-bg-secondary border-b border-dark-border p-6"
        style="padding-top: max(env(safe-area-inset-top), 1.5rem);"
      >
        <!-- Mobile layout -->
        <div class="flex flex-col gap-4 sm:hidden">
          <!-- Centered VibeTunnel title with stats -->
          <div class="text-center flex flex-col items-center gap-2">
            <h1 class="text-2xl font-bold text-accent-green flex items-center gap-3 font-mono">
              <terminal-icon size="28"></terminal-icon>
              <span>vibetunnel</span>
            </h1>
            <p class="text-dark-text-muted text-sm font-mono">
              ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
              ${exitedSessions.length > 0 ? `• ${exitedSessions.length} exited` : ''}
            </p>
          </div>

          <!-- Controls row: left buttons and right buttons -->
          <div class="flex items-center justify-between">
            <div class="flex gap-2">
              ${exitedSessions.length > 0
                ? html`
                    <button
                      class="btn-secondary font-mono text-xs px-4 py-2 ${this.hideExited
                        ? ''
                        : 'bg-accent-green text-dark-bg hover:bg-accent-green-darker'}"
                      @click=${() =>
                        this.dispatchEvent(
                          new CustomEvent('hide-exited-change', {
                            detail: !this.hideExited,
                          })
                        )}
                    >
                      ${this.hideExited
                        ? `Show (${exitedSessions.length})`
                        : `Hide (${exitedSessions.length})`}
                    </button>
                  `
                : ''}
              ${!this.hideExited && exitedSessions.length > 0
                ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-warning"
                      @click=${this.handleCleanExited}
                    >
                      Clean Exited
                    </button>
                  `
                : ''}
              ${runningSessions.length > 0 && !this.killingAll
                ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-error"
                      @click=${this.handleKillAll}
                    >
                      Kill (${runningSessions.length})
                    </button>
                  `
                : ''}
            </div>

            <div class="flex gap-2">
              <button
                class="btn-secondary font-mono text-xs px-3 py-2"
                @click=${this.handleOpenFileBrowser}
                title="Browse Files"
              >
                Browse
              </button>
              <button
                class="btn-primary font-mono text-xs px-4 py-2 vt-create-button"
                @click=${this.handleCreateSession}
                style="view-transition-name: create-session-button"
              >
                Create
              </button>
            </div>
          </div>
        </div>

        <!-- Desktop layout: single row -->
        <div class="hidden sm:flex sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <terminal-icon size="32"></terminal-icon>
            <div>
              <h1 class="text-xl font-bold text-accent-green font-mono">vibetunnel</h1>
              <p class="text-dark-text-muted text-sm font-mono">
                ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
                ${exitedSessions.length > 0 ? `• ${exitedSessions.length} exited` : ''}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${exitedSessions.length > 0
              ? html`
                  <button
                    class="btn-secondary font-mono text-xs px-4 py-2 ${this.hideExited
                      ? ''
                      : 'bg-accent-green text-dark-bg hover:bg-accent-green-darker'}"
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent('hide-exited-change', {
                          detail: !this.hideExited,
                        })
                      )}
                  >
                    ${this.hideExited
                      ? `Show Exited (${exitedSessions.length})`
                      : `Hide Exited (${exitedSessions.length})`}
                  </button>
                `
              : ''}
            <div class="flex gap-2">
              ${!this.hideExited && this.sessions.filter((s) => s.status === 'exited').length > 0
                ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-warning"
                      @click=${this.handleCleanExited}
                    >
                      Clean Exited
                    </button>
                  `
                : ''}
              ${runningSessions.length > 0 && !this.killingAll
                ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-error"
                      @click=${this.handleKillAll}
                    >
                      Kill All (${runningSessions.length})
                    </button>
                  `
                : ''}
              <button
                class="btn-secondary font-mono text-xs px-4 py-2"
                @click=${this.handleOpenFileBrowser}
                title="Browse Files (⌘O)"
              >
                Browse
              </button>
              <button
                class="btn-primary font-mono text-xs px-4 py-2 vt-create-button"
                @click=${this.handleCreateSession}
                style="view-transition-name: create-session-button"
              >
                Create Session
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

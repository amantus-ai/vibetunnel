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
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from './session-list.js';
import './terminal-icon.js';
import './notification-status.js';

@customElement('app-header')
export class AppHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) hideExited = true;
  @property({ type: String }) currentUser: string | null = null;
  @property({ type: String }) authMethod: string | null = null;
  @state() private killingAll = false;
  @state() private showUserMenu = false;

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

  private handleLogout() {
    this.showUserMenu = false;
    this.dispatchEvent(new CustomEvent('logout'));
  }

  private toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
  }

  private handleClickOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.user-menu-container')) {
      this.showUserMenu = false;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.handleClickOutside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleClickOutside);
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
        class="app-header bg-dark-bg-secondary border-b border-dark-border px-6 py-3"
        style="padding-top: max(0.75rem, calc(0.75rem + env(safe-area-inset-top)));"
      >
        <!-- Mobile layout -->
        <div class="flex flex-col gap-4 sm:hidden">
          <!-- Centered VibeTunnel title with stats -->
          <div class="text-center flex flex-col items-center gap-2">
            <a
              href="/"
              class="text-2xl font-bold text-accent-green flex items-center gap-3 font-mono hover:opacity-80 transition-opacity cursor-pointer group"
              title="Go to home"
            >
              <terminal-icon size="28"></terminal-icon>
              <span class="group-hover:underline">VibeTunnel</span>
            </a>
            <p class="text-dark-text-muted text-sm font-mono">
              ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
              ${exitedSessions.length > 0 ? `• ${exitedSessions.length} exited` : ''}
            </p>
          </div>

          <!-- Controls row: left buttons and right buttons -->
          <div class="flex items-center justify-between">
            <div class="flex gap-2">
              ${
                exitedSessions.length > 0
                  ? html`
                    <button
                      class="btn-secondary font-mono text-xs px-4 py-2 ${
                        this.hideExited
                          ? ''
                          : 'bg-accent-green text-dark-bg hover:bg-accent-green-darker'
                      }"
                      @click=${() =>
                        this.dispatchEvent(
                          new CustomEvent('hide-exited-change', {
                            detail: !this.hideExited,
                          })
                        )}
                    >
                      ${
                        this.hideExited
                          ? `Show (${exitedSessions.length})`
                          : `Hide (${exitedSessions.length})`
                      }
                    </button>
                  `
                  : ''
              }
              ${
                !this.hideExited && exitedSessions.length > 0
                  ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-warning"
                      @click=${this.handleCleanExited}
                    >
                      Clean Exited
                    </button>
                  `
                  : ''
              }
              ${
                runningSessions.length > 0 && !this.killingAll
                  ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-error"
                      @click=${this.handleKillAll}
                    >
                      Kill (${runningSessions.length})
                    </button>
                  `
                  : ''
              }
            </div>

            <div class="flex gap-2">
              <button
                class="btn-secondary font-mono text-xs px-3 py-2"
                @click=${this.handleOpenFileBrowser}
                title="Browse Files"
              >
                <span class="flex items-center gap-1">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
                    />
                  </svg>
                  Browse
                </span>
              </button>
              <notification-status
                @open-settings=${() =>
                  this.dispatchEvent(new CustomEvent('open-notification-settings'))}
              ></notification-status>
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
          <a
            href="/"
            class="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer group"
            title="Go to home"
          >
            <terminal-icon size="32"></terminal-icon>
            <div>
              <h1 class="text-xl font-bold text-accent-green font-mono group-hover:underline">
                VibeTunnel
              </h1>
              <p class="text-dark-text-muted text-sm font-mono">
                ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
                ${exitedSessions.length > 0 ? `• ${exitedSessions.length} exited` : ''}
              </p>
            </div>
          </a>
          <div class="flex items-center gap-3">
            ${
              exitedSessions.length > 0
                ? html`
                  <button
                    class="btn-secondary font-mono text-xs px-4 py-2 ${
                      this.hideExited
                        ? ''
                        : 'bg-accent-green text-dark-bg hover:bg-accent-green-darker'
                    }"
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent('hide-exited-change', {
                          detail: !this.hideExited,
                        })
                      )}
                  >
                    ${
                      this.hideExited
                        ? `Show Exited (${exitedSessions.length})`
                        : `Hide Exited (${exitedSessions.length})`
                    }
                  </button>
                `
                : ''
            }
            <div class="flex gap-2">
              ${
                !this.hideExited && this.sessions.filter((s) => s.status === 'exited').length > 0
                  ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-warning"
                      @click=${this.handleCleanExited}
                    >
                      Clean Exited
                    </button>
                  `
                  : ''
              }
              ${
                runningSessions.length > 0 && !this.killingAll
                  ? html`
                    <button
                      class="btn-ghost font-mono text-xs text-status-error"
                      @click=${this.handleKillAll}
                    >
                      Kill All (${runningSessions.length})
                    </button>
                  `
                  : ''
              }
              <button
                class="btn-secondary font-mono text-xs px-4 py-2"
                @click=${this.handleOpenFileBrowser}
                title="Browse Files (⌘O)"
              >
                <span class="flex items-center gap-1">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
                    />
                  </svg>
                  Browse
                </span>
              </button>
              <notification-status
                @open-settings=${() =>
                  this.dispatchEvent(new CustomEvent('open-notification-settings'))}
              ></notification-status>
              <button
                class="btn-primary font-mono text-xs px-4 py-2 vt-create-button"
                @click=${this.handleCreateSession}
                style="view-transition-name: create-session-button"
              >
                Create Session
              </button>
              ${
                this.currentUser
                  ? html`
                    <div class="user-menu-container relative">
                      <button
                        class="btn-ghost font-mono text-xs text-dark-text flex items-center gap-1"
                        @click=${this.toggleUserMenu}
                        title="User menu"
                      >
                        <span>${this.currentUser}</span>
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="currentColor"
                          class="transition-transform ${this.showUserMenu ? 'rotate-180' : ''}"
                        >
                          <path d="M5 7L1 3h8z" />
                        </svg>
                      </button>
                      ${
                        this.showUserMenu
                          ? html`
                            <div
                              class="absolute right-0 top-full mt-1 bg-dark-surface border border-dark-border rounded shadow-lg py-1 z-50 min-w-32"
                            >
                              <div
                                class="px-3 py-2 text-xs text-dark-text-muted border-b border-dark-border"
                              >
                                ${this.authMethod || 'authenticated'}
                              </div>
                              <button
                                class="w-full text-left px-3 py-2 text-xs font-mono text-status-warning hover:bg-dark-bg-secondary hover:text-status-error"
                                @click=${this.handleLogout}
                              >
                                Logout
                              </button>
                            </div>
                          `
                          : ''
                      }
                    </div>
                  `
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

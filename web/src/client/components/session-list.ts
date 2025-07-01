/**
 * Session List Component
 *
 * Displays a grid of session cards and manages the session creation modal.
 * Handles session filtering (hide/show exited) and cleanup operations.
 *
 * @fires navigate-to-session - When a session is selected (detail: { sessionId: string })
 * @fires refresh - When session list needs refreshing
 * @fires error - When an error occurs (detail: string)
 * @fires session-created - When a new session is created (detail: { sessionId: string, message?: string })
 * @fires create-modal-close - When create modal should close
 * @fires hide-exited-change - When hide exited state changes (detail: boolean)
 * @fires kill-all-sessions - When all sessions should be killed
 *
 * @listens session-killed - From session-card when a session is killed
 * @listens session-kill-error - From session-card when kill fails
 * @listens clean-exited-sessions - To trigger cleanup of exited sessions
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import './session-card.js';
import { formatSessionDuration } from '../../shared/utils/time.js';
import { createLogger } from '../utils/logger.js';
import { formatPathForDisplay } from '../utils/path-utils.js';

const logger = createLogger('session-list');

// Re-export Session type for backward compatibility
export type { Session };

@customElement('session-list')
export class SessionList extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) hideExited = true;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: String }) selectedSessionId: string | null = null;
  @property({ type: Boolean }) compactMode = false;

  @state() private cleaningExited = false;
  private previousRunningCount = 0;

  private handleRefresh() {
    this.dispatchEvent(new CustomEvent('refresh'));
  }

  private handleSessionSelect(e: CustomEvent) {
    const session = e.detail as Session;

    // Dispatch a custom event that the app can handle with view transitions
    this.dispatchEvent(
      new CustomEvent('navigate-to-session', {
        detail: { sessionId: session.id },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleSessionKilled(e: CustomEvent) {
    const { sessionId } = e.detail;
    logger.debug(`session ${sessionId} killed, updating session list`);

    // Remove the session from the local state
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);

    // Then trigger a refresh to get the latest server state
    this.dispatchEvent(new CustomEvent('refresh'));
  }

  private handleSessionKillError(e: CustomEvent) {
    const { sessionId, error } = e.detail;
    logger.error(`failed to kill session ${sessionId}:`, error);

    // Dispatch error event to parent for user notification
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: `Failed to kill session: ${error}`,
      })
    );
  }

  public async handleCleanupExited() {
    if (this.cleaningExited) return;

    this.cleaningExited = true;
    this.requestUpdate();

    try {
      const response = await fetch('/api/cleanup-exited', {
        method: 'POST',
        headers: {
          ...this.authClient.getAuthHeader(),
        },
      });

      if (response.ok) {
        // Get the list of exited sessions before cleanup
        const exitedSessions = this.sessions.filter((s) => s.status === 'exited');

        // Apply black hole animation to all exited sessions
        if (exitedSessions.length > 0) {
          const sessionCards = this.querySelectorAll('session-card');
          const exitedCards: HTMLElement[] = [];

          sessionCards.forEach((card) => {
            const sessionCard = card as HTMLElement & { session?: { id: string; status: string } };
            if (sessionCard.session?.status === 'exited') {
              exitedCards.push(sessionCard);
            }
          });

          // Apply animation to all exited cards
          exitedCards.forEach((card) => {
            card.classList.add('black-hole-collapsing');
          });

          // Wait for animation to complete
          if (exitedCards.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }

          // Remove all exited sessions at once
          this.sessions = this.sessions.filter((session) => session.status !== 'exited');
        }

        this.dispatchEvent(new CustomEvent('refresh'));
      } else {
        this.dispatchEvent(
          new CustomEvent('error', { detail: 'Failed to cleanup exited sessions' })
        );
      }
    } catch (error) {
      logger.error('error cleaning up exited sessions:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: 'Failed to cleanup exited sessions' }));
    } finally {
      this.cleaningExited = false;
      this.requestUpdate();
    }
  }

  render() {
    const filteredSessions = this.hideExited
      ? this.sessions.filter((session) => session.status !== 'exited')
      : this.sessions;

    return html`
      <div class="font-mono text-sm p-4 bg-black" data-testid="session-list-container">
        ${
          filteredSessions.length === 0
            ? html`
              <div class="text-dark-text-muted text-center py-8">
                ${
                  this.loading
                    ? 'Loading sessions...'
                    : this.hideExited && this.sessions.length > 0
                      ? html`
                        <div class="space-y-4 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-dark-text">
                            No running sessions
                          </div>
                          <div class="text-sm text-dark-text-muted">
                            There are exited sessions. Show them by toggling "Hide exited" above.
                          </div>
                        </div>
                      `
                      : html`
                        <div class="space-y-6 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-dark-text">
                            No terminal sessions yet!
                          </div>

                          <div class="space-y-3">
                            <div class="text-sm text-dark-text-muted">
                              Get started by using the
                              <code class="bg-dark-bg-secondary px-2 py-1 rounded">vt</code> command
                              in your terminal:
                            </div>

                            <div
                              class="bg-dark-bg-secondary p-4 rounded-lg font-mono text-xs space-y-2"
                            >
                              <div class="text-green-400">vt pnpm run dev</div>
                              <div class="text-dark-text-muted pl-4"># Monitor your dev server</div>

                              <div class="text-green-400">vt claude --dangerously...</div>
                              <div class="text-dark-text-muted pl-4">
                                # Keep an eye on AI agents
                              </div>

                              <div class="text-green-400">vt --shell</div>
                              <div class="text-dark-text-muted pl-4">
                                # Open an interactive shell
                              </div>

                              <div class="text-green-400">vt python train.py</div>
                              <div class="text-dark-text-muted pl-4">
                                # Watch long-running scripts
                              </div>
                            </div>
                          </div>

                          <div class="space-y-3 border-t border-dark-border pt-4">
                            <div class="text-sm font-semibold text-dark-text">
                              Haven't installed the CLI yet?
                            </div>
                            <div class="text-sm text-dark-text-muted space-y-1">
                              <div>→ Click the VibeTunnel menu bar icon</div>
                              <div>→ Go to Settings → Advanced → Install CLI Tools</div>
                            </div>
                          </div>

                          <div class="text-xs text-dark-text-muted mt-4">
                            Once installed, any command prefixed with
                            <code class="bg-dark-bg-secondary px-1 rounded">vt</code> will appear
                            here, accessible from any browser at localhost:4020.
                          </div>
                        </div>
                      `
                }
              </div>
            `
            : html`
              <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'}">
                ${repeat(
                  filteredSessions,
                  (session) => session.id,
                  (session) => html`
                    ${
                      this.compactMode
                        ? html`
                          <!-- Compact list item for sidebar -->
                          <div
                            class="group flex items-center gap-3 p-3 rounded-md cursor-pointer transition-all hover:bg-dark-bg-tertiary hover:shadow-md ${
                              session.id === this.selectedSessionId
                                ? 'bg-dark-bg-tertiary border border-accent-green shadow-sm'
                                : 'border border-transparent hover:border-dark-border'
                            }"
                            @click=${() =>
                              this.handleSessionSelect({ detail: session } as CustomEvent)}
                          >
                            <!-- Activity indicator on the left -->
                            <div
                              class="w-2 h-2 rounded-full flex-shrink-0 ${
                                session.status === 'running'
                                  ? session.activityStatus?.specificStatus
                                    ? 'bg-status-warning' // Claude active - orange, no pulse
                                    : session.activityStatus?.isActive
                                      ? 'bg-status-success' // Generic active
                                      : 'bg-status-success ring-1 ring-status-success' // Idle (outline)
                                  : 'bg-status-warning'
                              }"
                              title="${
                                session.status === 'running' && session.activityStatus
                                  ? session.activityStatus.specificStatus
                                    ? `Active: ${session.activityStatus.specificStatus.app}`
                                    : session.activityStatus.isActive
                                      ? 'Active'
                                      : 'Idle'
                                  : session.status
                              }"
                            ></div>
                            
                            <!-- Divider line -->
                            <div class="w-px h-8 bg-dark-border"></div>
                            
                            <!-- Session content -->
                            <div class="flex-1 min-w-0">
                              <div
                                class="text-sm font-mono text-accent-green truncate"
                                title="${
                                  session.name ||
                                  (Array.isArray(session.command)
                                    ? session.command.join(' ')
                                    : session.command)
                                }"
                              >
                                ${
                                  session.name ||
                                  (Array.isArray(session.command)
                                    ? session.command.join(' ')
                                    : session.command)
                                }
                              </div>
                              <div class="text-xs text-dark-text-muted truncate flex items-center gap-1">
                                ${(() => {
                                  // Debug logging for activity status
                                  if (session.status === 'running' && session.activityStatus) {
                                    logger.debug(`Session ${session.id} activity:`, {
                                      isActive: session.activityStatus.isActive,
                                      specificStatus: session.activityStatus.specificStatus,
                                    });
                                  }

                                  // Show activity status inline with path
                                  if (session.activityStatus?.specificStatus) {
                                    return html`
                                      <span class="text-status-warning flex-shrink-0">
                                        ${session.activityStatus.specificStatus.status}
                                      </span>
                                      <span class="text-dark-text-muted/50">·</span>
                                      <span class="truncate">
                                        ${formatPathForDisplay(session.workingDir)}
                                      </span>
                                    `;
                                  } else {
                                    return formatPathForDisplay(session.workingDir);
                                  }
                                })()}
                              </div>
                            </div>
                            
                            <!-- Right side: duration and close button -->
                            <div class="relative flex items-center flex-shrink-0">
                              <!-- Session duration (hidden on group hover on desktop) -->
                              <div class="text-xs text-dark-text-muted font-mono transition-opacity ${
                                'ontouchstart' in window ? '' : 'group-hover:opacity-0'
                              }">
                                ${session.startedAt ? formatSessionDuration(session.startedAt) : ''}
                              </div>
                              
                              <!-- Close button (overlaps duration on hover) -->
                              ${
                                session.status === 'running' || session.status === 'exited'
                                  ? html`
                                    <button
                                      class="btn-ghost text-status-error p-1 rounded transition-opacity absolute right-0 ${
                                        'ontouchstart' in window
                                          ? 'opacity-100 static ml-2'
                                          : 'opacity-0 group-hover:opacity-100'
                                      } hover:bg-dark-bg hover:shadow-sm"
                                      @click=${async (e: Event) => {
                                        e.stopPropagation();
                                        // Kill the session
                                        try {
                                          const endpoint =
                                            session.status === 'exited'
                                              ? `/api/sessions/${session.id}/cleanup`
                                              : `/api/sessions/${session.id}`;
                                          const response = await fetch(endpoint, {
                                            method: 'DELETE',
                                            headers: this.authClient.getAuthHeader(),
                                          });
                                          if (response.ok) {
                                            this.handleSessionKilled({
                                              detail: { sessionId: session.id },
                                            } as CustomEvent);
                                          }
                                        } catch (error) {
                                          logger.error('Failed to kill session', error);
                                        }
                                      }}
                                      title="${
                                        session.status === 'running'
                                          ? 'Kill session'
                                          : 'Clean up session'
                                      }"
                                    >
                                      <svg
                                        class="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="2"
                                          d="M6 18L18 6M6 6l12 12"
                                        />
                                      </svg>
                                    </button>
                                  `
                                  : ''
                              }
                            </div>
                          </div>
                        `
                        : html`
                          <!-- Full session card for main view -->
                          <session-card
                            .session=${session}
                            .authClient=${this.authClient}
                            @session-select=${this.handleSessionSelect}
                            @session-killed=${this.handleSessionKilled}
                            @session-kill-error=${this.handleSessionKillError}
                          >
                          </session-card>
                        `
                    }
                  `
                )}
              </div>
            `
        }

        ${this.renderExitedControls()}
      </div>
    `;
  }

  private renderExitedControls() {
    const exitedSessions = this.sessions.filter((session) => session.status === 'exited');
    const runningSessions = this.sessions.filter((session) => session.status === 'running');

    // If no exited sessions and no running sessions, don't show controls
    if (exitedSessions.length === 0 && runningSessions.length === 0) return '';

    return html`
      <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-8 pb-4 px-4 w-full">
        <!-- First group: Show/Hide Exited and Clean Exited (when visible) -->
        ${
          exitedSessions.length > 0
            ? html`
              <div class="flex flex-col gap-2 w-full sm:w-auto">
                <!-- Show/Hide Exited button -->
                <button
                  class="font-mono text-xs sm:text-sm px-3 sm:px-6 py-2 rounded-lg border transition-all duration-200 flex-1 sm:flex-none sm:w-auto sm:min-w-[180px] ${
                    this.hideExited
                      ? 'border-dark-border bg-dark-bg-secondary text-dark-text-muted hover:bg-dark-bg-tertiary hover:text-dark-text'
                      : 'border-dark-border bg-dark-bg-tertiary text-dark-text hover:bg-dark-bg-secondary'
                  }"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('hide-exited-change', { detail: !this.hideExited })
                    )}
                >
                  <div class="flex items-center justify-center gap-2 sm:gap-3">
                    <span class="hidden sm:inline"
                      >${this.hideExited ? 'Show' : 'Hide'} Exited (${exitedSessions.length})</span
                    >
                    <span class="sm:hidden"
                      >${this.hideExited ? 'Show' : 'Hide'} (${exitedSessions.length})</span
                    >
                    <div
                      class="w-8 h-4 rounded-full transition-colors duration-200 ${
                        this.hideExited ? 'bg-dark-surface' : 'bg-dark-bg'
                      }"
                    >
                      <div
                        class="w-3 h-3 rounded-full transition-transform duration-200 mt-0.5 ${
                          this.hideExited
                            ? 'translate-x-0.5 bg-dark-text-muted'
                            : 'translate-x-4 bg-accent-green'
                        }"
                      ></div>
                    </div>
                  </div>
                </button>
                
                <!-- Clean Exited button (only when Show Exited is active) -->
                ${
                  !this.hideExited
                    ? html`
                      <button
                        class="font-mono text-xs sm:text-sm px-3 sm:px-6 py-2 rounded-lg border transition-all duration-200 flex-1 sm:flex-none sm:w-auto sm:min-w-[120px] border-dark-border bg-dark-bg-secondary text-status-warning hover:bg-dark-bg-tertiary hover:border-status-warning"
                        @click=${this.handleCleanupExited}
                        ?disabled=${this.cleaningExited}
                      >
                        <span class="hidden sm:inline"
                          >${
                            this.cleaningExited
                              ? 'Cleaning...'
                              : `Clean Exited (${exitedSessions.length})`
                          }</span
                        >
                        <span class="sm:hidden">${this.cleaningExited ? 'Cleaning...' : 'Clean'}</span>
                      </button>
                    `
                    : ''
                }
              </div>
            `
            : ''
        }
        
        <!-- Kill All button -->
        ${
          runningSessions.length > 0
            ? html`
              <button
                class="font-mono text-xs sm:text-sm px-3 sm:px-6 py-2 rounded-lg border transition-all duration-200 w-full sm:w-auto sm:min-w-[120px] border-status-error bg-dark-bg-secondary text-status-error hover:bg-dark-bg-tertiary hover:border-status-error"
                @click=${() => this.dispatchEvent(new CustomEvent('kill-all-sessions'))}
              >
                Kill All (${runningSessions.length})
              </button>
            `
            : ''
        }
      </div>
    `;
  }
}

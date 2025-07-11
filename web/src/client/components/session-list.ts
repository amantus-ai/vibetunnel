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
import './inline-edit.js';
import { formatSessionDuration } from '../../shared/utils/time.js';
import { sendAIPrompt } from '../utils/ai-sessions.js';
import { Z_INDEX } from '../utils/constants.js';
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

  private async handleRename(sessionId: string, newName: string) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to rename session', { errorData, sessionId });
        throw new Error(`Rename failed: ${response.status}`);
      }

      // Update the local session object
      const sessionIndex = this.sessions.findIndex((s) => s.id === sessionId);
      if (sessionIndex >= 0) {
        this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], name: newName };
        this.requestUpdate();
      }

      logger.debug(`Session ${sessionId} renamed to: ${newName}`);
    } catch (error) {
      logger.error('Error renaming session', { error, sessionId });

      // Show error to user
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to rename session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      );
    }
  }

  private handleSessionRenamed = (e: CustomEvent) => {
    const { sessionId, newName } = e.detail;
    // Update the local session object
    const sessionIndex = this.sessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex >= 0) {
      this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], name: newName };
      this.requestUpdate();
    }
  };

  private handleSessionRenameError = (e: CustomEvent) => {
    const { sessionId, error } = e.detail;
    logger.error(`failed to rename session ${sessionId}:`, error);

    // Dispatch error event to parent for user notification
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: `Failed to rename session: ${error}`,
      })
    );
  };

  private async handleDeleteSession(sessionId: string) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          ...this.authClient.getAuthHeader(),
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to delete session', { errorData, sessionId });
        throw new Error(`Delete failed: ${response.status}`);
      }

      // Session killed successfully - update local state and trigger refresh
      this.handleSessionKilled({ detail: { sessionId } } as CustomEvent);
    } catch (error) {
      logger.error('Error deleting session', { error, sessionId });
      this.handleSessionKillError({
        detail: {
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      } as CustomEvent);
    }
  }

  private async handleSendAIPrompt(sessionId: string) {
    try {
      await sendAIPrompt(sessionId, this.authClient);
    } catch (error) {
      logger.error('Failed to send AI prompt', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to send AI prompt: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      );
    }
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
    // Group sessions by status
    const runningSessions = this.sessions.filter((session) => session.status === 'running');
    const exitedSessions = this.sessions.filter((session) => session.status === 'exited');

    const hasRunningSessions = runningSessions.length > 0;
    const hasExitedSessions = exitedSessions.length > 0;
    const showExitedSection = !this.hideExited && hasExitedSessions;

    return html`
      <div class="font-mono text-sm" data-testid="session-list-container">
        <div class="p-4 pt-5">
        ${
          !hasRunningSessions && (!hasExitedSessions || this.hideExited)
            ? html`
              <div class="text-text-muted text-center py-8">
                ${
                  this.loading
                    ? 'Loading sessions...'
                    : this.hideExited && this.sessions.length > 0
                      ? html`
                        <div class="space-y-4 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-text">
                            No running sessions
                          </div>
                          <div class="text-sm text-text-muted">
                            There are exited sessions. Show them by toggling "Hide exited" above.
                          </div>
                        </div>
                      `
                      : html`
                        <div class="space-y-6 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-text">
                            No terminal sessions yet!
                          </div>

                          <div class="space-y-3">
                            <div class="text-sm text-text-muted">
                              Get started by using the
                              <code class="bg-bg-secondary px-2 py-1 rounded">vt</code> command
                              in your terminal:
                            </div>

                            <div
                              class="bg-bg-secondary p-4 rounded-lg font-mono text-xs space-y-2"
                            >
                              <div class="text-status-success">vt pnpm run dev</div>
                              <div class="text-text-muted pl-4"># Monitor your dev server</div>

                              <div class="text-status-success">vt claude --dangerously...</div>
                              <div class="text-text-muted pl-4">
                                # Keep an eye on AI agents
                              </div>

                              <div class="text-status-success">vt --shell</div>
                              <div class="text-text-muted pl-4">
                                # Open an interactive shell
                              </div>

                              <div class="text-status-success">vt python train.py</div>
                              <div class="text-text-muted pl-4">
                                # Watch long-running scripts
                              </div>
                            </div>
                          </div>

                          <div class="space-y-3 border-t border-border pt-4">
                            <div class="text-sm font-semibold text-text">
                              Haven't installed the CLI yet?
                            </div>
                            <div class="text-sm text-text-muted space-y-1">
                              <div>→ Click the VibeTunnel menu bar icon</div>
                              <div>→ Go to Settings → Advanced → Install CLI Tools</div>
                            </div>
                          </div>

                          <div class="text-xs text-text-muted mt-4">
                            Once installed, any command prefixed with
                            <code class="bg-bg-secondary px-1 rounded">vt</code> will appear
                            here, accessible from any browser at localhost:4020.
                          </div>
                        </div>
                      `
                }
              </div>
            `
            : html`
              <!-- Active Sessions -->
              ${
                hasRunningSessions
                  ? html`
                    <div class="mb-6">
                      <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                        Active <span class="text-text-dim">(${runningSessions.length})</span>
                      </h3>
                      <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'} relative">
                        ${repeat(
                          runningSessions,
                          (session) => session.id,
                          (session) => html`
                    ${
                      this.compactMode
                        ? html`
                          <!-- Enhanced compact list item for sidebar -->
                          <div
                            class="group flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                              session.id === this.selectedSessionId
                                ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
                                : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card'
                            }"
                            @click=${() =>
                              this.handleSessionSelect({ detail: session } as CustomEvent)}
                          >
                            <!-- Enhanced activity indicator with pulse animation -->
                            <div class="relative flex-shrink-0">
                              <div
                                class="w-2.5 h-2.5 rounded-full ${
                                  session.status === 'running'
                                    ? session.activityStatus?.specificStatus
                                      ? 'bg-status-warning animate-pulse-primary' // Claude active - amber with pulse
                                      : session.activityStatus?.isActive
                                        ? 'bg-status-success' // Generic active
                                        : 'bg-status-success ring-1 ring-status-success ring-opacity-50' // Idle (subtle outline)
                                    : 'bg-status-error'
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
                              <!-- Pulse ring for active sessions -->
                              ${
                                session.status === 'running' && session.activityStatus?.isActive
                                  ? html`<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-success opacity-30 animate-ping"></div>`
                                  : ''
                              }
                            </div>
                            
                            <!-- Elegant divider line -->
                            <div class="w-px h-8 bg-gradient-to-b from-transparent via-border to-transparent"></div>
                            
                            <!-- Session content -->
                            <div class="flex-1 min-w-0">
                              <div
                                class="text-sm font-mono truncate ${
                                  session.id === this.selectedSessionId
                                    ? 'text-accent-primary font-medium'
                                    : 'text-text group-hover:text-accent-primary transition-colors'
                                }"
                              >
                                <inline-edit
                                  .value=${
                                    session.name ||
                                    (Array.isArray(session.command)
                                      ? session.command.join(' ')
                                      : session.command)
                                  }
                                  .placeholder=${
                                    Array.isArray(session.command)
                                      ? session.command.join(' ')
                                      : session.command
                                  }
                                  .onSave=${(newName: string) => this.handleRename(session.id, newName)}
                                ></inline-edit>
                              </div>
                              <div class="text-xs text-text-muted truncate flex items-center gap-1">
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
                                      <span class="text-text-muted/50">·</span>
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
                            <div class="relative flex items-center flex-shrink-0 gap-1">
                              ${
                                'ontouchstart' in window
                                  ? html`
                                    <!-- Touch devices: Close button left of time -->
                                    ${
                                      session.status === 'running' || session.status === 'exited'
                                        ? html`
                                          <button
                                            class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                            @click=${async (e: Event) => {
                                              e.stopPropagation();
                                              // Kill the session
                                              try {
                                                await this.handleDeleteSession(session.id);
                                              } catch (error) {
                                                logger.error('Failed to kill session', error);
                                              }
                                            }}
                                            title="Kill Session"
                                          >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                            </svg>
                                          </button>
                                        `
                                        : ''
                                    }
                                    <div class="text-xs text-text-muted font-mono">
                                      ${session.startedAt ? formatSessionDuration(session.startedAt) : ''}
                                    </div>
                                  `
                                  : html`
                                    <!-- Desktop: Time that hides on hover -->
                                    <div class="text-xs text-text-muted font-mono transition-opacity group-hover:opacity-0">
                                      ${session.startedAt ? formatSessionDuration(session.startedAt) : ''}
                                    </div>
                                    
                                    <!-- Desktop: Buttons show on hover -->
                                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0">
                                      <!-- Close button -->
                                      ${
                                        session.status === 'running' || session.status === 'exited'
                                          ? html`
                                            <button
                                              class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                              @click=${async (e: Event) => {
                                                e.stopPropagation();
                                                // Kill the session
                                                try {
                                                  await this.handleDeleteSession(session.id);
                                                } catch (error) {
                                                  logger.error('Failed to kill session', error);
                                                }
                                              }}
                                              title="Kill Session"
                                            >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                              </svg>
                                            </button>
                                          `
                                          : ''
                                      }
                                    </div>
                                  `
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
                            @session-renamed=${this.handleSessionRenamed}
                            @session-rename-error=${this.handleSessionRenameError}
                          >
                          </session-card>
                        `
                    }
                  `
                        )}
                      </div>
                    </div>
                  `
                  : ''
              }
              
              <!-- Idle/Exited Sessions -->
              ${
                showExitedSection
                  ? html`
                    <div>
                      <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                        Idle <span class="text-text-dim">(${exitedSessions.length})</span>
                      </h3>
                      <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'} relative">
                        ${repeat(
                          exitedSessions,
                          (session) => session.id,
                          (session) => html`
                            ${
                              this.compactMode
                                ? html`
                                  <!-- Enhanced compact list item for sidebar -->
                                  <div
                                    class="group flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                                      session.id === this.selectedSessionId
                                        ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
                                        : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card opacity-75'
                                    }"
                                    @click=${() =>
                                      this.handleSessionSelect({ detail: session } as CustomEvent)}
                                  >
                                    <!-- Status indicator -->
                                    <div class="relative flex-shrink-0">
                                      <div class="w-2.5 h-2.5 rounded-full bg-status-warning"></div>
                                    </div>
                                    
                                    <!-- Elegant divider line -->
                                    <div class="w-px h-8 bg-gradient-to-b from-transparent via-border to-transparent"></div>
                                    
                                    <!-- Session content -->
                                    <div class="flex-1 min-w-0">
                                      <div
                                        class="text-sm font-mono truncate ${
                                          session.id === this.selectedSessionId
                                            ? 'text-accent-primary font-medium'
                                            : 'text-text-muted group-hover:text-text transition-colors'
                                        }"
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
                                      <div class="text-xs text-text-dim truncate">
                                        ${formatPathForDisplay(session.workingDir)}
                                      </div>
                                    </div>
                                    
                                    <!-- Right side: duration and close button -->
                                    <div class="relative flex items-center flex-shrink-0 gap-1">
                                      <!-- Session duration -->
                                      <div class="text-xs text-text-dim font-mono">
                                        ${session.startedAt ? formatSessionDuration(session.startedAt) : ''}
                                      </div>
                                      
                                      <!-- Clean up button -->
                                      <button
                                        class="btn-ghost text-text-muted p-1.5 rounded-md transition-all flex-shrink-0 hover:text-status-warning hover:bg-bg-elevated hover:shadow-sm"
                                        @click=${async (e: Event) => {
                                          e.stopPropagation();
                                          try {
                                            const response = await fetch(
                                              `/api/sessions/${session.id}/cleanup`,
                                              {
                                                method: 'DELETE',
                                                headers: this.authClient.getAuthHeader(),
                                              }
                                            );
                                            if (response.ok) {
                                              this.handleSessionKilled({
                                                detail: { sessionId: session.id },
                                              } as CustomEvent);
                                            }
                                          } catch (error) {
                                            logger.error('Failed to clean up session', error);
                                          }
                                        }}
                                        title="Clean up session"
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
                                    @session-renamed=${this.handleSessionRenamed}
                                    @session-rename-error=${this.handleSessionRenameError}
                                  >
                                  </session-card>
                                `
                            }
                          `
                        )}
                      </div>
                    </div>
                  `
                  : ''
              }
            `
        }
        </div>

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
      <div class="sticky bottom-0 border-t border-border bg-bg-secondary p-3 flex flex-wrap gap-2 shadow-lg" style="z-index: ${Z_INDEX.SESSION_LIST_BOTTOM_BAR};">
        <!-- Control buttons with consistent styling -->
        ${
          exitedSessions.length > 0
            ? html`
                <!-- Show/Hide Exited button -->
                <button
                  class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 ${
                    this.hideExited
                      ? 'border-border bg-bg-elevated text-text-muted hover:bg-surface-hover hover:text-accent-primary hover:border-accent-primary hover:shadow-sm active:scale-95'
                      : 'border-accent-primary bg-accent-primary bg-opacity-10 text-accent-primary hover:bg-opacity-20 hover:shadow-glow-primary-sm active:scale-95'
                  }"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('hide-exited-change', { detail: !this.hideExited })
                    )}
                  data-testid="${this.hideExited ? 'show-exited-button' : 'hide-exited-button'}"
                >
                  ${this.hideExited ? 'Show' : 'Hide'} Exited
                  <span class="text-text-dim">(${exitedSessions.length})</span>
                </button>
                
                <!-- Clean Exited button (only when Show Exited is active) -->
                ${
                  !this.hideExited
                    ? html`
                      <button
                        class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 border-status-warning bg-status-warning bg-opacity-10 text-status-warning hover:bg-opacity-20 hover:shadow-glow-warning-sm active:scale-95 disabled:opacity-50"
                        @click=${this.handleCleanupExited}
                        ?disabled=${this.cleaningExited}
                        data-testid="clean-exited-button"
                      >
                        ${this.cleaningExited ? 'Cleaning...' : 'Clean Exited'}
                      </button>
                    `
                    : ''
                }
            `
            : ''
        }
        
        <!-- Kill All button -->
        ${
          runningSessions.length > 0
            ? html`
              <button
                class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 border-status-error bg-status-error bg-opacity-10 text-status-error hover:bg-opacity-20 hover:shadow-glow-error-sm active:scale-95"
                @click=${() => this.dispatchEvent(new CustomEvent('kill-all-sessions'))}
                data-testid="kill-all-button"
              >
                Kill All <span class="text-text-dim">(${runningSessions.length})</span>
              </button>
            `
            : ''
        }
      </div>
    `;
  }
}

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
import './session-create-form.js';
import './session-card.js';
import { createLogger } from '../utils/logger.js';

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
  @property({ type: Boolean }) showCreateModal = false;
  @property({ type: Object }) authClient!: AuthClient;

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
      <div class="font-mono text-sm p-4 bg-black">
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
              <div class="session-flex-responsive">
                ${repeat(
                  filteredSessions,
                  (session) => session.id,
                  (session) => html`
                    <session-card
                      .session=${session}
                      .authClient=${this.authClient}
                      @session-select=${this.handleSessionSelect}
                      @session-killed=${this.handleSessionKilled}
                      @session-kill-error=${this.handleSessionKillError}
                    >
                    </session-card>
                  `
                )}
              </div>
            `
        }

        <session-create-form
          .visible=${this.showCreateModal}
          .authClient=${this.authClient}
          @session-created=${(e: CustomEvent) =>
            this.dispatchEvent(new CustomEvent('session-created', { detail: e.detail }))}
          @cancel=${() => this.dispatchEvent(new CustomEvent('create-modal-close'))}
          @error=${(e: CustomEvent) =>
            this.dispatchEvent(new CustomEvent('error', { detail: e.detail }))}
        ></session-create-form>
      </div>
    `;
  }
}

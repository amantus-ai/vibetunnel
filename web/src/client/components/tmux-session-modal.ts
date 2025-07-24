import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { TmuxSession, TmuxTarget, TmuxWindow } from '../../shared/tmux-types.js';
import { apiClient } from '../services/api-client.js';
import { Z_INDEX } from '../utils/constants.js';
import './modal-wrapper.js';

@customElement('tmux-session-modal')
export class TmuxSessionModal extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: ${Z_INDEX.MODAL};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    .content {
      width: 100%;
      max-width: 600px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }

    h2 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .status-message {
      margin-bottom: 1rem;
      padding: 0.75rem;
      background: var(--bg-tertiary);
      border-radius: 0.5rem;
      color: var(--text-secondary);
      text-align: center;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      margin: 0 -1rem;
      padding: 0 1rem;
    }

    .session-item {
      margin-bottom: 0.5rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .session-item:hover {
      border-color: var(--primary);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .session-header {
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background-color 0.2s ease;
    }

    .session-header:hover {
      background: var(--bg-tertiary);
    }

    .session-info {
      flex: 1;
    }

    .session-name {
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }

    .session-meta {
      font-size: 0.875rem;
      color: var(--text-secondary);
      display: flex;
      gap: 1rem;
    }

    .session-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-tertiary);
    }

    .status-indicator.attached {
      background: var(--success);
    }

    .status-indicator.current {
      background: var(--primary);
    }

    .windows-list {
      padding: 0.5rem 1rem 0.75rem 2rem;
      background: var(--bg-primary);
      border-top: 1px solid var(--border);
    }

    .window-item {
      padding: 0.5rem;
      margin-bottom: 0.25rem;
      border-radius: 0.25rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background-color 0.2s ease;
    }

    .window-item:hover {
      background: var(--bg-secondary);
    }

    .window-item.active {
      background: var(--bg-tertiary);
      font-weight: 500;
    }

    .window-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .window-index {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .panes-count {
      font-size: 0.75rem;
      color: var(--text-tertiary);
    }

    .actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .action-button {
      padding: 0.5rem 1rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-button:hover {
      background: var(--bg-tertiary);
      border-color: var(--primary);
    }

    .action-button.primary {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }

    .action-button.primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }

    .expand-icon {
      transition: transform 0.2s ease;
    }

    .expanded .expand-icon {
      transform: rotate(90deg);
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-secondary);
    }

    .empty-state h3 {
      margin: 0 0 0.5rem 0;
      color: var(--text-primary);
    }

    .create-button {
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .create-button:hover {
      background: var(--primary-hover);
    }
  `;

  @property({ type: Boolean })
  open = false;

  @state()
  private sessions: TmuxSession[] = [];

  @state()
  private windows: Map<string, TmuxWindow[]> = new Map();

  @state()
  private expandedSessions: Set<string> = new Set();

  @state()
  private loading = true;

  @state()
  private tmuxAvailable = true;

  @state()
  private error: string | null = null;

  async connectedCallback() {
    super.connectedCallback();
    if (this.open) {
      await this.loadSessions();
    }
  }

  protected updated(changedProps: PropertyValues) {
    if (changedProps.has('open') && this.open) {
      this.loadSessions();
    }
  }

  private async loadSessions() {
    this.loading = true;
    this.error = null;

    try {
      // Check if tmux is available
      const availableResponse = await apiClient.get('/tmux/available');
      this.tmuxAvailable = availableResponse.available;

      if (!this.tmuxAvailable) {
        this.loading = false;
        return;
      }

      // Load sessions
      const sessionsResponse = await apiClient.get('/tmux/sessions');
      this.sessions = sessionsResponse.sessions;

      // Load windows for each session
      this.windows.clear();
      for (const session of this.sessions) {
        try {
          const windowsResponse = await apiClient.get(`/tmux/sessions/${session.name}/windows`);
          this.windows.set(session.name, windowsResponse.windows);
        } catch (error) {
          console.error(`Failed to load windows for session ${session.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to load tmux sessions:', error);
      this.error = 'Failed to load tmux sessions';
    } finally {
      this.loading = false;
    }
  }

  private toggleSession(sessionName: string) {
    if (this.expandedSessions.has(sessionName)) {
      this.expandedSessions.delete(sessionName);
    } else {
      this.expandedSessions.add(sessionName);
    }
    this.requestUpdate();
  }

  private async attachToSession(target: TmuxTarget) {
    try {
      const response = await apiClient.post('/tmux/attach', {
        sessionName: target.session,
        windowIndex: target.window,
        paneIndex: target.pane,
        cols: 80, // TODO: Get actual terminal dimensions
        rows: 24,
        titleMode: 'dynamic',
        metadata: {
          source: 'tmux-modal',
        },
      });

      if (response.success) {
        // Close modal and navigate to the new session
        this.handleClose();
        // Dispatch navigation event that the app can handle
        this.dispatchEvent(
          new CustomEvent('navigate-to-session', {
            detail: { sessionId: response.sessionId },
            bubbles: true,
            composed: true,
          })
        );
      }
    } catch (error) {
      console.error('Failed to attach to tmux session:', error);
      this.error = 'Failed to attach to tmux session';
    }
  }

  private async createNewSession() {
    // Close the modal and dispatch create-session event
    this.handleClose();
    this.dispatchEvent(
      new CustomEvent('create-session', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    if (!this.open) return null;

    return html`
      <modal-wrapper .open=${this.open} @close=${this.handleClose}>
        <div class="content">
          <h2>tmux Sessions</h2>

          ${
            this.loading
              ? html`<div class="status-message">Loading tmux sessions...</div>`
              : !this.tmuxAvailable
                ? html`
                <div class="empty-state">
                  <h3>tmux Not Available</h3>
                  <p>tmux is not installed or not available on this system.</p>
                  <p>Install tmux to use this feature.</p>
                </div>
              `
                : this.error
                  ? html`<div class="status-message">${this.error}</div>`
                  : this.sessions.length === 0
                    ? html`
                <div class="empty-state">
                  <h3>No tmux Sessions</h3>
                  <p>There are no active tmux sessions.</p>
                  <button class="create-button" @click=${this.createNewSession}>
                    Create New Session
                  </button>
                </div>
              `
                    : html`
                <div class="session-list">
                  ${repeat(
                    this.sessions,
                    (session) => session.name,
                    (session) => {
                      const sessionWindows = this.windows.get(session.name) || [];
                      const isExpanded = this.expandedSessions.has(session.name);

                      return html`
                        <div class="session-item ${isExpanded ? 'expanded' : ''}">
                          <div
                            class="session-header"
                            @click=${() => this.toggleSession(session.name)}
                          >
                            <div class="session-info">
                              <div class="session-name">${session.name}</div>
                              <div class="session-meta">
                                <span>${session.windows} window${session.windows !== 1 ? 's' : ''}</span>
                                ${
                                  session.activity
                                    ? html`<span>Last activity: ${session.activity}</span>`
                                    : null
                                }
                              </div>
                            </div>
                            <div class="session-status">
                              ${
                                session.attached
                                  ? html`<div class="status-indicator attached" title="Attached"></div>`
                                  : null
                              }
                              ${
                                session.current
                                  ? html`<div class="status-indicator current" title="Current"></div>`
                                  : null
                              }
                              <span class="expand-icon">▶</span>
                            </div>
                          </div>

                          ${
                            isExpanded && sessionWindows.length > 0
                              ? html`
                                <div class="windows-list">
                                  ${repeat(
                                    sessionWindows,
                                    (window) => `${session.name}-${window.index}`,
                                    (window) => html`
                                      <div
                                        class="window-item ${window.active ? 'active' : ''}"
                                        @click=${() =>
                                          this.attachToSession({
                                            session: session.name,
                                            window: window.index,
                                          })}
                                      >
                                        <div class="window-info">
                                          <span class="window-index">${window.index}:</span>
                                          <span>${window.name}</span>
                                        </div>
                                        <span class="panes-count">
                                          ${window.panes} pane${window.panes !== 1 ? 's' : ''}
                                        </span>
                                      </div>
                                    `
                                  )}
                                </div>
                              `
                              : null
                          }
                        </div>
                      `;
                    }
                  )}
                </div>
              `
          }

          <div class="actions">
            <button class="action-button" @click=${this.handleClose}>Cancel</button>
            ${
              !this.loading && this.tmuxAvailable
                ? html`
                  <button class="action-button primary" @click=${this.createNewSession}>
                    New Session
                  </button>
                `
                : null
            }
          </div>
        </div>
      </modal-wrapper>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tmux-session-modal': TmuxSessionModal;
  }
}

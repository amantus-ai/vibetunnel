import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type {
  MultiplexerStatus,
  MultiplexerTarget,
  MultiplexerType,
  TmuxPane,
  TmuxWindow,
} from '../../shared/multiplexer-types.js';
import { apiClient } from '../services/api-client.js';
import { Z_INDEX } from '../utils/constants.js';
import './modal-wrapper.js';

@customElement('multiplexer-modal')
export class MultiplexerModal extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: ${Z_INDEX.MODAL};
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    :host([open]) {
      display: flex;
    }

    .content {
      width: 100%;
      max-width: 600px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: rgb(var(--color-bg-secondary));
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.75rem;
      padding: 1.5rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    }

    h2 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: rgb(var(--color-text));
    }

    .multiplexer-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid rgb(var(--color-border));
    }

    .tab {
      padding: 0.5rem 1rem;
      border: none;
      background: none;
      color: rgb(var(--color-text-muted));
      cursor: pointer;
      position: relative;
      transition: color 0.2s ease;
    }

    .tab:hover {
      color: rgb(var(--color-text));
    }

    .tab.active {
      color: #10B981;
    }

    .tab.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #10B981;
    }

    .tab-count {
      margin-left: 0.5rem;
      font-size: 0.75rem;
      padding: 0.125rem 0.375rem;
      background: rgb(var(--color-bg-tertiary));
      border-radius: 9999px;
    }

    .status-message {
      margin-bottom: 1rem;
      padding: 0.75rem;
      background: rgb(var(--color-bg-tertiary));
      border-radius: 0.5rem;
      color: rgb(var(--color-text-muted));
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
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.5rem;
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .session-item:hover {
      border-color: #10B981;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .session-header {
      padding: 0.75rem 1rem;
      background: rgb(var(--color-bg-secondary));
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background-color 0.2s ease;
      position: relative;
    }

    .session-header:hover {
      background: rgb(var(--color-bg-tertiary));
    }

    .session-info {
      flex: 1;
    }

    .session-name {
      font-weight: 600;
      color: rgb(var(--color-text));
      margin-bottom: 0.25rem;
    }

    .session-meta {
      font-size: 0.875rem;
      color: rgb(var(--color-text-muted));
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
      background: rgb(var(--color-text-dim));
    }

    .status-indicator.attached {
      background: #10B981;
    }

    .status-indicator.current {
      background: #10B981;
    }

    .exited-badge {
      background: #EF4444;
      color: white;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.625rem;
      font-weight: 600;
    }

    .windows-list {
      padding: 0.5rem 1rem 0.75rem 2rem;
      background: rgb(var(--color-bg));
      border-top: 1px solid rgb(var(--color-border));
    }

    .attach-button {
      padding: 0.5rem 1rem;
      background: rgb(var(--color-accent-green));
      color: rgb(var(--color-bg));
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      transition: background-color 0.2s;
    }

    .attach-button:hover {
      background: rgb(var(--color-accent-green) / 0.8);
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
      background: rgb(var(--color-bg-secondary));
    }

    .window-item.active {
      background: rgb(var(--color-bg-tertiary));
      font-weight: 500;
    }

    .window-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .window-index {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.875rem;
      color: rgb(var(--color-text-muted));
    }

    .panes-count {
      font-size: 0.75rem;
      color: rgb(var(--color-text-dim));
    }

    .panes-list {
      padding: 0.25rem 0.5rem 0.5rem 1.5rem;
      background: rgb(var(--color-bg));
      border-top: 1px solid rgb(var(--color-border));
    }

    .pane-item {
      padding: 0.375rem 0.5rem;
      margin-bottom: 0.125rem;
      border-radius: 0.25rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.875rem;
      transition: background-color 0.2s ease;
    }

    .pane-item:hover {
      background: rgb(var(--color-bg-secondary));
    }

    .pane-item.active {
      background: rgb(var(--color-bg-tertiary));
      font-weight: 500;
    }

    .pane-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .pane-index {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.75rem;
      color: rgb(var(--color-text-muted));
    }

    .pane-command {
      color: rgb(var(--color-text));
    }

    .pane-size {
      font-size: 0.75rem;
      color: rgb(var(--color-text-dim));
    }

    .actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .action-button {
      padding: 0.5rem 1rem;
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.375rem;
      background: rgb(var(--color-bg-secondary));
      color: rgb(var(--color-text));
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-button:hover {
      background: rgb(var(--color-bg-tertiary));
      border-color: #10B981;
    }

    .action-button.primary {
      background: #10B981;
      color: white;
      border-color: #10B981;
    }

    .action-button.primary:hover {
      background: #059669;
      border-color: #059669;
    }

    .expand-icon {
      transition: transform 0.2s ease;
    }

    .expanded .expand-icon {
      transform: rotate(90deg);
    }

    .attach-button {
      padding: 0.25rem 0.75rem;
      margin-right: 0.5rem;
      background: #10B981;
      color: white;
      border: none;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .attach-button:hover {
      background: #059669;
    }

    .attach-button:active {
      transform: scale(0.95);
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: rgb(var(--color-text-muted));
    }

    .empty-state h3 {
      margin: 0 0 0.5rem 0;
      color: rgb(var(--color-text));
    }

    .create-button {
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: #10B981;
      color: white;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .create-button:hover {
      background: #059669;
    }
  `;

  @property({ type: Boolean, reflect: true })
  open = false;

  @state()
  private activeTab: MultiplexerType = 'tmux';

  @state()
  private multiplexerStatus: MultiplexerStatus | null = null;

  @state()
  private windows: Map<string, TmuxWindow[]> = new Map();

  @state()
  private panes: Map<string, TmuxPane[]> = new Map();

  @state()
  private expandedSessions: Set<string> = new Set();

  @state()
  private expandedWindows: Set<string> = new Set();

  @state()
  private loading = true;

  @state()
  private error: string | null = null;

  async connectedCallback() {
    super.connectedCallback();
    if (this.open) {
      await this.loadMultiplexerStatus();
    }
  }

  protected updated(changedProps: PropertyValues) {
    if (changedProps.has('open') && this.open) {
      this.loadMultiplexerStatus();
    }
  }

  private async loadMultiplexerStatus() {
    this.loading = true;
    this.error = null;

    try {
      // Get status of all multiplexers
      const statusResponse = await apiClient.get<MultiplexerStatus>('/multiplexer/status');
      this.multiplexerStatus = statusResponse;

      // Set active tab to first available multiplexer
      if (!statusResponse.tmux.available && statusResponse.zellij.available) {
        this.activeTab = 'zellij';
      }

      // Load windows for tmux sessions
      this.windows.clear();
      if (statusResponse.tmux.available) {
        for (const session of statusResponse.tmux.sessions) {
          try {
            const windowsResponse = await apiClient.get(
              `/multiplexer/tmux/sessions/${session.name}/windows`
            );
            this.windows.set(session.name, windowsResponse.windows);
          } catch (error) {
            console.error(`Failed to load windows for tmux session ${session.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load multiplexer status:', error);
      this.error = 'Failed to load terminal sessions';
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

  private toggleWindow(sessionName: string, windowIndex: number) {
    const key = `${sessionName}:${windowIndex}`;
    if (this.expandedWindows.has(key)) {
      this.expandedWindows.delete(key);
    } else {
      this.expandedWindows.add(key);
      // Load panes for this window if not already loaded
      this.loadPanesForWindow(sessionName, windowIndex);
    }
    this.requestUpdate();
  }

  private async loadPanesForWindow(sessionName: string, windowIndex: number) {
    const key = `${sessionName}:${windowIndex}`;
    if (this.panes.has(key)) return; // Already loaded

    try {
      const response = await apiClient.get(
        `/multiplexer/tmux/sessions/${sessionName}/panes?window=${windowIndex}`
      );
      console.log(`Loaded panes for ${key}:`, response.panes);
      this.panes.set(key, response.panes);
      this.requestUpdate();
    } catch (error) {
      console.error(`Failed to load panes for window ${key}:`, error);
    }
  }

  private formatTimestamp(timestamp: string): string {
    const ts = Number.parseInt(timestamp, 10);
    if (Number.isNaN(ts)) return timestamp;

    const now = Math.floor(Date.now() / 1000);
    const diff = now - ts;

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  private formatPaneInfo(pane: TmuxPane): string {
    console.log('formatPaneInfo called with:', pane);

    // If we have a meaningful title that's not just the hostname, use it
    if (pane.title && !pane.title.includes('< /dev/null') && !pane.title.match(/^[\w.-]+$/)) {
      return pane.title;
    }

    // If we have a current path, show it with the command
    if (pane.currentPath && pane.command) {
      // Simple home directory replacement for display
      const shortPath = pane.currentPath.replace(/^\/Users\/[^/]+/, '~');
      return `${pane.command} (${shortPath})`;
    }

    // Otherwise just show command or 'shell'
    return pane.command || 'shell';
  }

  private async attachToSession(target: MultiplexerTarget) {
    try {
      const response = await apiClient.post('/multiplexer/attach', {
        type: target.type,
        sessionName: target.session,
        windowIndex: target.window,
        paneIndex: target.pane,
        cols: 80, // TODO: Get actual terminal dimensions
        rows: 24,
        titleMode: 'dynamic',
        metadata: {
          source: 'multiplexer-modal',
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
      console.error(`Failed to attach to ${target.type} session:`, error);
      this.error = `Failed to attach to ${target.type} session`;
    }
  }

  private async createNewSession() {
    try {
      // Generate a unique session name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const sessionName = `session-${timestamp}`;

      if (this.activeTab === 'tmux') {
        // For tmux, create the session first
        const createResponse = await apiClient.post('/multiplexer/sessions', {
          type: this.activeTab,
          name: sessionName,
        });

        if (!createResponse.success) {
          throw new Error('Failed to create tmux session');
        }
      }

      // For both tmux and zellij, attach to the session
      // Zellij will create the session automatically with the -c flag
      const attachResponse = await apiClient.post('/multiplexer/attach', {
        type: this.activeTab,
        sessionName: sessionName,
        cols: 80, // TODO: Get actual terminal dimensions
        rows: 24,
        titleMode: 'dynamic',
        metadata: {
          source: 'multiplexer-modal-new',
        },
      });

      if (attachResponse.success) {
        // Close modal and navigate to the new session
        this.handleClose();
        this.dispatchEvent(
          new CustomEvent('navigate-to-session', {
            detail: { sessionId: attachResponse.sessionId },
            bubbles: true,
            composed: true,
          })
        );
      }
    } catch (error) {
      console.error(`Failed to create new ${this.activeTab} session:`, error);
      this.error = `Failed to create new ${this.activeTab} session`;
    }
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private switchTab(type: MultiplexerType) {
    this.activeTab = type;
  }

  render() {
    if (!this.open) return null;

    const status = this.multiplexerStatus;
    const activeMultiplexer = status ? status[this.activeTab] : null;

    return html`
      <modal-wrapper .open=${this.open} @close=${this.handleClose}>
        <div class="content">
          <h2>Terminal Sessions</h2>

          ${
            status && (status.tmux.available || status.zellij.available)
              ? html`
              <div class="multiplexer-tabs">
                ${
                  status.tmux.available
                    ? html`
                    <button
                      class="tab ${this.activeTab === 'tmux' ? 'active' : ''}"
                      @click=${() => this.switchTab('tmux')}
                    >
                      tmux
                      <span class="tab-count">${status.tmux.sessions.length}</span>
                    </button>
                  `
                    : null
                }
                ${
                  status.zellij.available
                    ? html`
                    <button
                      class="tab ${this.activeTab === 'zellij' ? 'active' : ''}"
                      @click=${() => this.switchTab('zellij')}
                    >
                      Zellij
                      <span class="tab-count">${status.zellij.sessions.length}</span>
                    </button>
                  `
                    : null
                }
              </div>
            `
              : null
          }

          ${
            this.loading
              ? html`<div class="status-message">Loading terminal sessions...</div>`
              : !status
                ? html`<div class="status-message">No multiplexer status available</div>`
                : !status.tmux.available && !status.zellij.available
                  ? html`
                    <div class="empty-state">
                      <h3>No Terminal Multiplexer Available</h3>
                      <p>Neither tmux nor Zellij is installed on this system.</p>
                      <p>Install tmux or Zellij to use this feature.</p>
                    </div>
                  `
                  : !activeMultiplexer?.available
                    ? html`
                      <div class="empty-state">
                        <h3>${this.activeTab} Not Available</h3>
                        <p>${this.activeTab} is not installed or not available on this system.</p>
                        <p>Install ${this.activeTab} to use this feature.</p>
                      </div>
                    `
                    : this.error
                      ? html`<div class="status-message">${this.error}</div>`
                      : activeMultiplexer.sessions.length === 0
                        ? html`
                          <div class="empty-state">
                            <h3>No ${this.activeTab} Sessions</h3>
                            <p>There are no active ${this.activeTab} sessions.</p>
                            <button class="create-button" @click=${this.createNewSession}>
                              Create New Session
                            </button>
                          </div>
                        `
                        : html`
                          <div class="session-list">
                            ${repeat(
                              activeMultiplexer.sessions,
                              (session) => `${session.type}-${session.name}`,
                              (session) => {
                                const sessionWindows = this.windows.get(session.name) || [];
                                const isExpanded = this.expandedSessions.has(session.name);

                                return html`
                        <div class="session-item ${session.type === 'tmux' && isExpanded ? 'expanded' : ''}">
                          <div
                            class="session-header"
                            @click=${() => session.type === 'tmux' ? this.toggleSession(session.name) : null}
                            style="cursor: ${session.type === 'tmux' ? 'pointer' : 'default'}"
                          >
                            <div class="session-info">
                              <div class="session-name">${session.name}</div>
                              <div class="session-meta">
                                ${
                                  session.windows !== undefined
                                    ? html`<span>${session.windows} window${session.windows !== 1 ? 's' : ''}</span>`
                                    : null
                                }
                                ${
                                  session.exited
                                    ? html`<span class="exited-badge">EXITED</span>`
                                    : null
                                }
                                ${
                                  session.activity
                                    ? html`<span>Last activity: ${this.formatTimestamp(session.activity)}</span>`
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
                              ${
                                session.type === 'tmux'
                                  ? html`
                                    <button
                                      class="attach-button"
                                      @click=${(e: Event) => {
                                        e.stopPropagation();
                                        this.attachToSession({
                                          type: session.type,
                                          session: session.name,
                                        });
                                      }}
                                    >
                                      Attach
                                    </button>
                                    <span class="expand-icon">▶</span>
                                  `
                                  : html`
                                    <button
                                      class="attach-button"
                                      @click=${(e: Event) => {
                                        e.stopPropagation();
                                        this.attachToSession({
                                          type: session.type,
                                          session: session.name,
                                        });
                                      }}
                                    >
                                      Attach to Session
                                    </button>
                                  `
                              }
                            </div>
                          </div>

                          ${
                            session.type === 'tmux' && isExpanded && sessionWindows.length > 0
                              ? html`
                                <div class="windows-list">
                                  ${repeat(
                                    sessionWindows,
                                    (window) => `${session.name}-${window.index}`,
                                    (window) => {
                                      const windowKey = `${session.name}:${window.index}`;
                                      const isWindowExpanded = this.expandedWindows.has(windowKey);
                                      const windowPanes = this.panes.get(windowKey) || [];

                                      return html`
                                        <div>
                                          <div
                                            class="window-item ${window.active ? 'active' : ''}"
                                            @click=${(e: Event) => {
                                              e.stopPropagation();
                                              if (window.panes > 1) {
                                                this.toggleWindow(session.name, window.index);
                                              } else {
                                                this.attachToSession({
                                                  type: session.type,
                                                  session: session.name,
                                                  window: window.index,
                                                });
                                              }
                                            }}
                                          >
                                            <div class="window-info">
                                              <span class="window-index">${window.index}:</span>
                                              <span>${window.name}</span>
                                            </div>
                                            <span class="panes-count">
                                              ${window.panes} pane${window.panes !== 1 ? 's' : ''}
                                              ${window.panes > 1 ? html`<span class="expand-icon" style="margin-left: 0.5rem;">${isWindowExpanded ? '▼' : '▶'}</span>` : ''}
                                            </span>
                                          </div>
                                          
                                          ${
                                            isWindowExpanded && windowPanes.length > 0
                                              ? html`
                                                <div class="panes-list">
                                                  ${repeat(
                                                    windowPanes,
                                                    (pane) =>
                                                      `${session.name}:${window.index}.${pane.index}`,
                                                    (pane) => html`
                                                      <div
                                                        class="pane-item ${pane.active ? 'active' : ''}"
                                                        @click=${(e: Event) => {
                                                          e.stopPropagation();
                                                          this.attachToSession({
                                                            type: session.type,
                                                            session: session.name,
                                                            window: window.index,
                                                            pane: pane.index,
                                                          });
                                                        }}
                                                      >
                                                        <div class="pane-info">
                                                          <span class="pane-index">%${pane.index}</span>
                                                          <span class="pane-command">${this.formatPaneInfo(pane)}</span>
                                                        </div>
                                                        <span class="pane-size">${pane.width}×${pane.height}</span>
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
              !this.loading && activeMultiplexer?.available
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
    'multiplexer-modal': MultiplexerModal;
  }
}

import type { PropertyValues } from 'lit';
import { html, LitElement } from 'lit';
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
import './modal-wrapper.js';

@customElement('multiplexer-modal')
export class MultiplexerModal extends LitElement {
  // Disable shadow DOM to use Tailwind classes
  createRenderRoot() {
    return this;
  }

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
      if (!statusResponse.tmux.available) {
        if (statusResponse.zellij.available) {
          this.activeTab = 'zellij';
        } else if (statusResponse.screen.available) {
          this.activeTab = 'screen';
        }
      }

      // Load windows for tmux sessions
      this.windows.clear();
      if (statusResponse.tmux.available) {
        for (const session of statusResponse.tmux.sessions) {
          try {
            const windowsResponse = await apiClient.get<{ windows: TmuxWindow[] }>(
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
      const response = await apiClient.get<{ panes: TmuxPane[] }>(
        `/multiplexer/tmux/sessions/${sessionName}/panes?window=${windowIndex}`
      );
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
      const response = await apiClient.post<{
        success: boolean;
        sessionId?: string;
        command?: string;
      }>('/multiplexer/attach', {
        type: target.type,
        sessionName: target.session,
        windowIndex: target.window,
        paneIndex: target.pane,
        cols: window.innerWidth > 768 ? 120 : 80,
        rows: window.innerHeight > 600 ? 30 : 24,
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

      if (this.activeTab === 'tmux' || this.activeTab === 'screen') {
        // For tmux and screen, create the session first
        const createResponse = await apiClient.post<{ success: boolean }>('/multiplexer/sessions', {
          type: this.activeTab,
          name: sessionName,
        });

        if (!createResponse.success) {
          throw new Error(`Failed to create ${this.activeTab} session`);
        }
      }

      // For all multiplexers, attach to the session
      // Zellij will create the session automatically with the -c flag
      const attachResponse = await apiClient.post<{
        success: boolean;
        sessionId?: string;
        command?: string;
      }>('/multiplexer/attach', {
        type: this.activeTab,
        sessionName: sessionName,
        cols: window.innerWidth > 768 ? 120 : 80,
        rows: window.innerHeight > 600 ? 30 : 24,
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

  private async killSession(type: MultiplexerType, sessionName: string) {
    if (
      !confirm(
        `Are you sure you want to kill session "${sessionName}"? This will terminate all windows and panes.`
      )
    ) {
      return;
    }

    try {
      const response = await apiClient.delete<{ success: boolean }>(
        `/multiplexer/${type}/sessions/${sessionName}`
      );
      if (response.success) {
        await this.loadMultiplexerStatus();
      }
    } catch (error) {
      console.error(`Failed to kill ${type} session:`, error);
      this.error = `Failed to kill ${type} session`;
    }
  }

  private async killWindow(sessionName: string, windowIndex: number) {
    if (
      !confirm(
        `Are you sure you want to kill window ${windowIndex}? This will terminate all panes in this window.`
      )
    ) {
      return;
    }

    try {
      const response = await apiClient.delete<{ success: boolean }>(
        `/multiplexer/tmux/sessions/${sessionName}/windows/${windowIndex}`
      );
      if (response.success) {
        await this.loadMultiplexerStatus();
      }
    } catch (error) {
      console.error(`Failed to kill window:`, error);
      this.error = `Failed to kill window`;
    }
  }

  private async killPane(sessionName: string, paneId: string) {
    if (!confirm(`Are you sure you want to kill this pane?`)) {
      return;
    }

    try {
      const response = await apiClient.delete<{ success: boolean }>(
        `/multiplexer/tmux/sessions/${sessionName}/panes/${paneId}`
      );
      if (response.success) {
        // Reload panes for the affected window
        this.panes.clear();
        this.expandedWindows.forEach((key) => {
          const [session, windowStr] = key.split(':');
          if (session === sessionName) {
            this.loadPanesForWindow(session, Number.parseInt(windowStr, 10));
          }
        });
      }
    } catch (error) {
      console.error(`Failed to kill pane:`, error);
      this.error = `Failed to kill pane`;
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
      <div class="fixed inset-0 z-50 ${this.open ? 'flex' : 'hidden'} items-center justify-center p-4">
        <modal-wrapper .open=${this.open} @close=${this.handleClose}>
          <div class="w-full max-w-2xl max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-xl p-6 shadow-xl">
            <h2 class="m-0 mb-4 text-xl font-semibold text-text">Terminal Sessions</h2>

            ${
              status &&
              (status.tmux.available || status.zellij.available || status.screen.available)
                ? html`
                <div class="flex gap-2 mb-4 border-b border-border">
                  ${
                    status.tmux.available
                      ? html`
                      <button
                        class="px-4 py-2 border-none bg-transparent text-text-muted cursor-pointer relative transition-colors hover:text-text ${this.activeTab === 'tmux' ? 'text-primary' : ''}"
                        @click=${() => this.switchTab('tmux')}
                      >
                        tmux
                        <span class="ml-2 text-xs px-1.5 py-0.5 bg-bg-tertiary rounded-full">${status.tmux.sessions.length}</span>
                        ${this.activeTab === 'tmux' ? html`<div class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-primary"></div>` : ''}
                      </button>
                    `
                      : null
                  }
                  ${
                    status.zellij.available
                      ? html`
                      <button
                        class="px-4 py-2 border-none bg-transparent text-text-muted cursor-pointer relative transition-colors hover:text-text ${this.activeTab === 'zellij' ? 'text-primary' : ''}"
                        @click=${() => this.switchTab('zellij')}
                      >
                        Zellij
                        <span class="ml-2 text-xs px-1.5 py-0.5 bg-bg-tertiary rounded-full">${status.zellij.sessions.length}</span>
                        ${this.activeTab === 'zellij' ? html`<div class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-primary"></div>` : ''}
                      </button>
                    `
                      : null
                  }
                  ${
                    status.screen.available
                      ? html`
                      <button
                        class="px-4 py-2 border-none bg-transparent text-text-muted cursor-pointer relative transition-colors hover:text-text ${this.activeTab === 'screen' ? 'text-primary' : ''}"
                        @click=${() => this.switchTab('screen')}
                      >
                        Screen
                        <span class="ml-2 text-xs px-1.5 py-0.5 bg-bg-tertiary rounded-full">${status.screen.sessions.length}</span>
                        ${this.activeTab === 'screen' ? html`<div class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-primary"></div>` : ''}
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
                ? html`<div class="mb-4 p-3 bg-bg-tertiary rounded-lg text-text-muted text-center">Loading terminal sessions...</div>`
                : !status
                  ? html`<div class="mb-4 p-3 bg-bg-tertiary rounded-lg text-text-muted text-center">No multiplexer status available</div>`
                  : !status.tmux.available && !status.zellij.available && !status.screen.available
                    ? html`
                      <div class="text-center py-12 text-text-muted">
                        <h3 class="m-0 mb-2 text-text">No Terminal Multiplexer Available</h3>
                        <p>No terminal multiplexer (tmux, Zellij, or Screen) is installed on this system.</p>
                        <p>Install tmux, Zellij, or GNU Screen to use this feature.</p>
                      </div>
                    `
                    : !activeMultiplexer?.available
                      ? html`
                        <div class="text-center py-12 text-text-muted">
                          <h3 class="m-0 mb-2 text-text">${this.activeTab} Not Available</h3>
                          <p>${this.activeTab} is not installed or not available on this system.</p>
                          <p>Install ${this.activeTab} to use this feature.</p>
                        </div>
                      `
                      : this.error
                        ? html`<div class="mb-4 p-3 bg-bg-tertiary rounded-lg text-text-muted text-center">${this.error}</div>`
                        : activeMultiplexer.sessions.length === 0
                          ? html`
                            <div class="text-center py-12 text-text-muted">
                              <h3 class="m-0 mb-2 text-text">No ${this.activeTab} Sessions</h3>
                              <p>There are no active ${this.activeTab} sessions.</p>
                              <button class="mt-4 px-6 py-3 bg-primary text-white border-none rounded-md text-sm cursor-pointer transition-colors hover:bg-primary-hover" @click=${this.createNewSession}>
                                Create New Session
                              </button>
                            </div>
                          `
                          : html`
                            <div class="flex-1 overflow-y-auto -mx-4 px-4">
                              ${repeat(
                                activeMultiplexer.sessions,
                                (session) => `${session.type}-${session.name}`,
                                (session) => {
                                  const sessionWindows = this.windows.get(session.name) || [];
                                  const isExpanded = this.expandedSessions.has(session.name);

                                  return html`
                          <div class="mb-2 border border-border rounded-lg overflow-hidden transition-all hover:border-primary hover:shadow-md">
                            <div
                              class="px-4 py-3 bg-bg-secondary cursor-pointer flex items-center justify-between transition-colors hover:bg-bg-tertiary"
                              @click=${() =>
                                session.type === 'tmux' ? this.toggleSession(session.name) : null}
                              style="cursor: ${session.type === 'tmux' ? 'pointer' : 'default'}"
                            >
                              <div class="flex-1">
                                <div class="font-semibold text-text mb-1">${session.name}</div>
                                <div class="text-sm text-text-muted flex gap-4">
                                  ${
                                    session.windows !== undefined
                                      ? html`<span>${session.windows} window${session.windows !== 1 ? 's' : ''}</span>`
                                      : null
                                  }
                                  ${
                                    session.exited
                                      ? html`<span class="bg-red-500 text-white px-1.5 py-0.5 rounded text-xs font-semibold">EXITED</span>`
                                      : null
                                  }
                                  ${
                                    session.activity
                                      ? html`<span>Last activity: ${this.formatTimestamp(session.activity)}</span>`
                                      : null
                                  }
                                </div>
                              </div>
                              <div class="flex items-center gap-2">
                                ${
                                  session.attached
                                    ? html`<div class="w-2 h-2 rounded-full bg-primary" title="Attached"></div>`
                                    : null
                                }
                                ${
                                  session.current
                                    ? html`<div class="w-2 h-2 rounded-full bg-primary" title="Current"></div>`
                                    : null
                                }
                                <button
                                  class="px-3 py-1.5 bg-primary text-white border-none rounded text-xs font-medium cursor-pointer transition-colors hover:bg-primary-hover active:scale-95"
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
                                <button
                                  class="px-3 py-1.5 bg-red-500 text-white border-none rounded text-xs font-medium cursor-pointer transition-colors hover:bg-red-600 active:scale-95"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this.killSession(session.type, session.name);
                                  }}
                                  title="Kill session"
                                >
                                  Kill
                                </button>
                                ${
                                  session.type === 'tmux'
                                    ? html`<span class="transition-transform ${isExpanded ? 'rotate-90' : ''}">▶</span>`
                                    : null
                                }
                              </div>
                            </div>

                            ${
                              session.type === 'tmux' && isExpanded && sessionWindows.length > 0
                                ? html`
                                  <div class="px-2 py-2 pl-8 bg-bg border-t border-border">
                                    ${repeat(
                                      sessionWindows,
                                      (window) => `${session.name}-${window.index}`,
                                      (window) => {
                                        const windowKey = `${session.name}:${window.index}`;
                                        const isWindowExpanded =
                                          this.expandedWindows.has(windowKey);
                                        const windowPanes = this.panes.get(windowKey) || [];

                                        return html`
                                          <div>
                                            <div
                                              class="p-2 mb-1 rounded cursor-pointer flex items-center justify-between transition-colors hover:bg-bg-secondary ${window.active ? 'bg-bg-tertiary font-medium' : ''}"
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
                                              <div class="flex items-center gap-2">
                                                <span class="font-mono text-sm text-text-muted">${window.index}:</span>
                                                <span>${window.name}</span>
                                              </div>
                                              <div class="flex items-center gap-2">
                                                <button
                                                  class="px-2 py-0.5 bg-red-500 text-white border-none rounded text-xs font-medium cursor-pointer transition-colors hover:bg-red-600 active:scale-95"
                                                  @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.killWindow(session.name, window.index);
                                                  }}
                                                  title="Kill window"
                                                >
                                                  Kill
                                                </button>
                                                <span class="text-xs text-text-dim">
                                                  ${window.panes} pane${window.panes !== 1 ? 's' : ''}
                                                  ${window.panes > 1 ? html`<span class="ml-2 transition-transform ${isWindowExpanded ? 'rotate-90' : ''}">▶</span>` : ''}
                                                </span>
                                              </div>
                                            </div>
                                            
                                            ${
                                              isWindowExpanded && windowPanes.length > 0
                                                ? html`
                                                  <div class="px-1 py-1 pl-6 bg-bg border-t border-border">
                                                    ${repeat(
                                                      windowPanes,
                                                      (pane) =>
                                                        `${session.name}:${window.index}.${pane.index}`,
                                                      (pane) => html`
                                                        <div
                                                          class="px-2 py-1.5 mb-0.5 rounded cursor-pointer flex items-center justify-between text-sm transition-colors hover:bg-bg-secondary ${pane.active ? 'bg-bg-tertiary font-medium' : ''}"
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
                                                          <div class="flex items-center gap-2">
                                                            <span class="font-mono text-xs text-text-muted">%${pane.index}</span>
                                                            <span class="text-text">${this.formatPaneInfo(pane)}</span>
                                                          </div>
                                                          <div class="flex items-center gap-2">
                                                            <button
                                                              class="px-2 py-0.5 bg-red-500 text-white border-none rounded text-xs font-medium cursor-pointer transition-colors hover:bg-red-600 active:scale-95"
                                                              @click=${(e: Event) => {
                                                                e.stopPropagation();
                                                                this.killPane(
                                                                  session.name,
                                                                  `${session.name}:${window.index}.${pane.index}`
                                                                );
                                                              }}
                                                              title="Kill pane"
                                                            >
                                                              Kill
                                                            </button>
                                                            <span class="text-xs text-text-dim">${pane.width}×${pane.height}</span>
                                                          </div>
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

            <div class="mt-4 flex gap-2 justify-end">
              <button class="px-4 py-2 border border-border rounded-md bg-bg-secondary text-text text-sm cursor-pointer transition-all hover:bg-bg-tertiary hover:border-primary" @click=${this.handleClose}>Cancel</button>
              ${
                !this.loading && activeMultiplexer?.available
                  ? html`
                    <button class="px-4 py-2 bg-primary text-white border border-primary rounded-md text-sm cursor-pointer transition-colors hover:bg-primary-hover" @click=${this.createNewSession}>
                      New Session
                    </button>
                  `
                  : null
              }
            </div>
          </div>
        </modal-wrapper>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'multiplexer-modal': MultiplexerModal;
  }
}

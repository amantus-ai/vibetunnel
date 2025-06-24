import { LitElement, html, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AuthClient } from '../services/auth-client.js';

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  isClient: boolean;
}

@customElement('log-viewer')
export class LogViewer extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private logs: LogEntry[] = [];
  @state() private loading = true;
  @state() private error = '';
  @state() private filter = '';
  @state() private levelFilter: Set<string> = new Set(['error', 'warn', 'log', 'debug']);
  @state() private autoScroll = true;
  @state() private logSize = '';
  @state() private showClient = true;
  @state() private showServer = true;

  private refreshInterval?: number;
  private isFirstLoad = true;
  private authClient = new AuthClient();

  override connectedCallback(): void {
    super.connectedCallback();
    this.loadLogs();
    // Refresh logs every 2 seconds
    this.refreshInterval = window.setInterval(() => this.loadLogs(), 2000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private async loadLogs(): Promise<void> {
    try {
      // Get log info
      const infoResponse = await fetch('/api/logs/info', {
        headers: { ...this.authClient.getAuthHeader() },
      });
      if (infoResponse.ok) {
        const info = await infoResponse.json();
        this.logSize = info.sizeHuman || '';
      }

      // Get raw logs
      const response = await fetch('/api/logs/raw', {
        headers: { ...this.authClient.getAuthHeader() },
      });
      if (!response.ok) {
        throw new Error('Failed to load logs');
      }

      const text = await response.text();
      this.parseLogs(text);
      this.loading = false;

      // Auto-scroll to bottom if enabled and user is near bottom (or first load)
      if (this.autoScroll) {
        requestAnimationFrame(() => {
          const container = this.querySelector('.log-container');
          if (container) {
            if (this.isFirstLoad) {
              // Always scroll to bottom on first load
              container.scrollTop = container.scrollHeight;
              this.isFirstLoad = false;
            } else {
              // Only scroll if we're within 100px of the bottom
              const isNearBottom =
                container.scrollHeight - container.scrollTop - container.clientHeight < 100;
              if (isNearBottom) {
                container.scrollTop = container.scrollHeight;
              }
            }
          }
        });
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load logs';
      this.loading = false;
    }
  }

  private formatRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) {
      return `${diffSec}s ago`;
    } else if (diffMin < 60) {
      return `${diffMin}m ago`;
    } else if (diffHour < 24) {
      return `${diffHour}h ago`;
    } else {
      // For older logs, show HH:MM:SS
      return date.toLocaleTimeString('en-US', { hour12: false });
    }
  }

  private parseLogs(text: string): void {
    const lines = text.split('\n');
    const logs: LogEntry[] = [];
    let currentLog: LogEntry | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      // Try to parse as a new log entry
      const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+(.*)$/);
      if (match) {
        // If we have a current log, push it before starting a new one
        if (currentLog) {
          logs.push(currentLog);
        }

        const [, timestamp, level, module, message] = match;
        const isClient = module.startsWith('CLIENT:');
        currentLog = {
          timestamp,
          level: level.trim().toLowerCase(),
          module: isClient ? module.substring(7) : module, // Remove CLIENT: prefix
          message,
          isClient,
        };
      } else if (currentLog) {
        // This is a continuation line - append to the current log's message
        currentLog.message += '\n' + line;
      } else {
        // Unparseable line with no current log - create a new entry
        logs.push({
          timestamp: '',
          level: 'log',
          module: 'unknown',
          message: line,
          isClient: false,
        });
      }
    }

    // Don't forget the last log
    if (currentLog) {
      logs.push(currentLog);
    }

    this.logs = logs;
  }

  private toggleLevel(level: string): void {
    if (this.levelFilter.has(level)) {
      this.levelFilter.delete(level);
    } else {
      this.levelFilter.add(level);
    }
    this.levelFilter = new Set(this.levelFilter); // Trigger re-render
  }

  private async clearLogs(): Promise<void> {
    if (!confirm('Are you sure you want to clear all logs?')) {
      return;
    }

    try {
      const response = await fetch('/api/logs/clear', {
        method: 'DELETE',
        headers: { ...this.authClient.getAuthHeader() },
      });
      if (!response.ok) {
        throw new Error('Failed to clear logs');
      }
      this.logs = [];
      this.logSize = '0 Bytes';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to clear logs';
    }
  }

  private async downloadLogs(): Promise<void> {
    try {
      const response = await fetch('/api/logs/raw', {
        headers: { ...this.authClient.getAuthHeader() },
      });
      if (!response.ok) {
        throw new Error('Failed to download logs');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibetunnel-logs-${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to download logs';
    }
  }

  private get filteredLogs(): LogEntry[] {
    return this.logs.filter((log) => {
      // Filter by level
      if (!this.levelFilter.has(log.level)) {
        return false;
      }

      // Filter by client/server
      if (!this.showClient && log.isClient) {
        return false;
      }
      if (!this.showServer && !log.isClient) {
        return false;
      }

      // Filter by search term
      if (this.filter) {
        const searchTerm = this.filter.toLowerCase();
        return (
          log.module.toLowerCase().includes(searchTerm) ||
          log.message.toLowerCase().includes(searchTerm)
        );
      }

      return true;
    });
  }

  override render(): TemplateResult {
    // Add custom scrollbar styles
    const scrollbarStyles = html`
      <style>
        .log-container {
          /* Hide scrollbar by default */
          scrollbar-width: none; /* Firefox */
        }

        .log-container::-webkit-scrollbar {
          width: 8px;
          background: transparent;
        }

        .log-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .log-container::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 4px;
        }

        /* Show scrollbar on hover */
        .log-container:hover::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }

        .log-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        /* Firefox */
        .log-container:hover {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
      </style>
    `;

    if (this.loading) {
      return html`
        <div class="flex items-center justify-center h-screen bg-dark-bg text-dark-text">
          <div class="text-center">
            <div
              class="animate-spin rounded-full h-12 w-12 border-4 border-accent-green border-t-transparent mb-4"
            ></div>
            <div>Loading logs...</div>
          </div>
        </div>
      `;
    }

    const levels = ['error', 'warn', 'log', 'debug'];

    return html`
      ${scrollbarStyles}
      <div class="flex flex-col h-full bg-dark-bg text-dark-text font-mono">
        <!-- Header -->
        <div class="flex items-center gap-3 p-4 bg-dark-bg-secondary border-b border-dark-border">
          <!-- Back button -->
          <button
            class="px-3 py-1.5 bg-dark-bg border border-dark-border rounded text-sm text-dark-text hover:border-accent-green hover:text-accent-green transition-colors flex items-center gap-2 flex-shrink-0"
            @click=${() => (window.location.href = '/')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>

          <h1 class="text-lg font-bold text-accent-green flex items-center gap-2 flex-shrink-0">
            <terminal-icon size="24"></terminal-icon>
            <span>System Logs</span>
          </h1>

          <div class="flex-1 flex flex-wrap gap-2 items-center justify-end">
            <!-- Search input -->
            <input
              type="text"
              class="px-3 py-1.5 bg-dark-bg border border-dark-border rounded text-sm text-dark-text placeholder-dark-text-muted focus:outline-none focus:border-accent-green transition-colors flex-1 sm:flex-initial sm:w-64 md:w-80"
              placeholder="Filter logs..."
              .value=${this.filter}
              @input=${(e: Event) => {
                this.filter = (e.target as HTMLInputElement).value;
              }}
            />

            <!-- Level filters -->
            <div class="flex gap-1">
              ${levels.map(
                (level) => html`
                  <button
                    class="px-2 py-1 text-xs uppercase font-bold rounded transition-colors ${this.levelFilter.has(
                      level
                    )
                      ? level === 'error'
                        ? 'bg-status-error text-dark-bg'
                        : level === 'warn'
                          ? 'bg-status-warning text-dark-bg'
                          : level === 'debug'
                            ? 'bg-dark-text-muted text-dark-bg'
                            : 'bg-dark-text text-dark-bg'
                      : 'bg-dark-bg-tertiary text-dark-text-muted border border-dark-border'}"
                    @click=${() => this.toggleLevel(level)}
                  >
                    ${level}
                  </button>
                `
              )}
            </div>

            <!-- Client/Server toggles -->
            <div class="flex gap-1">
              <button
                class="px-2 py-1 text-xs uppercase font-bold rounded transition-colors ${this
                  .showClient
                  ? 'bg-orange-500 text-dark-bg'
                  : 'bg-dark-bg-tertiary text-dark-text-muted border border-dark-border'}"
                @click=${() => {
                  this.showClient = !this.showClient;
                }}
              >
                CLIENT
              </button>
              <button
                class="px-2 py-1 text-xs uppercase font-bold rounded transition-colors ${this
                  .showServer
                  ? 'bg-accent-green text-dark-bg'
                  : 'bg-dark-bg-tertiary text-dark-text-muted border border-dark-border'}"
                @click=${() => {
                  this.showServer = !this.showServer;
                }}
              >
                SERVER
              </button>
            </div>

            <!-- Auto-scroll toggle -->
            <button
              class="px-3 py-1 text-xs uppercase font-bold rounded transition-colors ${this
                .autoScroll
                ? 'bg-accent-green text-dark-bg'
                : 'bg-dark-bg-tertiary text-dark-text-muted border border-dark-border'}"
              @click=${() => {
                this.autoScroll = !this.autoScroll;
              }}
            >
              AUTO SCROLL
            </button>
          </div>
        </div>

        <!-- Log container -->
        <div
          class="log-container flex-1 overflow-y-auto p-4 bg-dark-bg font-mono text-xs leading-relaxed"
        >
          ${this.filteredLogs.length === 0
            ? html`
                <div class="flex items-center justify-center h-full text-dark-text-muted">
                  <div class="text-center">
                    <div>No logs to display</div>
                  </div>
                </div>
              `
            : this.filteredLogs.map((log) => {
                const isMultiline = log.message.includes('\n');
                const messageLines = log.message.split('\n');

                return html`
                  <div
                    class="group hover:bg-dark-bg-secondary/50 transition-colors rounded ${log.isClient
                      ? 'bg-orange-500/5 pl-2'
                      : 'pl-2'}"
                  >
                    <!-- Desktop layout (hidden on mobile) -->
                    <div class="hidden sm:flex items-start gap-2 py-0.5">
                      <!-- Timestamp -->
                      <span class="text-dark-text-muted w-16 flex-shrink-0 opacity-50"
                        >${this.formatRelativeTime(log.timestamp)}</span
                      >

                      <!-- Level -->
                      <span
                        class="w-10 text-center font-mono uppercase tracking-wider flex-shrink-0 ${log.level ===
                        'error'
                          ? 'text-red-500 bg-red-500/20 px-1 rounded font-bold'
                          : log.level === 'warn'
                            ? 'text-yellow-500 bg-yellow-500/20 px-1 rounded font-bold'
                            : log.level === 'debug'
                              ? 'text-gray-600'
                              : 'text-gray-500'}"
                        >${log.level === 'error'
                          ? 'ERR'
                          : log.level === 'warn'
                            ? 'WRN'
                            : log.level === 'debug'
                              ? 'DBG'
                              : 'LOG'}</span
                      >

                      <!-- Source indicator -->
                      <span
                        class="flex-shrink-0 ${log.isClient
                          ? 'text-orange-400 font-bold'
                          : 'text-green-600'}"
                        >${log.isClient ? '◆ C' : '▸ S'}</span
                      >

                      <!-- Module -->
                      <span class="text-gray-600 flex-shrink-0 font-mono">${log.module}</span>

                      <!-- Separator -->
                      <span class="text-gray-700 flex-shrink-0">│</span>

                      <!-- Message -->
                      <span
                        class="flex-1 ${log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                            ? 'text-yellow-400'
                            : log.level === 'debug'
                              ? 'text-gray-600'
                              : log.isClient
                                ? 'text-orange-200'
                                : 'text-gray-300'}"
                        >${messageLines[0]}</span
                      >
                    </div>

                    <!-- Mobile layout (visible only on mobile) -->
                    <div class="sm:hidden py-1">
                      <div class="flex items-center gap-2 text-xs">
                        <span class="text-dark-text-muted opacity-50"
                          >${this.formatRelativeTime(log.timestamp)}</span
                        >
                        <span
                          class="${log.level === 'error'
                            ? 'text-red-500 font-bold'
                            : log.level === 'warn'
                              ? 'text-yellow-500 font-bold'
                              : log.level === 'debug'
                                ? 'text-gray-600'
                                : 'text-gray-500'} uppercase"
                          >${log.level}</span
                        >
                        <span class="${log.isClient ? 'text-orange-400' : 'text-green-600'}"
                          >${log.isClient ? '[C]' : '[S]'}</span
                        >
                        <span class="text-gray-600">${log.module}</span>
                      </div>
                      <div
                        class="mt-1 ${log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                            ? 'text-yellow-400'
                            : log.level === 'debug'
                              ? 'text-gray-600'
                              : log.isClient
                                ? 'text-orange-200'
                                : 'text-gray-300'}"
                      >
                        ${messageLines[0]}
                      </div>
                    </div>
                    ${isMultiline
                      ? html`
                          <div
                            class="hidden sm:block ml-36 ${log.level === 'error'
                              ? 'text-red-400'
                              : log.level === 'warn'
                                ? 'text-yellow-400'
                                : 'text-gray-500'}"
                          >
                            ${messageLines
                              .slice(1)
                              .map((line) => html`<div class="py-0.5">${line}</div>`)}
                          </div>
                          <div
                            class="sm:hidden mt-1 ${log.level === 'error'
                              ? 'text-red-400'
                              : log.level === 'warn'
                                ? 'text-yellow-400'
                                : 'text-gray-500'}"
                          >
                            ${messageLines
                              .slice(1)
                              .map((line) => html`<div class="py-0.5">${line}</div>`)}
                          </div>
                        `
                      : ''}
                  </div>
                `;
              })}
        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-between p-3 bg-dark-bg-secondary border-t border-dark-border text-xs"
        >
          <div class="text-dark-text-muted">
            ${this.filteredLogs.length} / ${this.logs.length} logs
            ${this.logSize
              ? html` <span class="text-dark-text-muted">• ${this.logSize}</span>`
              : ''}
          </div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1 bg-dark-bg border border-dark-border rounded hover:border-accent-green hover:text-accent-green transition-colors"
              @click=${this.downloadLogs}
            >
              Download
            </button>
            <button
              class="px-3 py-1 bg-dark-bg border border-status-error text-status-error rounded hover:bg-status-error hover:text-dark-bg transition-colors"
              @click=${this.clearLogs}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

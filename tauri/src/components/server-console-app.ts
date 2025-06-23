import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import { sharedStyles, buttonStyles, formStyles } from './shared/styles';
import './shared/vt-button';
import './shared/vt-loading';

interface ServerStatus {
  running: boolean;
  port: number | null;
  url?: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'debug' | 'warn' | 'error';
  message: string;
}

interface LogStats {
  total: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
}

type LogFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

@customElement('server-console-app')
export class ServerConsoleApp extends TauriBase {
  static override styles = [
    sharedStyles,
    buttonStyles,
    formStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        background: var(--bg-color);
        color: var(--text-primary);
        font-family: var(--font-sans);
        overflow: hidden;
      }

      /* Header */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 500;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--success);
        animation: pulse 2s ease-in-out infinite;
      }

      .status-indicator.stopped {
        background-color: var(--danger);
        animation: none;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .header-controls {
        display: flex;
        gap: 8px;
      }

      .control-btn {
        padding: 6px 12px;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-base);
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .control-btn:hover {
        background: var(--bg-input-hover);
      }

      .control-btn.active {
        background: var(--accent);
        color: white;
      }

      /* Toolbar */
      .toolbar {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
      }

      .filter-group {
        display: flex;
        gap: 4px;
      }

      .filter-btn {
        padding: 6px 12px;
        border: 1px solid var(--border-primary);
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: all var(--transition-base);
      }

      .filter-btn:first-child {
        border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      }

      .filter-btn:last-child {
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      }

      .filter-btn:not(:last-child) {
        border-right: none;
      }

      .filter-btn:hover {
        background: var(--bg-hover);
      }

      .filter-btn.active {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }

      .search-box {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
      }

      .search-icon {
        width: 14px;
        height: 14px;
        color: var(--text-tertiary);
      }

      .search-input {
        flex: 1;
        border: none;
        background: none;
        color: var(--text-primary);
        font-size: 13px;
        outline: none;
      }

      .search-input::placeholder {
        color: var(--text-tertiary);
      }

      /* Console */
      .console-container {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: #0e0e0e;
      }

      .console {
        height: 100%;
        overflow-y: auto;
        padding: 16px;
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.6;
      }

      .console::-webkit-scrollbar {
        width: 8px;
      }

      .console::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
      }

      .console::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .console::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .log-entry {
        display: flex;
        gap: 12px;
        margin-bottom: 2px;
        padding: 2px 0;
        border-radius: 2px;
        transition: background var(--transition-fast);
      }

      .log-entry:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .log-timestamp {
        color: #6b7280;
        flex-shrink: 0;
      }

      .log-level {
        font-weight: 600;
        text-transform: uppercase;
        width: 60px;
        flex-shrink: 0;
        text-align: center;
        padding: 0 4px;
        border-radius: 2px;
      }

      .log-level.info {
        color: #3794ff;
        background: rgba(55, 148, 255, 0.1);
      }

      .log-level.debug {
        color: #b5cea8;
        background: rgba(181, 206, 168, 0.1);
      }

      .log-level.warn {
        color: #ce9178;
        background: rgba(206, 145, 120, 0.1);
      }

      .log-level.error {
        color: #f48771;
        background: rgba(244, 135, 113, 0.1);
      }

      .log-message {
        flex: 1;
        color: #d4d4d4;
        word-break: break-word;
      }

      /* Empty state */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-tertiary);
      }

      .empty-icon {
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.3;
      }

      /* Footer */
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: var(--bg-secondary);
        border-top: 1px solid var(--border-primary);
        font-size: 12px;
      }

      .log-stats {
        display: flex;
        gap: 16px;
      }

      .stat-item {
        display: flex;
        gap: 4px;
        color: var(--text-secondary);
      }

      .stat-count {
        color: var(--text-primary);
        font-weight: 500;
      }

      #connectionStatus {
        color: var(--text-secondary);
      }
    `
  ];

  @state()
  private logs: LogEntry[] = [];

  @state()
  private isServerRunning = false;

  @state()
  private serverPort: number | null = null;

  @state()
  private autoScroll = true;

  @state()
  private currentFilter: LogFilter = 'all';

  @state()
  private searchTerm = '';

  private updateInterval: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.tauriAvailable) {
      this.init();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  private async init(): Promise<void> {
    await this.loadServerStatus();
    await this.loadLogs();
    
    // Start periodic updates
    this.updateInterval = window.setInterval(async () => {
      await this.loadServerStatus();
      await this.loadLogs();
    }, 1000);
  }

  private async loadServerStatus(): Promise<void> {
    try {
      const status = await this.safeInvoke<ServerStatus>('get_server_status');
      this.isServerRunning = status.running;
      this.serverPort = status.port;
    } catch (error) {
      console.error('Failed to load server status:', error);
    }
  }

  private async loadLogs(): Promise<void> {
    try {
      const newLogs = await this.safeInvoke<LogEntry[]>('get_server_logs', { limit: 1000 });
      if (newLogs.length !== this.logs.length) {
        this.logs = newLogs;
        this._scrollToBottomIfNeeded();
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  }

  private async toggleServer(): Promise<void> {
    try {
      if (this.isServerRunning) {
        await this.safeInvoke('stop_server');
        await this.showNotification('Server Stopped', 'The server has been stopped', 'info');
      } else {
        await this.safeInvoke('start_server');
        await this.showNotification('Server Started', 'The server has been started', 'success');
      }
      await this.loadServerStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to toggle server: ${message}`, 'error');
    }
  }

  private async restartServer(): Promise<void> {
    try {
      await this.safeInvoke('restart_server');
      await this.showNotification('Server Restarted', 'The server has been restarted', 'success');
      await this.loadServerStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to restart server: ${message}`, 'error');
    }
  }

  private clearLogs(): void {
    this.logs = [];
    this.safeInvoke('clear_server_logs').catch(console.error);
  }

  private exportLogs(): void {
    const logText = this.filteredLogs.map(log => 
      `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${log.message}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibetunnel-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private setFilter(filter: LogFilter): void {
    this.currentFilter = filter;
  }

  private handleSearch(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.searchTerm = target.value;
  }

  private toggleAutoScroll(): void {
    this.autoScroll = !this.autoScroll;
    if (this.autoScroll) {
      this._scrollToBottom();
    }
  }

  private _scrollToBottomIfNeeded(): void {
    if (this.autoScroll) {
      this.updateComplete.then(() => {
        this._scrollToBottom();
      });
    }
  }

  private _scrollToBottom(): void {
    const console = this.shadowRoot?.querySelector('.console') as HTMLElement;
    if (console) {
      console.scrollTop = console.scrollHeight;
    }
  }

  private get filteredLogs(): LogEntry[] {
    let filtered = this.logs;
    
    if (this.currentFilter !== 'all') {
      filtered = filtered.filter(log => log.level === this.currentFilter);
    }
    
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(term)
      );
    }
    
    return filtered;
  }

  private get logStats(): LogStats {
    const stats: LogStats = {
      total: this.logs.length,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0
    };
    
    this.logs.forEach(log => {
      const level = log.level;
      if (level in stats) {
        stats[level]++;
      }
    });
    
    return stats;
  }

  private formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  override render() {
    const stats = this.logStats;
    const filteredLogs = this.filteredLogs;

    return html`
      <div class="header">
        <div class="header-title">
          <span class="status-indicator ${this.isServerRunning ? '' : 'stopped'}"></span>
          <span>Server Console</span>
          ${this.isServerRunning ? html`<span style="color: var(--text-secondary)">• Port ${this.serverPort}</span>` : ''}
        </div>
        <div class="header-controls">
          <vt-button 
            size="sm" 
            variant="ghost"
            @click=${this.toggleServer}
          >
            ${this.isServerRunning ? 'Stop Server' : 'Start Server'}
          </vt-button>
          <vt-button 
            size="sm" 
            variant="ghost"
            @click=${this.restartServer}
            ?disabled=${!this.isServerRunning}
          >
            Restart
          </vt-button>
        </div>
      </div>

      <div class="toolbar">
        <div class="filter-group">
          <button 
            class="filter-btn ${this.currentFilter === 'all' ? 'active' : ''}"
            @click=${() => this.setFilter('all')}
          >
            All (${stats.total})
          </button>
          <button 
            class="filter-btn ${this.currentFilter === 'error' ? 'active' : ''}"
            @click=${() => this.setFilter('error')}
          >
            Errors (${stats.error})
          </button>
          <button 
            class="filter-btn ${this.currentFilter === 'warn' ? 'active' : ''}"
            @click=${() => this.setFilter('warn')}
          >
            Warnings (${stats.warn})
          </button>
          <button 
            class="filter-btn ${this.currentFilter === 'info' ? 'active' : ''}"
            @click=${() => this.setFilter('info')}
          >
            Info (${stats.info})
          </button>
          <button 
            class="filter-btn ${this.currentFilter === 'debug' ? 'active' : ''}"
            @click=${() => this.setFilter('debug')}
          >
            Debug (${stats.debug})
          </button>
        </div>

        <div class="search-box">
          <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input 
            type="text" 
            class="search-input" 
            placeholder="Search logs..."
            .value=${this.searchTerm}
            @input=${this.handleSearch}
          >
        </div>

        <vt-button 
          size="sm" 
          variant="ghost"
          @click=${this.clearLogs}
        >
          Clear
        </vt-button>
        <vt-button 
          size="sm" 
          variant="ghost"
          @click=${this.exportLogs}
        >
          Export
        </vt-button>
        <button 
          class="control-btn ${this.autoScroll ? 'active' : ''}"
          @click=${this.toggleAutoScroll}
          title="Auto-scroll"
        >
          ↓
        </button>
      </div>

      <div class="console-container">
        <div class="console">
          ${this.loading && !this.logs.length ? html`
            <vt-loading state="loading" message="Connecting to server..."></vt-loading>
          ` : ''}
          
          ${!this.loading && !filteredLogs.length ? html`
            <div class="empty-state">
              <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              <p>No logs yet</p>
              <p style="font-size: 12px; margin-top: 8px;">Server logs will appear here when activity occurs</p>
            </div>
          ` : ''}

          ${filteredLogs.map(log => html`
            <div class="log-entry">
              <span class="log-timestamp">${this.formatTimestamp(log.timestamp)}</span>
              <span class="log-level ${log.level}">${log.level}</span>
              <span class="log-message">${log.message}</span>
            </div>
          `)}
        </div>
      </div>

      <div class="footer">
        <div class="log-stats">
          <div class="stat-item">
            <span>Total:</span>
            <span class="stat-count">${stats.total}</span>
          </div>
          <div class="stat-item">
            <span>Errors:</span>
            <span class="stat-count">${stats.error}</span>
          </div>
          <div class="stat-item">
            <span>Warnings:</span>
            <span class="stat-count">${stats.warn}</span>
          </div>
        </div>
        <div id="connectionStatus">${this.tauriAvailable ? 'Connected' : 'Disconnected'}</div>
      </div>
    `;
  }
}
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

interface SystemStats {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  uptime: number;
  loadAverage: number[];
}

@customElement('system-monitor')
export class SystemMonitor extends LitElement {
  @property({ type: Boolean })
  expanded = false;

  @property({ type: Number })
  refreshInterval = 2000; // 2 seconds

  @state()
  private stats: SystemStats | null = null;

  @state()
  private loading = true;

  @state()
  private error: string | null = null;

  @state()
  private intervalId: number | null = null;

  static styles = css`
    :host {
      display: block;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      background: var(--bg-secondary, #1a1a1a);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg-tertiary, #2a2a2a);
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid var(--border-color, #333);
    }

    .header:hover {
      background: var(--bg-hover, #3a3a3a);
    }

    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .icon {
      width: 16px;
      height: 16px;
      fill: var(--accent-color, #00ff88);
    }

    .expand-icon {
      width: 12px;
      height: 12px;
      fill: var(--text-secondary, #888);
      transition: transform 0.2s ease;
    }

    .expanded .expand-icon {
      transform: rotate(90deg);
    }

    .content {
      padding: 16px;
      display: none;
    }

    .expanded .content {
      display: block;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      color: var(--text-secondary, #888);
    }

    .error {
      padding: 16px;
      color: var(--error-color, #ff6b6b);
      background: var(--error-bg, rgba(255, 107, 107, 0.1));
      border-radius: 4px;
      margin: 16px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }

    .stat-card {
      background: var(--bg-primary, #121212);
      border: 1px solid var(--border-color, #333);
      border-radius: 6px;
      padding: 16px;
    }

    .stat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .stat-title {
      font-weight: 600;
      color: var(--text-primary, #fff);
      font-size: 14px;
    }

    .stat-value {
      font-size: 12px;
      color: var(--text-secondary, #888);
    }

    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--bg-tertiary, #2a2a2a);
      border-radius: 3px;
      overflow: hidden;
      margin: 8px 0;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-color, #00ff88);
      transition: width 0.3s ease;
    }

    .progress-fill.warning {
      background: var(--warning-color, #ffa500);
    }

    .progress-fill.danger {
      background: var(--error-color, #ff6b6b);
    }

    .stat-details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 12px;
      color: var(--text-secondary, #888);
    }

    .network-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      font-size: 12px;
      color: var(--text-secondary, #888);
    }

    .network-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .network-label {
      font-weight: 500;
      color: var(--text-primary, #fff);
    }

    .uptime {
      font-size: 12px;
      color: var(--text-secondary, #888);
      margin-top: 8px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.startMonitoring();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopMonitoring();
  }

  private startMonitoring() {
    this.fetchStats();
    this.intervalId = window.setInterval(() => {
      this.fetchStats();
    }, this.refreshInterval);
  }

  private stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async fetchStats() {
    try {
      const response = await fetch('/api/system/stats');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const stats = await response.json();
      this.stats = stats;
      this.loading = false;
      this.error = null;
    } catch (err) {
      console.error('Failed to fetch system stats:', err);
      this.error = err instanceof Error ? err.message : 'Unknown error';
      this.loading = false;
    }
  }

  private toggleExpanded() {
    this.expanded = !this.expanded;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  private getUsageClass(usage: number): string {
    if (usage >= 90) return 'danger';
    if (usage >= 75) return 'warning';
    return '';
  }

  render() {
    const headerClasses = {
      header: true,
      expanded: this.expanded,
    };

    return html`
      <div class=${classMap(headerClasses)} @click=${this.toggleExpanded}>
        <div class="title">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z" />
          </svg>
          System Monitor
        </div>
        <svg class="expand-icon" viewBox="0 0 24 24">
          <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z" />
        </svg>
      </div>

      <div class="content">
        ${this.loading
          ? html`<div class="loading">Loading system stats...</div>`
          : this.error
          ? html`<div class="error">Error: ${this.error}</div>`
          : this.renderStats()}
      </div>
    `;
  }

  private renderStats() {
    if (!this.stats) return nothing;

    return html`
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-title">CPU Usage</div>
            <div class="stat-value">${this.stats.cpu.usage.toFixed(1)}%</div>
          </div>
          <div class="progress-bar">
            <div 
              class="progress-fill ${this.getUsageClass(this.stats.cpu.usage)}"
              style="width: ${this.stats.cpu.usage}%"
            ></div>
          </div>
          <div class="stat-details">
            <div>Cores: ${this.stats.cpu.cores}</div>
            <div>Load: ${this.stats.loadAverage[0].toFixed(2)}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-title">Memory Usage</div>
            <div class="stat-value">${this.stats.memory.usage.toFixed(1)}%</div>
          </div>
          <div class="progress-bar">
            <div 
              class="progress-fill ${this.getUsageClass(this.stats.memory.usage)}"
              style="width: ${this.stats.memory.usage}%"
            ></div>
          </div>
          <div class="stat-details">
            <div>Used: ${this.formatBytes(this.stats.memory.used)}</div>
            <div>Total: ${this.formatBytes(this.stats.memory.total)}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-title">Disk Usage</div>
            <div class="stat-value">${this.stats.disk.usage.toFixed(1)}%</div>
          </div>
          <div class="progress-bar">
            <div 
              class="progress-fill ${this.getUsageClass(this.stats.disk.usage)}"
              style="width: ${this.stats.disk.usage}%"
            ></div>
          </div>
          <div class="stat-details">
            <div>Used: ${this.formatBytes(this.stats.disk.used)}</div>
            <div>Free: ${this.formatBytes(this.stats.disk.free)}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-title">Network Activity</div>
          </div>
          <div class="network-stats">
            <div class="network-item">
              <div class="network-label">Incoming</div>
              <div>${this.formatBytes(this.stats.network.bytesIn)}</div>
              <div>${this.stats.network.packetsIn.toLocaleString()} packets</div>
            </div>
            <div class="network-item">
              <div class="network-label">Outgoing</div>
              <div>${this.formatBytes(this.stats.network.bytesOut)}</div>
              <div>${this.stats.network.packetsOut.toLocaleString()} packets</div>
            </div>
          </div>
          <div class="uptime">
            Uptime: ${this.formatUptime(this.stats.uptime)}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'system-monitor': SystemMonitor;
  }
}
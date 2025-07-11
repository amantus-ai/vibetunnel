import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { DebugEvent, type SessionDebugInfo } from '../../types/debug.js';
import { formatBytes, formatDuration } from '../utils/format.js';

@customElement('session-debug-panel')
export class SessionDebugPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 400px;
      background: var(--color-bg-secondary);
      border-left: 1px solid var(--color-border);
      overflow-y: auto;
      z-index: 1000;
      transform: translateX(100%);
      transition: transform 0.3s ease;
    }
    
    :host([open]) {
      transform: translateX(0);
    }
    
    @media (max-width: 768px) {
      :host {
        width: 100%;
        border-left: none;
      }
    }
    
    .header {
      position: sticky;
      top: 0;
      background: var(--color-bg-primary);
      border-bottom: 1px solid var(--color-border);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 1;
    }
    
    .title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-primary);
    }
    
    .close-button {
      background: none;
      border: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s;
    }
    
    .close-button:hover {
      background-color: var(--color-bg-hover);
    }
    
    .content {
      padding: 16px;
    }
    
    .section {
      margin-bottom: 24px;
    }
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      cursor: pointer;
      user-select: none;
    }
    
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .section-icon {
      width: 16px;
      height: 16px;
      transition: transform 0.2s;
    }
    
    .section-header[data-collapsed] .section-icon {
      transform: rotate(-90deg);
    }
    
    .section-content {
      font-size: 13px;
      color: var(--color-text-secondary);
    }
    
    .section-content[data-collapsed] {
      display: none;
    }
    
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid var(--color-border-subtle);
    }
    
    .info-row:last-child {
      border-bottom: none;
    }
    
    .info-label {
      color: var(--color-text-secondary);
    }
    
    .info-value {
      color: var(--color-text-primary);
      font-family: var(--font-mono);
      font-size: 12px;
    }
    
    .event-log {
      max-height: 300px;
      overflow-y: auto;
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: 8px;
    }
    
    .event-item {
      padding: 4px 0;
      border-bottom: 1px solid var(--color-border-subtle);
      font-size: 12px;
    }
    
    .event-item:last-child {
      border-bottom: none;
    }
    
    .event-time {
      color: var(--color-text-tertiary);
      font-family: var(--font-mono);
      font-size: 11px;
    }
    
    .event-message {
      color: var(--color-text-secondary);
      margin-top: 2px;
    }
    
    .event-type {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      margin-right: 8px;
    }
    
    .event-type[data-type="error"] {
      background: var(--color-error-bg);
      color: var(--color-error);
    }
    
    .event-type[data-type="warn"] {
      background: var(--color-warning-bg);
      color: var(--color-warning);
    }
    
    .event-type[data-type="info"] {
      background: var(--color-info-bg);
      color: var(--color-info);
    }
    
    .connection-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-text-tertiary);
    }
    
    .status-indicator[data-state="connected"] {
      background: var(--color-success);
    }
    
    .status-indicator[data-state="error"] {
      background: var(--color-error);
    }
    
    .copy-button {
      background: var(--color-bg-hover);
      border: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      transition: background-color 0.2s;
    }
    
    .copy-button:hover {
      background: var(--color-bg-active);
    }
    
    .metric-value {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-primary);
    }
    
    .metric-label {
      font-size: 12px;
      color: var(--color-text-secondary);
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 12px;
    }
    
    .metric-card {
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }
  `;

  @property({ type: Boolean, reflect: true })
  open = false;

  @property({ type: Object })
  debugInfo?: SessionDebugInfo;

  @state()
  private collapsedSections = new Set<string>();

  private toggleSection(section: string) {
    if (this.collapsedSections.has(section)) {
      this.collapsedSections.delete(section);
    } else {
      this.collapsedSections.add(section);
    }
    this.requestUpdate();
  }

  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  private renderConnectionSection() {
    if (!this.debugInfo) return null;

    const { connections } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('connections');

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('connections')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 8l6-6v3.5c7 0 10 4.5 10 9.5 0-8-3-10-10-10V2L1 8z"/>
            </svg>
            Network Connections
          </div>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="info-row">
            <span class="info-label">WebSocket</span>
            <span class="info-value">
              <span class="connection-status">
                <span class="status-indicator" data-state=${connections.websocket.state}></span>
                ${connections.websocket.state}
              </span>
            </span>
          </div>
          ${
            connections.websocket.state === 'connected'
              ? html`
            <div class="info-row">
              <span class="info-label">Messages</span>
              <span class="info-value">${connections.websocket.messagesReceived}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Data Received</span>
              <span class="info-value">${formatBytes(connections.websocket.bytesReceived)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Reconnects</span>
              <span class="info-value">${connections.websocket.reconnectCount}</span>
            </div>
          `
              : null
          }
          
          ${
            connections.httpStreams.length > 0
              ? html`
            <div style="margin-top: 12px; font-weight: 600;">Active Streams</div>
            ${connections.httpStreams.map(
              (stream) => html`
              <div class="info-row">
                <span class="info-label">${stream.type.toUpperCase()}</span>
                <span class="info-value">
                  ${formatBytes(stream.bytesReceived)} • 
                  ${this.formatUptime((Date.now() - stream.startedAt) / 1000)}
                </span>
              </div>
            `
            )}
          `
              : null
          }
        </div>
      </div>
    `;
  }

  private renderProcessSection() {
    if (!this.debugInfo) return null;

    const { process } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('process');

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('process')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>
              <path d="M8 3v5l3.5 2.1.8-1.3L9 7V3H8z"/>
            </svg>
            Process Information
          </div>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="info-row">
            <span class="info-label">PID</span>
            <span class="info-value">${process.pid || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Command</span>
            <span class="info-value">${process.command.join(' ')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Working Dir</span>
            <span class="info-value" title=${process.workingDir}>
              ${process.workingDir.split('/').pop() || '/'}
            </span>
          </div>
          ${
            process.uptime
              ? html`
            <div class="info-row">
              <span class="info-label">Uptime</span>
              <span class="info-value">${this.formatUptime(process.uptime)}</span>
            </div>
          `
              : null
          }
          ${
            process.cpuUsage !== undefined
              ? html`
            <div class="info-row">
              <span class="info-label">CPU Usage</span>
              <span class="info-value">${process.cpuUsage.toFixed(1)}%</span>
            </div>
          `
              : null
          }
          ${
            process.memoryUsage !== undefined
              ? html`
            <div class="info-row">
              <span class="info-label">Memory</span>
              <span class="info-value">${formatBytes(process.memoryUsage)}</span>
            </div>
          `
              : null
          }
        </div>
      </div>
    `;
  }

  private renderTerminalSection() {
    if (!this.debugInfo) return null;

    const { terminal } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('terminal');

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('terminal')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11zm1.5 0v11h11v-11h-11z"/>
              <path d="M3.5 5L6 7.5 3.5 10v-5zm3 5.5h4v-1h-4v1z"/>
            </svg>
            Terminal Data
          </div>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="info-row">
            <span class="info-label">Size</span>
            <span class="info-value">${terminal.currentSize.cols}×${terminal.currentSize.rows}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Buffer Lines</span>
            <span class="info-value">${terminal.bufferStats.totalLines}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Characters</span>
            <span class="info-value">${terminal.bufferStats.totalCharacters.toLocaleString()}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Viewport Y</span>
            <span class="info-value">${terminal.bufferStats.viewportY}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Last Update</span>
            <span class="info-value">${this.formatTimestamp(terminal.lastUpdate)}</span>
          </div>
          
          ${
            terminal.resizeHistory.length > 0
              ? html`
            <div style="margin-top: 12px; font-weight: 600;">Resize History</div>
            <div class="event-log" style="max-height: 150px;">
              ${terminal.resizeHistory
                .slice(-10)
                .reverse()
                .map(
                  (resize) => html`
                <div class="event-item">
                  <div class="event-time">${this.formatTimestamp(resize.timestamp)}</div>
                  <div class="event-message">
                    ${resize.from.cols}×${resize.from.rows} → ${resize.to.cols}×${resize.to.rows}
                    (${resize.source})
                  </div>
                </div>
              `
                )}
            </div>
          `
              : null
          }
        </div>
      </div>
    `;
  }

  private renderOutputSection() {
    if (!this.debugInfo) return null;

    const { output } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('output');

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('output')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 1h10a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2zm0 1a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1H3z"/>
              <path d="M3 4h10v1H3V4zm0 2h10v1H3V6zm0 2h10v1H3V8zm0 2h7v1H3v-1z"/>
            </svg>
            Output Statistics
          </div>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-value">${formatBytes(output.totalStdoutBytes)}</div>
              <div class="metric-label">Total Output</div>
            </div>
            <div class="metric-card">
              <div class="metric-value">${formatBytes(output.transferredBytes)}</div>
              <div class="metric-label">Transferred</div>
            </div>
            <div class="metric-card">
              <div class="metric-value">${(output.compressionRatio * 100).toFixed(1)}%</div>
              <div class="metric-label">Compression</div>
            </div>
            <div class="metric-card">
              <div class="metric-value">${formatBytes(output.totalStdoutBytes - output.transferredBytes)}</div>
              <div class="metric-label">Saved</div>
            </div>
          </div>
          ${
            output.lastCleanup > 0
              ? html`
            <div class="info-row" style="margin-top: 12px;">
              <span class="info-label">Last Cleanup</span>
              <span class="info-value">${this.formatTimestamp(output.lastCleanup)}</span>
            </div>
          `
              : null
          }
        </div>
      </div>
    `;
  }

  private renderEventsSection() {
    if (!this.debugInfo) return null;

    const { events } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('events');
    const recentEvents = events.slice(-50).reverse();

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('events')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2z"/>
              <path d="M8 4v4l2.5 1.5.5-.8L8.5 7.5V4H8z"/>
            </svg>
            Event Log (${events.length})
          </div>
          <button class="copy-button" 
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.copyToClipboard(JSON.stringify(events, null, 2));
                  }}>
            Copy All
          </button>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="event-log">
            ${
              recentEvents.length === 0
                ? html`
              <div style="text-align: center; color: var(--color-text-tertiary); padding: 20px;">
                No events recorded
              </div>
            `
                : recentEvents.map(
                    (event) => html`
              <div class="event-item">
                <div>
                  <span class="event-type" data-type=${event.level}>${event.type}</span>
                  <span class="event-time">${this.formatTimestamp(event.timestamp)}</span>
                </div>
                <div class="event-message">${event.message}</div>
                ${
                  event.data
                    ? html`
                  <div style="margin-top: 4px; font-size: 11px; color: var(--color-text-tertiary);">
                    ${JSON.stringify(event.data)}
                  </div>
                `
                    : null
                }
              </div>
            `
                  )
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderPerformanceSection() {
    if (!this.debugInfo) return null;

    const { performance } = this.debugInfo;
    const isCollapsed = this.collapsedSections.has('performance');

    return html`
      <div class="section">
        <div class="section-header" 
             @click=${() => this.toggleSection('performance')}
             ?data-collapsed=${isCollapsed}>
          <div class="section-title">
            <svg class="section-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2z"/>
              <path d="M11.5 4.5L8 8 6.5 6.5l-1 1L8 10l4.5-4.5-1-1z"/>
            </svg>
            Performance Metrics
          </div>
        </div>
        <div class="section-content" ?data-collapsed=${isCollapsed}>
          <div class="info-row">
            <span class="info-label">Avg Render Time</span>
            <span class="info-value">${performance.avgRenderTime.toFixed(2)}ms</span>
          </div>
          <div class="info-row">
            <span class="info-label">Update Frequency</span>
            <span class="info-value">${performance.updateFrequency.toFixed(1)}/s</span>
          </div>
          <div class="info-row">
            <span class="info-label">Input Latency</span>
            <span class="info-value">${performance.latency.input}ms</span>
          </div>
          <div class="info-row">
            <span class="info-label">Output Latency</span>
            <span class="info-value">${performance.latency.output}ms</span>
          </div>
          <div class="info-row">
            <span class="info-label">Last Measurement</span>
            <span class="info-value">${this.formatTimestamp(performance.lastMeasurement)}</span>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="header">
        <div class="title">Session Debug Info</div>
        <button class="close-button" @click=${() => this.dispatchEvent(new CustomEvent('close'))}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
          </svg>
        </button>
      </div>
      
      <div class="content">
        ${
          !this.debugInfo
            ? html`
          <div style="text-align: center; color: var(--color-text-tertiary); padding: 40px;">
            Loading debug information...
          </div>
        `
            : html`
          ${this.renderConnectionSection()}
          ${this.renderProcessSection()}
          ${this.renderTerminalSection()}
          ${this.renderOutputSection()}
          ${this.renderEventsSection()}
          ${this.renderPerformanceSection()}
        `
        }
      </div>
    `;
  }
}

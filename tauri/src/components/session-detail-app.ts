import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import { sharedStyles, buttonStyles, formStyles } from './shared/styles';
import './shared/vt-button';
import './shared/vt-loading';
import './shared/vt-card';

interface Session {
  id: string;
  pid: number;
  command: string;
  working_dir: string;
  status: string;
  is_running: boolean;
  started_at: string;
  last_modified: string;
  exit_code?: number | null;
}

@customElement('session-detail-app')
export class SessionDetailApp extends TauriBase {
  static override styles = [
    sharedStyles,
    buttonStyles,
    formStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: var(--font-sans);
        padding: 30px;
      }

      .container {
        max-width: 600px;
        margin: 0 auto;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
      }

      h1 {
        font-size: 28px;
        font-weight: 600;
        margin: 0;
        color: var(--text-primary);
      }

      .header-info {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .pid-label {
        font-size: 14px;
        color: var(--text-secondary);
        font-family: var(--font-mono);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: var(--radius-xl);
        font-size: 12px;
        font-weight: 500;
        transition: all var(--transition-base);
      }

      .status-badge.running {
        background: rgba(50, 215, 75, 0.1);
        color: var(--success);
        border: 1px solid var(--success);
      }

      .status-badge.stopped {
        background: rgba(255, 69, 58, 0.1);
        color: var(--danger);
        border: 1px solid var(--danger);
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }

      .status-indicator.running {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

      .details-section {
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        padding: 24px;
        margin-bottom: 24px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 12px 0;
        border-bottom: 1px solid var(--border-primary);
      }

      .detail-row:last-child {
        border-bottom: none;
      }

      .detail-label {
        font-size: 14px;
        color: var(--text-secondary);
        font-weight: 500;
        min-width: 140px;
      }

      .detail-value {
        font-size: 14px;
        color: var(--text-primary);
        text-align: right;
        word-break: break-all;
        font-family: var(--font-mono);
      }

      .actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .refresh-info {
        text-align: center;
        margin-top: 20px;
        font-size: 12px;
        color: var(--text-tertiary);
      }

      @media (max-width: 600px) {
        :host {
          padding: 20px;
        }

        .header {
          flex-direction: column;
          align-items: flex-start;
          gap: 16px;
        }

        .detail-row {
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }

        .detail-value {
          text-align: left;
        }

        .actions {
          flex-direction: column;
        }
      }
    `
  ];

  @state()
  private sessionId: string | null = null;

  @state()
  private session: Session | null = null;

  private refreshInterval: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    
    // Get session ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    this.sessionId = urlParams.get('id');
    
    if (this.sessionId) {
      this.loadSessionDetails();
      // Refresh every 2 seconds
      this.refreshInterval = window.setInterval(() => {
        this.loadSessionDetails();
      }, 2000);
    } else {
      this.error = 'No session ID provided';
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async loadSessionDetails(): Promise<void> {
    if (!this.sessionId) return;

    try {
      const sessions = await this.safeInvoke<Session[]>('get_monitored_sessions');
      const session = sessions.find(s => s.id === this.sessionId);
      
      if (!session) {
        throw new Error('Session not found');
      }
      
      this.session = session;
      this.error = null;
      
      // Update window title
      const dirName = session.working_dir.split('/').pop() || session.working_dir;
      document.title = `${dirName} — VibeTunnel (PID: ${session.pid})`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.error = `Error loading session details: ${message}`;
      this.session = null;
    }
  }

  private async openInTerminal(): Promise<void> {
    if (!this.session) return;
    
    try {
      await this.safeInvoke('terminal_spawn_service:spawn_terminal_for_session', { 
        sessionId: this.session.id 
      });
      await this.showNotification('Success', 'Terminal opened successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to open terminal: ${message}`, 'error');
    }
  }

  private async terminateSession(): Promise<void> {
    if (!this.session) return;
    
    if (!confirm('Are you sure you want to terminate this session?')) {
      return;
    }
    
    try {
      await this.safeInvoke('close_terminal', { id: this.session.id });
      await this.showNotification('Success', 'Session terminated', 'success');
      
      // Reload after a short delay
      setTimeout(() => this.loadSessionDetails(), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to terminate session: ${message}`, 'error');
    }
  }

  private formatDate(dateString: string | null | undefined): string {
    if (!dateString) return 'N/A';
    
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  override render() {
    if (this.loading && !this.session) {
      return html`
        <div class="container">
          <vt-loading state="loading" message="Loading session details..."></vt-loading>
        </div>
      `;
    }

    if (this.error && !this.session) {
      return html`
        <div class="container">
          <vt-loading 
            state="error" 
            message=${this.error}
            .errorDetails=${this.sessionId ? `Session ID: ${this.sessionId}` : ''}
          ></vt-loading>
        </div>
      `;
    }

    if (!this.session) {
      return html`
        <div class="container">
          <vt-loading state="empty" message="No session data"></vt-loading>
        </div>
      `;
    }

    const isRunning = this.session.is_running;
    const statusClass = isRunning ? 'running' : 'stopped';
    const statusText = isRunning ? 'Running' : 'Stopped';

    return html`
      <div class="container">
        <div class="header">
          <h1>Session Details</h1>
          <div class="header-info">
            <span class="pid-label">PID: ${this.session.pid}</span>
            <div class="status-badge ${statusClass}">
              <span class="status-indicator ${statusClass}"></span>
              <span>${statusText}</span>
            </div>
          </div>
        </div>

        <vt-card>
          <div class="details-section">
            <div class="detail-row">
              <div class="detail-label">Session ID:</div>
              <div class="detail-value">${this.session.id}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Command:</div>
              <div class="detail-value">${this.session.command}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Working Directory:</div>
              <div class="detail-value">${this.session.working_dir}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Status:</div>
              <div class="detail-value">${this.session.status}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Started At:</div>
              <div class="detail-value">${this.formatDate(this.session.started_at)}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Last Modified:</div>
              <div class="detail-value">${this.formatDate(this.session.last_modified)}</div>
            </div>
            ${this.session.exit_code !== null && this.session.exit_code !== undefined ? html`
              <div class="detail-row">
                <div class="detail-label">Exit Code:</div>
                <div class="detail-value">${this.session.exit_code}</div>
              </div>
            ` : ''}
          </div>
        </vt-card>

        <div class="actions">
          <vt-button 
            variant="primary"
            @click=${this.openInTerminal}
          >
            Open in Terminal
          </vt-button>
          ${isRunning ? html`
            <vt-button 
              variant="danger"
              @click=${this.terminateSession}
            >
              Terminate Session
            </vt-button>
          ` : ''}
        </div>

        <div class="refresh-info">
          Auto-refreshing every 2 seconds
        </div>
      </div>
    `;
  }
}
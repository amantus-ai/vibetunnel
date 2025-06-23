import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { provide } from '@lit/context';
import { TauriBase } from './base/tauri-base';
import { appContext, appActionsContext, defaultAppState, type AppState, type AppActions } from '../contexts/app-context';
import './shared/vt-button';
import './shared/vt-loading';

interface ServerStatus {
  running: boolean;
  port?: number;
  url?: string;
  error?: string;
}

@customElement('app-main')
export class AppMain extends TauriBase implements AppActions {
  static override styles = css`
    :host {
      display: flex;
      width: 100vw;
      height: 100vh;
      align-items: center;
      justify-content: center;
      font-family: var(--font-sans);
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }

    .container {
      text-align: center;
      max-width: 600px;
      padding: 40px;
      animation: fadeIn 0.5s ease-out;
    }

    .app-icon {
      width: 128px;
      height: 128px;
      margin-bottom: 30px;
      filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.3));
      border-radius: 27.6%;
    }

    h1 {
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 18px;
      color: var(--text-secondary);
      margin-bottom: 40px;
      line-height: 1.5;
    }

    .status {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 30px;
      padding: 12px 20px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-md);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .status.running {
      color: var(--success);
    }

    .status.error {
      color: var(--danger);
    }

    .button-group {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .info {
      margin-top: 40px;
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .info-item {
      margin-bottom: 8px;
    }

    code {
      background: var(--bg-hover);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.9em;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  @provide({ context: appContext })
  @state()
  private _appState: AppState = { ...defaultAppState };

  @provide({ context: appActionsContext })
  appActions: AppActions = this;

  @state()
  private _serverStatus: ServerStatus = { running: false };

  private _statusInterval?: number;
  private _unlistenRestart?: () => void;

  // Task for checking server status
  private _serverStatusTask = new Task(this, {
    task: async () => {
      if (!this.tauriAvailable) {
        throw new Error('Tauri API not available');
      }
      const status = await this.safeInvoke<ServerStatus>('get_server_status');
      this._serverStatus = status;
      this.updateServerConfig({ 
        connected: status.running,
        port: status.port || this._appState.serverConfig.port
      });
      return status;
    },
    autoRun: false
  });

  override async connectedCallback() {
    super.connectedCallback();
    
    if (this.tauriAvailable) {
      // Initial status check
      this._serverStatusTask.run();
      
      // Set up periodic status check
      this._statusInterval = window.setInterval(() => {
        this._serverStatusTask.run();
      }, 5000);
      
      // Listen for server restart events
      this._unlistenRestart = await this.listen<void>('server:restarted', () => {
        this._serverStatusTask.run();
      });
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this._statusInterval) {
      clearInterval(this._statusInterval);
    }
    if (this._unlistenRestart) {
      this._unlistenRestart();
    }
  }

  private async _openDashboard() {
    if (!this._serverStatus.running || !this._serverStatus.url) {
      await this.showNotification(
        'Server Not Running',
        'Please start the server from the tray menu.',
        'warning'
      );
      return;
    }
    
    try {
      await this.openExternal(this._serverStatus.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to open dashboard: ${message}`, 'error');
    }
  }

  private async _openSettings() {
    try {
      await this.openSettings();
    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  }

  private async _showWelcome() {
    try {
      await this.safeInvoke('show_welcome_window');
    } catch (error) {
      console.error('Failed to show welcome:', error);
    }
  }

  override render() {
    return html`
      <div class="container">
        <img src="./icon.png" alt="VibeTunnel" class="app-icon">
        <h1>VibeTunnel</h1>
        <p class="subtitle">Turn any browser into your terminal. Command your agents on the go.</p>
        
        ${this._serverStatusTask.render({
          pending: () => html`
            <div class="status">
              <vt-loading state="loading" message="Checking server status..."></vt-loading>
            </div>
          `,
          complete: (status) => html`
            <div class="status ${status.running ? 'running' : status.error ? 'error' : ''}">
              ${status.running
                ? `Server running on port ${status.port}`
                : status.error 
                  ? 'Unable to check server status'
                  : 'Server not running'}
            </div>
          `,
          error: (e) => html`
            <div class="status error">
              Error: ${e instanceof Error ? e.message : String(e)}
            </div>
          `
        })}
        
        <div class="button-group">
          <vt-button 
            @click=${this._openDashboard}
            ?disabled=${!this.tauriAvailable || !this._serverStatus.running}
          >
            Open Dashboard
          </vt-button>
          <vt-button 
            variant="secondary" 
            @click=${this._openSettings}
            ?disabled=${!this.tauriAvailable}
          >
            Settings
          </vt-button>
          <vt-button 
            variant="secondary" 
            @click=${this._showWelcome}
            ?disabled=${!this.tauriAvailable}
          >
            Welcome Guide
          </vt-button>
        </div>
        
        <div class="info">
          <div class="info-item">💡 VibeTunnel runs in your system tray</div>
          <div class="info-item">🖱️ Click the tray icon to access quick actions</div>
          <div class="info-item">⌨️ Use the <code>vt</code> command to create terminal sessions</div>
        </div>
      </div>
    `;
  }

  // Implement AppActions interface
  setSessions(sessions: AppState['sessions']): void {
    this._appState = { ...this._appState, sessions };
    this.requestUpdate();
  }

  addSession(session: AppState['sessions'][0]): void {
    this._appState = { 
      ...this._appState, 
      sessions: [...this._appState.sessions, session]
    };
    this.requestUpdate();
  }

  removeSession(sessionId: string): void {
    this._appState = {
      ...this._appState,
      sessions: this._appState.sessions.filter(s => s.id !== sessionId)
    };
    this.requestUpdate();
  }

  setCurrentSession(sessionId: string | null): void {
    this._appState = { ...this._appState, currentSessionId: sessionId };
    this.requestUpdate();
  }

  updateSession(sessionId: string, updates: Partial<AppState['sessions'][0]>): void {
    this._appState = {
      ...this._appState,
      sessions: this._appState.sessions.map(s => 
        s.id === sessionId ? { ...s, ...updates } : s
      )
    };
    this.requestUpdate();
  }

  updatePreferences(preferences: Partial<AppState['preferences']>): void {
    this._appState = {
      ...this._appState,
      preferences: { ...this._appState.preferences, ...preferences }
    };
    this.requestUpdate();
  }

  updateServerConfig(config: Partial<AppState['serverConfig']>): void {
    this._appState = {
      ...this._appState,
      serverConfig: { ...this._appState.serverConfig, ...config }
    };
    this.requestUpdate();
  }

  setConnectionStatus(connected: boolean): void {
    this.updateServerConfig({ connected });
  }

  setLoading(loading: boolean): void {
    this._appState = { ...this._appState, isLoading: loading };
    this.requestUpdate();
  }

  setError(error: string | null): void {
    this._appState = { ...this._appState, error };
    this.requestUpdate();
  }

  toggleSidebar(): void {
    this._appState = { ...this._appState, sidebarOpen: !this._appState.sidebarOpen };
    this.requestUpdate();
  }

  appendToBuffer(data: string): void {
    this._appState = {
      ...this._appState,
      terminalBuffer: [...this._appState.terminalBuffer, data]
    };
    this.requestUpdate();
  }

  clearBuffer(): void {
    this._appState = { ...this._appState, terminalBuffer: [] };
    this.requestUpdate();
  }

  setCursorPosition(position: { x: number; y: number }): void {
    this._appState = { ...this._appState, terminalCursorPosition: position };
    this.requestUpdate();
  }

  addNotification(notification: Omit<AppState['notifications'][0], 'id' | 'timestamp'>): void {
    const newNotification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: Date.now()
    };
    this._appState = {
      ...this._appState,
      notifications: [...this._appState.notifications, newNotification]
    };
    this.requestUpdate();
  }

  removeNotification(id: string): void {
    this._appState = {
      ...this._appState,
      notifications: this._appState.notifications.filter(n => n.id !== id)
    };
    this.requestUpdate();
  }

  clearNotifications(): void {
    this._appState = { ...this._appState, notifications: [] };
    this.requestUpdate();
  }
}
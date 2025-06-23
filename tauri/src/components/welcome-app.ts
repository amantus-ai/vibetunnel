import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import { sharedStyles, animationStyles } from './shared/styles';
import './shared/vt-stepper';
import './shared/vt-button';
import './shared/vt-loading';

interface Terminal {
  id: string;
  name: string;
  path?: string;
  icon?: string;
}

interface PermissionStatus {
  all_granted: boolean;
  accessibility?: boolean;
  automation?: boolean;
  screen_recording?: boolean;
}

interface ServerStatus {
  running: boolean;
  url?: string;
  port?: number;
}

interface Settings {
  general?: {
    default_terminal?: string;
    show_welcome_on_startup?: boolean;
  };
}

@customElement('welcome-app')
export class WelcomeApp extends TauriBase {
  static override styles = [
    sharedStyles,
    animationStyles,
    css`
      :host {
        display: flex;
        width: 100vw;
        height: 100vh;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: var(--font-sans);
        overflow: hidden;
      }

      .welcome-step {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        max-width: 600px;
        margin: 0 auto;
        animation: fadeIn var(--transition-slow);
      }

      .app-icon {
        width: 156px;
        height: 156px;
        margin-bottom: 40px;
        filter: drop-shadow(0 10px 20px var(--shadow-lg));
        border-radius: 27.6%;
        animation: float 3s ease-in-out infinite;
      }

      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }

      h1 {
        font-size: 36px;
        font-weight: 600;
        margin: 0 0 16px 0;
        letter-spacing: -0.5px;
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .subtitle {
        font-size: 18px;
        color: var(--text-secondary);
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .description {
        font-size: 14px;
        color: var(--text-tertiary);
        line-height: 1.6;
        margin-bottom: 32px;
      }

      .code-block {
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        padding: 16px 24px;
        font-family: var(--font-mono);
        font-size: 14px;
        margin: 20px 0;
        text-align: left;
      }

      .terminal-list {
        display: grid;
        gap: 12px;
        width: 100%;
        max-width: 400px;
        margin: 20px auto;
      }

      .terminal-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: var(--bg-secondary);
        border: 2px solid var(--border-primary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-base);
      }

      .terminal-option:hover {
        border-color: var(--accent);
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .terminal-option.selected {
        border-color: var(--accent);
        background: var(--bg-active);
      }

      .terminal-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
      }

      .terminal-info {
        flex: 1;
        text-align: left;
      }

      .terminal-name {
        font-weight: 500;
        color: var(--text-primary);
      }

      .terminal-path {
        font-size: 12px;
        color: var(--text-tertiary);
        font-family: var(--font-mono);
      }

      .feature-list {
        display: grid;
        gap: 16px;
        max-width: 400px;
        margin: 20px auto;
        text-align: left;
      }

      .feature-item {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .feature-icon {
        width: 24px;
        height: 24px;
        color: var(--success);
        flex-shrink: 0;
      }

      .button-group {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 32px;
      }

      .status-message {
        margin-top: 16px;
        padding: 12px 20px;
        background: var(--bg-secondary);
        border-radius: var(--radius-md);
        font-size: 14px;
      }

      .status-message.success {
        color: var(--success);
        border: 1px solid var(--success);
      }

      .status-message.error {
        color: var(--danger);
        border: 1px solid var(--danger);
      }

      .credits {
        margin-top: 32px;
        padding-top: 32px;
        border-top: 1px solid var(--border-primary);
      }

      .credits p {
        color: var(--text-tertiary);
        margin: 8px 0;
        font-size: 13px;
      }

      .credit-link {
        color: var(--accent);
        text-decoration: none;
        transition: all var(--transition-base);
      }

      .credit-link:hover {
        color: var(--accent-hover);
        text-decoration: underline;
      }
    `
  ];

  @state()
  private currentStep = 0;

  @state()
  private terminals: Terminal[] = [];

  @state()
  private selectedTerminal = 'terminal';

  @state()
  private cliInstallStatus = '';

  @state()
  private permissionsGranted = false;

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.tauriAvailable) {
      await this.loadTerminals();
      await this.checkPermissions();
    }
  }

  private async loadTerminals(): Promise<void> {
    try {
      const detectedTerminals = await this.safeInvoke<Terminal[]>('detect_terminals');
      this.terminals = detectedTerminals;
      
      // Get the current default terminal
      const settings = await this.safeInvoke<Settings>('get_settings');
      if (settings.general?.default_terminal) {
        this.selectedTerminal = settings.general.default_terminal;
      }
    } catch (error) {
      console.error('Failed to load terminals:', error);
    }
  }

  private async checkPermissions(): Promise<void> {
    try {
      const status = await this.safeInvoke<PermissionStatus>('check_permissions');
      this.permissionsGranted = status.all_granted;
    } catch (error) {
      console.error('Failed to check permissions:', error);
    }
  }

  private async installCLI(): Promise<void> {
    try {
      this.cliInstallStatus = 'Installing...';
      await this.safeInvoke('install_cli');
      this.cliInstallStatus = 'CLI tool installed successfully!';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.cliInstallStatus = `Installation failed: ${message}`;
    }
  }

  private async requestPermissions(): Promise<void> {
    try {
      await this.safeInvoke('request_permissions');
      await this.checkPermissions();
      if (this.permissionsGranted) {
        await this.showNotification('Success', 'All permissions granted!', 'success');
      }
    } catch (error) {
      await this.showNotification('Error', 'Failed to request permissions', 'error');
    }
  }

  private async selectTerminal(terminal: string): Promise<void> {
    this.selectedTerminal = terminal;
    try {
      const settings = await this.safeInvoke<Settings>('get_settings');
      settings.general = settings.general || {};
      settings.general.default_terminal = terminal;
      await this.safeInvoke('save_settings', { settings });
    } catch (error) {
      console.error('Failed to save terminal preference:', error);
    }
  }

  private async testTerminal(): Promise<void> {
    try {
      await this.safeInvoke('test_terminal_integration', { terminal: this.selectedTerminal });
      await this.showNotification('Success', 'Terminal opened successfully!', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.showNotification('Error', `Failed to open terminal: ${message}`, 'error');
    }
  }

  private async openDashboard(): Promise<void> {
    try {
      const status = await this.safeInvoke<ServerStatus>('get_server_status');
      if (status.running && status.url) {
        await this.openExternal(status.url);
      } else {
        await this.showNotification('Server Not Running', 'Please start the server from the tray menu', 'warning');
      }
    } catch (error) {
      console.error('Failed to open dashboard:', error);
    }
  }

  private async skipPassword(): Promise<void> {
    // Just move to next step
    const stepper = this.shadowRoot?.querySelector('vt-stepper') as any;
    if (stepper) {
      stepper.nextStep();
    }
  }

  private async handleComplete(): Promise<void> {
    // Save that welcome has been completed
    try {
      const settings = await this.safeInvoke<Settings>('get_settings');
      settings.general = settings.general || {};
      settings.general.show_welcome_on_startup = false;
      await this.safeInvoke('save_settings', { settings });
      
      // Close the welcome window
      if (this.window) {
        await this.window.getCurrent().close();
      }
    } catch (error) {
      console.error('Failed to complete welcome:', error);
    }
  }

  override render() {
    return html`
      <vt-stepper 
        .currentStep=${this.currentStep}
        @step-change=${(e: CustomEvent<{ step: number }>) => this.currentStep = e.detail.step}
        @complete=${this.handleComplete}
      >
        <!-- Step 0: Welcome -->
        <div slot="step-0" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Welcome to VibeTunnel</h1>
          <p class="subtitle">Turn any browser into your terminal. Command your agents on the go.</p>
          <p class="description">
            You'll be quickly guided through the basics of VibeTunnel.<br>
            This screen can always be opened from the settings.
          </p>
        </div>

        <!-- Step 1: Install CLI -->
        <div slot="step-1" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Install the VT Command</h1>
          <p class="subtitle">The <code>vt</code> command lets you quickly create terminal sessions</p>
          <div class="code-block">
            $ vt<br>
            # Creates a new terminal session in your browser
          </div>
          <div class="button-group">
            <vt-button 
              variant="secondary"
              @click=${this.installCLI}
              ?disabled=${this.cliInstallStatus.includes('successfully')}
            >
              Install CLI Tool
            </vt-button>
          </div>
          ${this.cliInstallStatus ? html`
            <div class="status-message ${this.cliInstallStatus.includes('failed') ? 'error' : 'success'}">
              ${this.cliInstallStatus}
            </div>
          ` : ''}
        </div>

        <!-- Step 2: Permissions -->
        <div slot="step-2" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Grant Permissions</h1>
          <p class="subtitle">VibeTunnel needs permissions to function properly</p>
          <div class="feature-list">
            <div class="feature-item">
              <svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div>
                <div class="font-medium">Accessibility</div>
                <div class="text-sm text-tertiary">To integrate with terminal emulators</div>
              </div>
            </div>
            <div class="feature-item">
              <svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div>
                <div class="font-medium">Automation</div>
                <div class="text-sm text-tertiary">To control terminal windows</div>
              </div>
            </div>
          </div>
          <div class="button-group">
            <vt-button 
              variant="secondary"
              @click=${this.requestPermissions}
              ?disabled=${this.permissionsGranted}
            >
              ${this.permissionsGranted ? 'Permissions Granted' : 'Grant Permissions'}
            </vt-button>
          </div>
        </div>

        <!-- Step 3: Select Terminal -->
        <div slot="step-3" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Select Your Terminal</h1>
          <p class="subtitle">Choose your preferred terminal emulator</p>
          <div class="terminal-list">
            ${this.terminals.map(terminal => html`
              <div 
                class="terminal-option ${this.selectedTerminal === terminal.id ? 'selected' : ''}"
                @click=${() => this.selectTerminal(terminal.id)}
              >
                <div class="terminal-info">
                  <div class="terminal-name">${terminal.name}</div>
                  <div class="terminal-path">${terminal.path || 'Default'}</div>
                </div>
              </div>
            `)}
          </div>
          <div class="button-group">
            <vt-button variant="secondary" @click=${this.testTerminal}>
              Test Terminal
            </vt-button>
          </div>
        </div>

        <!-- Step 4: Security -->
        <div slot="step-4" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Protect Your Dashboard</h1>
          <p class="subtitle">Security is important when accessing terminals remotely</p>
          <p class="description">
            We recommend setting a password for your dashboard,<br>
            especially if you plan to access it from outside your local network.
          </p>
          <div class="button-group">
            <vt-button variant="secondary" @click=${() => this.openSettings('dashboard')}>
              Set Password
            </vt-button>
            <vt-button variant="ghost" @click=${this.skipPassword}>
              Skip for Now
            </vt-button>
          </div>
        </div>

        <!-- Step 5: Remote Access -->
        <div slot="step-5" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>Access Your Dashboard</h1>
          <p class="subtitle">
            To access your terminals from any device, create a tunnel from your device.<br><br>
            This can be done via <strong>ngrok</strong> in settings or <strong>Tailscale</strong> (recommended).
          </p>
          <div class="button-group">
            <vt-button variant="secondary" @click=${this.openDashboard}>
              Open Dashboard
            </vt-button>
            <vt-button variant="ghost" @click=${() => this.openSettings('dashboard')}>
              Configure Access
            </vt-button>
          </div>
          <div class="credits">
            <p>Built by</p>
            <p>
              <a href="#" @click=${(e: Event) => { e.preventDefault(); this.openExternal('https://mariozechner.at/'); }} class="credit-link">@badlogic</a> • 
              <a href="#" @click=${(e: Event) => { e.preventDefault(); this.openExternal('https://lucumr.pocoo.org/'); }} class="credit-link">@mitsuhiko</a> • 
              <a href="#" @click=${(e: Event) => { e.preventDefault(); this.openExternal('https://steipete.me/'); }} class="credit-link">@steipete</a>
            </p>
          </div>
        </div>

        <!-- Step 6: Complete -->
        <div slot="step-6" class="welcome-step">
          <img src="./icon.png" alt="VibeTunnel" class="app-icon">
          <h1>You're All Set!</h1>
          <p class="subtitle">VibeTunnel is now running in your system tray</p>
          <p class="description">
            Click the VibeTunnel icon in your system tray to access settings,<br>
            open the dashboard, or manage your terminal sessions.
          </p>
        </div>
      </vt-stepper>
    `;
  }
}
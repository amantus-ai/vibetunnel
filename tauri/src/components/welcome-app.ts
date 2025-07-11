import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import './glowing-app-icon';
import './shared/vt-button';
import './shared/window-header';
import './settings-checkbox';
import './settings-select';

interface Terminal {
  id: string;
  name: string;
  path?: string;
  icon?: string;
}

@customElement('welcome-app')
export class WelcomeApp extends TauriBase {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--border-primary);
    }

    .welcome-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      width: 100%;
      height: 100%;
    }

    /* Header Section */
    .header {
      height: 200px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    /* Content Section */
    .content {
      flex: 1;
      height: 260px;
      overflow: hidden;
      position: relative;
    }

    .pages-container {
      display: flex;
      height: 100%;
      transition: transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .page {
      width: 640px;
      flex-shrink: 0;
      padding: 0 60px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    /* Navigation Section */
    .navigation {
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-top: 1px solid var(--border-primary);
    }

    .nav-button {
      min-width: 80px;
    }

    .page-indicators {
      display: flex;
      gap: 8px;
    }

    .page-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--bg-hover);
      cursor: pointer;
      transition: all 0.3s ease;
      border: none;
      padding: 0;
    }

    .page-dot:hover {
      background: var(--bg-active);
    }

    .page-dot.active {
      background: var(--accent);
    }

    /* Page Content Styles */
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }

    h2 {
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }

    .tagline {
      font-size: 18px;
      color: var(--text-secondary);
      margin: 0 0 24px 0;
      line-height: 1.5;
    }

    .description {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
      max-width: 480px;
      margin: 0 auto;
    }

    .code-block {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 16px 24px;
      font-family: var(--font-mono);
      font-size: 14px;
      margin: 24px 0;
    }

    .button-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 24px;
      width: 100%;
      max-width: 300px;
    }

    .status-message {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      margin-top: 12px;
    }

    .status-message.success {
      color: var(--success, #10b981);
    }

    .status-message.error {
      color: var(--error, #ef4444);
    }

    .password-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      max-width: 300px;
      margin: 24px 0;
    }

    .password-input {
      padding: 10px 16px;
      font-size: 14px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      color: var(--text-primary);
      transition: all 0.2s ease;
    }

    .password-input:hover {
      border-color: var(--border-secondary);
      background: var(--bg-hover);
    }

    .password-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .help-text {
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 8px;
    }

    .credits {
      margin-top: 32px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .credit-links {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 8px;
    }

    .credit-links a {
      color: var(--accent);
      text-decoration: none;
    }

    .credit-links a:hover {
      text-decoration: underline;
    }

    .separator {
      color: var(--text-tertiary);
    }

    /* Theme Variables */
    :host {
      --bg-primary: rgba(0, 0, 0, 0.85);
      --bg-secondary: rgba(20, 20, 20, 0.95);
      --bg-hover: rgba(255, 255, 255, 0.05);
      --bg-active: rgba(16, 185, 129, 0.1);
      
      --text-primary: #fff;
      --text-secondary: rgba(255, 255, 255, 0.6);
      --text-tertiary: rgba(255, 255, 255, 0.4);
      
      --border-primary: rgba(255, 255, 255, 0.08);
      --border-secondary: rgba(255, 255, 255, 0.12);
      
      --accent: #10b981;
      --accent-hover: #0ea671;
      --accent-glow: rgba(16, 185, 129, 0.5);
      
      --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'SF Mono', Consolas, 'Courier New', monospace;
      
      --success: #10b981;
      --error: #ef4444;
    }

    /* Light theme */
    :host-context(html.light) {
      --bg-primary: rgba(255, 255, 255, 0.85);
      --bg-secondary: rgba(249, 250, 251, 0.95);
      --bg-hover: rgba(0, 0, 0, 0.05);
      --bg-active: rgba(16, 185, 129, 0.1);
      
      --text-primary: #111827;
      --text-secondary: #6b7280;
      --text-tertiary: #9ca3af;
      
      --border-primary: rgba(0, 0, 0, 0.08);
      --border-secondary: rgba(0, 0, 0, 0.12);
    }
  `;

  @state()
  private currentPage = 0;

  @state()
  private vtInstalled = false;

  @state()
  private vtInstalling = false;

  @state()
  private vtError = '';

  @state()
  private automationGranted = false;

  @state()
  private accessibilityGranted = false;

  @state()
  private selectedTerminal = 'terminal';

  @state()
  private password = '';

  @state()
  private confirmPassword = '';

  @state()
  private passwordError = '';

  @state()
  private passwordSaved = false;

  private readonly totalPages = 6;

  override async connectedCallback() {
    super.connectedCallback();
    
    if (this.tauriAvailable) {
      // Check initial states
      await this.checkVtInstallation();
      await this.checkPermissions();
    }

    // Add keyboard navigation
    this.addEventListener('keydown', this.handleKeyDown);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && this.currentPage < this.totalPages - 1) {
      this.nextPage();
    }
  };

  private async checkVtInstallation(): Promise<void> {
    try {
      const result = await this.safeInvoke<{ installed: boolean }>('check_vt_installation');
      this.vtInstalled = result.installed;
    } catch (error) {
      console.error('Failed to check VT installation:', error);
    }
  }

  private async checkPermissions(): Promise<void> {
    try {
      const permissions = await this.safeInvoke<{ automation: boolean; accessibility: boolean }>('check_permissions');
      this.automationGranted = permissions.automation;
      this.accessibilityGranted = permissions.accessibility;
    } catch (error) {
      console.error('Failed to check permissions:', error);
    }
  }

  private async installVt(): Promise<void> {
    if (this.vtInstalling || this.vtInstalled) return;

    this.vtInstalling = true;
    this.vtError = '';

    try {
      await this.safeInvoke('install_vt');
      this.vtInstalled = true;
    } catch (error) {
      this.vtError = error instanceof Error ? error.message : 'Installation failed';
    } finally {
      this.vtInstalling = false;
    }
  }

  private async requestAutomation(): Promise<void> {
    try {
      await this.safeInvoke('request_automation_permission');
      // Re-check after a delay
      setTimeout(() => this.checkPermissions(), 1000);
    } catch (error) {
      console.error('Failed to request automation permission:', error);
    }
  }

  private async requestAccessibility(): Promise<void> {
    try {
      await this.safeInvoke('request_accessibility_permission');
      // Re-check after a delay
      setTimeout(() => this.checkPermissions(), 1000);
    } catch (error) {
      console.error('Failed to request accessibility permission:', error);
    }
  }

  private async testTerminal(): Promise<void> {
    try {
      await this.safeInvoke('test_terminal', { terminal: this.selectedTerminal });
    } catch (error) {
      console.error('Failed to test terminal:', error);
      // Show error dialog
    }
  }

  private async savePassword(): Promise<void> {
    this.passwordError = '';

    if (!this.password) {
      this.passwordError = 'Password cannot be empty';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.passwordError = 'Passwords do not match';
      return;
    }

    if (this.password.length < 6) {
      this.passwordError = 'Password must be at least 6 characters';
      return;
    }

    try {
      await this.safeInvoke('save_dashboard_password', { password: this.password });
      this.passwordSaved = true;
    } catch (error) {
      this.passwordError = error instanceof Error ? error.message : 'Failed to save password';
    }
  }

  private async openDashboard(): Promise<void> {
    try {
      await this.safeInvoke('open_dashboard');
    } catch (error) {
      console.error('Failed to open dashboard:', error);
    }
  }

  private async finishWelcome(): Promise<void> {
    try {
      await this.safeInvoke('finish_welcome');
      // Close window after saving state
      window.close();
    } catch (error) {
      console.error('Failed to finish welcome:', error);
    }
  }

  private nextPage(): void {
    if (this.currentPage < this.totalPages - 1) {
      this.currentPage++;
    } else {
      this.finishWelcome();
    }
  }

  private previousPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
    }
  }

  private goToPage(page: number): void {
    if (page >= 0 && page < this.totalPages) {
      this.currentPage = page;
    }
  }

  private renderPage(pageNumber: number) {
    switch (pageNumber) {
      case 0:
        return this.renderWelcomePage();
      case 1:
        return this.renderVtCommandPage();
      case 2:
        return this.renderPermissionsPage();
      case 3:
        return this.renderTerminalPage();
      case 4:
        return this.renderPasswordPage();
      case 5:
        return this.renderAccessPage();
      default:
        return html``;
    }
  }

  private renderWelcomePage() {
    return html`
      <div class="page">
        <h1>Welcome to VibeTunnel</h1>
        <p class="tagline">Turn any browser into your terminal. Command your agents on the go.</p>
        <p class="description">
          You'll be quickly guided through the basics of VibeTunnel. 
          This screen can always be opened from the settings.
        </p>
      </div>
    `;
  }

  private renderVtCommandPage() {
    return html`
      <div class="page">
        <h2>Capturing Terminal Apps</h2>
        <p class="description">
          With the <strong>vt</strong> command, you can capture any terminal application.
          For example, to capture Claude, run:
        </p>
        <div class="code-block">vt claude</div>
        
        <vt-button
          .variant=${'primary'}
          .size=${'large'}
          @click=${this.installVt}
          ?disabled=${this.vtInstalled || this.vtInstalling}
        >
          ${this.vtInstalled ? 'VT Command Installed' : 'Install VT Command Line Tool'}
        </vt-button>
        
        ${this.vtInstalled ? html`
          <div class="status-message success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>VT command line tool installed successfully</span>
          </div>
        ` : ''}
        
        ${this.vtError ? html`
          <div class="status-message error">
            <span>${this.vtError}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderPermissionsPage() {
    return html`
      <div class="page">
        <h2>Request Permissions</h2>
        <p class="description">
          VibeTunnel needs AppleScript to start new terminal sessions 
          and accessibility to send commands.
        </p>
        
        <div class="button-group">
          <vt-button
            .variant=${'primary'}
            .size=${'large'}
            @click=${this.requestAutomation}
            ?disabled=${this.automationGranted}
          >
            ${this.automationGranted ? '✓ Automation Permission Granted' : 'Grant Automation Permission'}
          </vt-button>
          
          <vt-button
            .variant=${'secondary'}
            .size=${'large'}
            @click=${this.requestAccessibility}
            ?disabled=${this.accessibilityGranted}
          >
            ${this.accessibilityGranted ? '✓ Accessibility Permission Granted' : 'Grant Accessibility Permission'}
          </vt-button>
        </div>
      </div>
    `;
  }

  private renderTerminalPage() {
    return html`
      <div class="page">
        <h2>Select Terminal</h2>
        <p class="description">
          VibeTunnel can spawn new sessions and open a terminal for you. 
          Select your preferred Terminal and test permissions.
        </p>
        
        <div class="button-group">
          <settings-select
            label=""
            settingKey="terminal"
            .value=${this.selectedTerminal}
            .options=${[
              { value: 'terminal', label: 'Terminal.app' },
              { value: 'iterm2', label: 'iTerm2' },
              { value: 'warp', label: 'Warp' }
            ]}
            @change=${(e: CustomEvent) => this.selectedTerminal = e.detail.value}
          ></settings-select>
          
          <vt-button
            .variant=${'secondary'}
            .size=${'medium'}
            @click=${this.testTerminal}
          >
            Test Terminal Permission
          </vt-button>
        </div>
      </div>
    `;
  }

  private renderPasswordPage() {
    return html`
      <div class="page">
        <h2>Protect Your Dashboard</h2>
        <p class="description">
          If you want to access your dashboard over the network, set a password now.
          Otherwise, it will only be accessible via localhost.
        </p>
        
        <div class="password-group">
          <input
            type="password"
            class="password-input"
            placeholder="Password"
            .value=${this.password}
            @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value}
            ?disabled=${this.passwordSaved}
          />
          <input
            type="password"
            class="password-input"
            placeholder="Confirm Password"
            .value=${this.confirmPassword}
            @input=${(e: Event) => this.confirmPassword = (e.target as HTMLInputElement).value}
            ?disabled=${this.passwordSaved}
          />
          
          ${!this.passwordSaved ? html`
            <vt-button
              .variant=${'primary'}
              .size=${'medium'}
              @click=${this.savePassword}
              ?disabled=${!this.password}
            >
              Set Password
            </vt-button>
          ` : html`
            <div class="status-message success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>Password saved successfully</span>
            </div>
          `}
        </div>
        
        ${this.passwordError ? html`
          <div class="status-message error">
            <span>${this.passwordError}</span>
          </div>
        ` : ''}
        
        <p class="help-text">Leave empty to skip password protection</p>
      </div>
    `;
  }

  private renderAccessPage() {
    return html`
      <div class="page">
        <h2>Accessing Your Dashboard</h2>
        <p class="description">
          To access your terminals from any device, create a tunnel from your device.
          This can be done via <strong>ngrok</strong> in settings or 
          <strong>Cloudflare</strong> or <strong>Tailscale</strong>.
        </p>
        
        <vt-button
          .variant=${'primary'}
          .size=${'large'}
          @click=${this.openDashboard}
        >
          Open Dashboard
        </vt-button>
        
        <p class="help-text">
          <a href="https://tailscale.com" target="_blank">Learn more about Tailscale</a>
        </p>
        
        <div class="credits">
          <p class="credits-label">Brought to you by</p>
          <div class="credit-links">
            <a href="https://mariozechner.at/" target="_blank">@badlogic</a>
            <span class="separator">•</span>
            <a href="https://lucumr.pocoo.org/" target="_blank">@mitsuhiko</a>
            <span class="separator">•</span>
            <a href="https://steipete.me" target="_blank">@steipete</a>
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      <window-header .showMaximize=${false}></window-header>
      <div class="welcome-container">
        <header class="header">
          <glowing-app-icon
            .size=${128}
            .enableFloating=${true}
            .enableInteraction=${false}
            .glowIntensity=${0.3}
          ></glowing-app-icon>
        </header>
        
        <main class="content">
          <div 
            class="pages-container" 
            style="transform: translateX(-${this.currentPage * 640}px)"
          >
            ${Array.from({ length: this.totalPages }, (_, i) => this.renderPage(i))}
          </div>
        </main>
        
        <nav class="navigation">
          ${this.currentPage > 0 ? html`
            <vt-button
              .variant=${'secondary'}
              .size=${'small'}
              @click=${this.previousPage}
              class="nav-button"
            >
              Back
            </vt-button>
          ` : html`<div class="nav-button"></div>`}
          
          <div class="page-indicators">
            ${Array.from({ length: this.totalPages }, (_, i) => html`
              <button
                class="page-dot ${i === this.currentPage ? 'active' : ''}"
                @click=${() => this.goToPage(i)}
                aria-label="Go to page ${i + 1}"
              ></button>
            `)}
          </div>
          
          <vt-button
            .variant=${'primary'}
            .size=${'small'}
            @click=${this.nextPage}
            class="nav-button"
          >
            ${this.currentPage === this.totalPages - 1 ? 'Finish' : 'Next'}
          </vt-button>
        </nav>
      </div>
    `;
  }
}
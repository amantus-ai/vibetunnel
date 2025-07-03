import { html, css, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import { formStyles } from './shared/styles';
import './settings-tab';
import './settings-checkbox';
import './settings-select';
import './glowing-app-icon';
import './shared/window-header';

interface SettingsData {
  general?: {
    launch_at_login?: boolean;
    show_welcome_on_startup?: boolean;
    show_dock_icon?: boolean;
    theme?: 'system' | 'light' | 'dark';
    default_terminal?: string;
  };
  dashboard?: {
    password_enabled?: boolean;
    password?: string;
    access_mode?: 'localhost' | 'network';
    port?: string;
    ngrok_enabled?: boolean;
    ngrok_token?: string;
  };
  advanced?: {
    debug_mode?: boolean;
    cleanup_on_startup?: boolean;
    preferred_terminal?: string;
    preferred_git_app?: string;
  };
}

interface SystemInfo {
  version?: string;
  os?: string;
  arch?: string;
}

interface TabConfig {
  id: string;
  name: string;
  icon: TemplateResult;
}

type SettingChangeEvent = CustomEvent<{
  settingKey: string;
  checked?: boolean;
  value?: string | number | boolean;
}>;

@customElement('settings-app')
export class SettingsApp extends TauriBase {
  @state()
  private password = '';
  
  @state()
  private confirmPassword = '';
  
  @state()
  private passwordError = '';
  
  // Debug panel state
  @state()
  private debugLogs: Array<any> = [];
  
  @state()
  private performanceMetrics: any = {};
  
  @state()
  private networkRequests: Array<any> = [];
  
  @state()
  private apiTestResults: Array<any> = [];
  
  @state()
  private memorySnapshots: Array<any> = [];
  
  @state()
  private debugStats: any = {};
  
  @state()
  private debugSubTab = 'logs';
  
  @state()
  private logFilter = 'all';
  
  @state()
  private logSearchTerm = '';
  
  @state()
  private isRunningTests = false;
  
  @state()
  private diagnosticReport: any = null;
  
  @state()
  private installedGitApps: Array<{value: string, label: string}> = [];
  static override styles = [
    formStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-primary);
      user-select: none;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      border-radius: 12px;
      border: 1px solid var(--border-primary);
      overflow: hidden;
    }

    .window {
      display: flex;
      flex: 1;
      width: 100%;
      background: var(--bg-primary);
      -webkit-app-region: no-drag;
      overflow: hidden;
    }

    .sidebar {
      width: 200px;
      background: var(--bg-secondary);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border-right: 1px solid var(--border-primary);
      padding: 24px 0;
      position: relative;
      z-index: 10;
    }

    .tabs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: block;
    }

    .content {
      flex: 1;
      padding: 40px;
      overflow-y: auto;
      background: var(--bg-tertiary);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
    }

    .content::-webkit-scrollbar {
      width: 8px;
    }

    .content::-webkit-scrollbar-track {
      background: var(--bg-card);
      border-radius: 4px;
    }

    .content::-webkit-scrollbar-thumb {
      background: var(--bg-button);
      border-radius: 4px;
    }

    .content::-webkit-scrollbar-thumb:hover {
      background: var(--bg-button-hover);
    }

    .tab-content {
      display: none;
      animation: fadeIn 0.3s ease;
    }

    .tab-content.active {
      display: block;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    h2 {
      margin: 0 0 32px 0;
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.5px;
    }

    h3 {
      margin: 0 0 20px 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.2px;
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 24px;
      margin-bottom: 40px;
    }

    .setting-card {
      background: var(--bg-card);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-primary);
      border-radius: 12px;
      padding: 24px;
      transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      animation: fadeInUp 0.5s ease forwards;
      opacity: 0;
    }

    .setting-card:hover {
      background: var(--bg-card);
      border-color: var(--border-secondary);
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .setting-card:nth-child(1) { animation-delay: 0.1s; }
    .setting-card:nth-child(2) { animation-delay: 0.15s; }
    .setting-card:nth-child(3) { animation-delay: 0.2s; }
    .setting-card:nth-child(4) { animation-delay: 0.25s; }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 1024px) {
      .settings-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Form Elements */
    .form-group {
      margin-bottom: 16px;
    }

    .form-input {
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      color: var(--text-primary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .form-input:hover {
      border-color: var(--border-secondary);
      background: var(--bg-hover);
    }

    .form-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    
    .password-section {
      margin-top: 16px;
      padding: 16px;
      background: var(--bg-hover);
      border-radius: 8px;
      border: 1px solid var(--border-primary);
    }
    
    .error-message {
      color: var(--error);
      font-size: 12px;
      margin-top: 8px;
      margin-bottom: 8px;
    }
    
    .btn {
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 16px;
    }
    
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .form-input[type="number"] {
      width: 120px;
    }

    .form-text {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    .password-section {
      margin-top: 12px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* About Tab Styles */
    .about-content {
      max-width: 600px;
      margin: 0 auto;
      text-align: center;
      padding: 40px 20px;
    }

    .app-info-section {
      margin-bottom: 32px;
    }

    .app-name {
      font-size: 36px;
      font-weight: 500;
      margin: 24px 0 8px 0;
      letter-spacing: -0.5px;
    }

    .app-version {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0;
    }

    .description-section {
      margin-bottom: 32px;
    }

    .description-section p {
      font-size: 16px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
    }

    .links-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 48px;
    }

    .link-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      color: var(--accent);
      text-decoration: none;
      border-radius: 8px;
      transition: all 0.2s ease;
      width: fit-content;
      margin: 0 auto;
    }

    .link-item:hover {
      background: var(--bg-hover);
      text-decoration: underline;
      transform: translateX(4px);
    }

    .link-item svg {
      flex-shrink: 0;
    }

    .credits-section {
      padding-top: 24px;
      border-top: 1px solid var(--border-primary);
    }

    .credits-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin: 0 0 8px 0;
    }

    .credits-links {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .credit-link {
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      transition: all 0.2s ease;
    }

    .credit-link:hover {
      text-decoration: underline;
    }

    .separator {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .copyright {
      font-size: 11px;
      color: var(--text-tertiary);
      margin: 0;
    }

    /* Theme Variables */
    :host {
      /* Dark theme (default) */
      --bg-primary: #000;
      --bg-secondary: rgba(20, 20, 20, 0.95);
      --bg-tertiary: rgba(15, 15, 15, 0.95);
      --bg-hover: rgba(255, 255, 255, 0.05);
      --bg-active: rgba(16, 185, 129, 0.1);
      --bg-card: rgba(255, 255, 255, 0.03);
      --bg-button: rgba(255, 255, 255, 0.1);
      --bg-button-hover: rgba(255, 255, 255, 0.15);
      
      --text-primary: #fff;
      --text-secondary: rgba(255, 255, 255, 0.6);
      --text-tertiary: rgba(255, 255, 255, 0.4);
      
      --border-primary: rgba(255, 255, 255, 0.08);
      --border-secondary: rgba(255, 255, 255, 0.12);
      
      --accent: #10b981;
      --accent-hover: #0ea671;
      --accent-glow: rgba(16, 185, 129, 0.5);
    }

    /* Light theme */
    :host-context(html.light) {
      --bg-primary: #ffffff;
      --bg-secondary: rgba(249, 250, 251, 0.95);
      --bg-tertiary: rgba(243, 244, 246, 0.95);
      --bg-hover: rgba(0, 0, 0, 0.05);
      --bg-active: rgba(16, 185, 129, 0.1);
      --bg-card: rgba(0, 0, 0, 0.02);
      --bg-button: rgba(0, 0, 0, 0.05);
      --bg-button-hover: rgba(0, 0, 0, 0.1);
      
      --text-primary: #111827;
      --text-secondary: #6b7280;
      --text-tertiary: #9ca3af;
      
      --border-primary: rgba(0, 0, 0, 0.08);
      --border-secondary: rgba(0, 0, 0, 0.12);
      
      --accent: #10b981;
      --accent-hover: #059669;
      --accent-glow: rgba(16, 185, 129, 0.3);
    }

    /* Debug panel styles */
    .debug-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .debug-tabs {
      display: flex;
      gap: 2px;
      padding: 0;
      margin: 0 0 24px 0;
      background: var(--bg-card);
      border-radius: 8px;
      padding: 4px;
    }

    .debug-tab {
      padding: 8px 16px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .debug-tab:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .debug-tab.active {
      background: var(--accent);
      color: white;
    }

    .debug-content {
      flex: 1;
      overflow: hidden;
    }

    .logs-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .logs-toolbar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: center;
    }

    .log-filters {
      display: flex;
      gap: 4px;
    }

    .log-filter-btn {
      padding: 6px 12px;
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .log-filter-btn:first-child {
      border-radius: 6px 0 0 6px;
    }

    .log-filter-btn:last-child {
      border-radius: 0 6px 6px 0;
    }

    .log-filter-btn:not(:last-child) {
      border-right: none;
    }

    .log-filter-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }

    .log-search {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
    }

    .log-search input {
      flex: 1;
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
    }

    .logs-view {
      flex: 1;
      background: #0e0e0e;
      border-radius: 8px;
      padding: 16px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
    }

    .log-entry {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
      padding: 2px 0;
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
      width: 60px;
      flex-shrink: 0;
    }

    .log-level.trace { color: #9ca3af; }
    .log-level.debug { color: #b5cea8; }
    .log-level.info { color: #3794ff; }
    .log-level.warn { color: #ce9178; }
    .log-level.error { color: #f48771; }

    .log-message {
      flex: 1;
      color: #d4d4d4;
      word-break: break-word;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 16px;
    }

    .metric-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .metric-value {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .metric-unit {
      font-size: 14px;
      color: var(--text-secondary);
      margin-left: 4px;
    }

    .network-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .network-item {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .network-item:hover {
      border-color: var(--border-secondary);
    }

    .network-method {
      font-weight: 600;
      color: var(--accent);
      margin-right: 8px;
    }

    .network-url {
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .network-status {
      float: right;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .network-status.success {
      background: var(--success-bg);
      color: var(--success);
    }

    .network-status.error {
      background: var(--error-bg);
      color: var(--error);
    }

    .api-test-form {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .test-results {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .test-result {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 12px;
    }

    .test-result.success {
      border-color: var(--success);
    }

    .test-result.failure {
      border-color: var(--error);
    }

    .memory-chart {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 24px;
      height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
    }

    .diagnostic-section {
      background: var(--bg-card);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
    }

    .diagnostic-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text-primary);
    }

    .diagnostic-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-primary);
    }

    .diagnostic-item:last-child {
      border-bottom: none;
    }

    .diagnostic-label {
      color: var(--text-secondary);
      font-size: 13px;
    }

    .diagnostic-value {
      color: var(--text-primary);
      font-weight: 500;
      font-size: 13px;
    }

    .action-buttons {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: var(--text-tertiary);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.3;
    }
  `
  ];

  @state()
  private activeTab = 'general';

  @state()
  private settings: SettingsData = {
    general: {},
    dashboard: {},
    advanced: {}
  };

  @state()
  private systemInfo: SystemInfo = {};

  @state()
  private debugMode = false;

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    
    // Check for tab parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam) {
      this.activeTab = tabParam;
    }

    // TauriBase handles initialization, just load data if available
    if (this.tauriAvailable) {
      // Load settings
      await this.loadSettings();
      
      // Get system info
      await this.loadSystemInfo();
      
      // Load debug data if in debug mode
      if (this.debugMode) {
        await this.loadDebugData();
      }
      
      // Load installed Git apps
      await this.loadInstalledGitApps();
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.safeInvoke<SettingsData>('get_settings');
      this.settings = settings;
      
      // Check debug mode
      this.debugMode = settings.advanced?.debug_mode || false;
      
      // Apply theme
      this.applyTheme(settings.general?.theme || 'system');
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  private async loadSystemInfo(): Promise<void> {
    try {
      const info = await this.safeInvoke<SystemInfo>('get_system_info');
      this.systemInfo = info;
    } catch (error) {
      console.error('Failed to get system info:', error);
    }
  }

  private async loadInstalledGitApps(): Promise<void> {
    try {
      const apps = await this.safeInvoke<Array<{value: string, label: string}>>('get_installed_git_apps');
      this.installedGitApps = apps || [];
    } catch (error) {
      console.error('Failed to load installed Git apps:', error);
    }
  }

  private applyTheme(theme: 'system' | 'light' | 'dark'): void {
    const htmlElement = document.documentElement;
    
    if (theme === 'dark') {
      htmlElement.classList.add('dark');
      htmlElement.classList.remove('light');
    } else if (theme === 'light') {
      htmlElement.classList.remove('dark');
      htmlElement.classList.add('light');
    } else {
      // System theme - detect preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        htmlElement.classList.add('dark');
        htmlElement.classList.remove('light');
      } else {
        htmlElement.classList.remove('dark');
        htmlElement.classList.add('light');
      }
    }
  }

  private async saveSettings(): Promise<void> {
    if (!this.tauriAvailable) return;
    
    try {
      await this.safeInvoke('save_settings', { settings: this.settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  private async handleSettingChange(e: SettingChangeEvent): Promise<void> {
    const { settingKey, checked, value } = e.detail;
    const [category, key] = settingKey.split('.') as [keyof SettingsData, string];
    
    if (!this.settings[category]) {
      this.settings[category] = {};
    }
    
    (this.settings[category] as any)[key] = checked !== undefined ? checked : value;
    
    // Special handling for certain settings
    if (settingKey === 'general.theme' && typeof value === 'string') {
      this.applyTheme(value as 'system' | 'light' | 'dark');
    } else if (settingKey === 'advanced.debug_mode') {
      this.debugMode = !!checked;
    } else if (settingKey === 'general.launch_at_login' && this.tauriAvailable) {
      try {
        await this.safeInvoke('set_auto_launch', { enabled: checked });
      } catch (error) {
        console.error('Failed to set auto launch:', error);
      }
    }
    
    await this.saveSettings();
    this.requestUpdate();
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
      if (this.tauriAvailable) {
        await this.safeInvoke('set_dashboard_password', { password: this.password });
      }
      
      // Update local settings
      if (!this.settings.dashboard) {
        this.settings.dashboard = {};
      }
      this.settings.dashboard.password = this.password;
      await this.saveSettings();
      
      // Clear password fields after successful save
      this.password = '';
      this.confirmPassword = '';
      this.passwordError = '';
      
      // Show success message or notification
      this.requestUpdate();
    } catch (error) {
      this.passwordError = error instanceof Error ? error.message : 'Failed to save password';
    }
  }

  private _switchTab(tabName: string): void {
    this.activeTab = tabName;
  }

  private _renderGeneralTab(): TemplateResult {
    return html`
      <div class="tab-content ${this.activeTab === 'general' ? 'active' : ''}" id="general">
        <h2>General</h2>
        
        <div class="settings-grid">
          <div class="setting-card">
            <h3>Startup</h3>
            <settings-checkbox
              .checked=${this.settings.general?.launch_at_login || false}
              label="Launch at Login"
              help="Start VibeTunnel when you log in"
              settingKey="general.launch_at_login"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
            <settings-checkbox
              .checked=${this.settings.general?.show_welcome_on_startup !== false}
              label="Show Welcome Guide"
              help="Display welcome screen on startup"
              settingKey="general.show_welcome_on_startup"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
          </div>
          
          <div class="setting-card">
            <h3>Terminal</h3>
            <settings-select
              label="Default Terminal"
              help="Choose your preferred terminal application"
              settingKey="general.default_terminal"
              .value=${this.settings.general?.default_terminal || 'terminal'}
              .options=${[
                { value: 'terminal', label: 'Terminal.app' },
                { value: 'iterm2', label: 'iTerm2' },
                { value: 'warp', label: 'Warp' }
              ]}
              @change=${this.handleSettingChange}
            ></settings-select>
          </div>
          
          <div class="setting-card">
            <h3>Appearance</h3>
            <settings-checkbox
              .checked=${this.settings.general?.show_dock_icon !== false}
              label="Show Dock Icon"
              help="Display in dock or taskbar"
              settingKey="general.show_dock_icon"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
            
            <settings-select
              label="Theme"
              help="Choose your preferred color scheme"
              settingKey="general.theme"
              .value=${this.settings.general?.theme || 'system'}
              .options=${[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
              @change=${this.handleSettingChange}
            ></settings-select>
          </div>
        </div>
      </div>
    `;
  }

  private _renderDashboardTab(): TemplateResult {
    return html`
      <div class="tab-content ${this.activeTab === 'dashboard' ? 'active' : ''}" id="dashboard">
        <h2>Dashboard</h2>
        
        <div class="settings-grid">
          <div class="setting-card">
            <h3>Security</h3>
            <settings-checkbox
              .checked=${this.settings.dashboard?.password_enabled || false}
              label="Password protect dashboard"
              help="Require a password to access the dashboard from remote connections"
              settingKey="dashboard.password_enabled"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
            
            ${this.settings.dashboard?.password_enabled ? html`
              <div class="password-section">
                <div class="form-group">
                  <label for="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    class="form-input"
                    .value=${this.password}
                    @input=${(e: Event) => {
                      const input = e.target as HTMLInputElement;
                      this.password = input.value;
                      this.passwordError = '';
                    }}
                  />
                </div>
                
                <div class="form-group">
                  <label for="confirm-password">Confirm Password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder="Confirm password"
                    class="form-input"
                    .value=${this.confirmPassword}
                    @input=${(e: Event) => {
                      const input = e.target as HTMLInputElement;
                      this.confirmPassword = input.value;
                      this.passwordError = '';
                    }}
                  />
                </div>
                
                ${this.passwordError ? html`
                  <div class="error-message">${this.passwordError}</div>
                ` : ''}
                
                <button 
                  class="btn btn-primary"
                  @click=${this.savePassword}
                  ?disabled=${!this.password || !this.confirmPassword}
                >
                  Save Password
                </button>
              </div>
            ` : ''}
          </div>
          
          <div class="setting-card">
            <h3>Server Configuration</h3>
            <settings-select
              label="Allow dashboard access from"
              help="Control where the dashboard can be accessed from"
              settingKey="dashboard.access_mode"
              .value=${this.settings.dashboard?.access_mode || 'localhost'}
              .options=${[
                { value: 'localhost', label: 'This Mac only' },
                { value: 'network', label: 'Local network' }
              ]}
              @change=${this.handleSettingChange}
            ></settings-select>
            
            <div class="form-group">
              <label>Server port</label>
              <input
                type="number"
                class="form-input"
                .value=${this.settings.dashboard?.port || '4022'}
                @input=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  this.handleSettingChange(new CustomEvent('change', {
                    detail: { settingKey: 'dashboard.port', value: input.value }
                  }) as SettingChangeEvent);
                }}
              />
              <small class="form-text">The server will automatically restart when the port is changed</small>
            </div>
          </div>
          
          <div class="setting-card">
            <h3>ngrok Integration</h3>
            <settings-checkbox
              .checked=${this.settings.dashboard?.ngrok_enabled || false}
              label="Enable ngrok tunnel"
              help="Expose VibeTunnel to the internet using ngrok"
              settingKey="dashboard.ngrok_enabled"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
            
            ${this.settings.dashboard?.ngrok_enabled ? html`
              <div class="form-group">
                <label>Auth token</label>
                <input
                  type="password"
                  placeholder="Enter ngrok auth token"
                  class="form-input"
                  .value=${this.settings.dashboard?.ngrok_token || ''}
                  @input=${(e: Event) => {
                    const input = e.target as HTMLInputElement;
                    this.handleSettingChange(new CustomEvent('change', {
                      detail: { settingKey: 'dashboard.ngrok_token', value: input.value }
                    }) as SettingChangeEvent);
                  }}
                />
                <small class="form-text">Get your free auth token at <a href="https://ngrok.com" target="_blank">ngrok.com</a></small>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderDebugTab(): TemplateResult | '' {
    if (!this.debugMode) return '';
    
    return html`
      <div class="tab-content ${this.activeTab === 'debug' ? 'active' : ''}" id="debug">
        <h2>Debug</h2>
        
        <div class="debug-container">
          <div class="debug-tabs">
            <button 
              class="debug-tab ${this.debugSubTab === 'logs' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'logs'}
            >
              Logs
            </button>
            <button 
              class="debug-tab ${this.debugSubTab === 'performance' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'performance'}
            >
              Performance
            </button>
            <button 
              class="debug-tab ${this.debugSubTab === 'network' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'network'}
            >
              Network
            </button>
            <button 
              class="debug-tab ${this.debugSubTab === 'api-testing' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'api-testing'}
            >
              API Testing
            </button>
            <button 
              class="debug-tab ${this.debugSubTab === 'memory' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'memory'}
            >
              Memory
            </button>
            <button 
              class="debug-tab ${this.debugSubTab === 'diagnostics' ? 'active' : ''}"
              @click=${() => this.debugSubTab = 'diagnostics'}
            >
              Diagnostics
            </button>
          </div>
          
          <div class="debug-content">
            ${this.debugSubTab === 'logs' ? this._renderLogsTab() : ''}
            ${this.debugSubTab === 'performance' ? this._renderPerformanceTab() : ''}
            ${this.debugSubTab === 'network' ? this._renderNetworkTab() : ''}
            ${this.debugSubTab === 'api-testing' ? this._renderApiTestingTab() : ''}
            ${this.debugSubTab === 'memory' ? this._renderMemoryTab() : ''}
            ${this.debugSubTab === 'diagnostics' ? this._renderDiagnosticsTab() : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderAdvancedTab(): TemplateResult {
    return html`
      <div class="tab-content ${this.activeTab === 'advanced' ? 'active' : ''}" id="advanced">
        <h2>Advanced</h2>
        
        <div class="settings-grid">
          <div class="setting-card">
            <h3>Terminal</h3>
            <settings-select
              label="Preferred Terminal"
              help="Select which application to use when creating new sessions"
              settingKey="advanced.preferred_terminal"
              .value=${this.settings.advanced?.preferred_terminal || 'terminal'}
              .options=${[
                { value: 'terminal', label: 'Terminal.app' },
                { value: 'iterm2', label: 'iTerm2' },
                { value: 'warp', label: 'Warp' }
              ]}
              @change=${this.handleSettingChange}
            ></settings-select>
          </div>
          
          <div class="setting-card">
            <h3>Git Applications</h3>
            <settings-select
              label="Preferred Git App"
              help="Select which Git GUI application to use when opening repositories"
              settingKey="advanced.preferred_git_app"
              .value=${this.settings.advanced?.preferred_git_app || 'auto'}
              .options=${[
                { value: 'auto', label: 'Auto-detect' },
                ...this.installedGitApps
              ]}
              @change=${this.handleSettingChange}
            ></settings-select>
          </div>
          
          <div class="setting-card">
            <h3>Advanced Options</h3>
            <settings-checkbox
              .checked=${this.settings.advanced?.cleanup_on_startup !== false}
              label="Clean up old sessions on startup"
              help="Automatically remove terminated sessions when the app starts"
              settingKey="advanced.cleanup_on_startup"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
            
            <settings-checkbox
              .checked=${this.settings.advanced?.debug_mode || false}
              label="Debug mode"
              help="Enable additional logging and debugging features"
              settingKey="advanced.debug_mode"
              @change=${this.handleSettingChange}
            ></settings-checkbox>
          </div>
        </div>
      </div>
    `;
  }

  private _renderAboutTab(): TemplateResult {
    return html`
      <div class="tab-content ${this.activeTab === 'about' ? 'active' : ''}" id="about">
        <div class="about-content">
          <div class="app-info-section">
            <glowing-app-icon
              .size=${128}
              .enableFloating=${true}
              .enableInteraction=${true}
              .glowIntensity=${0.3}
              @icon-click=${() => window.open('https://vibetunnel.sh', '_blank')}
            ></glowing-app-icon>
            
            <h1 class="app-name">VibeTunnel</h1>
            <p class="app-version">Version ${this.systemInfo.version || '1.0.0'}</p>
          </div>
          
          <div class="description-section">
            <p>Turn any browser into your terminal & command your agents on the go.</p>
          </div>
          
          <div class="links-section">
            <a href="https://vibetunnel.sh" target="_blank" class="link-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
              </svg>
              <span>Website</span>
            </a>
            
            <a href="https://github.com/amantus-ai/vibetunnel" target="_blank" class="link-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="currentColor"/>
              </svg>
              <span>View on GitHub</span>
            </a>
            
            <a href="https://github.com/amantus-ai/vibetunnel/issues" target="_blank" class="link-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
              </svg>
              <span>Report an Issue</span>
            </a>
            
            <a href="https://x.com/VibeTunnel" target="_blank" class="link-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
              </svg>
              <span>Follow @VibeTunnel</span>
            </a>
          </div>
          
          <div class="credits-section">
            <p class="credits-label">Brought to you by</p>
            <div class="credits-links">
              <a href="https://mariozechner.at/" target="_blank" class="credit-link">@badlogic</a>
              <span class="separator">•</span>
              <a href="https://lucumr.pocoo.org/" target="_blank" class="credit-link">@mitsuhiko</a>
              <span class="separator">•</span>
              <a href="https://steipete.me" target="_blank" class="credit-link">@steipete</a>
            </div>
            <p class="copyright">© 2025 • MIT Licensed</p>
          </div>
        </div>
      </div>
    `;
  }

  private async loadDebugData(): Promise<void> {
    try {
      // Load debug logs
      this.debugLogs = await this.safeInvoke('get_debug_logs', { limit: 100 }) || [];
      
      // Load performance metrics - returns array
      const metrics = await this.safeInvoke('get_performance_metrics', { limit: 10 }) || [];
      
      // Convert metrics array to object for display
      this.performanceMetrics = {
        avg_response_time_ms: this._getMetricValue(metrics, 'response_time'),
        requests_per_second: this._getMetricValue(metrics, 'requests_per_second'),
        cpu_usage_percent: this._getMetricValue(metrics, 'cpu_usage'),
        memory_usage_mb: this._getMetricValue(metrics, 'memory_usage'),
        active_sessions: this._getMetricValue(metrics, 'active_sessions'),
        total_requests: this._getMetricValue(metrics, 'total_requests')
      };
      
      // Load network requests
      this.networkRequests = await this.safeInvoke('get_network_requests', { limit: 50 }) || [];
      
      // Load debug stats
      this.debugStats = await this.safeInvoke('get_debug_stats') || {};
    } catch (error) {
      console.error('Failed to load debug data:', error);
    }
  }
  
  private _getMetricValue(metrics: Array<any>, name: string): number {
    const metric = metrics.find((m: any) => m.name === name);
    return metric?.value || 0;
  }

  private _renderLogsTab(): TemplateResult {
    const filteredLogs = this._filterLogs(this.debugLogs);
    
    return html`
      <div class="logs-container">
        <div class="logs-toolbar">
          <div class="log-filters">
            <button 
              class="log-filter-btn ${this.logFilter === 'all' ? 'active' : ''}"
              @click=${() => { this.logFilter = 'all'; this.requestUpdate(); }}
            >
              All (${this.debugLogs.length})
            </button>
            <button 
              class="log-filter-btn ${this.logFilter === 'error' ? 'active' : ''}"
              @click=${() => { this.logFilter = 'error'; this.requestUpdate(); }}
            >
              Errors
            </button>
            <button 
              class="log-filter-btn ${this.logFilter === 'warn' ? 'active' : ''}"
              @click=${() => { this.logFilter = 'warn'; this.requestUpdate(); }}
            >
              Warnings
            </button>
            <button 
              class="log-filter-btn ${this.logFilter === 'info' ? 'active' : ''}"
              @click=${() => { this.logFilter = 'info'; this.requestUpdate(); }}
            >
              Info
            </button>
            <button 
              class="log-filter-btn ${this.logFilter === 'debug' ? 'active' : ''}"
              @click=${() => { this.logFilter = 'debug'; this.requestUpdate(); }}
            >
              Debug
            </button>
          </div>
          
          <div class="log-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input 
              type="text" 
              placeholder="Search logs..."
              .value=${this.logSearchTerm}
              @input=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                this.logSearchTerm = input.value;
                this.requestUpdate();
              }}
            />
          </div>
          
          <button class="btn btn-primary" @click=${this.refreshLogs}>Refresh</button>
          <button class="btn" @click=${this.exportLogs}>Export</button>
          <button class="btn" @click=${this.clearLogs}>Clear</button>
        </div>
        
        <div class="logs-view">
          ${filteredLogs.length === 0 ? html`
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <p>No logs yet</p>
            </div>
          ` : filteredLogs.map(log => html`
            <div class="log-entry">
              <span class="log-timestamp">${this._formatTimestamp(log.timestamp)}</span>
              <span class="log-level ${log.level.toLowerCase()}">${log.level.toUpperCase()}</span>
              <span class="log-message">${log.message}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderPerformanceTab(): TemplateResult {
    return html`
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-label">Response Time</div>
          <div class="metric-value">
            ${this.performanceMetrics.avg_response_time_ms || 0}
            <span class="metric-unit">ms</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Requests/Second</div>
          <div class="metric-value">
            ${this.performanceMetrics.requests_per_second || 0}
            <span class="metric-unit">req/s</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">CPU Usage</div>
          <div class="metric-value">
            ${this.performanceMetrics.cpu_usage_percent || 0}
            <span class="metric-unit">%</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Memory Usage</div>
          <div class="metric-value">
            ${this.performanceMetrics.memory_usage_mb || 0}
            <span class="metric-unit">MB</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Active Sessions</div>
          <div class="metric-value">
            ${this.performanceMetrics.active_sessions || 0}
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Total Requests</div>
          <div class="metric-value">
            ${this.performanceMetrics.total_requests || 0}
          </div>
        </div>
      </div>
      
      <div class="action-buttons">
        <button class="btn btn-primary" @click=${this.refreshPerformance}>Refresh</button>
        <button class="btn" @click=${this.exportPerformance}>Export Data</button>
      </div>
    `;
  }

  private _renderNetworkTab(): TemplateResult {
    return html`
      <div class="network-list">
        ${this.networkRequests.length === 0 ? html`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
            </svg>
            <p>No network requests recorded</p>
          </div>
        ` : this.networkRequests.map(req => html`
          <div class="network-item">
            <div>
              <span class="network-method">${req.method}</span>
              <span class="network-url">${req.url}</span>
              <span class="network-status ${req.status >= 200 && req.status < 300 ? 'success' : 'error'}">
                ${req.status || 'Failed'}
              </span>
            </div>
            <div style="margin-top: 4px; font-size: 11px; color: var(--text-tertiary);">
              ${req.duration_ms}ms • ${this._formatTimestamp(req.timestamp)}
            </div>
          </div>
        `)}
      </div>
      
      <div class="action-buttons">
        <button class="btn btn-primary" @click=${this.refreshNetwork}>Refresh</button>
        <button class="btn" @click=${this.clearNetwork}>Clear</button>
      </div>
    `;
  }

  private _renderApiTestingTab(): TemplateResult {
    return html`
      <div class="api-test-form">
        <h3>Quick API Test</h3>
        <div class="form-group">
          <label>Method</label>
          <select class="form-input" id="api-method">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>DELETE</option>
          </select>
        </div>
        
        <div class="form-group">
          <label>URL</label>
          <input type="text" class="form-input" id="api-url" placeholder="http://localhost:4022/api/..." />
        </div>
        
        <div class="form-group">
          <label>Headers (JSON)</label>
          <textarea class="form-input" id="api-headers" rows="3" placeholder='{"Content-Type": "application/json"}'></textarea>
        </div>
        
        <div class="form-group">
          <label>Body (JSON)</label>
          <textarea class="form-input" id="api-body" rows="5" placeholder='{}'></textarea>
        </div>
        
        <button 
          class="btn btn-primary" 
          @click=${this.runApiTest}
          ?disabled=${this.isRunningTests}
        >
          ${this.isRunningTests ? 'Running...' : 'Run Test'}
        </button>
      </div>
      
      <div class="test-results">
        ${this.apiTestResults.map(result => html`
          <div class="test-result ${result.success ? 'success' : 'failure'}">
            <div style="display: flex; justify-content: space-between;">
              <strong>${result.test_name || 'API Test'}</strong>
              <span>${result.duration_ms}ms</span>
            </div>
            ${result.error ? html`
              <div style="color: var(--error); margin-top: 8px;">${result.error}</div>
            ` : html`
              <div style="margin-top: 8px;">
                Status: ${result.actual_status}<br>
                Response: <code>${JSON.stringify(result.actual_body, null, 2)}</code>
              </div>
            `}
          </div>
        `)}
      </div>
    `;
  }

  private _renderMemoryTab(): TemplateResult {
    const latest = this.memorySnapshots[this.memorySnapshots.length - 1];
    
    return html`
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-label">Heap Used</div>
          <div class="metric-value">
            ${latest?.heap_used_mb || 0}
            <span class="metric-unit">MB</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Heap Total</div>
          <div class="metric-value">
            ${latest?.heap_total_mb || 0}
            <span class="metric-unit">MB</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">External</div>
          <div class="metric-value">
            ${latest?.external_mb || 0}
            <span class="metric-unit">MB</span>
          </div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">RSS</div>
          <div class="metric-value">
            ${latest?.process_rss_mb || 0}
            <span class="metric-unit">MB</span>
          </div>
        </div>
      </div>
      
      <div class="memory-chart">
        Memory usage chart would go here
      </div>
      
      <div class="action-buttons">
        <button class="btn btn-primary" @click=${this.takeMemorySnapshot}>Take Snapshot</button>
        <button class="btn" @click=${this.exportMemoryData}>Export Data</button>
        <button class="btn" @click=${this.clearMemoryData}>Clear History</button>
      </div>
    `;
  }

  private _renderDiagnosticsTab(): TemplateResult {
    return html`
      ${this.diagnosticReport ? html`
        <div class="diagnostic-section">
          <h3 class="diagnostic-title">System Information</h3>
          <div class="diagnostic-item">
            <span class="diagnostic-label">OS</span>
            <span class="diagnostic-value">${this.diagnosticReport.system_info?.os}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Architecture</span>
            <span class="diagnostic-value">${this.diagnosticReport.system_info?.arch}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">CPU Count</span>
            <span class="diagnostic-value">${this.diagnosticReport.system_info?.cpu_count}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Total Memory</span>
            <span class="diagnostic-value">${this.diagnosticReport.system_info?.total_memory_mb} MB</span>
          </div>
        </div>
        
        <div class="diagnostic-section">
          <h3 class="diagnostic-title">Application Info</h3>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Version</span>
            <span class="diagnostic-value">${this.diagnosticReport.app_info?.version}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Uptime</span>
            <span class="diagnostic-value">${this._formatUptime(this.diagnosticReport.app_info?.uptime_seconds)}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Active Sessions</span>
            <span class="diagnostic-value">${this.diagnosticReport.app_info?.active_sessions}</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Total Errors</span>
            <span class="diagnostic-value">${this.diagnosticReport.app_info?.error_count}</span>
          </div>
        </div>
        
        ${this.diagnosticReport.recommendations?.length > 0 ? html`
          <div class="diagnostic-section">
            <h3 class="diagnostic-title">Recommendations</h3>
            ${this.diagnosticReport.recommendations.map((rec: string) => html`
              <div style="padding: 8px 0; color: var(--text-secondary);">
                • ${rec}
              </div>
            `)}
          </div>
        ` : ''}
      ` : html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>No diagnostic report available</p>
        </div>
      `}
      
      <div class="action-buttons">
        <button class="btn btn-primary" @click=${this.generateDiagnosticReport}>Generate Report</button>
        ${this.diagnosticReport ? html`
          <button class="btn" @click=${this.exportDiagnosticReport}>Export Report</button>
        ` : ''}
      </div>
    `;
  }

  // Debug helper methods
  private _filterLogs(logs: Array<any>): Array<any> {
    let filtered = logs;
    
    if (this.logFilter !== 'all') {
      filtered = filtered.filter(log => log.level.toLowerCase() === this.logFilter);
    }
    
    if (this.logSearchTerm) {
      const term = this.logSearchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(term) ||
        log.component?.toLowerCase().includes(term)
      );
    }
    
    return filtered;
  }

  private _formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  private _formatUptime(seconds?: number): string {
    if (!seconds) return 'N/A';
    
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

  private async refreshLogs(): Promise<void> {
    this.debugLogs = await this.safeInvoke('get_debug_logs', { limit: 100 }) || [];
    this.requestUpdate();
  }

  private async exportLogs(): Promise<void> {
    const logText = this.debugLogs.map(log => 
      `[${new Date(log.timestamp).toISOString()}] [${log.level}] [${log.component}] ${log.message}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async clearLogs(): Promise<void> {
    await this.safeInvoke('clear_debug_logs');
    this.debugLogs = [];
    this.requestUpdate();
  }

  private async refreshPerformance(): Promise<void> {
    const metrics = await this.safeInvoke('get_performance_metrics', { limit: 10 }) || [];
    
    // Convert metrics array to object for display
    this.performanceMetrics = {
      avg_response_time_ms: this._getMetricValue(metrics, 'response_time'),
      requests_per_second: this._getMetricValue(metrics, 'requests_per_second'),
      cpu_usage_percent: this._getMetricValue(metrics, 'cpu_usage'),
      memory_usage_mb: this._getMetricValue(metrics, 'memory_usage'),
      active_sessions: this._getMetricValue(metrics, 'active_sessions'),
      total_requests: this._getMetricValue(metrics, 'total_requests')
    };
    
    this.requestUpdate();
  }

  private async exportPerformance(): Promise<void> {
    const data = JSON.stringify(this.performanceMetrics, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-metrics-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async refreshNetwork(): Promise<void> {
    this.networkRequests = await this.safeInvoke('get_network_requests', { limit: 50 }) || [];
    this.requestUpdate();
  }

  private async clearNetwork(): Promise<void> {
    await this.safeInvoke('clear_network_requests');
    this.networkRequests = [];
    this.requestUpdate();
  }

  private async runApiTest(): Promise<void> {
    this.isRunningTests = true;
    
    const method = (this.shadowRoot?.querySelector('#api-method') as HTMLSelectElement)?.value;
    const url = (this.shadowRoot?.querySelector('#api-url') as HTMLInputElement)?.value;
    const headers = (this.shadowRoot?.querySelector('#api-headers') as HTMLTextAreaElement)?.value;
    const body = (this.shadowRoot?.querySelector('#api-body') as HTMLTextAreaElement)?.value;
    
    try {
      const test = {
        id: Date.now().toString(),
        name: `${method} ${url}`,
        endpoint: url,
        method,
        headers: headers ? JSON.parse(headers) : {},
        body: body ? JSON.parse(body) : null,
        expected_status: 200,
        timeout_ms: 10000
      };
      
      const results = await this.safeInvoke('run_api_tests', { tests: [test] });
      this.apiTestResults = [...results, ...this.apiTestResults].slice(0, 10);
    } catch (error) {
      console.error('API test failed:', error);
    } finally {
      this.isRunningTests = false;
      this.requestUpdate();
    }
  }

  private async takeMemorySnapshot(): Promise<void> {
    const snapshot = await this.safeInvoke('take_memory_snapshot');
    if (snapshot) {
      this.memorySnapshots = [...this.memorySnapshots, snapshot].slice(-20);
      this.requestUpdate();
    }
  }

  private async exportMemoryData(): Promise<void> {
    const data = JSON.stringify(this.memorySnapshots, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-snapshots-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async clearMemoryData(): Promise<void> {
    this.memorySnapshots = [];
    this.requestUpdate();
  }

  private async generateDiagnosticReport(): Promise<void> {
    this.diagnosticReport = await this.safeInvoke('generate_diagnostic_report');
    this.requestUpdate();
  }

  private async exportDiagnosticReport(): Promise<void> {
    const data = JSON.stringify(this.diagnosticReport, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostic-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  override render() {
    const tabs: TabConfig[] = [
      { id: 'general', name: 'General', icon: html`<path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z"/>` },
      { id: 'dashboard', name: 'Dashboard', icon: html`<path d="M13,3V9H21V3M13,21H21V11H13M3,21H11V15H3M3,13H11V3H3V13Z"/>` },
      { id: 'advanced', name: 'Advanced', icon: html`<path d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M10,22C9.75,22 9.54,21.82 9.5,21.58L9.13,18.93C8.5,18.68 7.96,18.34 7.44,17.94L4.95,18.95C4.73,19.03 4.46,18.95 4.34,18.73L2.34,15.27C2.21,15.05 2.27,14.78 2.46,14.63L4.57,12.97L4.5,12L4.57,11L2.46,9.37C2.27,9.22 2.21,8.95 2.34,8.73L4.34,5.27C4.46,5.05 4.73,4.96 4.95,5.05L7.44,6.05C7.96,5.66 8.5,5.32 9.13,5.07L9.5,2.42C9.54,2.18 9.75,2 10,2H14C14.25,2 14.46,2.18 14.5,2.42L14.87,5.07C15.5,5.32 16.04,5.66 16.56,6.05L19.05,5.05C19.27,4.96 19.54,5.05 19.66,5.27L21.66,8.73C21.79,8.95 21.73,9.22 21.54,9.37L19.43,11L19.5,12L19.43,13L21.54,14.63C21.73,14.78 21.79,15.05 21.66,15.27L19.66,18.73C19.54,18.95 19.27,19.04 19.05,18.95L16.56,17.95C16.04,18.34 15.5,18.68 14.87,18.93L14.5,21.58C14.46,21.82 14.25,22 14,22H10Z"/>` },
      { id: 'about', name: 'About', icon: html`<path d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>` }
    ];

    if (this.debugMode) {
      tabs.push({ id: 'debug', name: 'Debug', icon: html`<path d="M12,1.5A2.5,2.5 0 0,1 14.5,4A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 9.5,4A2.5,2.5 0 0,1 12,1.5M8.41,18.82C8,18.56 8,18.06 8.41,17.8L11,16.2V14A1,1 0 0,0 10,13H8A1,1 0 0,0 7,14V16.17C7,16.64 6.76,17.09 6.37,17.35L2.81,19.83C2.3,20.16 2,20.74 2,21.35V22H7.86C7.86,21.89 7.88,21.78 7.93,21.68L8.67,20.07L7,19M15.59,17.8C16,18.06 16,18.56 15.59,18.82L14.91,19.23L16.29,22H22V21.35C22,20.74 21.7,20.16 21.19,19.83L17.63,17.35C17.24,17.09 17,16.64 17,16.17V14A1,1 0 0,0 16,13H14A1,1 0 0,0 13,14V16.2L15.59,17.8M10.76,20L9.93,21.73C9.79,22.04 9.91,22.4 10.17,22.56C10.25,22.6 10.34,22.63 10.43,22.63C10.64,22.63 10.83,22.5 10.93,22.31L12,20.25L13.07,22.31C13.17,22.5 13.36,22.63 13.57,22.63C13.66,22.63 13.75,22.6 13.83,22.56C14.09,22.4 14.21,22.04 14.07,21.73L13.24,20M14.59,12H14V10H13V8H14V6.31C13.42,6.75 12.72,7 12,7C11.28,7 10.58,6.75 10,6.31V8H11V10H10V12H9.41C9.77,11.71 10.24,11.5 10.76,11.5H13.24C13.76,11.5 14.23,11.71 14.59,12Z"/>` });
    }

    return html`
      <window-header title="VibeTunnel Settings"></window-header>
      <div class="window">
        <div class="sidebar">
          <ul class="tabs">
            ${tabs.map(tab => html`
              <settings-tab
                name=${tab.name}
                .icon=${tab.icon}
                ?active=${this.activeTab === tab.id}
                @click=${() => this._switchTab(tab.id)}
              ></settings-tab>
            `)}
          </ul>
        </div>
        
        <div class="content">
          ${this._renderGeneralTab()}
          ${this._renderDebugTab()}
          
          <!-- Other tabs will be added here -->
          ${this._renderDashboardTab()}
          
          ${this._renderAdvancedTab()}
          
          ${this._renderAboutTab()}
        </div>
      </div>
    `;
  }
}
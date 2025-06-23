import { html, css, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { TauriBase } from './base/tauri-base';
import { formStyles } from './shared/styles';
import './settings-tab';
import './settings-checkbox';

interface SettingsData {
  general?: {
    launch_at_login?: boolean;
    show_welcome_on_startup?: boolean;
    show_dock_icon?: boolean;
    theme?: 'system' | 'light' | 'dark';
    default_terminal?: string;
  };
  dashboard?: Record<string, unknown>;
  advanced?: {
    debug_mode?: boolean;
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
  static override styles = [
    formStyles,
    css`
    :host {
      display: flex;
      width: 100vw;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-primary);
      user-select: none;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .window {
      display: flex;
      height: 100%;
      width: 100%;
      background: var(--bg-primary);
      -webkit-app-region: no-drag;
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
            <div class="form-group">
              <label for="terminal-select">Default Terminal</label>
              <select 
                id="terminal-select"
                class="form-select"
                @change=${(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  this.handleSettingChange(new CustomEvent('change', {
                    detail: { settingKey: 'general.default_terminal', value: target.value }
                  }) as SettingChangeEvent);
                }}
              >
                <option value="terminal" ?selected=${!this.settings.general?.default_terminal || this.settings.general.default_terminal === 'terminal'}>Terminal.app</option>
                <option value="iterm2" ?selected=${this.settings.general?.default_terminal === 'iterm2'}>iTerm2</option>
                <option value="warp" ?selected=${this.settings.general?.default_terminal === 'warp'}>Warp</option>
              </select>
              <small class="form-text">Choose your preferred terminal application</small>
            </div>
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
            
            <div class="form-group">
              <label for="theme-select">Theme</label>
              <select 
                id="theme-select"
                class="form-select"
                @change=${(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  this.handleSettingChange(new CustomEvent('change', {
                    detail: { settingKey: 'general.theme', value: target.value }
                  }) as SettingChangeEvent);
                }}
              >
                <option value="system" ?selected=${!this.settings.general?.theme || this.settings.general.theme === 'system'}>System</option>
                <option value="light" ?selected=${this.settings.general?.theme === 'light'}>Light</option>
                <option value="dark" ?selected=${this.settings.general?.theme === 'dark'}>Dark</option>
              </select>
              <small class="form-text">Choose your preferred color scheme</small>
            </div>
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
        <p>Debug content here...</p>
      </div>
    `;
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
          <div class="tab-content ${this.activeTab === 'dashboard' ? 'active' : ''}" id="dashboard">
            <h2>Dashboard</h2>
            <p>Dashboard settings coming soon...</p>
          </div>
          
          <div class="tab-content ${this.activeTab === 'advanced' ? 'active' : ''}" id="advanced">
            <h2>Advanced</h2>
            <p>Advanced settings coming soon...</p>
          </div>
          
          <div class="tab-content ${this.activeTab === 'about' ? 'active' : ''}" id="about">
            <h2>About</h2>
            <p>VibeTunnel v${this.systemInfo.version || '1.0.0'}</p>
          </div>
        </div>
      </div>
    `;
  }
}
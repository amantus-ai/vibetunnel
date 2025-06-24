import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { TauriBase } from '../base/tauri-base';

@customElement('window-header')
export class WindowHeader extends TauriBase {
  static override styles = css`
    :host {
      display: block;
      background: var(--bg-primary, #000);
      border-bottom: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
      user-select: none;
      -webkit-user-select: none;
    }

    .header {
      display: flex;
      align-items: center;
      height: 38px;
      padding: 0 16px;
      position: relative;
    }

    /* Draggable region - covers most of the header */
    .drag-region {
      position: absolute;
      top: 0;
      left: 80px; /* Leave space for traffic lights */
      right: 0;
      bottom: 0;
      -webkit-app-region: drag;
      app-region: drag;
    }

    /* Window controls container */
    .window-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      position: relative;
      z-index: 10;
      -webkit-app-region: no-drag;
      app-region: no-drag;
    }

    /* Traffic light buttons */
    .traffic-light {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .traffic-light:hover::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.1);
    }

    .traffic-light:active {
      transform: scale(0.95);
    }

    .traffic-light.close {
      background: #ff5f57;
    }

    .traffic-light.close:hover {
      background: #ff6058;
    }

    .traffic-light.minimize {
      background: #ffbd2e;
    }

    .traffic-light.minimize:hover {
      background: #ffbe2f;
    }

    .traffic-light.maximize {
      background: #28ca42;
    }

    .traffic-light.maximize:hover {
      background: #29cb43;
    }

    /* When window is not focused, gray out the buttons */
    :host(.inactive) .traffic-light {
      background: #4a4a4a;
    }

    /* Title */
    .title {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary, rgba(255, 255, 255, 0.6));
      pointer-events: none;
      z-index: 5;
    }

    /* Content slot */
    .content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      position: relative;
      z-index: 5;
      -webkit-app-region: no-drag;
      app-region: no-drag;
    }

    /* For non-macOS, use different controls */
    @media not all and (hover: hover) {
      .traffic-light {
        display: none;
      }
    }

    /* Windows/Linux style controls */
    .windows-controls {
      display: none;
      gap: 0;
    }

    .windows-control {
      width: 46px;
      height: 38px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
    }

    .windows-control:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
    }

    .windows-control.close:hover {
      background: #e81123;
      color: white;
    }

    .windows-control svg {
      width: 10px;
      height: 10px;
    }

    /* Show Windows controls on non-macOS */
    :host([platform="windows"]) .traffic-light,
    :host([platform="linux"]) .traffic-light {
      display: none;
    }

    :host([platform="windows"]) .windows-controls,
    :host([platform="linux"]) .windows-controls {
      display: flex;
    }
  `;

  @property({ type: String })
  title = '';

  @property({ type: Boolean })
  showMaximize = true;

  @property({ type: String, reflect: true })
  platform = 'macos';

  override async connectedCallback() {
    super.connectedCallback();
    
    // Detect platform
    if (this.tauriAvailable) {
      const os = await this.safeInvoke<string>('get_os');
      this.platform = os || 'macos';
    }

    // Listen for window focus/blur events
    window.addEventListener('blur', this._handleBlur);
    window.addEventListener('focus', this._handleFocus);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('blur', this._handleBlur);
    window.removeEventListener('focus', this._handleFocus);
  }

  private _handleBlur = () => {
    this.classList.add('inactive');
  };

  private _handleFocus = () => {
    this.classList.remove('inactive');
  };

  private async _closeWindow() {
    if (this.tauriAvailable) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    }
  }

  private async _minimizeWindow() {
    if (this.tauriAvailable) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    }
  }

  private async _maximizeWindow() {
    if (this.tauriAvailable) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window = getCurrentWindow();
      const isMaximized = await window.isMaximized();
      if (isMaximized) {
        await window.unmaximize();
      } else {
        await window.maximize();
      }
    }
  }

  override render() {
    return html`
      <div class="header">
        ${this.platform === 'macos' ? html`
          <div class="window-controls">
            <button 
              class="traffic-light close" 
              @click=${this._closeWindow}
              aria-label="Close window"
            ></button>
            <button 
              class="traffic-light minimize" 
              @click=${this._minimizeWindow}
              aria-label="Minimize window"
            ></button>
            ${this.showMaximize ? html`
              <button 
                class="traffic-light maximize" 
                @click=${this._maximizeWindow}
                aria-label="Maximize window"
              ></button>
            ` : ''}
          </div>
        ` : ''}
        
        <div class="drag-region" data-tauri-drag-region></div>
        
        ${this.title ? html`
          <div class="title">${this.title}</div>
        ` : ''}
        
        <div class="content">
          <slot></slot>
        </div>
        
        ${this.platform !== 'macos' ? html`
          <div class="windows-controls">
            <button 
              class="windows-control minimize" 
              @click=${this._minimizeWindow}
              aria-label="Minimize window"
            >
              <svg viewBox="0 0 10 10" fill="currentColor">
                <path d="M0 5h10v1H0z"/>
              </svg>
            </button>
            ${this.showMaximize ? html`
              <button 
                class="windows-control maximize" 
                @click=${this._maximizeWindow}
                aria-label="Maximize window"
              >
                <svg viewBox="0 0 10 10" fill="none" stroke="currentColor">
                  <rect x="0.5" y="0.5" width="9" height="9" stroke-width="1"/>
                </svg>
              </button>
            ` : ''}
            <button 
              class="windows-control close" 
              @click=${this._closeWindow}
              aria-label="Close window"
            >
              <svg viewBox="0 0 10 10" fill="currentColor">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'window-header': WindowHeader;
  }
}
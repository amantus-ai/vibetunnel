import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('keyboard-capture-indicator');

@customElement('keyboard-capture-indicator')
export class KeyboardCaptureIndicator extends LitElement {
  // Disable shadow DOM to use Tailwind classes
  createRenderRoot() {
    return this;
  }

  static styles = css`
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); filter: brightness(1.3); }
      100% { transform: scale(1); }
    }

    .animating {
      animation: pulse 0.4s ease;
    }

    .tooltip {
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-top: 0.5em;
      padding: 0.75em 1em;
      background: var(--dark-bg, #1a1a1a);
      color: var(--dark-text, #e0e0e0);
      border: 1px solid var(--dark-border, #333);
      border-radius: 0.25em;
      font-size: 0.875em;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 1000;
      max-width: 300px;
      white-space: normal;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .tooltip-container:hover .tooltip {
      opacity: 1;
    }

    .tooltip.dynamic {
      background: var(--accent-green, #4ade80);
      color: var(--dark-bg, #1a1a1a);
      font-weight: 500;
    }

    .shortcut-list {
      margin-top: 0.5em;
      padding-top: 0.5em;
      border-top: 1px solid var(--dark-border, #333);
    }

    .shortcut-item {
      display: flex;
      justify-content: space-between;
      gap: 1em;
      margin: 0.25em 0;
      font-family: monospace;
    }

    .shortcut-key {
      font-weight: bold;
    }

    .shortcut-desc {
      color: var(--dark-text-muted, #999);
    }
  `;

  @property({ type: Boolean }) active = true;
  @property({ type: Boolean }) isMobile = false;
  @state() private animating = false;
  @state() private lastCapturedShortcut = '';
  @state() private showDynamicTooltip = false;

  private animationTimeout?: number;
  private tooltipTimeout?: number;
  private isMacOS = navigator.platform.toLowerCase().includes('mac');

  connectedCallback() {
    super.connectedCallback();
    // Listen for captured shortcuts
    window.addEventListener('shortcut-captured', this.handleShortcutCaptured as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('shortcut-captured', this.handleShortcutCaptured as EventListener);
    if (this.animationTimeout) clearTimeout(this.animationTimeout);
    if (this.tooltipTimeout) clearTimeout(this.tooltipTimeout);
  }

  private handleShortcutCaptured = (event: CustomEvent) => {
    const { shortcut, browserAction, terminalAction } = event.detail;
    this.lastCapturedShortcut = this.formatShortcutInfo(shortcut, browserAction, terminalAction);
    this.animating = true;
    this.showDynamicTooltip = true;

    // Clear existing timeouts
    if (this.animationTimeout) clearTimeout(this.animationTimeout);
    if (this.tooltipTimeout) clearTimeout(this.tooltipTimeout);

    // Remove animation class after animation completes
    this.animationTimeout = window.setTimeout(() => {
      this.animating = false;
    }, 400);

    // Hide dynamic tooltip after 3 seconds
    this.tooltipTimeout = window.setTimeout(() => {
      this.showDynamicTooltip = false;
    }, 3000);
  };

  private formatShortcutInfo(
    shortcut: string,
    browserAction: string,
    terminalAction: string
  ): string {
    return `"${shortcut}" → Terminal: ${terminalAction} (not Browser: ${browserAction})`;
  }

  private handleClick() {
    this.active = !this.active;
    this.dispatchEvent(
      new CustomEvent('capture-toggled', {
        detail: { active: this.active },
        bubbles: true,
        composed: true,
      })
    );
    logger.log(`Keyboard capture ${this.active ? 'enabled' : 'disabled'}`);
  }

  private getOSSpecificShortcuts() {
    if (this.isMacOS) {
      return [
        { key: 'Cmd+A/E', desc: 'Line start/end' },
        { key: 'Cmd+W', desc: 'Delete word' },
        { key: 'Cmd+U/K', desc: 'Delete to start/end' },
        { key: 'Cmd+R', desc: 'History search' },
        { key: 'Cmd+L', desc: 'Clear screen' },
        { key: 'Option+←/→', desc: 'Word navigation' },
      ];
    } else {
      return [
        { key: 'Ctrl+A/E', desc: 'Line start/end' },
        { key: 'Ctrl+W', desc: 'Delete word' },
        { key: 'Ctrl+U/K', desc: 'Delete to start/end' },
        { key: 'Ctrl+R', desc: 'History search' },
        { key: 'Ctrl+L', desc: 'Clear screen' },
        { key: 'Alt+←/→', desc: 'Word navigation' },
      ];
    }
  }

  private renderKeyboardIcon() {
    return html`
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="6" width="20" height="12" rx="2"/>
        <circle cx="7" cy="10" r="1"/>
        <circle cx="12" cy="10" r="1"/>
        <circle cx="17" cy="10" r="1"/>
        <circle cx="7" cy="14" r="1"/>
        <rect x="9" y="13" width="6" height="2" rx="1"/>
        <circle cx="17" cy="14" r="1"/>
      </svg>
    `;
  }

  render() {
    if (this.isMobile) return html``;

    // Use the same button styling as other header buttons
    const buttonClasses = `
      bg-elevated border border-base rounded-lg p-2 font-mono text-muted 
      transition-all duration-200 hover:text-primary hover:bg-hover hover:border-primary 
      hover:shadow-sm flex-shrink-0
      ${this.active ? 'text-primary bg-primary bg-opacity-10 border-primary' : ''}
      ${this.animating ? 'animating' : ''}
    `.trim();

    const tooltipContent =
      this.showDynamicTooltip && this.lastCapturedShortcut
        ? html`<div class="tooltip dynamic">${this.lastCapturedShortcut}</div>`
        : html`
          <div class="tooltip">
            <div>
              <strong>Keyboard Capture ${this.active ? 'ON' : 'OFF'}</strong>
            </div>
            <div style="margin-top: 0.5em;">
              ${
                this.active
                  ? 'Terminal receives priority for shortcuts'
                  : 'Browser shortcuts work normally'
              }
            </div>
            <div style="margin-top: 0.5em;">
              Double-tap <span class="shortcut-key">Escape</span> to toggle
            </div>
            ${
              this.active
                ? html`
              <div class="shortcut-list">
                <div style="margin-bottom: 0.5em; font-weight: bold;">Captured for terminal:</div>
                ${this.getOSSpecificShortcuts().map(
                  ({ key, desc }) => html`
                  <div class="shortcut-item">
                    <span class="shortcut-key">${key}</span>
                    <span class="shortcut-desc">${desc}</span>
                  </div>
                `
                )}
              </div>
            `
                : ''
            }
          </div>
        `;

    return html`
      <div class="tooltip-container relative">
        <button 
          class="${buttonClasses}"
          @click=${this.handleClick}
        >
          ${this.renderKeyboardIcon()}
        </button>
        ${tooltipContent}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'keyboard-capture-indicator': KeyboardCaptureIndicator;
  }
}

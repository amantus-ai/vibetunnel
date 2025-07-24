import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('keyboard-capture-indicator');

@customElement('keyboard-capture-indicator')
export class KeyboardCaptureIndicator extends LitElement {
  // Disable shadow DOM to use Tailwind classes
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) active = true;
  @property({ type: Boolean }) isMobile = false;
  @state() private animating = false;
  @state() private lastCapturedShortcut = '';
  @state() private showDynamicTooltip = false;
  @state() private isHovered = false;

  private animationTimeout?: number;
  private tooltipTimeout?: number;
  private isMacOS = navigator.platform.toLowerCase().includes('mac');

  connectedCallback() {
    super.connectedCallback();
    // Listen for captured shortcuts
    window.addEventListener('shortcut-captured', this.handleShortcutCaptured as EventListener);
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('active')) {
      logger.log(`Keyboard capture indicator updated: ${this.active ? 'ON' : 'OFF'}`);
    }
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
    // Don't toggle local state - let parent control it
    const newActive = !this.active;
    this.dispatchEvent(
      new CustomEvent('capture-toggled', {
        detail: { active: newActive },
        bubbles: true,
        composed: true,
      })
    );
    logger.log(`Keyboard capture toggle requested: ${newActive ? 'enable' : 'disable'}`);
  }

  private getOSSpecificShortcuts() {
    if (this.isMacOS) {
      return [
        { key: 'Cmd+1...9', desc: 'Switch to session 1 to 9' },
        { key: 'Cmd+0', desc: 'Switch to session 10' },
        { key: 'Cmd+A', desc: 'Line start (not select all)' },
        { key: 'Cmd+E', desc: 'Line end' },
        { key: 'Cmd+R', desc: 'History search (not reload)' },
        { key: 'Cmd+L', desc: 'Clear screen (not address bar)' },
        { key: 'Cmd+D', desc: 'EOF/Exit (not bookmark)' },
        { key: 'Cmd+F', desc: 'Forward char (not find)' },
        { key: 'Cmd+P', desc: 'Previous cmd (not print)' },
        { key: 'Cmd+U', desc: 'Delete to start (not view source)' },
        { key: 'Cmd+K', desc: 'Delete to end (not search bar)' },
        { key: 'Option+D', desc: 'Delete word forward' },
      ];
    } else {
      return [
        { key: 'Ctrl+1...9', desc: 'Switch to session 1 to 9' },
        { key: 'Ctrl+0', desc: 'Switch to session 10' },
        { key: 'Ctrl+A', desc: 'Line start (not select all)' },
        { key: 'Ctrl+E', desc: 'Line end' },
        { key: 'Ctrl+R', desc: 'History search (not reload)' },
        { key: 'Ctrl+L', desc: 'Clear screen (not address bar)' },
        { key: 'Ctrl+D', desc: 'EOF/Exit (not bookmark)' },
        { key: 'Ctrl+F', desc: 'Forward char (not find)' },
        { key: 'Ctrl+P', desc: 'Previous cmd (not print)' },
        { key: 'Ctrl+U', desc: 'Delete to start (not view source)' },
        { key: 'Ctrl+K', desc: 'Delete to end (not search bar)' },
        { key: 'Alt+D', desc: 'Delete word forward' },
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
      bg-bg-tertiary border border-border rounded-lg p-2 font-mono 
      transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary 
      hover:shadow-sm flex-shrink-0
      ${this.active ? 'text-primary' : 'text-muted'}
      ${this.animating ? 'animating' : ''}
    `.trim();

    const _tooltipContent =
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
      <div 
        class="relative flex-shrink-0"
        @mouseenter=${() => {
          this.isHovered = true;
        }}
        @mouseleave=${() => {
          this.isHovered = false;
        }}
      >
        <button 
          class="${buttonClasses}"
          @click=${this.handleClick}
        >
          ${this.renderKeyboardIcon()}
        </button>
        ${
          this.isHovered
            ? html`
          <div 
            style="
              position: absolute;
              top: 100%;
              left: 50%;
              transform: translateX(-50%);
              margin-top: 0.5em;
              padding: 0.75em 1em;
              background: #1a1a1a;
              color: #e0e0e0;
              border: 1px solid #333;
              border-radius: 0.25em;
              font-size: 0.875em;
              white-space: normal;
              z-index: 1000;
              max-width: 300px;
              width: 300px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            "
          >
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
              Double-tap <strong>Escape</strong> to toggle
            </div>
            ${
              this.active
                ? html`
              <div style="margin-top: 0.5em; padding-top: 0.5em; border-top: 1px solid #333;">
                <div style="margin-bottom: 0.5em; font-weight: bold;">Captured for terminal:</div>
                ${this.getOSSpecificShortcuts().map(
                  ({ key, desc }) => html`
                  <div style="display: flex; justify-content: space-between; gap: 1em; margin: 0.25em 0; font-family: monospace;">
                    <span style="font-weight: bold;">${key}</span>
                    <span style="color: #999;">${desc}</span>
                  </div>
                `
                )}
              </div>
            `
                : ''
            }
          </div>
        `
            : ''
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'keyboard-capture-indicator': KeyboardCaptureIndicator;
  }
}

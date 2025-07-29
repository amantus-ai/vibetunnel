import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { notificationEventService } from '../services/notification-event-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('notification-status');

@customElement('notification-status')
export class NotificationStatus extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private isSSEConnected = false;

  private connectionStateUnsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.initializeComponent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.connectionStateUnsubscribe) {
      this.connectionStateUnsubscribe();
    }
  }

  private initializeComponent(): void {
    // Get initial connection state
    this.isSSEConnected = notificationEventService.getConnectionStatus();
    logger.debug('Initial SSE connection status:', this.isSSEConnected);

    // Listen for connection state changes
    this.connectionStateUnsubscribe = notificationEventService.onConnectionStateChange(
      (connected) => {
        logger.log(`SSE connection state changed: ${connected ? 'connected' : 'disconnected'}`);
        this.isSSEConnected = connected;
      }
    );
  }

  private handleClick(): void {
    this.dispatchEvent(new CustomEvent('open-settings'));
  }

  private getStatusConfig() {
    // Green when SSE is connected (Mac app notifications are working)
    if (this.isSSEConnected) {
      return {
        color: 'text-status-success',
        tooltip: 'Settings (Notifications connected)',
      };
    }

    // Default color when SSE is not connected
    return {
      color: 'text-muted',
      tooltip: 'Settings (Notifications disconnected)',
    };
  }

  private renderIcon() {
    return html`
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
      </svg>
    `;
  }

  render() {
    const { color, tooltip } = this.getStatusConfig();

    return html`
      <button
        @click=${this.handleClick}
        class="bg-bg-tertiary border border-border rounded-lg p-2 ${color} transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm"
        title="${tooltip}"
      >
        ${this.renderIcon()}
      </button>
    `;
  }
}

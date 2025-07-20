import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  type PushSubscription,
  pushNotificationService,
} from '../services/push-notification-service.js';
import { createLogger } from '../utils/logger.js';

const _logger = createLogger('notification-status');

@customElement('notification-status')
export class NotificationStatus extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private permission: NotificationPermission = 'default';
  @state() private subscription: PushSubscription | null = null;
  @state() private isSupported = false;

  private permissionChangeUnsubscribe?: () => void;
  private subscriptionChangeUnsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.initializeComponent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.permissionChangeUnsubscribe) {
      this.permissionChangeUnsubscribe();
    }
    if (this.subscriptionChangeUnsubscribe) {
      this.subscriptionChangeUnsubscribe();
    }
  }

  private async initializeComponent(): Promise<void> {
    this.isSupported = pushNotificationService.isSupported();

    if (!this.isSupported) {
      return;
    }

    // Wait for the push notification service to be fully initialized
    await pushNotificationService.waitForInitialization();

    this.permission = pushNotificationService.getPermission();
    this.subscription = pushNotificationService.getSubscription();

    // Listen for changes
    this.permissionChangeUnsubscribe = pushNotificationService.onPermissionChange((permission) => {
      this.permission = permission;
    });

    this.subscriptionChangeUnsubscribe = pushNotificationService.onSubscriptionChange(
      (subscription) => {
        this.subscription = subscription;
      }
    );
  }

  private handleClick(): void {
    this.dispatchEvent(new CustomEvent('open-settings'));
  }

  private getStatusConfig() {
    // Green when notifications are enabled (permission granted AND subscription active)
    if (this.permission === 'granted' && this.subscription) {
      return {
        color: 'text-status-success',
        tooltip: 'Settings (Notifications enabled)',
      };
    }

    // Default color for all other cases (not red anymore)
    let tooltip = 'Settings (Notifications disabled)';
    if (!this.isSupported) {
      tooltip = 'Settings (Notifications not supported)';
    } else if (this.permission === 'denied') {
      tooltip = 'Settings (Notifications blocked)';
    } else if (!this.subscription) {
      tooltip = 'Settings (Notifications not subscribed)';
    }

    return {
      color: 'text-muted',
      tooltip,
    };
  }

  private renderIcon() {
    return html`
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
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

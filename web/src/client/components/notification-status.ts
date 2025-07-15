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
        tooltip: 'Notifications enabled',
      };
    }

    // Red for all other cases (not supported, denied, or no subscription)
    let tooltip = 'Notifications disabled';
    if (!this.isSupported) {
      tooltip = 'Notifications not supported';
    } else if (this.permission === 'denied') {
      tooltip = 'Notifications blocked';
    } else if (!this.subscription) {
      tooltip = 'Notifications not subscribed';
    }

    return {
      color: 'text-status-error',
      tooltip,
    };
  }

  private renderIcon() {
    return html`
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 17h5l-3.5-3.5A7 7 0 0 1 17 10a7 7 0 0 0-14 0 7 7 0 0 1 .5 3.5L0 17h5m10 0v1a3 3 0 0 1-6 0v-1m6 0H9"
        />
      </svg>
    `;
  }

  render() {
    const { color, tooltip } = this.getStatusConfig();

    return html`
      <button
        @click=${this.handleClick}
        class="p-2 ${color} hover:text-primary transition-colors relative"
        title="${tooltip}"
      >
        ${this.renderIcon()}
      </button>
    `;
  }
}

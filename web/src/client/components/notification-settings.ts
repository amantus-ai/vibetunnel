import { LitElement, html } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import {
  pushNotificationService,
  type NotificationPreferences,
  type PushSubscription,
} from '../services/push-notification-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('notification-settings');

@customElement('notification-settings')
export class NotificationSettings extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;

  @state() private preferences: NotificationPreferences = {
    enabled: false,
    sessionExit: true,
    sessionStart: false,
    sessionError: true,
    systemAlerts: true,
    soundEnabled: true,
    vibrationEnabled: true,
  };
  @state() private permission: NotificationPermission = 'default';
  @state() private subscription: PushSubscription | null = null;
  @state() private isLoading = false;
  @state() private testingNotification = false;
  @state() private hasChanges = false;

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
    this.preferences = pushNotificationService.loadPreferences();
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

  private handleClose(): void {
    if (this.hasChanges) {
      this.savePreferences();
    }
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handlePreferenceChange(key: keyof NotificationPreferences, value: boolean): void {
    this.preferences = { ...this.preferences, [key]: value };
    this.hasChanges = true;
  }

  private savePreferences(): void {
    pushNotificationService.savePreferences(this.preferences);
    this.hasChanges = false;
    logger.log('notification preferences saved');
  }

  private async handleEnableNotifications(): Promise<void> {
    this.isLoading = true;

    try {
      await pushNotificationService.subscribe();
      this.preferences.enabled = true;
      this.savePreferences();

      this.dispatchEvent(new CustomEvent('notifications-enabled'));
    } catch (error) {
      logger.error('failed to enable notifications:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to enable notifications: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDisableNotifications(): Promise<void> {
    this.isLoading = true;

    try {
      await pushNotificationService.unsubscribe();
      this.preferences.enabled = false;
      this.savePreferences();

      this.dispatchEvent(new CustomEvent('notifications-disabled'));
    } catch (error) {
      logger.error('failed to disable notifications:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to disable notifications: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  private async handleTestNotification(): Promise<void> {
    this.testingNotification = true;

    try {
      await pushNotificationService.testNotification();
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: 'Test notification sent!',
        })
      );
    } catch (error) {
      logger.error('failed to send test notification:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to send test notification: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    } finally {
      this.testingNotification = false;
    }
  }

  private async handleClearNotifications(): Promise<void> {
    try {
      await pushNotificationService.clearAllNotifications();
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: 'All notifications cleared',
        })
      );
    } catch (error) {
      logger.error('failed to clear notifications:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to clear notifications: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private renderPermissionStatus() {
    const statusConfig = {
      granted: { color: 'text-status-success', icon: '✓', text: 'Granted' },
      denied: { color: 'text-status-error', icon: '✗', text: 'Denied' },
      default: { color: 'text-status-warning', icon: '?', text: 'Not requested' },
    };

    const config = statusConfig[this.permission];

    return html`
      <div class="flex items-center space-x-2">
        <span class="${config.color} font-mono">${config.icon}</span>
        <span class="text-sm text-dark-text">${config.text}</span>
      </div>
    `;
  }

  private renderSubscriptionStatus() {
    // Check both our subscription state and the service's actual subscription status
    const hasSubscription = this.subscription || pushNotificationService.isSubscribed();

    if (hasSubscription) {
      return html`
        <div class="flex items-center space-x-2">
          <span class="text-status-success font-mono">✓</span>
          <span class="text-sm text-dark-text">Active</span>
        </div>
      `;
    } else {
      return html`
        <div class="flex items-center space-x-2">
          <span class="text-status-error font-mono">✗</span>
          <span class="text-sm text-dark-text">Not subscribed</span>
        </div>
      `;
    }
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    const isSupported = pushNotificationService.isSupported();
    const hasSubscription = this.subscription || pushNotificationService.isSubscribed();
    const canTest = this.permission === 'granted' && hasSubscription;

    return html`
      <!-- Modal backdrop -->
      <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div
          class="bg-dark-bg border border-dark-border rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto"
        >
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-dark-border">
            <h2 class="text-lg font-semibold text-dark-text">Notification Settings</h2>
            <button
              @click=${this.handleClose}
              class="p-1 text-dark-text-secondary hover:text-dark-text transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-4 space-y-6">
            ${!isSupported
              ? html`
                  <div
                    class="p-3 bg-status-warning bg-opacity-10 border border-status-warning rounded"
                  >
                    <p class="text-sm text-status-warning">
                      Push notifications are not supported in this browser.
                    </p>
                  </div>
                `
              : html`
                  <!-- Status Section -->
                  <div class="space-y-3">
                    <h3 class="text-sm font-semibold text-dark-text uppercase tracking-wide">
                      Status
                    </h3>

                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <label class="text-xs text-dark-text-secondary uppercase tracking-wide"
                          >Permission</label
                        >
                        ${this.renderPermissionStatus()}
                      </div>
                      <div>
                        <label class="text-xs text-dark-text-secondary uppercase tracking-wide"
                          >Subscription</label
                        >
                        ${this.renderSubscriptionStatus()}
                      </div>
                    </div>
                  </div>

                  <!-- Master Enable/Disable -->
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <div>
                        <h3 class="text-sm font-semibold text-dark-text">Enable Notifications</h3>
                        <p class="text-xs text-dark-text-secondary">
                          Allow VibeTunnel to send push notifications
                        </p>
                      </div>
                      <div class="flex items-center space-x-2">
                        ${hasSubscription
                          ? html`
                              <button
                                @click=${this.handleDisableNotifications}
                                ?disabled=${this.isLoading}
                                class="px-3 py-1.5 text-xs font-medium rounded border border-status-error text-status-error hover:bg-status-error hover:text-dark-bg transition-colors disabled:opacity-50"
                              >
                                ${this.isLoading ? 'Disabling...' : 'Disable'}
                              </button>
                            `
                          : html`
                              <button
                                @click=${this.handleEnableNotifications}
                                ?disabled=${this.isLoading || this.permission === 'denied'}
                                class="px-3 py-1.5 text-xs font-medium rounded bg-dark-accent text-dark-text hover:bg-dark-accent-hover transition-colors disabled:opacity-50"
                              >
                                ${this.isLoading ? 'Enabling...' : 'Enable'}
                              </button>
                            `}
                      </div>
                    </div>
                  </div>

                  <!-- Notification Types -->
                  ${hasSubscription
                    ? html`
                        <div class="space-y-3">
                          <h3 class="text-sm font-semibold text-dark-text uppercase tracking-wide">
                            Notification Types
                          </h3>

                          <div class="space-y-3">
                            <!-- Session Exit -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">Session Exit</span>
                                <p class="text-xs text-dark-text-secondary">
                                  When terminal sessions complete
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.sessionExit}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'sessionExit',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>

                            <!-- Session Start -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">Session Start</span>
                                <p class="text-xs text-dark-text-secondary">
                                  When new terminal sessions begin
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.sessionStart}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'sessionStart',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>

                            <!-- Session Error -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">Session Errors</span>
                                <p class="text-xs text-dark-text-secondary">
                                  When sessions encounter errors
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.sessionError}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'sessionError',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>

                            <!-- System Alerts -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">System Alerts</span>
                                <p class="text-xs text-dark-text-secondary">
                                  System-wide notifications and alerts
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.systemAlerts}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'systemAlerts',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>
                          </div>
                        </div>

                        <!-- Notification Behavior -->
                        <div class="space-y-3">
                          <h3 class="text-sm font-semibold text-dark-text uppercase tracking-wide">
                            Behavior
                          </h3>

                          <div class="space-y-3">
                            <!-- Sound -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">Sound</span>
                                <p class="text-xs text-dark-text-secondary">
                                  Play notification sounds
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.soundEnabled}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'soundEnabled',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>

                            <!-- Vibration -->
                            <label class="flex items-center justify-between">
                              <div>
                                <span class="text-sm text-dark-text">Vibration</span>
                                <p class="text-xs text-dark-text-secondary">
                                  Vibrate on mobile devices
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                ?checked=${this.preferences.vibrationEnabled}
                                @change=${(e: Event) =>
                                  this.handlePreferenceChange(
                                    'vibrationEnabled',
                                    (e.target as HTMLInputElement).checked
                                  )}
                                class="h-4 w-4 text-dark-accent focus:ring-dark-accent border-dark-border rounded"
                              />
                            </label>
                          </div>
                        </div>

                        <!-- Actions -->
                        <div class="space-y-3">
                          <h3 class="text-sm font-semibold text-dark-text uppercase tracking-wide">
                            Actions
                          </h3>

                          <div class="flex space-x-2">
                            <button
                              @click=${this.handleTestNotification}
                              ?disabled=${!canTest || this.testingNotification}
                              class="flex-1 px-3 py-2 text-xs font-medium rounded border border-dark-border text-dark-text hover:bg-dark-border transition-colors disabled:opacity-50"
                            >
                              ${this.testingNotification ? 'Sending...' : 'Test Notification'}
                            </button>

                            <button
                              @click=${this.handleClearNotifications}
                              class="flex-1 px-3 py-2 text-xs font-medium rounded border border-dark-border text-dark-text hover:bg-dark-border transition-colors"
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                      `
                    : ''}
                  ${this.permission === 'denied'
                    ? html`
                        <div
                          class="p-3 bg-status-error bg-opacity-10 border border-status-error rounded"
                        >
                          <p class="text-sm text-status-error">
                            Notification permission has been denied. To enable notifications, please
                            reset the permission in your browser settings and reload the page.
                          </p>
                        </div>
                      `
                    : ''}
                `}
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end space-x-2 p-4 border-t border-dark-border">
            ${this.hasChanges
              ? html`
                  <button
                    @click=${this.savePreferences}
                    class="px-4 py-2 text-sm font-medium rounded bg-dark-accent text-dark-text hover:bg-dark-accent-hover transition-colors"
                  >
                    Save Changes
                  </button>
                `
              : ''}
            <button
              @click=${this.handleClose}
              class="px-4 py-2 text-sm font-medium rounded border border-dark-border text-dark-text hover:bg-dark-border transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

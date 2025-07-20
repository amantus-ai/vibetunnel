import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AuthClient } from '../services/auth-client.js';
import {
  type NotificationPreferences,
  type PushSubscription,
  pushNotificationService,
} from '../services/push-notification-service.js';
import { createLogger } from '../utils/logger.js';
import { type MediaQueryState, responsiveObserver } from '../utils/responsive-utils.js';

const logger = createLogger('unified-settings');

export interface AppPreferences {
  useDirectKeyboard: boolean;
  useBinaryMode: boolean;
  showLogLink: boolean;
  repositoryBasePath: string;
}

interface ServerConfig {
  repositoryBasePath: string;
  serverConfigured?: boolean;
}

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  useDirectKeyboard: true, // Default to modern direct keyboard for new users
  useBinaryMode: false, // Default to SSE/RSC mode for compatibility
  showLogLink: false,
  repositoryBasePath: '~/',
};

export const STORAGE_KEY = 'vibetunnel_app_preferences';

@customElement('unified-settings')
export class UnifiedSettings extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) authClient?: AuthClient;

  // Notification settings state
  @state() private notificationPreferences: NotificationPreferences = {
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
  @state() private hasNotificationChanges = false;

  // App settings state
  @state() private appPreferences: AppPreferences = DEFAULT_APP_PREFERENCES;
  @state() private mediaState: MediaQueryState = responsiveObserver.getCurrentState();
  @state() private serverConfig: ServerConfig | null = null;
  @state() private isServerConfigured = false;
  @state() private repositoryCount = 0;
  @state() private isDiscoveringRepositories = false;

  private permissionChangeUnsubscribe?: () => void;
  private subscriptionChangeUnsubscribe?: () => void;
  private unsubscribeResponsive?: () => void;
  private configWebSocket?: WebSocket;

  connectedCallback() {
    super.connectedCallback();
    this.initializeNotifications();
    this.loadAppPreferences();
    this.connectConfigWebSocket();
    this.discoverRepositories();

    // Subscribe to responsive changes
    this.unsubscribeResponsive = responsiveObserver.subscribe((state) => {
      this.mediaState = state;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.permissionChangeUnsubscribe) {
      this.permissionChangeUnsubscribe();
    }
    if (this.subscriptionChangeUnsubscribe) {
      this.subscriptionChangeUnsubscribe();
    }
    if (this.unsubscribeResponsive) {
      this.unsubscribeResponsive();
    }
    if (this.configWebSocket) {
      this.configWebSocket.close();
      this.configWebSocket = undefined;
    }
    // Clean up keyboard listener
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('visible')) {
      if (this.visible) {
        document.addEventListener('keydown', this.handleKeyDown);
        document.startViewTransition?.(() => {
          this.requestUpdate();
        });
      } else {
        document.removeEventListener('keydown', this.handleKeyDown);
      }
    }
  }

  private async initializeNotifications(): Promise<void> {
    await pushNotificationService.waitForInitialization();

    this.permission = pushNotificationService.getPermission();
    this.subscription = pushNotificationService.getSubscription();
    this.notificationPreferences = pushNotificationService.loadPreferences();

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

  private async loadAppPreferences() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.appPreferences = { ...DEFAULT_APP_PREFERENCES, ...JSON.parse(stored) };
      }

      // Fetch server configuration
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const serverConfig: ServerConfig = await response.json();
          this.serverConfig = serverConfig;
          this.isServerConfigured = serverConfig.serverConfigured ?? false;

          // If server-configured, always use server's path
          if (this.isServerConfigured) {
            this.appPreferences.repositoryBasePath = serverConfig.repositoryBasePath;
            // Save the updated preferences
            this.saveAppPreferences();
          } else if (!stored || !JSON.parse(stored).repositoryBasePath) {
            // If we don't have a local repository base path and not server-configured, use the server's default
            this.appPreferences.repositoryBasePath =
              serverConfig.repositoryBasePath || DEFAULT_APP_PREFERENCES.repositoryBasePath;
            // Save the updated preferences
            this.saveAppPreferences();
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch server config', error);
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
    }
  }

  private saveAppPreferences() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.appPreferences));

      // Dispatch event to notify app about preference changes
      window.dispatchEvent(
        new CustomEvent('app-preferences-changed', {
          detail: this.appPreferences,
        })
      );
    } catch (error) {
      logger.error('Failed to save app preferences', error);
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.visible) {
      this.handleClose();
    }
  };

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleBackdropClick(e: Event) {
    if (e.target === e.currentTarget) {
      this.handleClose();
    }
  }

  private async handleToggleNotifications() {
    if (this.isLoading) return;

    this.isLoading = true;
    try {
      if (this.notificationPreferences.enabled) {
        // Disable notifications
        await pushNotificationService.unsubscribe();
        this.notificationPreferences = { ...this.notificationPreferences, enabled: false };
        pushNotificationService.savePreferences(this.notificationPreferences);
        this.dispatchEvent(new CustomEvent('notifications-disabled'));
      } else {
        // Enable notifications
        const permission = await pushNotificationService.requestPermission();
        if (permission === 'granted') {
          const subscription = await pushNotificationService.subscribe();
          if (subscription) {
            this.notificationPreferences = { ...this.notificationPreferences, enabled: true };
            pushNotificationService.savePreferences(this.notificationPreferences);
            this.dispatchEvent(new CustomEvent('notifications-enabled'));
          } else {
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: 'Failed to subscribe to notifications',
              })
            );
          }
        } else {
          this.dispatchEvent(
            new CustomEvent('error', {
              detail:
                permission === 'denied'
                  ? 'Notifications permission denied'
                  : 'Notifications permission not granted',
            })
          );
        }
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async handleTestNotification() {
    if (this.testingNotification) return;

    this.testingNotification = true;
    try {
      await pushNotificationService.testNotification();
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: 'Test notification sent',
        })
      );
    } finally {
      this.testingNotification = false;
    }
  }

  private async handleNotificationPreferenceChange(
    key: keyof NotificationPreferences,
    value: boolean
  ) {
    this.notificationPreferences = { ...this.notificationPreferences, [key]: value };
    this.hasNotificationChanges = true;
    pushNotificationService.savePreferences(this.notificationPreferences);
  }

  private handleAppPreferenceChange(key: keyof AppPreferences, value: boolean | string) {
    // Don't allow changes to repository path if server-configured
    if (key === 'repositoryBasePath' && this.isServerConfigured) {
      return;
    }
    this.appPreferences = { ...this.appPreferences, [key]: value };
    this.saveAppPreferences();

    // Send repository path updates to server/Mac app
    if (key === 'repositoryBasePath' && this.configWebSocket?.readyState === WebSocket.OPEN) {
      logger.log('Sending repository path update to server:', value);
      this.configWebSocket.send(
        JSON.stringify({
          type: 'update-repository-path',
          path: value as string,
        })
      );
      // Re-discover repositories when path changes
      this.discoverRepositories();
    }
  }

  private async discoverRepositories() {
    this.isDiscoveringRepositories = true;

    try {
      const basePath = this.appPreferences.repositoryBasePath || '~/';
      const response = await fetch(
        `/api/repositories/discover?path=${encodeURIComponent(basePath)}`,
        {
          headers: this.authClient?.getAuthHeader() || {},
        }
      );

      if (response.ok) {
        const repositories = await response.json();
        this.repositoryCount = repositories.length;
        logger.debug(`Discovered ${this.repositoryCount} repositories in ${basePath}`);
      } else {
        logger.error('Failed to discover repositories');
        this.repositoryCount = 0;
      }
    } catch (error) {
      logger.error('Error discovering repositories:', error);
      this.repositoryCount = 0;
    } finally {
      this.isDiscoveringRepositories = false;
    }
  }

  private connectConfigWebSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/config`;

      this.configWebSocket = new WebSocket(wsUrl);

      this.configWebSocket.onopen = () => {
        logger.log('Config WebSocket connected');
      };

      this.configWebSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'config' && message.data) {
            const { repositoryBasePath } = message.data;

            // Update server config state
            this.serverConfig = message.data;
            this.isServerConfigured = message.data.serverConfigured ?? false;

            // If server-configured, update the app preferences
            if (this.isServerConfigured && repositoryBasePath) {
              this.appPreferences.repositoryBasePath = repositoryBasePath;
              this.saveAppPreferences();
              logger.log('Repository path updated from server:', repositoryBasePath);
            }
          }
        } catch (error) {
          logger.error('Failed to parse config WebSocket message:', error);
        }
      };

      this.configWebSocket.onerror = (error) => {
        logger.error('Config WebSocket error:', error);
      };

      this.configWebSocket.onclose = () => {
        logger.log('Config WebSocket closed');
        // Attempt to reconnect after a delay
        setTimeout(() => {
          // Check if component is still connected to DOM
          if (this.isConnected) {
            this.connectConfigWebSocket();
          }
        }, 5000);
      };
    } catch (error) {
      logger.error('Failed to connect config WebSocket:', error);
    }
  }

  private get isNotificationsSupported(): boolean {
    return pushNotificationService.isSupported();
  }

  private get isNotificationsEnabled(): boolean {
    return (
      this.notificationPreferences.enabled && this.permission === 'granted' && !!this.subscription
    );
  }

  private renderSubscriptionStatus() {
    const hasSubscription = this.subscription || pushNotificationService.isSubscribed();

    if (hasSubscription) {
      return html`
        <div class="flex items-center space-x-2">
          <span class="text-status-success font-mono">✓</span>
          <span class="text-sm text-primary">Active</span>
        </div>
      `;
    } else if (this.permission === 'granted') {
      return html`
        <div class="flex items-center space-x-2">
          <span class="text-status-warning font-mono">!</span>
          <span class="text-sm text-primary">Not subscribed</span>
        </div>
      `;
    } else {
      return html`
        <div class="flex items-center space-x-2">
          <span class="text-status-error font-mono">✗</span>
          <span class="text-sm text-primary">Disabled</span>
        </div>
      `;
    }
  }

  private isIOSSafari(): boolean {
    const userAgent = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    return isIOS;
  }

  private isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator &&
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
    );
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div class="modal-backdrop flex items-center justify-center" @click=${this.handleBackdropClick}>
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-2xl mx-2 sm:mx-4 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col"
          style="view-transition-name: settings-modal"
        >
          <!-- Header -->
          <div class="p-4 pb-4 border-b border-base relative flex-shrink-0">
            <h2 class="text-primary text-lg font-bold">Settings</h2>
            <button
              class="absolute top-4 right-4 text-muted hover:text-primary transition-colors p-1"
              @click=${this.handleClose}
              title="Close"
              aria-label="Close settings"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-4 space-y-6">
            ${this.renderNotificationSettings()}
            ${this.renderAppSettings()}
          </div>
        </div>
      </div>
    `;
  }

  private renderNotificationSettings() {
    const isIOSSafari = this.isIOSSafari();
    const isStandalone = this.isStandalone();
    const canTest = this.permission === 'granted' && this.subscription;

    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-md font-bold text-primary">Notifications</h3>
          ${this.renderSubscriptionStatus()}
        </div>
        
        ${
          !this.isNotificationsSupported
            ? html`
              <div class="p-4 bg-status-warning bg-opacity-10 border border-status-warning rounded-lg">
                ${
                  isIOSSafari && !isStandalone
                    ? html`
                      <p class="text-sm text-status-warning mb-2">
                        Push notifications require installing this app to your home screen.
                      </p>
                      <p class="text-xs text-status-warning opacity-80">
                        Tap the share button in Safari and select "Add to Home Screen" to enable push notifications.
                      </p>
                    `
                    : html`
                      <p class="text-sm text-status-warning">
                        Push notifications are not supported in this browser.
                      </p>
                    `
                }
              </div>
            `
            : html`
              <!-- Main toggle -->
              <div class="flex items-center justify-between p-4 bg-tertiary rounded-lg border border-base">
                <div class="flex-1">
                  <label class="text-primary font-medium">Enable Notifications</label>
                  <p class="text-muted text-xs mt-1">
                    Receive alerts for session events
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked="${this.isNotificationsEnabled}"
                  @click=${this.handleToggleNotifications}
                  ?disabled=${this.isLoading}
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
                    this.isNotificationsEnabled ? 'bg-primary' : 'bg-border'
                  }"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-bg-elevated transition-transform ${
                      this.isNotificationsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }"
                  ></span>
                </button>
              </div>

              ${
                this.isNotificationsEnabled
                  ? html`
                    <!-- Notification types -->
                    <div class="mt-4 space-y-4">
                      <div>
                        <h4 class="text-sm font-medium text-muted mb-3">Notification Types</h4>
                        <div class="space-y-2 bg-base rounded-lg p-3">
                          ${this.renderNotificationToggle('sessionExit', 'Session Exit', 'When a session terminates')}
                          ${this.renderNotificationToggle('sessionStart', 'Session Start', 'When a new session starts')}
                          ${this.renderNotificationToggle('sessionError', 'Session Errors', 'When errors occur in sessions')}
                          ${this.renderNotificationToggle('systemAlerts', 'System Alerts', 'Important system notifications')}
                        </div>
                      </div>

                      <!-- Sound and vibration -->
                      <div>
                        <h4 class="text-sm font-medium text-muted mb-3">Notification Behavior</h4>
                        <div class="space-y-2 bg-base rounded-lg p-3">
                          ${this.renderNotificationToggle('soundEnabled', 'Sound', 'Play sound with notifications')}
                          ${this.renderNotificationToggle('vibrationEnabled', 'Vibration', 'Vibrate device with notifications')}
                        </div>
                      </div>
                    </div>

                    <!-- Test button -->
                    <div class="flex items-center justify-between pt-3 mt-3 border-t border-base">
                      <p class="text-xs text-muted">Test your notification settings</p>
                      <button
                        class="btn-secondary text-xs px-3 py-1.5"
                        @click=${this.handleTestNotification}
                        ?disabled=${!canTest || this.testingNotification}
                        title=${!canTest ? 'Enable notifications first' : 'Send test notification'}
                      >
                        ${this.testingNotification ? 'Sending...' : 'Test Notification'}
                      </button>
                    </div>
                  `
                  : ''
              }
            `
        }
      </div>
    `;
  }

  private renderNotificationToggle(
    key: keyof NotificationPreferences,
    label: string,
    description: string
  ) {
    return html`
      <div class="flex items-center justify-between py-2">
        <div class="flex-1 pr-4">
          <label class="text-primary text-sm font-medium">${label}</label>
          <p class="text-muted text-xs">${description}</p>
        </div>
        <button
          role="switch"
          aria-checked="${this.notificationPreferences[key]}"
          @click=${() => this.handleNotificationPreferenceChange(key, !this.notificationPreferences[key])}
          class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
            this.notificationPreferences[key] ? 'bg-primary' : 'bg-border'
          }"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-bg-elevated transition-transform ${
              this.notificationPreferences[key] ? 'translate-x-4' : 'translate-x-0.5'
            }"
          ></span>
        </button>
      </div>
    `;
  }

  private renderAppSettings() {
    return html`
      <div class="space-y-4">
        <h3 class="text-md font-bold text-primary mb-3">Application</h3>
        
        <!-- Direct keyboard input (Mobile only) -->
        ${
          this.mediaState.isMobile
            ? html`
              <div class="flex items-center justify-between p-4 bg-tertiary rounded-lg border border-base">
                <div class="flex-1">
                  <label class="text-primary font-medium">
                    Use Direct Keyboard
                  </label>
                  <p class="text-muted text-xs mt-1">
                    Capture keyboard input directly without showing a text field (desktop-like experience)
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked="${this.appPreferences.useDirectKeyboard}"
                  @click=${() => this.handleAppPreferenceChange('useDirectKeyboard', !this.appPreferences.useDirectKeyboard)}
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
                    this.appPreferences.useDirectKeyboard ? 'bg-primary' : 'bg-border'
                  }"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-bg-elevated transition-transform ${
                      this.appPreferences.useDirectKeyboard ? 'translate-x-5' : 'translate-x-0.5'
                    }"
                  ></span>
                </button>
              </div>
            `
            : ''
        }

        <!-- Show log link -->
        <div class="flex items-center justify-between p-4 bg-tertiary rounded-lg border border-base">
          <div class="flex-1">
            <label class="text-primary font-medium">Show Log Link</label>
            <p class="text-muted text-xs mt-1">
              Display log link for debugging
            </p>
          </div>
          <button
            role="switch"
            aria-checked="${this.appPreferences.showLogLink}"
            @click=${() => this.handleAppPreferenceChange('showLogLink', !this.appPreferences.showLogLink)}
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
              this.appPreferences.showLogLink ? 'bg-primary' : 'bg-border'
            }"
          >
            <span
              class="inline-block h-5 w-5 transform rounded-full bg-bg-elevated transition-transform ${
                this.appPreferences.showLogLink ? 'translate-x-5' : 'translate-x-0.5'
              }"
            ></span>
          </button>
        </div>

        <!-- Repository Base Path -->
        <div class="p-4 bg-tertiary rounded-lg border border-base">
          <div class="mb-3">
            <div class="flex items-center justify-between">
              <label class="text-primary font-medium">Repository Base Path</label>
              ${
                this.isDiscoveringRepositories
                  ? html`<span class="text-muted text-xs">Scanning...</span>`
                  : html`<span class="text-muted text-xs">${this.repositoryCount} repositories found</span>`
              }
            </div>
            <p class="text-muted text-xs mt-1">
              ${
                this.isServerConfigured
                  ? 'This path is synced with the VibeTunnel Mac app'
                  : 'Default directory for new sessions and repository discovery'
              }
            </p>
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              .value=${this.appPreferences.repositoryBasePath}
              @input=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                this.handleAppPreferenceChange('repositoryBasePath', input.value);
              }}
              placeholder="~/"
              class="input-field py-2 text-sm flex-1 ${
                this.isServerConfigured ? 'opacity-60 cursor-not-allowed' : ''
              }"
              ?disabled=${this.isServerConfigured}
              ?readonly=${this.isServerConfigured}
            />
            ${
              this.isServerConfigured
                ? html`
                  <div class="flex items-center text-muted" title="Synced with Mac app">
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                `
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }
}

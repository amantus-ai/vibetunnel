import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { DEFAULT_REPOSITORY_BASE_PATH } from '../../shared/constants.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../types/config.js';
import type { AuthClient } from '../services/auth-client.js';
import {
  type NotificationPreferences,
  type PushSubscription,
  pushNotificationService,
} from '../services/push-notification-service.js';
import { RepositoryService } from '../services/repository-service.js';
import { ServerConfigService } from '../services/server-config-service.js';
import { createLogger } from '../utils/logger.js';
import { type MediaQueryState, responsiveObserver } from '../utils/responsive-utils.js';
import { VERSION } from '../version.js';

const logger = createLogger('settings');

export interface AppPreferences {
  useDirectKeyboard: boolean;
  useBinaryMode: boolean;
}

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  useDirectKeyboard: true, // Default to modern direct keyboard for new users
  useBinaryMode: false, // Default to SSE/RSC mode for compatibility
};

export const STORAGE_KEY = 'vibetunnel_app_preferences';

@customElement('vt-settings')
export class Settings extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) authClient?: AuthClient;

  // Notification settings state
  @state() private notificationPreferences: NotificationPreferences =
    DEFAULT_NOTIFICATION_PREFERENCES;
  @state() private permission: NotificationPermission = 'default';
  @state() private subscription: PushSubscription | null = null;
  @state() private isLoading = false;
  @state() private testingNotification = false;

  // App settings state
  @state() private appPreferences: AppPreferences = DEFAULT_APP_PREFERENCES;
  @state() private repositoryBasePath = DEFAULT_REPOSITORY_BASE_PATH;
  @state() private mediaState: MediaQueryState = responsiveObserver.getCurrentState();
  @state() private repositoryCount = 0;
  @state() private isDiscoveringRepositories = false;

  private permissionChangeUnsubscribe?: () => void;
  private subscriptionChangeUnsubscribe?: () => void;
  private unsubscribeResponsive?: () => void;
  private repositoryService?: RepositoryService;
  private serverConfigService?: ServerConfigService;

  connectedCallback() {
    super.connectedCallback();
    this.initializeNotifications();
    this.loadAppPreferences();

    // Initialize services
    this.serverConfigService = new ServerConfigService(this.authClient);

    // Initialize repository service if authClient is available
    if (this.authClient) {
      this.repositoryService = new RepositoryService(this.authClient, this.serverConfigService);
    }

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
    // Clean up keyboard listener
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('visible')) {
      if (this.visible) {
        document.addEventListener('keydown', this.handleKeyDown);
        // Removed view transition for instant display
        this.requestUpdate();
        // Discover repositories when settings are opened
        this.discoverRepositories();
      } else {
        document.removeEventListener('keydown', this.handleKeyDown);
      }
    }

    // Initialize repository service when authClient becomes available
    if (changedProperties.has('authClient') && this.authClient) {
      if (!this.repositoryService && this.serverConfigService) {
        this.repositoryService = new RepositoryService(this.authClient, this.serverConfigService);
      }
      // Update server config service's authClient
      if (this.serverConfigService) {
        this.serverConfigService.setAuthClient(this.authClient);
      }
      // Discover repositories if settings are already visible
      if (this.visible) {
        this.discoverRepositories();
      }
    }
  }

  private async initializeNotifications(): Promise<void> {
    await pushNotificationService.waitForInitialization();

    this.permission = pushNotificationService.getPermission();
    this.subscription = pushNotificationService.getSubscription();
    this.notificationPreferences = await pushNotificationService.loadPreferences();

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

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    // When dialog becomes visible, refresh the config to ensure sync
    if (changedProperties.has('visible') && this.visible) {
      this.loadAppPreferences();
    }
  }

  private async loadAppPreferences() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.appPreferences = { ...DEFAULT_APP_PREFERENCES, ...JSON.parse(stored) };
      }

      // Fetch server configuration - force refresh when dialog opens
      if (this.serverConfigService) {
        try {
          const serverConfig = await this.serverConfigService.loadConfig(this.visible);
          // Always use server's repository base path
          this.repositoryBasePath = serverConfig.repositoryBasePath || DEFAULT_REPOSITORY_BASE_PATH;
          logger.debug('Loaded repository base path:', this.repositoryBasePath);
          // Force update to ensure UI reflects the loaded value
          this.requestUpdate();
        } catch (error) {
          logger.warn('Failed to fetch server config', error);
        }
      }

      // Discover repositories after preferences are loaded if visible
      if (this.visible && this.repositoryService) {
        this.discoverRepositories();
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

  private async discoverRepositories() {
    if (!this.repositoryService || this.isDiscoveringRepositories) {
      return;
    }

    this.isDiscoveringRepositories = true;
    try {
      // Add a small delay to ensure preferences are loaded
      await new Promise((resolve) => setTimeout(resolve, 100));

      const repositories = await this.repositoryService.discoverRepositories();
      this.repositoryCount = repositories.length;
      logger.log(`Discovered ${this.repositoryCount} repositories in ${this.repositoryBasePath}`);
    } catch (error) {
      logger.error('Failed to discover repositories', error);
      this.repositoryCount = 0;
    } finally {
      this.isDiscoveringRepositories = false;
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
        await pushNotificationService.savePreferences(this.notificationPreferences);
        this.dispatchEvent(new CustomEvent('notifications-disabled'));
      } else {
        // Enable notifications
        const permission = await pushNotificationService.requestPermission();
        if (permission === 'granted') {
          const subscription = await pushNotificationService.subscribe();
          if (subscription) {
            this.notificationPreferences = { ...this.notificationPreferences, enabled: true };
            await pushNotificationService.savePreferences(this.notificationPreferences);
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
    await pushNotificationService.savePreferences(this.notificationPreferences);
  }

  private handleAppPreferenceChange(key: keyof AppPreferences, value: boolean | string) {
    // Update locally
    this.appPreferences = { ...this.appPreferences, [key]: value };
    this.saveAppPreferences();
  }

  private async handleRepositoryBasePathChange(value: string) {
    if (this.serverConfigService) {
      try {
        // Update server config
        await this.serverConfigService.updateConfig({ repositoryBasePath: value });
        // Update local state
        this.repositoryBasePath = value;
        // Rediscover repositories
        this.discoverRepositories();
      } catch (error) {
        logger.error('Failed to update repository base path:', error);
        // Revert the change on error
        this.requestUpdate();
      }
    }
  }

  private get isNotificationsSupported(): boolean {
    return pushNotificationService.isSupported();
  }

  private get isNotificationsEnabled(): boolean {
    // Show as enabled if the preference is set, regardless of subscription state
    // This allows the toggle to properly reflect user intent
    return this.notificationPreferences.enabled;
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
        >
          <!-- Header -->
          <div class="p-4 pb-4 border-b border-border/50 relative flex-shrink-0">
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

          <!-- Footer -->
          <div class="p-4 pt-3 border-t border-border/50 flex-shrink-0">
            <div class="flex items-center justify-between text-xs font-mono">
              <span class="text-muted">v${VERSION}</span>
              <a href="/logs" class="text-primary hover:text-primary-hover transition-colors" target="_blank">
                View Logs
              </a>
            </div>
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
              <div class="flex items-center justify-between p-4 bg-tertiary rounded-lg border border-border/50">
                <div class="flex-1">
                  <label class="text-primary font-medium">Enable Notifications</label>
                  <p class="text-muted text-xs mt-1">
                    Receive alerts for session events
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked="${this.notificationPreferences.enabled}"
                  @click=${this.handleToggleNotifications}
                  ?disabled=${this.isLoading}
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
                    this.notificationPreferences.enabled ? 'bg-primary' : 'bg-border'
                  }"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-bg-elevated transition-transform ${
                      this.notificationPreferences.enabled ? 'translate-x-5' : 'translate-x-0.5'
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
                          ${this.renderNotificationToggle('commandError', 'Session Errors', 'When errors occur in sessions')}
                          ${this.renderNotificationToggle('commandCompletion', 'Command Completion', 'When long-running commands finish')}
                          ${this.renderNotificationToggle('bell', 'System Alerts', 'Important system notifications')}
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
                    <div class="flex items-center justify-between pt-3 mt-3 border-t border-border/50">
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
              <div class="flex items-center justify-between p-4 bg-tertiary rounded-lg border border-border/50">
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


        <!-- Repository Base Path -->
        <div class="p-4 bg-tertiary rounded-lg border border-border/50">
          <div class="mb-3">
            <div class="flex items-center justify-between">
              <label class="text-primary font-medium">Repository Base Path</label>
              <div class="flex items-center gap-2">
                ${
                  this.isDiscoveringRepositories
                    ? html`<span id="repository-status" class="text-muted text-xs">Scanning...</span>`
                    : html`<span id="repository-status" class="text-muted text-xs">${this.repositoryCount} repositories found</span>`
                }
                <button
                  @click=${() => this.discoverRepositories()}
                  ?disabled=${this.isDiscoveringRepositories}
                  class="text-primary hover:text-primary-hover text-xs transition-colors duration-200"
                  title="Refresh repository list"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
            <p class="text-muted text-xs mt-1">
              Default directory for new sessions and repository discovery.
            </p>
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              .value=${this.repositoryBasePath}
              @input=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                this.handleRepositoryBasePathChange(input.value);
              }}
              placeholder="~/"
              class="input-field py-2 text-sm flex-1"
            />
          </div>
        </div>
      </div>
    `;
  }
}

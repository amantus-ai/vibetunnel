/**
 * Git Notification Handler Component
 *
 * Displays real-time Git notifications received from the server.
 * Shows notifications for branch switches, divergence, and follow mode changes.
 */
import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type {
  ControlEventService,
  GitNotificationData,
} from '../services/control-event-service.js';
import { Z_INDEX } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('git-notification-handler');

interface GitNotification {
  id: string;
  data: GitNotificationData;
  timestamp: number;
}

@customElement('git-notification-handler')
export class GitNotificationHandler extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() private notifications: GitNotification[] = [];
  private unsubscribe?: () => void;
  private autoHideTimers = new Map<string, NodeJS.Timeout>();

  setControlEventService(service: ControlEventService): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Subscribe to control events
    this.unsubscribe = service.onEvent((event) => {
      if (event.category === 'git' && event.action === 'notification') {
        this.handleGitNotification(event.data as GitNotificationData);
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up subscription
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Clear all timers
    this.autoHideTimers.forEach((timer) => clearTimeout(timer));
    this.autoHideTimers.clear();
  }

  private handleGitNotification(data: GitNotificationData): void {
    const notification: GitNotification = {
      id: `git-notif-${Date.now()}-${Math.random()}`,
      data,
      timestamp: Date.now(),
    };

    logger.debug('Received Git notification:', data);

    // Add to notifications
    this.notifications = [...this.notifications, notification];

    // Auto-hide after 10 seconds
    const timer = setTimeout(() => {
      this.dismissNotification(notification.id);
    }, 10000);

    this.autoHideTimers.set(notification.id, timer);
  }

  private dismissNotification(id: string): void {
    this.notifications = this.notifications.filter((n) => n.id !== id);

    const timer = this.autoHideTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autoHideTimers.delete(id);
    }
  }

  private getNotificationIcon(type: GitNotificationData['type']): TemplateResult {
    switch (type) {
      case 'branch_switched':
        return html`
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        `;
      case 'branch_diverged':
        return html`
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        `;
      case 'follow_enabled':
      case 'follow_disabled':
        return html`
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        `;
    }
  }

  private getNotificationClass(type: GitNotificationData['type']): string {
    switch (type) {
      case 'branch_switched':
      case 'follow_enabled':
        return 'bg-blue-500';
      case 'branch_diverged':
        return 'bg-yellow-500';
      case 'follow_disabled':
        return 'bg-gray-500';
    }
  }

  private formatNotificationMessage(data: GitNotificationData): string {
    switch (data.type) {
      case 'branch_switched':
        return data.message || `Branch switched to ${data.currentBranch}`;
      case 'branch_diverged':
        return (
          data.message ||
          `Branch ${data.divergedBranch} has diverged (${data.aheadBy || 0} ahead, ${data.behindBy || 0} behind)`
        );
      case 'follow_enabled':
        return data.message || `Follow mode enabled for ${data.currentBranch}`;
      case 'follow_disabled':
        return data.message || `Follow mode disabled`;
    }
  }

  render() {
    if (this.notifications.length === 0) {
      return html``;
    }

    return html`
      <div class="fixed top-4 right-4 space-y-2" style="z-index: ${Z_INDEX.NOTIFICATION};">
        ${this.notifications.map(
          (notification) => html`
            <div
              class="flex items-start gap-3 p-4 rounded-lg shadow-lg text-white max-w-md animate-slide-in-right ${this.getNotificationClass(
                notification.data.type
              )}"
            >
              <div class="flex-shrink-0">
                ${this.getNotificationIcon(notification.data.type)}
              </div>
              <div class="flex-1">
                ${
                  notification.data.sessionTitle
                    ? html`
                      <div class="font-semibold text-sm mb-1">
                        ${notification.data.sessionTitle}
                      </div>
                    `
                    : ''
                }
                <div class="text-sm">
                  ${this.formatNotificationMessage(notification.data)}
                </div>
              </div>
              <button
                @click=${() => this.dismissNotification(notification.id)}
                class="flex-shrink-0 text-white/80 hover:text-white transition-colors"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'git-notification-handler': GitNotificationHandler;
  }
}

/**
 * Session Card Component
 *
 * Displays a single terminal session with its preview, status, and controls.
 * Shows activity indicators when terminal content changes and provides kill functionality.
 *
 * @fires session-select - When card is clicked (detail: Session)
 * @fires session-killed - When session is successfully killed (detail: { sessionId: string, session: Session })
 * @fires session-kill-error - When kill operation fails (detail: { sessionId: string, error: string })
 *
 * @listens content-changed - From vibe-terminal-buffer when terminal content changes
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import { isAIAssistantSession, sendAIPrompt } from '../utils/ai-sessions.js';
import { createLogger } from '../utils/logger.js';
import { copyToClipboard } from '../utils/path-utils.js';
import { TerminalPreferencesManager } from '../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';

const logger = createLogger('session-card');
import './vibe-terminal-buffer.js';
import './copy-icon.js';
import './clickable-path.js';
import './inline-edit.js';

// Magic wand icon constant
const MAGIC_WAND_ICON = html`
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
      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
    />
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
      d="M12 8l-2 2m4-2l-2 2m4 0l-2 2"
      opacity="0.6"
    />
  </svg>
`;

@customElement('session-card')
export class SessionCard extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session!: Session;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: Boolean }) selected = false;
  @state() private killing = false;
  @state() private killingFrame = 0;
  @state() private isActive = false;
  @state() private isHovered = false;
  @state() private isSendingPrompt = false;
  @state() private terminalTheme: TerminalThemeId = 'auto';

  private killingInterval: number | null = null;
  private activityTimeout: number | null = null;
  private storageListener: ((e: StorageEvent) => void) | null = null;
  private themeChangeListener: ((e: CustomEvent) => void) | null = null;
  private preferencesManager = TerminalPreferencesManager.getInstance();

  connectedCallback() {
    super.connectedCallback();

    // Load initial theme from TerminalPreferencesManager
    this.loadThemeFromStorage();

    // Listen for storage changes to update theme reactively (cross-tab)
    this.storageListener = (e: StorageEvent) => {
      if (e.key === 'vibetunnel_terminal_preferences') {
        this.loadThemeFromStorage();
      }
    };
    window.addEventListener('storage', this.storageListener);

    // Listen for custom theme change events (same-tab)
    this.themeChangeListener = (e: CustomEvent) => {
      this.terminalTheme = e.detail as TerminalThemeId;
    };
    window.addEventListener('terminal-theme-changed', this.themeChangeListener as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.killingInterval) {
      clearInterval(this.killingInterval);
    }
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }
    if (this.themeChangeListener) {
      window.removeEventListener(
        'terminal-theme-changed',
        this.themeChangeListener as EventListener
      );
      this.themeChangeListener = null;
    }
  }

  private handleCardClick() {
    this.dispatchEvent(
      new CustomEvent('session-select', {
        detail: this.session,
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleContentChanged() {
    // Only track activity for running sessions
    if (this.session.status !== 'running') {
      return;
    }

    // Content changed, immediately mark as active
    this.isActive = true;

    // Clear existing timeout
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }

    // Set timeout to clear activity after 500ms of no changes
    this.activityTimeout = window.setTimeout(() => {
      this.isActive = false;
      this.activityTimeout = null;
    }, 500);
  }

  private async handleKillClick(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    await this.kill();
  }

  // Public method to kill the session with animation (or clean up exited session)
  public async kill(): Promise<boolean> {
    // Don't kill if already killing
    if (this.killing) {
      return false;
    }

    // Only allow killing/cleanup for running or exited sessions
    if (this.session.status !== 'running' && this.session.status !== 'exited') {
      return false;
    }

    // Check if this is a cleanup action (for black hole animation)
    const isCleanup = this.session.status === 'exited';

    // Start killing animation
    this.killing = true;
    this.killingFrame = 0;
    this.killingInterval = window.setInterval(() => {
      this.killingFrame = (this.killingFrame + 1) % 4;
      this.requestUpdate();
    }, 200);

    // Set a timeout to prevent getting stuck in killing state
    const killingTimeout = setTimeout(() => {
      logger.warn(`Kill operation timed out for session ${this.session.id}`);
      this.stopKillingAnimation();
      // Dispatch error event
      this.dispatchEvent(
        new CustomEvent('session-kill-error', {
          detail: {
            sessionId: this.session.id,
            error: 'Kill operation timed out',
          },
          bubbles: true,
          composed: true,
        })
      );
    }, 10000); // 10 second timeout

    // If cleanup, apply black hole animation FIRST and wait
    if (isCleanup) {
      // Apply the black hole animation class
      (this as HTMLElement).classList.add('black-hole-collapsing');

      // Wait for the animation to complete (300ms)
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Send kill or cleanup request based on session status
    try {
      // Use different endpoint based on session status
      const endpoint =
        this.session.status === 'exited'
          ? `/api/sessions/${this.session.id}/cleanup`
          : `/api/sessions/${this.session.id}`;

      const action = this.session.status === 'exited' ? 'cleanup' : 'kill';

      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          ...this.authClient.getAuthHeader(),
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error(`Failed to ${action} session`, { errorData, sessionId: this.session.id });
        throw new Error(`${action} failed: ${response.status}`);
      }

      // Kill/cleanup succeeded - dispatch event to notify parent components
      this.dispatchEvent(
        new CustomEvent('session-killed', {
          detail: {
            sessionId: this.session.id,
            session: this.session,
          },
          bubbles: true,
          composed: true,
        })
      );

      logger.log(
        `Session ${this.session.id} ${action === 'cleanup' ? 'cleaned up' : 'killed'} successfully`
      );
      clearTimeout(killingTimeout);
      return true;
    } catch (error) {
      logger.error('Error killing session', { error, sessionId: this.session.id });

      // Show error to user (keep animation to indicate something went wrong)
      this.dispatchEvent(
        new CustomEvent('session-kill-error', {
          detail: {
            sessionId: this.session.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          bubbles: true,
          composed: true,
        })
      );
      clearTimeout(killingTimeout);
      return false;
    } finally {
      // Stop animation in all cases
      this.stopKillingAnimation();
      clearTimeout(killingTimeout);
    }
  }

  private stopKillingAnimation() {
    this.killing = false;
    if (this.killingInterval) {
      clearInterval(this.killingInterval);
      this.killingInterval = null;
    }
  }

  private getKillingText(): string {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[this.killingFrame % frames.length];
  }

  private async handleRename(newName: string) {
    try {
      const response = await fetch(`/api/sessions/${this.session.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to rename session', { errorData, sessionId: this.session.id });
        throw new Error(`Rename failed: ${response.status}`);
      }

      // Update the local session object
      this.session = { ...this.session, name: newName };

      // Dispatch event to notify parent components
      this.dispatchEvent(
        new CustomEvent('session-renamed', {
          detail: {
            sessionId: this.session.id,
            newName: newName,
          },
          bubbles: true,
          composed: true,
        })
      );

      logger.log(`Session ${this.session.id} renamed to: ${newName}`);
    } catch (error) {
      logger.error('Error renaming session', { error, sessionId: this.session.id });

      // Show error to user
      this.dispatchEvent(
        new CustomEvent('session-rename-error', {
          detail: {
            sessionId: this.session.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private async handlePidClick(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.session.pid) {
      const success = await copyToClipboard(this.session.pid.toString());
      if (success) {
        logger.log('PID copied to clipboard', { pid: this.session.pid });
      } else {
        logger.error('Failed to copy PID to clipboard', { pid: this.session.pid });
      }
    }
  }

  private async handleMagicButton() {
    if (!this.session || this.isSendingPrompt) return;

    this.isSendingPrompt = true;
    logger.log('Magic button clicked for session', this.session.id);

    try {
      await sendAIPrompt(this.session.id, this.authClient);
    } catch (error) {
      logger.error('Failed to send AI prompt', error);
      this.dispatchEvent(
        new CustomEvent('show-toast', {
          detail: {
            message: 'Failed to send prompt to AI assistant',
            type: 'error',
          },
          bubbles: true,
          composed: true,
        })
      );
    } finally {
      this.isSendingPrompt = false;
    }
  }

  private handleMouseEnter() {
    this.isHovered = true;
  }

  private handleMouseLeave() {
    this.isHovered = false;
  }

  private loadThemeFromStorage() {
    this.terminalTheme = this.preferencesManager.getTheme();
  }

  render() {
    // Debug logging to understand what's in the session
    if (!this.session.name) {
      logger.warn('Session missing name', {
        sessionId: this.session.id,
        name: this.session.name,
        command: this.session.command,
      });
    }

    return html`
      <div
        class="card cursor-pointer overflow-hidden flex flex-col h-full ${
          this.killing ? 'opacity-60' : ''
        } ${
          this.isActive && this.session.status === 'running'
            ? 'ring-2 ring-primary shadow-glow-sm'
            : ''
        } ${this.selected ? 'ring-2 ring-accent-primary shadow-card-hover' : ''}"
        style="view-transition-name: session-${this.session.id}; --session-id: session-${
          this.session.id
        }"
        data-session-id="${this.session.id}"
        data-testid="session-card"
        data-session-status="${this.session.status}"
        data-is-killing="${this.killing}"
        @click=${this.handleCardClick}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <!-- Compact Header -->
        <div
          class="flex justify-between items-center px-3 py-2 border-b border-base bg-gradient-to-r from-secondary to-tertiary"
        >
          <div class="text-xs font-mono pr-2 flex-1 min-w-0 text-primary">
            <inline-edit
              .value=${this.session.name || this.session.command?.join(' ') || ''}
              .placeholder=${this.session.command?.join(' ') || ''}
              .onSave=${async (newName: string) => {
                try {
                  await this.handleRename(newName);
                } catch (error) {
                  // Error is already handled in handleRename
                  logger.debug('Rename error caught in onSave', { error });
                }
              }}
            ></inline-edit>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            ${
              this.session.status === 'running' && isAIAssistantSession(this.session)
                ? html`
                  <button
                    class="bg-transparent border-0 p-0 cursor-pointer opacity-50 hover:opacity-100 transition-opacity duration-200 text-primary"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.handleMagicButton();
                    }}
                    title="Send prompt to update terminal title"
                    aria-label="Send magic prompt to AI assistant"
                    ?disabled=${this.isSendingPrompt}
                  >
                    ${
                      this.isSendingPrompt
                        ? html`<span class="block w-5 h-5 flex items-center justify-center animate-spin">⠋</span>`
                        : MAGIC_WAND_ICON
                    }
                  </button>
                `
                : ''
            }
            ${
              this.session.status === 'running' || this.session.status === 'exited'
                ? html`
                  <button
                    class="p-1 rounded-full transition-all duration-200 disabled:opacity-50 flex-shrink-0 ${
                      this.session.status === 'running'
                        ? 'text-status-error hover:bg-status-error hover:bg-opacity-20'
                        : 'text-status-warning hover:bg-status-warning hover:bg-opacity-20'
                    }"
                    @click=${this.handleKillClick}
                    ?disabled=${this.killing}
                    title="${this.session.status === 'running' ? 'Kill session' : 'Clean up session'}"
                    data-testid="kill-session-button"
                  >
                    ${
                      this.killing
                        ? html`<span class="block w-5 h-5 flex items-center justify-center"
                          >${this.getKillingText()}</span
                        >`
                        : html`
                          <svg
                            class="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <circle cx="12" cy="12" r="10" stroke-width="2" />
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M15 9l-6 6m0-6l6 6"
                            />
                          </svg>
                        `
                    }
                  </button>
                `
                : ''
            }
          </div>
        </div>

        <!-- Terminal display (main content) -->
        <div
          class="session-preview bg-bg overflow-hidden flex-1 relative ${
            this.session.status === 'exited' ? 'session-exited' : ''
          }"
          style="background: linear-gradient(to bottom, rgb(var(--color-bg)), rgb(var(--color-bg-secondary))); box-shadow: inset 0 1px 3px rgb(var(--color-bg) / 0.5);"
        >
          ${
            this.killing
              ? html`
                <div class="w-full h-full flex items-center justify-center text-status-error">
                  <div class="text-center font-mono">
                    <div class="text-4xl mb-2">${this.getKillingText()}</div>
                    <div class="text-sm">Killing session...</div>
                  </div>
                </div>
              `
              : html`
                <vibe-terminal-buffer
                  .sessionId=${this.session.id}
                  .theme=${this.terminalTheme}
                  class="w-full h-full"
                  style="pointer-events: none;"
                  @content-changed=${this.handleContentChanged}
                ></vibe-terminal-buffer>
              `
          }
        </div>

        <!-- Compact Footer -->
        <div
          class="px-3 py-2 text-muted text-xs border-t border-base bg-gradient-to-r from-tertiary to-secondary"
        >
          <div class="flex justify-between items-center min-w-0">
            <span 
              class="${this.getActivityStatusColor()} text-xs flex items-center gap-1 flex-shrink-0"
              data-status="${this.session.status}"
              data-killing="${this.killing}"
            >
              <div class="w-2 h-2 rounded-full ${this.getStatusDotColor()}"></div>
              ${this.getActivityStatusText()}
              ${
                this.session.status === 'running' &&
                this.isActive &&
                !this.session.activityStatus?.specificStatus
                  ? html`<span class="text-primary animate-pulse ml-1">●</span>`
                  : ''
              }
            </span>
            ${
              this.session.pid
                ? html`
                  <span
                    class="cursor-pointer hover:text-primary transition-colors text-xs flex-shrink-0 ml-2 inline-flex items-center gap-1"
                    @click=${this.handlePidClick}
                    title="Click to copy PID"
                  >
                    PID: ${this.session.pid} <copy-icon size="14"></copy-icon>
                  </span>
                `
                : ''
            }
          </div>
          <div class="text-xs opacity-75 min-w-0 mt-1">
            <clickable-path .path=${this.session.workingDir} .iconSize=${12}></clickable-path>
          </div>
        </div>
      </div>
    `;
  }

  private getStatusText(): string {
    if (this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getActivityStatusText(): string {
    if (this.killing) {
      return 'killing...';
    }
    if (this.session.active === false) {
      return 'waiting';
    }
    if (this.session.status === 'running' && this.session.activityStatus?.specificStatus) {
      return this.session.activityStatus.specificStatus.status;
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (this.killing) {
      return 'text-status-error';
    }
    if (this.session.active === false) {
      return 'text-muted';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getActivityStatusColor(): string {
    if (this.killing) {
      return 'text-status-error';
    }
    if (this.session.active === false) {
      return 'text-muted';
    }
    if (this.session.status === 'running' && this.session.activityStatus?.specificStatus) {
      return 'text-status-warning';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getStatusDotColor(): string {
    if (this.killing) {
      return 'bg-status-error animate-pulse';
    }
    if (this.session.active === false) {
      return 'bg-muted';
    }
    if (this.session.status === 'running') {
      if (this.session.activityStatus?.specificStatus) {
        return 'bg-status-warning animate-pulse'; // Claude active - amber with pulse
      } else if (this.session.activityStatus?.isActive || this.isActive) {
        return 'bg-status-success'; // Generic active - solid green
      } else {
        return 'bg-status-success ring-1 ring-status-success ring-opacity-50'; // Idle - green with ring
      }
    }
    return 'bg-status-warning';
  }
}

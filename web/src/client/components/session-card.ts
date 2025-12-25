/**
 * Session Card Component
 *
 * Displays a single terminal session with its preview, status, and controls.
 * Provides kill functionality and quick session status at a glance.
 *
 * @fires session-select - When card is clicked (detail: Session)
 * @fires session-killed - When session is successfully killed (detail: { sessionId: string, session: Session })
 * @fires session-kill-error - When kill operation fails (detail: { sessionId: string, error: string })
 *
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import { sessionActionService } from '../services/session-action-service.js';
import { isAIAssistantSession, sendAIPrompt } from '../utils/ai-sessions.js';
import { createLogger } from '../utils/logger.js';
import { renameSession } from '../utils/session-actions.js';
import { TerminalPreferencesManager } from '../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../utils/terminal-themes.js';

const logger = createLogger('session-card');
import './vibe-terminal-buffer.js';
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
  @state() private isSendingPrompt = false;
  @state() private terminalTheme: TerminalThemeId = 'auto';
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in render method
  @state() private isHovered = false;

  private killingInterval: number | null = null;
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
    const isExited = this.session.status === 'exited';

    const result = await sessionActionService.deleteSession(this.session, {
      authClient: this.authClient,
      callbacks: {
        onError: (errorMessage) => {
          logger.error('Error killing session', {
            error: errorMessage,
            sessionId: this.session.id,
          });

          // Show error to user (keep animation to indicate something went wrong)
          this.dispatchEvent(
            new CustomEvent('session-kill-error', {
              detail: {
                sessionId: this.session.id,
                error: errorMessage,
              },
              bubbles: true,
              composed: true,
            })
          );

          clearTimeout(killingTimeout);
        },
        onSuccess: () => {
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
            `Session ${this.session.id} ${isExited ? 'cleaned up' : 'killed'} successfully`
          );
          clearTimeout(killingTimeout);
        },
      },
    });

    // Stop animation in all cases
    this.stopKillingAnimation();
    clearTimeout(killingTimeout);

    return result.success;
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
    const result = await renameSession(this.session.id, newName, this.authClient);

    if (result.success) {
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
    } else {
      // Show error to user
      this.dispatchEvent(
        new CustomEvent('session-rename-error', {
          detail: {
            sessionId: this.session.id,
            error: result.error || 'Unknown error',
          },
          bubbles: true,
          composed: true,
        })
      );
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
          class="flex justify-between items-center px-3 py-2 border-b border-border bg-gradient-to-r from-bg-secondary to-bg-tertiary"
        >
          <div class="text-xs font-mono pr-2 flex-1 min-w-0 text-primary">
            <div class="flex items-center gap-2">
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
                    id="session-magic-button"
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
                        ? 'text-status-error hover:bg-status-error/20'
                        : 'text-status-warning hover:bg-status-warning/20'
                    }"
                    @click=${this.handleKillClick}
                    ?disabled=${this.killing}
                    id="session-kill-button"
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
                ></vibe-terminal-buffer>
              `
          }
        </div>

        <!-- Compact Footer -->
        <div
          class="px-3 py-2 text-text-muted text-xs border-t border-border bg-gradient-to-r from-bg-tertiary to-bg-secondary"
        >
          <div class="flex justify-between items-center min-w-0">
            <span 
              class="${this.getActivityStatusColor()} text-xs flex items-center gap-1 flex-shrink-0"
              data-status="${this.session.status}"
              data-killing="${this.killing}"
            >
              <div class="w-2 h-2 rounded-full ${this.getStatusDotColor()}"></div>
              ${this.getActivityStatusText()}
            </span>
            ${this.renderGitStatus()}
          </div>
          <div class="text-xs opacity-75 min-w-0 mt-1">
            <clickable-path .path=${this.session.workingDir} .iconSize=${12}></clickable-path>
          </div>
        </div>
      </div>
    `;
  }

  private renderGitStatus() {
    if (!this.session.gitBranch) {
      return '';
    }

    return html`
      <div class="flex items-center gap-1 text-[10px] flex-shrink-0">
        ${
          this.session.gitBranch
            ? html`
          <span class="px-1.5 py-0.5 bg-surface-2 rounded-sm">${this.session.gitBranch}</span>
        `
            : ''
        }
        
        ${
          this.session.gitAheadCount && this.session.gitAheadCount > 0
            ? html`
          <span class="text-status-success flex items-center gap-0.5">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4l-4 4h3v4h2v-4h3L8 4z"/>
            </svg>
            ${this.session.gitAheadCount}
          </span>
        `
            : ''
        }
        
        ${
          this.session.gitBehindCount && this.session.gitBehindCount > 0
            ? html`
          <span class="text-status-warning flex items-center gap-0.5">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12l4-4h-3V4H7v4H4l4 4z"/>
            </svg>
            ${this.session.gitBehindCount}
          </span>
        `
            : ''
        }
        
        ${
          this.session.gitHasChanges
            ? html`
          <span class="text-yellow-500">●</span>
        `
            : ''
        }
        
        ${
          this.session.gitIsWorktree
            ? html`
          <span class="text-purple-400" title="Git worktree">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
            </svg>
          </span>
        `
            : ''
        }
      </div>
    `;
  }

  private getActivityStatusText(): string {
    if (this.killing) {
      return 'killing...';
    }
    if (this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getActivityStatusColor(): string {
    if (this.killing) {
      return 'text-status-error';
    }
    if (this.session.active === false) {
      return 'text-text-muted';
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
      return 'bg-status-success';
    }
    return 'bg-status-warning';
  }
}

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
      if (e.key === 'shellops_terminal_preferences') {
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

    // Determine status colors
    const isRunning = this.session.status === 'running';
    const isWarning = this.session.status === 'starting';
    const statusColor = isRunning ? '#22C55E' : isWarning ? '#FBBF24' : '#525252';

    return html`
      <div
        class="session-card cursor-pointer overflow-hidden relative group ${this.killing ? 'opacity-60' : ''} ${
          this.selected ? 'ring-2 ring-primary' : ''
        }"
        style="view-transition-name: session-${this.session.id}; --session-id: session-${
          this.session.id
        };"
        data-session-id="${this.session.id}"
        data-testid="session-card"
        data-session-status="${this.session.status}"
        data-is-killing="${this.killing}"
        @click=${this.handleCardClick}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <!-- Mobile: List-style card layout -->
        <div class="sm:hidden flex flex-col gap-3 p-4">
          <!-- Header row: Status, Name, Time -->
          <div class="flex items-center gap-2.5">
            <div
              class="w-2 h-2 rounded-full flex-shrink-0 ${isRunning ? 'animate-pulse' : ''}"
              style="background: ${statusColor}; box-shadow: 0 0 6px ${statusColor};"
            ></div>
            <div class="font-mono text-sm font-medium truncate text-white flex-1" @click=${(e: Event) => e.stopPropagation()}>
              <inline-edit
                .value=${this.session.name || this.session.command?.join(' ') || ''}
                .placeholder=${this.session.command?.join(' ') || ''}
                .onSave=${async (newName: string) => {
                  try {
                    await this.handleRename(newName);
                  } catch (error) {
                    logger.debug('Rename error caught in onSave', { error });
                  }
                }}
              ></inline-edit>
            </div>
            <!-- Close button always visible on mobile -->
            ${
              (this.session.status === 'running' || this.session.status === 'exited') &&
              !this.killing
                ? html`
                  <button
                    class="p-1.5 rounded-full ${
                      this.session.status === 'running'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }"
                    @click=${this.handleKillClick}
                    ?disabled=${this.killing}
                    data-testid="kill-session-button-mobile"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                `
                : ''
            }
          </div>

          <!-- Server badge -->
          ${
            this.session.remoteName
              ? html`
                <div
                  class="flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[11px] w-fit"
                  style="background: rgba(59, 130, 246, 0.1); color: #3B82F6;"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                  </svg>
                  ${this.session.remoteName}
                </div>
              `
              : ''
          }

          <!-- Terminal preview (60px on mobile) -->
          <div
            class="terminal-preview-mobile rounded-lg overflow-hidden ${
              this.session.status === 'exited' ? 'opacity-50' : ''
            }"
            style="background: #0A0A0A; height: 60px;"
          >
            ${
              this.killing
                ? html`
                  <div class="w-full h-full flex items-center justify-center" style="color: #EF4444;">
                    <span class="font-mono text-sm">${this.getKillingText()} Terminating...</span>
                  </div>
                `
                : html`
                  <div class="p-2.5 h-full">
                    <vibe-terminal-buffer
                      .sessionId=${this.session.id}
                      .theme=${this.terminalTheme}
                      class="w-full h-full"
                      style="pointer-events: none; font-size: 10px;"
                    ></vibe-terminal-buffer>
                  </div>
                `
            }
          </div>
        </div>

        <!-- Desktop: Original card layout with full preview -->
        <div class="hidden sm:block h-[180px]">
          <!-- Full Terminal Preview -->
          <div
            class="session-preview absolute inset-0 ${
              this.session.status === 'exited' ? 'session-exited opacity-50' : ''
            }"
          >
            ${
              this.killing
                ? html`
                  <div class="w-full h-full flex items-center justify-center" style="color: #EF4444;">
                    <div class="text-center font-mono">
                      <div class="text-3xl mb-2">${this.getKillingText()}</div>
                      <div class="text-sm opacity-70">Terminating...</div>
                    </div>
                  </div>
                `
                : html`
                  <div class="p-3 h-full">
                    <vibe-terminal-buffer
                      .sessionId=${this.session.id}
                      .theme=${this.terminalTheme}
                      class="w-full h-full"
                      style="pointer-events: none; font-size: 11px;"
                    ></vibe-terminal-buffer>
                  </div>
                `
            }
          </div>

          <!-- Close Button Overlay (top-right) -->
          ${
            (this.session.status === 'running' || this.session.status === 'exited') && !this.killing
              ? html`
                <button
                  class="absolute top-3 right-3 p-1.5 rounded-full transition-all duration-200 opacity-0 group-hover:opacity-100 z-10 ${
                    this.session.status === 'running'
                      ? 'bg-red-500/20 hover:bg-red-500/40 text-red-400'
                      : 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-400'
                  }"
                  style="backdrop-filter: blur(8px);"
                  @click=${this.handleKillClick}
                  ?disabled=${this.killing}
                  id="session-kill-button"
                  title="${this.session.status === 'running' ? 'Kill session' : 'Clean up session'}"
                  data-testid="kill-session-button"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              `
              : ''
          }

          <!-- Magic Button Overlay (top-right, next to close) -->
          ${
            this.session.status === 'running' && isAIAssistantSession(this.session)
              ? html`
                <button
                  class="absolute top-3 right-12 p-1.5 rounded-full transition-all duration-200 opacity-0 group-hover:opacity-100 z-10 bg-primary/20 hover:bg-primary/40 text-primary"
                  style="backdrop-filter: blur(8px);"
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
                      ? html`<span class="block w-4 h-4 flex items-center justify-center animate-spin text-xs">⠋</span>`
                      : html`<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>`
                  }
                </button>
              `
              : ''
          }

          <!-- Name & Info Overlay (bottom) -->
          <div
            class="absolute bottom-0 left-0 right-0 p-4 z-10"
            style="background: linear-gradient(to top, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.8) 50%, transparent 100%);"
          >
            <div class="flex items-center gap-2.5">
              <!-- Status indicator -->
              <div
                class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRunning ? 'animate-pulse' : ''}"
                style="background: ${statusColor}; box-shadow: 0 0 8px ${statusColor};"
              ></div>
              <!-- Name -->
              <div class="font-mono text-sm font-medium truncate text-white flex-1" @click=${(e: Event) => e.stopPropagation()}>
                <inline-edit
                  .value=${this.session.name || this.session.command?.join(' ') || ''}
                  .placeholder=${this.session.command?.join(' ') || ''}
                  .onSave=${async (newName: string) => {
                    try {
                      await this.handleRename(newName);
                    } catch (error) {
                      logger.debug('Rename error caught in onSave', { error });
                    }
                  }}
                ></inline-edit>
              </div>
              <!-- Server badge -->
              ${
                this.session.remoteName
                  ? html`
                    <div
                      class="flex items-center gap-1.5 px-2 py-1 rounded-full font-mono text-[10px] flex-shrink-0"
                      style="background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7);"
                    >
                      <div class="w-1.5 h-1.5 rounded-full" style="background: #22C55E;"></div>
                      ${this.session.remoteName}
                    </div>
                  `
                  : html`
                    <div
                      class="px-2 py-1 rounded-full font-mono text-[10px] flex-shrink-0"
                      style="background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.5);"
                    >
                      local
                    </div>
                  `
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

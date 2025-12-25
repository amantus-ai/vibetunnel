/**
 * Form Options Section Component
 *
 * Collapsible section containing advanced options for session creation:
 * - Spawn window toggle (when Mac app is connected)
 * - Terminal title mode selector
 * - Follow mode toggle (for Git repositories)
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { TitleMode } from '../../../shared/types.js';
import type { GitRepoInfo } from '../../services/git-service.js';
import { getTitleModeDescription } from '../../utils/title-mode-utils.js';

@customElement('form-options-section')
export class FormOptionsSection extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) macAppConnected = false;
  @property({ type: Boolean }) spawnWindow = false;
  @property({ type: String }) titleMode = TitleMode.STATIC;
  @property({ type: Object }) gitRepoInfo: GitRepoInfo | null = null;
  @property({ type: Boolean }) followMode = false;
  @property({ type: String }) followBranch: string | null = null;
  @property({ type: Boolean }) showFollowMode = false;
  @property({ type: String }) selectedWorktree?: string;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) isCreating = false;

  @state() private expanded = false;

  private handleToggle() {
    this.expanded = !this.expanded;
  }

  private handleSpawnWindowToggle() {
    this.dispatchEvent(
      new CustomEvent('spawn-window-changed', {
        detail: { enabled: !this.spawnWindow },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleTitleModeChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.dispatchEvent(
      new CustomEvent('title-mode-changed', {
        detail: { mode: select.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleFollowModeToggle() {
    this.dispatchEvent(
      new CustomEvent('follow-mode-changed', {
        detail: { enabled: !this.showFollowMode },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="mb-2 sm:mb-4 lg:mb-6">
        <button
          id="session-options-button"
          @click=${this.handleToggle}
          class="flex items-center gap-1.5 sm:gap-2 text-text-muted hover:text-primary transition-colors duration-200"
          type="button"
          aria-expanded="${this.expanded}"
        >
          <svg 
            width="8" 
            height="8" 
            class="sm:w-2 sm:h-2 lg:w-2.5 lg:h-2.5 transition-transform duration-200 flex-shrink-0" 
            viewBox="0 0 16 16" 
            fill="currentColor"
            style="transform: ${this.expanded ? 'rotate(90deg)' : 'rotate(0deg)'}"
          >
            <path
              d="M5.22 1.22a.75.75 0 011.06 0l6.25 6.25a.75.75 0 010 1.06l-6.25 6.25a.75.75 0 01-1.06-1.06L10.94 8 5.22 2.28a.75.75 0 010-1.06z"
            />
          </svg>
          <span class="form-label mb-0 text-text-muted uppercase text-[9px] sm:text-[10px] lg:text-xs tracking-wider">Options</span>
        </button>

        ${
          this.expanded
            ? html`
            <div class="mt-2 sm:mt-3">
              <!-- Spawn Window Toggle - Only show when Mac app is connected -->
              ${
                this.macAppConnected
                  ? html`
                  <div class="flex items-center justify-between bg-bg-elevated border border-border/50 rounded-lg p-2 sm:p-3 lg:p-4 mb-2 sm:mb-3">
                    <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                      <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Spawn window</span>
                      <p class="text-[9px] sm:text-[10px] lg:text-xs text-text-muted mt-0.5 hidden sm:block">Opens native terminal window</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked="${this.spawnWindow}"
                      @click=${this.handleSpawnWindowToggle}
                      class="relative inline-flex h-4 w-8 sm:h-5 sm:w-10 lg:h-6 lg:w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-bg-secondary ${
                        this.spawnWindow ? 'bg-primary' : 'bg-border/50'
                      }"
                      ?disabled=${this.disabled || this.isCreating}
                      data-testid="spawn-window-toggle"
                    >
                      <span
                        class="inline-block h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 transform rounded-full bg-bg-elevated transition-transform ${
                          this.spawnWindow ? 'translate-x-4 sm:translate-x-5' : 'translate-x-0.5'
                        }"
                      ></span>
                    </button>
                  </div>
                `
                  : ''
              }

              <!-- Terminal Title Mode -->
              <div class="flex items-center justify-between bg-bg-elevated border border-border/50 rounded-lg p-2 sm:p-3 lg:p-4 mb-2 sm:mb-3">
                <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                  <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Terminal Title Mode</span>
                  <p class="text-[9px] sm:text-[10px] lg:text-xs text-text-muted mt-0.5 hidden sm:block">
                    ${getTitleModeDescription(this.titleMode)}
                  </p>
                </div>
                <div class="relative">
                  <select
                    .value=${this.titleMode}
                    @change=${this.handleTitleModeChange}
                    class="bg-bg-tertiary border border-border/50 rounded-lg px-1.5 py-1 pr-6 sm:px-2 sm:py-1.5 sm:pr-7 lg:px-3 lg:py-2 lg:pr-8 text-text text-[10px] sm:text-xs lg:text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none appearance-none cursor-pointer"
                    style="min-width: 80px"
                    ?disabled=${this.disabled || this.isCreating}
                  >
                    <option value="${TitleMode.NONE}" class="bg-bg-tertiary text-text" ?selected=${this.titleMode === TitleMode.NONE}>None</option>
                    <option value="${TitleMode.FILTER}" class="bg-bg-tertiary text-text" ?selected=${this.titleMode === TitleMode.FILTER}>Filter</option>
                    <option value="${TitleMode.STATIC}" class="bg-bg-tertiary text-text" ?selected=${this.titleMode === TitleMode.STATIC}>Static</option>
                    <option value="${TitleMode.DYNAMIC}" class="bg-bg-tertiary text-text" ?selected=${this.titleMode === TitleMode.DYNAMIC}>Dynamic (legacy)</option>
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 sm:px-1.5 lg:px-2 text-text-muted">
                    <svg class="h-2.5 w-2.5 sm:h-3 sm:w-3 lg:h-4 lg:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Follow Mode Toggle - Show only when a worktree is selected -->
              ${
                this.gitRepoInfo?.isGitRepo &&
                this.selectedWorktree &&
                this.selectedWorktree !== 'none'
                  ? html`
                  <div class="flex items-center justify-between bg-bg-elevated border border-border/50 rounded-lg p-2 sm:p-3 lg:p-4">
                    <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                      <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Follow Mode</span>
                      <p class="text-[9px] sm:text-[10px] lg:text-xs text-text-muted mt-0.5 hidden sm:block">
                        ${
                          this.followMode
                            ? `Currently following: ${this.followBranch || 'unknown'}`
                            : 'Keep main repository in sync with this worktree'
                        }
                      </p>
                    </div>
                    <button
                      role="switch"
                      aria-checked="${this.showFollowMode}"
                      @click=${this.handleFollowModeToggle}
                      class="relative inline-flex h-4 w-8 sm:h-5 sm:w-10 lg:h-6 lg:w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-bg-secondary ${
                        this.showFollowMode ? 'bg-primary' : 'bg-border/50'
                      }"
                      ?disabled=${this.disabled || this.isCreating || this.followMode}
                      data-testid="follow-mode-toggle"
                    >
                      <span
                        class="inline-block h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 transform rounded-full bg-bg-elevated transition-transform ${
                          this.showFollowMode ? 'translate-x-4 sm:translate-x-5' : 'translate-x-0.5'
                        }"
                      ></span>
                    </button>
                  </div>
                `
                  : ''
              }
            </div>
          `
            : ''
        }
      </div>
    `;
  }
}

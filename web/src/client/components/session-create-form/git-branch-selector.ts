/**
 * Git Branch and Worktree Selector Component
 *
 * Handles branch selection, worktree management, and follow mode
 * for Git repositories in the session creation form.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitRepoInfo } from '../../services/git-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('git-branch-selector');

export interface WorktreeInfo {
  branch: string;
  path: string;
  isMainWorktree?: boolean;
  isCurrentWorktree?: boolean;
}

@customElement('git-branch-selector')
export class GitBranchSelector extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) gitRepoInfo: GitRepoInfo | null = null;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) isCreating = false;
  @property({ type: String }) currentBranch = '';
  @property({ type: String }) selectedBaseBranch = '';
  @property({ type: String }) selectedWorktree?: string;
  @property({ type: Array }) availableBranches: string[] = [];
  @property({ type: Array }) availableWorktrees: WorktreeInfo[] = [];
  @property({ type: Boolean }) isLoadingBranches = false;
  @property({ type: Boolean }) isLoadingWorktrees = false;
  @property({ type: Boolean }) followMode = false;
  @property({ type: String }) followBranch: string | null = null;
  @property({ type: Boolean }) showFollowMode = false;
  @property({ type: String }) branchSwitchWarning?: string;

  @state() private showCreateWorktree = false;
  @state() private newBranchName = '';
  @state() private isCreatingWorktree = false;
  @state() private customPath = '';
  @state() private useCustomPath = false;

  private handleBaseBranchChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.selectedBaseBranch = select.value;
    this.dispatchEvent(
      new CustomEvent('branch-changed', {
        detail: { branch: select.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleWorktreeChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.selectedWorktree = select.value === 'none' ? undefined : select.value;
    this.dispatchEvent(
      new CustomEvent('worktree-changed', {
        detail: { worktree: this.selectedWorktree },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleCreateWorktree() {
    const branchName = this.newBranchName.trim();

    if (!branchName) {
      return;
    }

    // Validate branch name
    const validationError = this.validateBranchName(branchName);
    if (validationError) {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: validationError,
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    this.isCreatingWorktree = true;
    this.dispatchEvent(
      new CustomEvent('create-worktree', {
        detail: {
          branchName: branchName,
          baseBranch: this.selectedBaseBranch || 'main',
          customPath: this.useCustomPath ? this.customPath.trim() : null,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private validateBranchName(name: string): string | null {
    // Check if branch already exists
    if (this.availableBranches.includes(name)) {
      return `Branch '${name}' already exists`;
    }

    // Git branch name validation rules
    if (name.startsWith('-') || name.endsWith('-')) {
      return 'Branch name cannot start or end with a hyphen';
    }

    if (name.includes('..') || name.includes('~') || name.includes('^') || name.includes(':')) {
      return 'Branch name contains invalid characters (.. ~ ^ :)';
    }

    if (name.endsWith('.lock')) {
      return 'Branch name cannot end with .lock';
    }

    if (name.includes('//') || name.includes('\\')) {
      return 'Branch name cannot contain consecutive slashes';
    }

    // Reserved names
    const reserved = ['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD'];
    if (reserved.includes(name.toUpperCase())) {
      return `'${name}' is a reserved Git name`;
    }

    return null;
  }

  private handleNewBranchInput(e: InputEvent) {
    this.newBranchName = (e.target as HTMLInputElement).value;
  }

  private handleCancelCreateWorktree() {
    this.showCreateWorktree = false;
    this.newBranchName = '';
    this.customPath = '';
    this.useCustomPath = false;
  }

  render() {
    if (!this.gitRepoInfo?.isGitRepo) {
      return nothing;
    }

    logger.log('Rendering Git branch selector', {
      isGitRepo: this.gitRepoInfo?.isGitRepo,
      currentBranch: this.currentBranch,
      selectedBaseBranch: this.selectedBaseBranch,
    });

    return html`
      <div class="mb-2 sm:mb-3 mt-2 sm:mt-3">
        <div class="space-y-2">
          <!-- Base Branch Selection -->
          <div>
            <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm flex items-center gap-2">
              ${
                this.availableWorktrees.some((wt) => wt.isCurrentWorktree && !wt.isMainWorktree)
                  ? 'Base Branch for Current Worktree:'
                  : this.selectedWorktree
                    ? 'Base Branch for Worktree:'
                    : 'Switch to Branch:'
              }
              ${
                this.gitRepoInfo?.hasChanges && !this.selectedWorktree
                  ? html`
                  <span class="text-yellow-500 text-[9px] sm:text-[10px] flex items-center gap-1">
                    <span>●</span>
                    <span>Uncommitted changes</span>
                  </span>
                `
                  : ''
              }
            </label>
            <div class="relative">
              <select
                .value=${this.selectedBaseBranch || this.currentBranch}
                @change=${this.handleBaseBranchChange}
                class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm appearance-none pr-8 ${
                  this.gitRepoInfo?.hasChanges && !this.selectedWorktree
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }"
                ?disabled=${this.disabled || this.isCreating || this.isLoadingBranches || (this.gitRepoInfo?.hasChanges && !this.selectedWorktree)}
                data-testid="git-base-branch-select"
              >
                ${this.availableBranches.map(
                  (branch) => html`
                    <option value="${branch}" ?selected=${branch === (this.selectedBaseBranch || this.currentBranch)}>
                      ${branch}${branch === this.currentBranch ? ' (current)' : ''}
                    </option>
                  `
                )}
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-text-muted">
                <svg class="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            ${
              !this.isLoadingBranches
                ? html`
                <p class="text-[9px] sm:text-[10px] text-text-muted mt-1">
                  ${
                    this.gitRepoInfo?.hasChanges && !this.selectedWorktree
                      ? html`<span class="text-yellow-500">Branch switching is disabled due to uncommitted changes. Commit or stash changes first.</span>`
                      : this.selectedWorktree
                        ? `Session will use worktree: ${this.selectedWorktree}`
                        : this.selectedBaseBranch && this.selectedBaseBranch !== this.currentBranch
                          ? `Session will start on ${this.selectedBaseBranch}`
                          : ''
                  }
                  ${
                    this.followMode &&
                    this.followBranch &&
                    (
                      (this.gitRepoInfo?.hasChanges && !this.selectedWorktree) ||
                        this.selectedWorktree ||
                        (this.selectedBaseBranch && this.selectedBaseBranch !== this.currentBranch)
                    )
                      ? html`${
                          (this.gitRepoInfo?.hasChanges && !this.selectedWorktree) ||
                          this.selectedWorktree ||
                          (
                            this.selectedBaseBranch &&
                              this.selectedBaseBranch !== this.currentBranch
                          )
                            ? html`<br>`
                            : ''
                        }<span class="text-primary">Follow mode active: following ${this.followBranch}</span>`
                      : this.followMode && this.followBranch
                        ? html`<span class="text-primary">Follow mode active: following ${this.followBranch}</span>`
                        : ''
                  }
                </p>
              `
                : nothing
            }
          </div>
          
          <!-- Worktree Selection -->
          <div>
            <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm">
              Worktree:
            </label>
            ${
              !this.showCreateWorktree
                ? html`
                <div class="relative">
                  <select
                    .value=${this.selectedWorktree || 'none'}
                    @change=${this.handleWorktreeChange}
                    class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm appearance-none pr-8"
                    ?disabled=${this.disabled || this.isCreating || this.isLoadingWorktrees}
                    data-testid="git-worktree-select"
                  >
                    <option value="none">
                      ${
                        this.availableWorktrees.some(
                          (wt) => wt.isCurrentWorktree && !wt.isMainWorktree
                        )
                          ? 'Use main repository'
                          : 'Use selected worktree'
                      }
                    </option>
                    ${this.availableWorktrees.map((worktree) => {
                      const folderName = worktree.path.split('/').pop() || worktree.path;
                      const showBranch =
                        folderName.toLowerCase() !== worktree.branch.toLowerCase() &&
                        !folderName.toLowerCase().endsWith(`-${worktree.branch.toLowerCase()}`);

                      return html`
                        <option value="${worktree.branch}" ?selected=${worktree.branch === this.selectedWorktree}>
                          ${folderName}${showBranch ? ` [${worktree.branch}]` : ''}${worktree.isMainWorktree ? ' (main)' : ''}${worktree.isCurrentWorktree ? ' (current)' : ''}${this.followMode && this.followBranch === worktree.branch ? ' ⚡️ following' : ''}
                        </option>
                      `;
                    })}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-text-muted">
                    <svg class="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <div class="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    @click=${() => {
                      this.showCreateWorktree = true;
                      this.newBranchName = '';
                    }}
                    class="text-[10px] sm:text-xs text-primary hover:text-primary-dark transition-colors flex items-center gap-1"
                    ?disabled=${this.disabled || this.isCreating}
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    Create new worktree
                  </button>
                </div>
              `
                : html`
                <!-- Create Worktree Mode -->
                <div class="space-y-2">
                  <input
                    type="text"
                    .value=${this.newBranchName}
                    @input=${this.handleNewBranchInput}
                    placeholder="New branch name"
                    class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm"
                    ?disabled=${this.disabled || this.isCreating || this.isCreatingWorktree}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Escape') {
                        this.handleCancelCreateWorktree();
                      }
                    }}
                  />
                  
                  <!-- Path customization toggle -->
                  <label class="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      .checked=${this.useCustomPath}
                      @change=${(e: Event) => {
                        this.useCustomPath = (e.target as HTMLInputElement).checked;
                        if (!this.useCustomPath) {
                          this.customPath = '';
                        }
                      }}
                      ?disabled=${this.disabled || this.isCreating || this.isCreatingWorktree}
                      class="rounded"
                    />
                    <span>Customize worktree path</span>
                  </label>
                  
                  <!-- Custom path input -->
                  ${
                    this.useCustomPath
                      ? html`
                      <div class="space-y-1">
                        <input
                          type="text"
                          .value=${this.customPath}
                          @input=${(e: InputEvent) => {
                            this.customPath = (e.target as HTMLInputElement).value;
                          }}
                          placeholder="/path/to/worktree"
                          class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm"
                          ?disabled=${this.disabled || this.isCreating || this.isCreatingWorktree}
                        />
                        <div class="text-[10px] text-text-dim">
                          ${
                            this.customPath.trim()
                              ? `Will create at: ${this.customPath.trim()}`
                              : 'Enter absolute path for the worktree'
                          }
                        </div>
                      </div>
                    `
                      : html`
                      <div class="text-[10px] text-text-dim">
                        Will use default path: ${this.gitRepoInfo?.repoPath || ''}-${this.newBranchName.trim().replace(/[^a-zA-Z0-9-_]/g, '-') || 'branch'}
                      </div>
                    `
                  }
                  
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      @click=${this.handleCancelCreateWorktree}
                      class="text-[10px] sm:text-xs text-text-muted hover:text-text transition-colors"
                      ?disabled=${this.disabled || this.isCreating || this.isCreatingWorktree}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      @click=${this.handleCreateWorktree}
                      class="text-[10px] sm:text-xs px-2 py-1 bg-primary text-bg-elevated rounded hover:bg-primary-dark transition-colors disabled:opacity-50"
                      ?disabled=${!this.newBranchName.trim() || (this.useCustomPath && !this.customPath.trim()) || this.disabled || this.isCreating || this.isCreatingWorktree}
                    >
                      ${this.isCreatingWorktree ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              `
            }
          </div>
        </div>
      </div>
    `;
  }
}

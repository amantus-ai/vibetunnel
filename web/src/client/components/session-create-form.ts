/**
 * Session Create Form Component
 *
 * Modal dialog for creating new terminal sessions. Provides command input,
 * working directory selection, and options for spawning in native terminal.
 *
 * @fires session-created - When session is successfully created (detail: { sessionId: string, message?: string })
 * @fires cancel - When form is cancelled
 * @fires error - When creation fails (detail: string)
 *
 * @listens file-selected - From file browser when directory is selected
 * @listens browser-cancel - From file browser when cancelled
 */
import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './file-browser.js';
import './session-create-form/git-branch-selector.js';
import './session-create-form/quick-start-section.js';
import './session-create-form/form-options-section.js';
import './session-create-form/directory-autocomplete.js';
import './session-create-form/repository-dropdown.js';
import { DEFAULT_REPOSITORY_BASE_PATH } from '../../shared/constants.js';
import type { Session } from '../../shared/types.js';
import { TitleMode } from '../../shared/types.js';
import type { QuickStartCommand } from '../../types/config.js';
import type { AuthClient } from '../services/auth-client.js';
import { type GitRepoInfo, GitService } from '../services/git-service.js';
import { RepositoryService } from '../services/repository-service.js';
import { ServerConfigService } from '../services/server-config-service.js';
import { type SessionCreateData, SessionService } from '../services/session-service.js';
import { parseCommand } from '../utils/command-utils.js';
import { createLogger } from '../utils/logger.js';
import { formatPathForDisplay } from '../utils/path-utils.js';
import {
  getSessionFormValue,
  loadSessionFormData,
  removeSessionFormValue,
  saveSessionFormData,
  setSessionFormValue,
} from '../utils/storage-utils.js';
import {
  type AutocompleteItem,
  AutocompleteManager,
  type Repository,
} from './autocomplete-manager.js';
import type { WorktreeInfo } from './session-create-form/git-branch-selector.js';
import {
  checkFollowMode,
  enableFollowMode,
  generateWorktreePath,
  loadBranches,
} from './session-create-form/git-utils.js';
import type { QuickStartItem } from './session-create-form/quick-start-section.js';

const logger = createLogger('session-create-form');

@customElement('session-create-form')
export class SessionCreateForm extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) workingDir = DEFAULT_REPOSITORY_BASE_PATH;
  @property({ type: String }) command = 'zsh';
  @property({ type: String }) sessionName = '';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: Boolean }) spawnWindow = false;
  @property({ type: String }) titleMode = TitleMode.STATIC;

  @state() private isCreating = false;
  @state() private showFileBrowser = false;
  @state() private showRepositoryDropdown = false;
  @state() private repositories: Repository[] = [];
  @state() private macAppConnected = false;
  @state() private showCompletions = false;
  @state() private completions: AutocompleteItem[] = [];
  @state() private selectedCompletionIndex = -1;
  @state() private isLoadingCompletions = false;
  @state() private gitRepoInfo: GitRepoInfo | null = null;
  @state() private availableBranches: string[] = [];

  // New properties for split branch/worktree selectors
  @state() private currentBranch: string = '';
  @state() private selectedBaseBranch: string = '';
  @state() private selectedWorktree?: string;
  @state() private branchSwitchWarning?: string;
  @state() private availableWorktrees: WorktreeInfo[] = [];
  @state() private isLoadingBranches = false;
  @state() private isLoadingWorktrees = false;

  // Follow mode state
  @state() private followMode = false;
  @state() private followBranch: string | null = null;
  @state() private showFollowMode = false;

  @state() private quickStartCommands: QuickStartItem[] = [
    { label: '✨ codex', command: 'codex' },
    { label: '✨ claude', command: 'claude' },
    { label: 'gemini3', command: 'gemini3' },
    { label: 'opencode 4', command: 'opencode 4' },
    { label: 'zsh', command: 'zsh' },
    { label: 'node', command: 'node' },
  ];

  // State properties for UI
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in template
  @state() private selectedQuickStart = '';
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in discoverDirectories method
  @state() private isDiscovering = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in checkGitEnabled method
  @state() private isCheckingGit = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in checkFollowMode method
  @state() private isCheckingFollowMode = false;

  private completionsDebounceTimer?: NodeJS.Timeout;
  private gitCheckDebounceTimer?: NodeJS.Timeout;
  private autocompleteManager!: AutocompleteManager;
  private repositoryService?: RepositoryService;
  private sessionService?: SessionService;
  private serverConfigService?: ServerConfigService;
  private gitService?: GitService;

  async connectedCallback() {
    super.connectedCallback();
    // Initialize services - AutocompleteManager handles optional authClient
    this.autocompleteManager = new AutocompleteManager(this.authClient);
    this.serverConfigService = new ServerConfigService(this.authClient);

    // Initialize other services only if authClient is available
    if (this.authClient) {
      this.repositoryService = new RepositoryService(this.authClient, this.serverConfigService);
      this.sessionService = new SessionService(this.authClient);
      this.gitService = new GitService(this.authClient);
    }
    // Load from localStorage when component is first created
    await this.loadFromLocalStorage();
    // Check server status
    this.checkServerStatus();
    // Load server configuration including quick start commands
    this.loadServerConfig();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up document event listener if modal is still visible
    if (this.visible) {
      document.removeEventListener('keydown', this.handleGlobalKeyDown);
    }
    // Clean up debounce timers
    if (this.completionsDebounceTimer) {
      clearTimeout(this.completionsDebounceTimer);
    }
    if (this.gitCheckDebounceTimer) {
      clearTimeout(this.gitCheckDebounceTimer);
    }
  }

  private handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Only handle events when modal is visible
    if (!this.visible) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();

      // If autocomplete is visible, close it first
      if (this.showCompletions) {
        this.showCompletions = false;
        this.selectedCompletionIndex = -1;
      } else {
        // Otherwise close the dialog
        this.handleCancel();
      }
    } else if (e.key === 'Enter') {
      // Don't interfere with Enter in textarea elements
      if (e.target instanceof HTMLTextAreaElement) return;

      // Don't submit if autocomplete is active and an item is selected
      if (this.showCompletions && this.selectedCompletionIndex >= 0) return;

      // Check if form is valid (same conditions as Create button)
      const canCreate =
        !this.disabled && !this.isCreating && this.workingDir?.trim() && this.command?.trim();

      if (canCreate) {
        e.preventDefault();
        e.stopPropagation();
        this.handleCreate();
      }
    }
  };

  private async loadFromLocalStorage() {
    const formData = loadSessionFormData();

    // Get repository base path from server config to use as default working dir
    let appRepoBasePath = DEFAULT_REPOSITORY_BASE_PATH;
    if (this.serverConfigService) {
      try {
        appRepoBasePath = await this.serverConfigService.getRepositoryBasePath();
      } catch (error) {
        logger.error('Failed to get repository base path from server:', error);
        appRepoBasePath = DEFAULT_REPOSITORY_BASE_PATH;
      }
    }

    // Always set values, using saved values or defaults
    // Priority: savedWorkingDir > appRepoBasePath > default
    this.workingDir = formData.workingDir || appRepoBasePath || DEFAULT_REPOSITORY_BASE_PATH;
    this.command = formData.command || 'zsh';

    // For spawn window, use saved value or default to false
    this.spawnWindow = formData.spawnWindow ?? false;

    // For title mode, use saved value or default to STATIC
    this.titleMode =
      formData.titleMode === TitleMode.DYNAMIC
        ? TitleMode.STATIC
        : formData.titleMode || TitleMode.STATIC;

    // Force re-render to update the input values
    this.requestUpdate();
  }

  private saveToLocalStorage() {
    const workingDir = this.workingDir?.trim() || '';
    const command = this.command?.trim() || '';

    saveSessionFormData({
      workingDir,
      command,
      spawnWindow: this.spawnWindow,
      titleMode: this.titleMode,
    });
  }

  private async loadServerConfig() {
    if (!this.serverConfigService) {
      return;
    }

    try {
      const quickStartCommands = await this.serverConfigService.getQuickStartCommands();
      if (quickStartCommands && quickStartCommands.length > 0) {
        // Map server config to our format
        this.quickStartCommands = quickStartCommands.map((cmd: QuickStartCommand) => ({
          label: cmd.name || cmd.command,
          command: cmd.command,
        }));
        logger.debug('Loaded quick start commands from server:', this.quickStartCommands);
      }
    } catch (error) {
      logger.error('Failed to load server config:', error);
      // Keep default quick start commands on error
    }
  }

  private async handleQuickStartChanged(e: CustomEvent<QuickStartCommand[]>) {
    const commands = e.detail;

    if (!this.serverConfigService) {
      logger.error('Server config service not initialized');
      return;
    }

    try {
      await this.serverConfigService.updateQuickStartCommands(commands);

      // Update local state
      this.quickStartCommands = commands.map((cmd: QuickStartCommand) => ({
        label: cmd.name || cmd.command,
        command: cmd.command,
      }));
      logger.debug('Updated quick start commands:', this.quickStartCommands);
    } catch (error) {
      logger.error('Failed to save quick start commands:', error);
    }
  }

  private async checkServerStatus() {
    // Defensive check - authClient should always be provided
    if (!this.authClient) {
      logger.warn('checkServerStatus called without authClient');
      this.macAppConnected = false;
      return;
    }

    try {
      const response = await fetch('/api/server/status', {
        headers: this.authClient.getAuthHeader(),
      });
      if (response.ok) {
        const status = await response.json();
        this.macAppConnected = status.macAppConnected || false;
        logger.debug('server status:', status);
      }
    } catch (error) {
      logger.warn('failed to check server status:', error);
      // Default to not connected if we can't check
      this.macAppConnected = false;
    }
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    // Handle authClient becoming available
    if (changedProperties.has('authClient') && this.authClient) {
      // Initialize services if they haven't been created yet
      if (!this.repositoryService && this.serverConfigService) {
        this.repositoryService = new RepositoryService(this.authClient, this.serverConfigService);
      }
      if (!this.sessionService) {
        this.sessionService = new SessionService(this.authClient);
      }
      if (!this.gitService) {
        this.gitService = new GitService(this.authClient);
      }
      // Update autocomplete manager's authClient
      this.autocompleteManager.setAuthClient(this.authClient);
      // Update server config service's authClient
      if (this.serverConfigService) {
        this.serverConfigService.setAuthClient(this.authClient);
      }
    }

    // Handle visibility changes
    if (changedProperties.has('visible')) {
      if (this.visible) {
        // Reset to defaults first to ensure clean state
        this.workingDir = DEFAULT_REPOSITORY_BASE_PATH;
        this.command = 'zsh';
        this.sessionName = '';
        this.spawnWindow = false;
        this.titleMode = TitleMode.STATIC;
        this.branchSwitchWarning = undefined;

        // Then load from localStorage which may override the defaults
        // Don't await since we're in updated() lifecycle method
        this.loadFromLocalStorage()
          .then(() => {
            // Check if the loaded working directory is a Git repository
            // This must happen AFTER localStorage is loaded
            this.checkGitRepository();
          })
          .catch((error) => {
            logger.error('Failed to load from localStorage:', error);
          });

        // Re-check server status when form becomes visible
        this.checkServerStatus();

        // Add global keyboard listener
        document.addEventListener('keydown', this.handleGlobalKeyDown);

        // Set data attributes for testing - both synchronously to avoid race conditions
        this.setAttribute('data-modal-state', 'open');
        this.setAttribute('data-modal-rendered', 'true');

        // Discover repositories
        this.discoverRepositories();
      } else {
        // Remove global keyboard listener when hidden
        document.removeEventListener('keydown', this.handleGlobalKeyDown);

        // Remove data attributes synchronously
        this.removeAttribute('data-modal-state');
        this.removeAttribute('data-modal-rendered');
      }
    }
  }

  private handleWorkingDirChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.workingDir = input.value;
    this.dispatchEvent(
      new CustomEvent('working-dir-change', {
        detail: this.workingDir,
      })
    );

    // Hide repository dropdown when typing
    this.showRepositoryDropdown = false;

    // Trigger autocomplete with debounce
    if (this.completionsDebounceTimer) {
      clearTimeout(this.completionsDebounceTimer);
    }

    this.completionsDebounceTimer = setTimeout(() => {
      this.fetchCompletions();
    }, 300);

    // Check if directory is a Git repository with debounce
    if (this.gitCheckDebounceTimer) {
      clearTimeout(this.gitCheckDebounceTimer);
    }

    this.gitCheckDebounceTimer = setTimeout(() => {
      this.checkGitRepository();
    }, 500);
  }

  private handleCommandChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.command = input.value;
  }

  private handleSessionNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.sessionName = input.value;
  }

  private handleSpawnWindowChanged(e: CustomEvent) {
    this.spawnWindow = e.detail.enabled;
  }

  private handleTitleModeChanged(e: CustomEvent) {
    this.titleMode = e.detail.mode as TitleMode;
  }

  private handleFollowModeChanged(e: CustomEvent) {
    this.showFollowMode = e.detail.enabled;
  }

  private handleBrowse() {
    logger.debug('handleBrowse called, setting showFileBrowser to true');
    this.showFileBrowser = true;
    this.requestUpdate();
  }

  private handleDirectorySelected(e: CustomEvent) {
    this.workingDir = formatPathForDisplay(e.detail);
    this.showFileBrowser = false;
    // Check Git repository after directory selection
    this.checkGitRepository();
  }

  private handleBrowserCancel() {
    this.showFileBrowser = false;
  }

  private async handleCreate() {
    if (!this.workingDir?.trim() || !this.command?.trim()) {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: 'Please fill in both working directory and command',
        })
      );
      return;
    }

    this.isCreating = true;

    // Determine if we're actually spawning a terminal window
    const effectiveSpawnTerminal = this.spawnWindow && this.macAppConnected;

    // Determine the working directory and branch
    let effectiveWorkingDir = this.workingDir?.trim() || '';
    let effectiveBranch = '';

    if (this.selectedWorktree && this.availableWorktrees.length > 0) {
      // Using a worktree - use its path and branch
      const selectedWorktreeInfo = this.availableWorktrees.find(
        (wt) => wt.branch === this.selectedWorktree
      );
      if (selectedWorktreeInfo?.path) {
        effectiveWorkingDir = formatPathForDisplay(selectedWorktreeInfo.path);
        effectiveBranch = this.selectedWorktree;
        logger.log(
          `Using worktree path: ${effectiveWorkingDir} for branch: ${this.selectedWorktree}`
        );
      }
    } else if (
      this.gitRepoInfo?.isGitRepo &&
      this.selectedBaseBranch &&
      this.selectedBaseBranch !== this.currentBranch
    ) {
      // Not using worktree but selected a different branch - attempt to switch
      logger.log(`Attempting to switch from ${this.currentBranch} to ${this.selectedBaseBranch}`);

      // Direct branch switching without worktrees is no longer supported
      logger.log(
        `Selected branch ${this.selectedBaseBranch} differs from current branch ${this.currentBranch}, but direct branch switching is not supported. Using current branch.`
      );
      effectiveBranch = this.currentBranch;

      this.branchSwitchWarning = `Cannot switch to ${this.selectedBaseBranch} without a worktree. Create a worktree or use the current branch ${this.currentBranch}.`;
    } else {
      // Using current branch
      effectiveBranch = this.selectedBaseBranch || this.currentBranch;
    }

    const sessionData: SessionCreateData = {
      command: parseCommand(this.command?.trim() || ''),
      workingDir: effectiveWorkingDir,
      spawn_terminal: effectiveSpawnTerminal,
      titleMode: this.titleMode,
    };

    // Add Git information if available
    if (this.gitRepoInfo?.isGitRepo && this.gitRepoInfo.repoPath && effectiveBranch) {
      sessionData.gitRepoPath = this.gitRepoInfo.repoPath;
      sessionData.gitBranch = effectiveBranch;
    }

    // Only add dimensions for web sessions (not external terminal spawns)
    if (!effectiveSpawnTerminal) {
      // Use conservative defaults that work well across devices
      // The terminal will auto-resize to fit the actual container after creation
      sessionData.cols = 120;
      sessionData.rows = 30;
    }

    // Add session name if provided
    if (this.sessionName?.trim()) {
      sessionData.name = this.sessionName.trim();
    }

    // Handle follow mode - only enable when a worktree is selected
    if (
      this.showFollowMode &&
      this.selectedWorktree &&
      this.selectedWorktree !== 'none' &&
      this.gitRepoInfo?.repoPath &&
      effectiveBranch &&
      this.authClient
    ) {
      try {
        // Check if follow mode is already active for a different branch
        if (this.followMode && this.followBranch && this.followBranch !== effectiveBranch) {
          logger.log(
            `Follow mode is already active for branch: ${this.followBranch}, switching to: ${effectiveBranch}`
          );
        }

        logger.log(`Enabling follow mode for worktree branch: ${effectiveBranch}`);
        const success = await enableFollowMode(
          this.gitRepoInfo.repoPath,
          effectiveBranch,
          this.authClient
        );

        if (!success) {
          // Show error to user
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: 'Failed to enable follow mode. Session will be created without follow mode.',
              bubbles: true,
              composed: true,
            })
          );
        } else {
          logger.log('Follow mode enabled successfully for worktree');
          // Update local state
          this.followMode = true;
          this.followBranch = effectiveBranch;
        }
      } catch (error) {
        logger.error('Error enabling follow mode:', error);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: 'Error enabling follow mode. Session will be created without follow mode.',
            bubbles: true,
            composed: true,
          })
        );
      }
    }

    try {
      // Check if sessionService is initialized
      if (!this.sessionService) {
        throw new Error('Session service not initialized');
      }
      const result = await this.sessionService.createSession(sessionData);

      // Save to localStorage before clearing the fields
      // In test environments, don't save spawn window to avoid cross-test contamination
      const isTestEnvironment =
        window.location.search.includes('test=true') ||
        navigator.userAgent.includes('HeadlessChrome');

      if (isTestEnvironment) {
        // Save everything except spawn window in tests
        const currentSpawnWindow = getSessionFormValue('SPAWN_WINDOW');
        this.saveToLocalStorage();
        // Restore the original spawn window value
        if (currentSpawnWindow !== null) {
          setSessionFormValue('SPAWN_WINDOW', currentSpawnWindow);
        } else {
          removeSessionFormValue('SPAWN_WINDOW');
        }
      } else {
        this.saveToLocalStorage();
      }

      this.command = ''; // Clear command on success
      this.sessionName = ''; // Clear session name on success
      this.dispatchEvent(
        new CustomEvent('session-created', {
          detail: result,
        })
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      logger.error('Error creating session:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: errorMessage,
        })
      );
    } finally {
      this.isCreating = false;
    }
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  private handleBackdropClick(e: Event) {
    if (e.target === e.currentTarget) {
      this.handleCancel();
    }
  }

  private handleQuickStartSelected(e: CustomEvent) {
    const command = e.detail.command;
    this.command = command;
    this.selectedQuickStart = command;
  }

  private handleBranchChanged(e: CustomEvent) {
    this.selectedBaseBranch = e.detail.branch;
    // Clear any previous warning
    this.branchSwitchWarning = undefined;
  }

  private handleWorktreeChanged(e: CustomEvent) {
    this.selectedWorktree = e.detail.worktree;
    // Clear any previous warning
    this.branchSwitchWarning = undefined;

    // Reset follow mode toggle when no worktree is selected
    if (!this.selectedWorktree || this.selectedWorktree === 'none') {
      this.showFollowMode = false;
    }
  }

  private async handleCreateWorktreeRequest(e: CustomEvent) {
    const { branchName, baseBranch, customPath } = e.detail;
    if (!this.gitRepoInfo?.repoPath || !this.gitService) {
      return;
    }

    try {
      // Use custom path if provided, otherwise generate default
      const worktreePath =
        customPath || generateWorktreePath(this.gitRepoInfo.repoPath, branchName);

      // Create the worktree
      await this.gitService.createWorktree(
        this.gitRepoInfo.repoPath,
        branchName,
        worktreePath,
        baseBranch
      );

      // Update working directory to the new worktree
      this.workingDir = worktreePath;

      // Update selected base branch to the new branch
      this.selectedBaseBranch = branchName;

      // Add new branch to available branches
      if (!this.availableBranches.includes(branchName)) {
        this.availableBranches = [...this.availableBranches, branchName];
      }

      // Reload worktrees
      await this.loadWorktrees(this.gitRepoInfo.repoPath, worktreePath);

      // Select the newly created worktree
      this.selectedWorktree = branchName;

      // Git branch selector will reset its own state after successful creation

      // Show success message
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: `Created worktree for branch '${branchName}'`,
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      logger.error('Failed to create worktree:', error);

      // Git branch selector will reset its own state on error

      // Determine specific error message
      let errorMessage = 'Failed to create worktree';
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          errorMessage = `Worktree path already exists. Try a different branch name.`;
        } else if (error.message.includes('already checked out')) {
          errorMessage = `Branch '${branchName}' is already checked out in another worktree`;
        } else if (error.message.includes('Permission denied')) {
          errorMessage = 'Permission denied. Check directory permissions.';
        } else {
          errorMessage = error.message;
        }
      }

      this.dispatchEvent(
        new CustomEvent('error', {
          detail: errorMessage,
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private handleAutocompleteItemSelected(e: CustomEvent) {
    this.handleSelectCompletion(e.detail.suggestion);
  }

  private handleRepositorySelected(e: CustomEvent) {
    this.handleSelectRepository(e.detail.path);
  }

  private async discoverRepositories() {
    this.isDiscovering = true;
    try {
      // Only proceed if repositoryService is initialized
      if (this.repositoryService) {
        this.repositories = await this.repositoryService.discoverRepositories();
        // Update autocomplete manager with discovered repositories
        this.autocompleteManager.setRepositories(this.repositories);
      } else {
        logger.warn('Repository service not initialized yet');
        this.repositories = [];
      }
    } finally {
      this.isDiscovering = false;
    }
  }

  private handleToggleAutocomplete() {
    // If we have text input, toggle the autocomplete
    if (this.workingDir?.trim()) {
      if (this.showCompletions) {
        this.showCompletions = false;
        this.completions = [];
      } else {
        this.fetchCompletions();
      }
    } else {
      // If no text, show repository dropdown instead
      this.showRepositoryDropdown = !this.showRepositoryDropdown;
    }
  }

  private handleSelectRepository(repoPath: string) {
    this.workingDir = formatPathForDisplay(repoPath);
    this.showRepositoryDropdown = false;
    // Check Git repository after selection
    this.checkGitRepository();
  }

  private async fetchCompletions() {
    const path = this.workingDir?.trim();
    if (!path || path === '') {
      this.completions = [];
      this.showCompletions = false;
      return;
    }

    this.isLoadingCompletions = true;

    try {
      // Use the autocomplete manager to fetch completions
      this.completions = await this.autocompleteManager.fetchCompletions(path);
      this.showCompletions = this.completions.length > 0;
      // Auto-select the first item when completions are shown
      this.selectedCompletionIndex = this.completions.length > 0 ? 0 : -1;
    } catch (error) {
      logger.error('Error fetching completions:', error);
      this.completions = [];
      this.showCompletions = false;
    } finally {
      this.isLoadingCompletions = false;
    }
  }

  private handleSelectCompletion(suggestion: string) {
    this.workingDir = formatPathForDisplay(suggestion);
    this.showCompletions = false;
    this.completions = [];
    this.selectedCompletionIndex = -1;
    // Check Git repository after autocomplete selection
    this.checkGitRepository();
  }

  private handleWorkingDirKeydown(e: KeyboardEvent) {
    if (!this.showCompletions || this.completions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedCompletionIndex = Math.min(
        this.selectedCompletionIndex + 1,
        this.completions.length - 1
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedCompletionIndex = Math.max(this.selectedCompletionIndex - 1, -1);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      // Allow Enter/Tab to select the auto-selected first item or any selected item
      if (this.selectedCompletionIndex >= 0 && this.completions[this.selectedCompletionIndex]) {
        e.preventDefault();
        e.stopPropagation();
        this.handleSelectCompletion(this.completions[this.selectedCompletionIndex].suggestion);
      }
    }
  }

  private handleWorkingDirBlur() {
    // Hide completions after a delay to allow clicking on them
    setTimeout(() => {
      this.showCompletions = false;
      this.selectedCompletionIndex = -1;
    }, 200);
  }

  private async checkGitRepository() {
    const path = this.workingDir?.trim();
    logger.log(`🔍 Checking Git repository for path: ${path}`);

    if (!path || !this.gitService) {
      logger.debug('No path or gitService, clearing Git info');
      this.gitRepoInfo = null;
      this.availableBranches = [];
      this.selectedBaseBranch = '';
      this.followMode = false;
      this.followBranch = null;
      return;
    }

    this.isCheckingGit = true;
    try {
      const repoInfo = await this.gitService.checkGitRepo(path);
      logger.log(`✅ Git check result:`, repoInfo);

      if (repoInfo.isGitRepo && repoInfo.repoPath) {
        logger.log(`🎉 Git repository detected at: ${repoInfo.repoPath}`);
        this.gitRepoInfo = repoInfo;
        // Trigger re-render after updating gitRepoInfo
        this.requestUpdate();

        // Load branches, worktrees, and follow mode status in parallel
        await Promise.all([
          this.loadBranches(repoInfo.repoPath),
          this.loadWorktrees(repoInfo.repoPath, path),
          this.checkFollowMode(repoInfo.repoPath),
        ]);
      } else {
        logger.log(`❌ Not a Git repository: ${path}`, repoInfo);
        this.gitRepoInfo = null;
        this.availableBranches = [];
        this.selectedBaseBranch = '';
        this.currentBranch = '';
        this.selectedBaseBranch = '';
        this.availableWorktrees = [];
        this.selectedWorktree = undefined;
        this.followMode = false;
        this.followBranch = null;
        // Trigger re-render to clear Git UI
        this.requestUpdate();
      }
    } catch (error) {
      logger.error('❌ Error checking Git repository:', error);
      this.gitRepoInfo = null;
      this.availableBranches = [];
      this.selectedBaseBranch = '';
      this.currentBranch = '';
      this.selectedBaseBranch = '';
      this.availableWorktrees = [];
      this.selectedWorktree = undefined;
      this.followMode = false;
      this.followBranch = null;
    } finally {
      this.isCheckingGit = false;
    }
  }

  private async loadBranches(repoPath: string): Promise<void> {
    if (!this.authClient) {
      return;
    }

    this.isLoadingBranches = true;
    try {
      const { branches, currentBranch } = await loadBranches(repoPath, this.authClient);
      this.availableBranches = branches;

      if (currentBranch) {
        this.currentBranch = currentBranch;
        if (!this.selectedBaseBranch) {
          this.selectedBaseBranch = this.currentBranch;
        }
      }
    } finally {
      this.isLoadingBranches = false;
    }
  }

  private async loadWorktrees(repoPath: string, currentPath: string): Promise<void> {
    if (!this.gitService) {
      return;
    }

    this.isLoadingWorktrees = true;
    try {
      const response = await this.gitService.listWorktrees(repoPath);
      this.availableWorktrees = response.worktrees.map((wt) => ({
        // Strip refs/heads/ prefix for display
        branch: wt.branch.replace(/^refs\/heads\//, ''),
        path: wt.path,
        isMainWorktree: wt.isMainWorktree,
        isCurrentWorktree: wt.path === currentPath,
      }));

      // Update current branch based on worktree info
      const currentWorktree = response.worktrees.find(
        (wt) => wt.isCurrentWorktree || wt.path === currentPath
      );
      if (currentWorktree) {
        // Strip refs/heads/ prefix from branch name
        this.currentBranch = currentWorktree.branch.replace(/^refs\/heads\//, '');
        if (!this.selectedBaseBranch) {
          this.selectedBaseBranch = this.currentBranch;
        }

        // Pre-select the current worktree if we're already in one (not the main worktree)
        if (!currentWorktree.isMainWorktree && !this.selectedWorktree) {
          this.selectedWorktree = currentWorktree.branch.replace(/^refs\/heads\//, '');
        }
      }
    } catch (error) {
      logger.error('Failed to load worktrees:', error);
      this.availableWorktrees = [];
    } finally {
      this.isLoadingWorktrees = false;
    }
  }

  private renderGitBranchIndicator() {
    if (
      !this.gitRepoInfo?.isGitRepo ||
      !this.currentBranch ||
      document.activeElement?.getAttribute('data-testid') === 'working-dir-input'
    ) {
      return nothing;
    }

    return html`
      <div class="absolute inset-y-0 right-2 flex items-center pointer-events-none">
        <span class="text-[10px] sm:text-xs text-primary font-medium flex items-center gap-1">[${this.currentBranch}]
          ${this.gitRepoInfo.hasChanges ? html`<span class="text-yellow-500" title="Modified">●</span>` : ''}
          ${
            this.gitRepoInfo.isWorktree
              ? html`
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" class="text-purple-400" title="Git worktree">
              <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
            </svg>
          `
              : ''
          }
        </span>
      </div>
    `;
  }

  private handleWorkingDirFocus() {
    // Force re-render to hide the branch indicator
    this.requestUpdate();
  }

  private async checkFollowMode(repoPath: string): Promise<void> {
    if (!this.authClient) {
      return;
    }

    this.isCheckingFollowMode = true;
    try {
      const { followMode: mode, followBranch: branch } = await checkFollowMode(
        repoPath,
        this.authClient
      );
      this.followMode = mode;
      this.followBranch = branch;
      logger.log('Follow mode status:', {
        followMode: this.followMode,
        followBranch: this.followBranch,
      });
    } finally {
      this.isCheckingFollowMode = false;
    }
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="modal-backdrop flex items-center justify-center py-4 sm:py-6 lg:py-8" @click=${this.handleBackdropClick} role="dialog" aria-modal="true">
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-[576px] mx-2 sm:mx-4 overflow-hidden"
          style="pointer-events: auto;"
          @click=${(e: Event) => e.stopPropagation()}
          data-testid="session-create-modal"
        >
          <div class="p-3 sm:p-4 mb-1 sm:mb-2 border-b border-border/50 relative bg-gradient-to-r from-bg-secondary to-bg-tertiary flex-shrink-0 rounded-t-xl flex items-center justify-between">
            <h2 id="modal-title" class="text-primary text-base sm:text-lg lg:text-xl font-bold">New Session</h2>
            <button
              class="text-text-muted hover:text-text transition-all duration-200 p-1.5 sm:p-2 hover:bg-bg-elevated/30 rounded-lg"
              @click=${this.handleCancel}
              title="Close (Esc)"
              aria-label="Close modal"
            >
              <svg
                class="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="p-3 sm:p-4 overflow-y-auto flex-grow max-h-[calc(100vh-8rem)] sm:max-h-[calc(100vh-6rem)] lg:max-h-[calc(100vh-4rem)]">
            <!-- Branch Switch Warning -->
            ${
              this.branchSwitchWarning
                ? html`
                  <div class="mb-2 sm:mb-3 p-2 sm:p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <div class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <p class="text-[10px] sm:text-xs text-yellow-200">
                        ${this.branchSwitchWarning}
                      </p>
                    </div>
                  </div>
                `
                : nothing
            }
            
            <!-- Session Name -->
            <div class="mb-2 sm:mb-3">
              <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm">Session Name (Optional):</label>
              <input
                type="text"
                class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm"
                .value=${this.sessionName}
                @input=${this.handleSessionNameChange}
                placeholder="My Session"
                ?disabled=${this.disabled || this.isCreating}
                data-testid="session-name-input"
              />
            </div>

            <!-- Command -->
            <div class="mb-2 sm:mb-3">
              <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm">Command:</label>
              <input
                type="text"
                class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm"
                .value=${this.command}
                @input=${this.handleCommandChange}
                placeholder="zsh"
                ?disabled=${this.disabled || this.isCreating}
                data-testid="command-input"
              />
            </div>

            <!-- Working Directory -->
            <div class="mb-3 sm:mb-4">
              <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm">Working Directory:</label>
              <div class="relative">
                <div class="flex gap-1.5 sm:gap-2">
                <div class="relative flex-1">
                  <input
                    type="text"
                    class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm w-full pr-24"
                    .value=${this.workingDir}
                    @input=${this.handleWorkingDirChange}
                    @keydown=${this.handleWorkingDirKeydown}
                    @blur=${this.handleWorkingDirBlur}
                    @focus=${this.handleWorkingDirFocus}
                    placeholder="~/"
                    ?disabled=${this.disabled || this.isCreating}
                    data-testid="working-dir-input"
                    autocomplete="off"
                  />
                  ${this.renderGitBranchIndicator()}
                </div>
                <button
                  id="session-browse-button"
                  class="bg-bg-tertiary border border-border/50 rounded-lg p-1.5 sm:p-2 lg:p-3 font-mono text-text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary/50 hover:shadow-sm flex-shrink-0"
                  @click=${this.handleBrowse}
                  ?disabled=${this.disabled || this.isCreating}
                  title="Browse directories"
                  type="button"
                >
                  <svg width="12" height="12" class="sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z"
                    />
                  </svg>
                </button>
                <button
                  id="session-autocomplete-button"
                  class="bg-bg-tertiary border border-border/50 rounded-lg p-1.5 sm:p-2 lg:p-3 font-mono text-text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary/50 hover:shadow-sm flex-shrink-0 ${
                    this.showRepositoryDropdown || this.showCompletions
                      ? 'text-primary border-primary/50'
                      : ''
                  }"
                  @click=${this.handleToggleAutocomplete}
                  ?disabled=${this.disabled || this.isCreating}
                  title="Choose from repositories or recent directories"
                  type="button"
                >
                  <svg 
                    width="12" 
                    height="12" 
                    class="sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4 transition-transform duration-200" 
                    viewBox="0 0 16 16" 
                    fill="currentColor"
                    style="transform: ${this.showRepositoryDropdown || this.showCompletions ? 'rotate(90deg)' : 'rotate(0deg)'}"
                  >
                    <path
                      d="M5.22 1.22a.75.75 0 011.06 0l6.25 6.25a.75.75 0 010 1.06l-6.25 6.25a.75.75 0 01-1.06-1.06L10.94 8 5.22 2.28a.75.75 0 010-1.06z"
                    />
                  </svg>
                </button>
              </div>
              <directory-autocomplete
                .visible=${this.showCompletions}
                .items=${this.completions}
                .selectedIndex=${this.selectedCompletionIndex}
                .isLoading=${this.isLoadingCompletions}
                @item-selected=${this.handleAutocompleteItemSelected}
              ></directory-autocomplete>
              <repository-dropdown
                .visible=${this.showRepositoryDropdown}
                .repositories=${this.repositories}
                @repository-selected=${this.handleRepositorySelected}
              ></repository-dropdown>
            </div>

            <!-- Git Branch/Worktree Selection (shown when Git repository detected) -->
            <git-branch-selector
              .gitRepoInfo=${this.gitRepoInfo}
              .disabled=${this.disabled}
              .isCreating=${this.isCreating}
              .currentBranch=${this.currentBranch}
              .selectedBaseBranch=${this.selectedBaseBranch}
              .selectedWorktree=${this.selectedWorktree}
              .availableBranches=${this.availableBranches}
              .availableWorktrees=${this.availableWorktrees}
              .isLoadingBranches=${this.isLoadingBranches}
              .isLoadingWorktrees=${this.isLoadingWorktrees}
              .followMode=${this.followMode}
              .followBranch=${this.followBranch}
              .showFollowMode=${this.showFollowMode}
              .branchSwitchWarning=${this.branchSwitchWarning}
              @branch-changed=${this.handleBranchChanged}
              @worktree-changed=${this.handleWorktreeChanged}
              @create-worktree=${this.handleCreateWorktreeRequest}
            ></git-branch-selector>

            <!-- Quick Start Section -->
            <quick-start-section
              .commands=${this.quickStartCommands}
              .selectedCommand=${this.command}
              .disabled=${this.disabled}
              .isCreating=${this.isCreating}
              @quick-start-selected=${this.handleQuickStartSelected}
              @quick-start-changed=${this.handleQuickStartChanged}
            ></quick-start-section>

            <!-- Options Section (collapsible) -->
            <form-options-section
              .macAppConnected=${this.macAppConnected}
              .spawnWindow=${this.spawnWindow}
              .titleMode=${this.titleMode}
              .gitRepoInfo=${this.gitRepoInfo}
              .followMode=${this.followMode}
              .followBranch=${this.followBranch}
              .showFollowMode=${this.showFollowMode}
              .selectedWorktree=${this.selectedWorktree}
              .disabled=${this.disabled}
              .isCreating=${this.isCreating}
              @spawn-window-changed=${this.handleSpawnWindowChanged}
              @title-mode-changed=${this.handleTitleModeChanged}
              @follow-mode-changed=${this.handleFollowModeChanged}
            ></form-options-section>

            <div class="flex gap-1.5 sm:gap-2 mt-2 sm:mt-3">
              <button
                id="session-cancel-button"
                class="flex-1 bg-bg-elevated border border-border/50 text-text px-2 py-1 sm:px-3 sm:py-1.5 lg:px-4 lg:py-2 xl:px-6 xl:py-3 rounded-lg font-mono text-[10px] sm:text-xs lg:text-sm transition-all duration-200 hover:bg-hover hover:border-border"
                @click=${this.handleCancel}
                ?disabled=${this.isCreating}
              >
                Cancel
              </button>
              <button
                id="session-create-button"
                class="flex-1 bg-primary text-text-bright px-2 py-1 sm:px-3 sm:py-1.5 lg:px-4 lg:py-2 xl:px-6 xl:py-3 rounded-lg font-mono text-[10px] sm:text-xs lg:text-sm font-medium transition-all duration-200 hover:bg-primary-hover hover:shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
                @click=${this.handleCreate}
                ?disabled=${
                  this.disabled ||
                  this.isCreating ||
                  !this.workingDir?.trim() ||
                  !this.command?.trim()
                }
                data-testid="create-session-submit"
              >
                ${this.isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <file-browser
        .visible=${this.showFileBrowser}
        .mode=${'select'}
        .session=${{ workingDir: this.workingDir } as Session}
        @directory-selected=${this.handleDirectorySelected}
        @browser-cancel=${this.handleBrowserCancel}
      ></file-browser>
    `;
  }
}

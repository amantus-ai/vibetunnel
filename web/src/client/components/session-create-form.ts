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
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './file-browser.js';
import './quick-start-editor.js';
import type { Session } from '../../shared/types.js';
import { TitleMode } from '../../shared/types.js';
import type { QuickStartCommand } from '../../types/config.js';
import type { AuthClient } from '../services/auth-client.js';
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
import { getTitleModeDescription } from '../utils/title-mode-utils.js';
import {
  type AutocompleteItem,
  AutocompleteManager,
  type Repository,
} from './autocomplete-manager.js';

const logger = createLogger('session-create-form');

@customElement('session-create-form')
export class SessionCreateForm extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) workingDir = '~/';
  @property({ type: String }) command = 'zsh';
  @property({ type: String }) sessionName = '';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: Boolean }) spawnWindow = false;
  @property({ type: String }) titleMode = TitleMode.DYNAMIC;

  @state() private isCreating = false;
  @state() private showFileBrowser = false;
  @state() private selectedQuickStart = 'zsh';
  @state() private showRepositoryDropdown = false;
  @state() private repositories: Repository[] = [];
  @state() private isDiscovering = false;
  @state() private macAppConnected = false;
  @state() private showCompletions = false;
  @state() private completions: AutocompleteItem[] = [];
  @state() private selectedCompletionIndex = -1;
  @state() private isLoadingCompletions = false;
  @state() private showOptions = false;
  @state() private quickStartEditMode = false;

  @state() private quickStartCommands = [
    { label: '✨ claude', command: 'claude' },
    { label: '✨ gemini', command: 'gemini' },
    { label: 'zsh', command: 'zsh' },
    { label: 'python3', command: 'python3' },
    { label: 'node', command: 'node' },
    { label: '▶️ pnpm run dev', command: 'pnpm run dev' },
  ];

  private completionsDebounceTimer?: NodeJS.Timeout;
  private autocompleteManager!: AutocompleteManager;
  private repositoryService?: RepositoryService;
  private sessionService?: SessionService;
  private serverConfigService?: ServerConfigService;

  async connectedCallback() {
    super.connectedCallback();
    // Initialize services - AutocompleteManager handles optional authClient
    this.autocompleteManager = new AutocompleteManager(this.authClient);
    this.serverConfigService = new ServerConfigService(this.authClient);

    // Initialize other services only if authClient is available
    if (this.authClient) {
      this.repositoryService = new RepositoryService(this.authClient, this.serverConfigService);
      this.sessionService = new SessionService(this.authClient);
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
    // Clean up debounce timer
    if (this.completionsDebounceTimer) {
      clearTimeout(this.completionsDebounceTimer);
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
    let appRepoBasePath = '~/';
    if (this.serverConfigService) {
      try {
        appRepoBasePath = await this.serverConfigService.getRepositoryBasePath();
      } catch (error) {
        logger.error('Failed to get repository base path from server:', error);
        appRepoBasePath = '~/';
      }
    }

    // Always set values, using saved values or defaults
    // Priority: savedWorkingDir > appRepoBasePath > default
    this.workingDir = formData.workingDir || appRepoBasePath || '~/';
    this.command = formData.command || 'zsh';

    // For spawn window, use saved value or default to false
    this.spawnWindow = formData.spawnWindow ?? false;

    // For title mode, use saved value or default to DYNAMIC
    this.titleMode = formData.titleMode || TitleMode.DYNAMIC;

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
        this.workingDir = '~/';
        this.command = 'zsh';
        this.sessionName = '';
        this.spawnWindow = false;
        this.titleMode = TitleMode.DYNAMIC;

        // Then load from localStorage which may override the defaults
        // Don't await since we're in updated() lifecycle method
        this.loadFromLocalStorage().catch((error) => {
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
  }

  private handleCommandChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.command = input.value;

    // Auto-select dynamic mode for Claude
    if (this.command.toLowerCase().includes('claude')) {
      this.titleMode = TitleMode.DYNAMIC;
    }
  }

  private handleSessionNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.sessionName = input.value;
  }

  private handleSpawnWindowChange() {
    this.spawnWindow = !this.spawnWindow;
  }

  private handleTitleModeChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.titleMode = select.value as TitleMode;
  }

  private handleBrowse() {
    logger.debug('handleBrowse called, setting showFileBrowser to true');
    this.showFileBrowser = true;
    this.requestUpdate();
  }

  private handleDirectorySelected(e: CustomEvent) {
    this.workingDir = formatPathForDisplay(e.detail);
    this.showFileBrowser = false;
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

    const sessionData: SessionCreateData = {
      command: parseCommand(this.command?.trim() || ''),
      workingDir: this.workingDir?.trim() || '',
      spawn_terminal: effectiveSpawnTerminal,
      titleMode: this.titleMode,
    };

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

  private handleQuickStart(command: string) {
    this.command = command;
    this.selectedQuickStart = command;

    // Auto-select dynamic mode for Claude
    if (command.toLowerCase().includes('claude')) {
      this.titleMode = TitleMode.DYNAMIC;
    }
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

  private handleToggleRepositoryDropdown() {
    this.showRepositoryDropdown = !this.showRepositoryDropdown;
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
  }

  private handleToggleOptions() {
    this.showOptions = !this.showOptions;
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

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="modal-backdrop flex items-center justify-center" @click=${this.handleBackdropClick} role="dialog" aria-modal="true">
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-[576px] mx-2 sm:mx-4 overflow-hidden"
          style="pointer-events: auto;"
          @click=${(e: Event) => e.stopPropagation()}
          data-testid="session-create-modal"
        >
          <div class="p-3 sm:p-4 lg:p-6 mb-1 sm:mb-2 lg:mb-3 border-b border-border/50 relative bg-gradient-to-r from-bg-secondary to-bg-tertiary flex-shrink-0 rounded-t-xl">
            <h2 id="modal-title" class="text-primary text-base sm:text-lg lg:text-xl font-bold">New Session</h2>
            <button
              class="absolute top-2 right-2 sm:top-3 sm:right-3 lg:top-5 lg:right-5 text-text-muted hover:text-text transition-all duration-200 p-1.5 sm:p-2 hover:bg-bg-elevated/30 rounded-lg"
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

          <div class="p-3 sm:p-4 lg:p-6 overflow-y-auto flex-grow max-h-[65vh] sm:max-h-[75vh] lg:max-h-[80vh]">
            <!-- Session Name -->
            <div class="mb-2 sm:mb-3 lg:mb-5">
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
            <div class="mb-2 sm:mb-3 lg:mb-5">
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
            <div class="mb-4 sm:mb-5 lg:mb-6">
              <label class="form-label text-text-muted text-[10px] sm:text-xs lg:text-sm">Working Directory:</label>
              <div class="relative">
                <div class="flex gap-1.5 sm:gap-2">
                <input
                  type="text"
                  class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm flex-1"
                  .value=${this.workingDir}
                  @input=${this.handleWorkingDirChange}
                  @keydown=${this.handleWorkingDirKeydown}
                  @blur=${this.handleWorkingDirBlur}
                  placeholder="~/"
                  ?disabled=${this.disabled || this.isCreating}
                  data-testid="working-dir-input"
                  autocomplete="off"
                />
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
              ${
                this.showCompletions && this.completions.length > 0
                  ? html`
                    <div class="absolute left-0 right-0 mt-1 bg-bg-elevated border border-border/50 rounded-lg overflow-hidden shadow-lg z-50">
                      <div class="max-h-48 sm:max-h-64 lg:max-h-80 overflow-y-auto">
                        ${this.completions.map(
                          (completion, index) => html`
                            <button
                              @click=${() => this.handleSelectCompletion(completion.suggestion)}
                              class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors duration-200 flex items-center gap-2 ${
                                index === this.selectedCompletionIndex
                                  ? 'bg-primary/20 border-l-2 border-primary'
                                  : ''
                              }"
                              type="button"
                            >
                              <svg 
                                width="12" 
                                height="12" 
                                viewBox="0 0 16 16" 
                                fill="currentColor"
                                class="${completion.isRepository ? 'text-primary' : 'text-text-muted'} flex-shrink-0"
                              >
                                ${
                                  completion.isRepository
                                    ? html`<path d="M4.177 7.823A4.5 4.5 0 118 12.5a4.474 4.474 0 01-1.653-.316.75.75 0 11.557-1.392 2.999 2.999 0 001.096.208 3 3 0 10-2.108-5.134.75.75 0 01.236.662l.428 3.009a.75.75 0 01-1.255.592L2.847 7.677a.75.75 0 01.426-1.27A4.476 4.476 0 014.177 7.823zM8 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 1zm3.197 2.197a.75.75 0 01.092.992l-1 1.25a.75.75 0 01-1.17-.938l1-1.25a.75.75 0 01.992-.092.75.75 0 01.086.038zM5.75 8a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 015.75 8zm5.447 2.197a.75.75 0 01.092.992l-1 1.25a.75.75 0 11-1.17-.938l1-1.25a.75.75 0 01.992-.092.75.75 0 01.086.038z" />`
                                    : completion.type === 'directory'
                                      ? html`<path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z" />`
                                      : html`<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 00.25-.25V6h-2.75A1.75 1.75 0 019 4.25V1.5H3.75zm6.75.062V4.25c0 .138.112.25.25.25h2.688a.252.252 0 00-.011-.013l-2.914-2.914a.272.272 0 00-.013-.011z" />`
                                }
                              </svg>
                              <span class="text-text text-xs sm:text-sm truncate flex-1">
                                ${completion.name}
                              </span>
                              <span class="text-text-muted text-[9px] sm:text-[10px] truncate max-w-[40%]">${completion.path}</span>
                            </button>
                          `
                        )}
                      </div>
                    </div>
                  `
                  : ''
              }
              ${
                this.showRepositoryDropdown && this.repositories.length > 0
                  ? html`
                    <div class="mt-2 bg-bg-elevated border border-border/50 rounded-lg overflow-hidden">
                      <div class="max-h-48 overflow-y-auto">
                        ${this.repositories.map(
                          (repo) => html`
                            <button
                              @click=${() => this.handleSelectRepository(repo.path)}
                              class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors duration-200 border-b border-border/30 last:border-b-0"
                              type="button"
                            >
                              <div class="flex items-center justify-between">
                                <div>
                                  <div class="text-text text-xs sm:text-sm font-medium">${repo.folderName}</div>
                                  <div class="text-text-muted text-[9px] sm:text-[10px] mt-0.5">${repo.relativePath}</div>
                                </div>
                                <div class="text-text-muted text-[9px] sm:text-[10px]">
                                  ${new Date(repo.lastModified).toLocaleDateString()}
                                </div>
                              </div>
                            </button>
                          `
                        )}
                      </div>
                    </div>
                  `
                  : ''
              }
            </div>

            <!-- Quick Start Section -->
            <div class="${this.quickStartEditMode ? '' : 'mb-4 sm:mb-5 lg:mb-6'}">
              ${
                this.quickStartEditMode
                  ? html`
                    <!-- Full width editor when in edit mode -->
                    <div class="-mx-3 sm:-mx-4 lg:-mx-6">
                      <quick-start-editor
                        .commands=${this.quickStartCommands.map((cmd) => ({
                          name: cmd.label === cmd.command ? undefined : cmd.label,
                          command: cmd.command,
                        }))}
                        .editing=${true}
                        @quick-start-changed=${this.handleQuickStartChanged}
                        @editing-changed=${(e: CustomEvent) => {
                          this.quickStartEditMode = e.detail.editing;
                        }}
                      ></quick-start-editor>
                    </div>
                  `
                  : html`
                    <!-- Normal mode with Edit button -->
                    <div class="flex items-center justify-between mb-1 sm:mb-2 lg:mb-3 mt-4 sm:mt-5 lg:mt-6">
                      <label class="form-label text-text-muted uppercase text-[9px] sm:text-[10px] lg:text-xs tracking-wider"
                        >Quick Start</label
                      >
                      <quick-start-editor
                        .commands=${this.quickStartCommands.map((cmd) => ({
                          name: cmd.label === cmd.command ? undefined : cmd.label,
                          command: cmd.command,
                        }))}
                        .editing=${false}
                        @quick-start-changed=${this.handleQuickStartChanged}
                        @editing-changed=${(e: CustomEvent) => {
                          this.quickStartEditMode = e.detail.editing;
                        }}
                      ></quick-start-editor>
                    </div>
                  `
              }
              ${
                !this.quickStartEditMode
                  ? html`
                  <div class="grid grid-cols-2 gap-2 sm:gap-2.5 lg:gap-3 mt-1.5 sm:mt-2">
                    ${this.quickStartCommands.map(
                      ({ label, command }) => html`
                        <button
                          @click=${() => this.handleQuickStart(command)}
                          class="${
                            this.command === command
                              ? 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-primary bg-opacity-10 border-primary/50 text-primary hover:bg-opacity-20 font-medium text-[10px] sm:text-xs lg:text-sm'
                              : 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-bg-elevated border-border/50 text-text hover:bg-hover hover:border-primary/50 hover:text-primary text-[10px] sm:text-xs lg:text-sm'
                          }"
                          ?disabled=${this.disabled || this.isCreating}
                        >
                          ${label}
                        </button>
                      `
                    )}
                  </div>
                `
                  : ''
              }
            </div>

            <!-- Options Section (collapsible) -->
            <div class="mb-2 sm:mb-4 lg:mb-6">
              <button
                id="session-options-button"
                @click=${this.handleToggleOptions}
                class="flex items-center gap-1.5 sm:gap-2 text-text-muted hover:text-primary transition-colors duration-200"
                type="button"
                aria-expanded="${this.showOptions}"
              >
                <svg 
                  width="8" 
                  height="8" 
                  class="sm:w-2 sm:h-2 lg:w-2.5 lg:h-2.5 transition-transform duration-200 flex-shrink-0" 
                  viewBox="0 0 16 16" 
                  fill="currentColor"
                  style="transform: ${this.showOptions ? 'rotate(90deg)' : 'rotate(0deg)'}"
                >
                  <path
                    d="M5.22 1.22a.75.75 0 011.06 0l6.25 6.25a.75.75 0 010 1.06l-6.25 6.25a.75.75 0 01-1.06-1.06L10.94 8 5.22 2.28a.75.75 0 010-1.06z"
                  />
                </svg>
                <span class="form-label text-text-muted uppercase text-[9px] sm:text-[10px] lg:text-xs tracking-wider">Options</span>
              </button>

              ${
                this.showOptions
                  ? html`
                <div class="space-y-2 sm:space-y-3 mt-2 sm:mt-4 lg:mt-6">
                  <!-- Spawn Window Toggle - Only show when Mac app is connected -->
                  ${
                    this.macAppConnected
                      ? html`
                        <div class="flex items-center justify-between bg-bg-elevated border border-border/50 rounded-lg p-2 sm:p-3 lg:p-4">
                          <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                            <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Spawn window</span>
                            <p class="text-[9px] sm:text-[10px] lg:text-xs text-text-muted mt-0.5 hidden sm:block">Opens native terminal window</p>
                          </div>
                          <button
                            role="switch"
                            aria-checked="${this.spawnWindow}"
                            @click=${this.handleSpawnWindowChange}
                            class="relative inline-flex h-4 w-8 sm:h-5 sm:w-10 lg:h-6 lg:w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-bg-secondary ${
                              this.spawnWindow ? 'bg-primary' : 'bg-border/50'
                            }"
                            ?disabled=${this.disabled || this.isCreating}
                            data-testid="spawn-window-toggle"
                          >
                            <span
                              class="inline-block h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 transform rounded-full bg-bg-elevated transition-transform ${
                                this.spawnWindow
                                  ? 'translate-x-4 sm:translate-x-5'
                                  : 'translate-x-0.5'
                              }"
                            ></span>
                          </button>
                        </div>
                      `
                      : ''
                  }

                  <!-- Terminal Title Mode -->
                  <div class="flex items-center justify-between bg-bg-elevated border border-border/50 rounded-lg p-2 sm:p-3 lg:p-4">
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
                        <option value="${TitleMode.DYNAMIC}" class="bg-bg-tertiary text-text" ?selected=${this.titleMode === TitleMode.DYNAMIC}>Dynamic</option>
                      </select>
                      <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 sm:px-1.5 lg:px-2 text-text-muted">
                        <svg class="h-2.5 w-2.5 sm:h-3 sm:w-3 lg:h-4 lg:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              `
                  : ''
              }
            </div>

            <div class="flex gap-1.5 sm:gap-2 lg:gap-3 mt-2 sm:mt-3 lg:mt-4 xl:mt-6">
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

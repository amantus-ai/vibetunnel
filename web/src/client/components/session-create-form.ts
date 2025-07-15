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
import { TitleMode } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';
import type { Session } from './session-list.js';
import {
  STORAGE_KEY as APP_PREFERENCES_STORAGE_KEY,
  type AppPreferences,
} from './unified-settings.js';

const logger = createLogger('session-create-form');

export interface SessionCreateData {
  command: string[];
  workingDir: string;
  name?: string;
  spawn_terminal?: boolean;
  cols?: number;
  rows?: number;
  titleMode?: TitleMode;
}

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
  @state() private repositories: Array<{
    id: string;
    path: string;
    folderName: string;
    lastModified: string;
    relativePath: string;
  }> = [];
  @state() private isDiscovering = false;

  quickStartCommands = [
    { label: 'claude', command: 'claude' },
    { label: 'gemini', command: 'gemini' },
    { label: 'zsh', command: 'zsh' },
    { label: 'python3', command: 'python3' },
    { label: 'node', command: 'node' },
    { label: 'pnpm run dev', command: 'pnpm run dev' },
  ];

  private readonly STORAGE_KEY_WORKING_DIR = 'vibetunnel_last_working_dir';
  private readonly STORAGE_KEY_COMMAND = 'vibetunnel_last_command';
  private readonly STORAGE_KEY_SPAWN_WINDOW = 'vibetunnel_spawn_window';
  private readonly STORAGE_KEY_TITLE_MODE = 'vibetunnel_title_mode';

  connectedCallback() {
    super.connectedCallback();
    // Load from localStorage when component is first created
    this.loadFromLocalStorage();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up document event listener if modal is still visible
    if (this.visible) {
      document.removeEventListener('keydown', this.handleGlobalKeyDown);
    }
  }

  private handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Only handle events when modal is visible
    if (!this.visible) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.handleCancel();
    } else if (e.key === 'Enter') {
      // Don't interfere with Enter in textarea elements
      if (e.target instanceof HTMLTextAreaElement) return;

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

  private loadFromLocalStorage() {
    try {
      const savedWorkingDir = localStorage.getItem(this.STORAGE_KEY_WORKING_DIR);
      const savedCommand = localStorage.getItem(this.STORAGE_KEY_COMMAND);
      const savedSpawnWindow = localStorage.getItem(this.STORAGE_KEY_SPAWN_WINDOW);
      const savedTitleMode = localStorage.getItem(this.STORAGE_KEY_TITLE_MODE);

      // Get app preferences for repository base path to use as default working dir
      let appRepoBasePath = '~/';
      const savedPreferences = localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
      if (savedPreferences) {
        try {
          const preferences: AppPreferences = JSON.parse(savedPreferences);
          appRepoBasePath = preferences.repositoryBasePath || '~/';
        } catch (error) {
          logger.error('Failed to parse app preferences:', error);
        }
      }

      // Always set values, using saved values or defaults
      // Priority: savedWorkingDir > appRepoBasePath > default
      this.workingDir = savedWorkingDir || appRepoBasePath || '~/';
      this.command = savedCommand || 'zsh';

      // For spawn window, only use saved value if it exists and is valid
      // This ensures we respect the default (false) when nothing is saved
      if (savedSpawnWindow !== null && savedSpawnWindow !== '') {
        this.spawnWindow = savedSpawnWindow === 'true';
      }

      if (savedTitleMode !== null) {
        // Validate the saved mode is a valid enum value
        if (Object.values(TitleMode).includes(savedTitleMode as TitleMode)) {
          this.titleMode = savedTitleMode as TitleMode;
        } else {
          // If invalid value in localStorage, default to DYNAMIC
          this.titleMode = TitleMode.DYNAMIC;
        }
      } else {
        // If no value in localStorage, ensure DYNAMIC is set
        this.titleMode = TitleMode.DYNAMIC;
      }

      // Force re-render to update the input values
      this.requestUpdate();
    } catch (_error) {
      logger.warn('failed to load from localStorage');
    }
  }

  private saveToLocalStorage() {
    try {
      const workingDir = this.workingDir?.trim() || '';
      const command = this.command?.trim() || '';

      // Only save non-empty values
      if (workingDir) {
        localStorage.setItem(this.STORAGE_KEY_WORKING_DIR, workingDir);
      }
      if (command) {
        localStorage.setItem(this.STORAGE_KEY_COMMAND, command);
      }
      localStorage.setItem(this.STORAGE_KEY_SPAWN_WINDOW, String(this.spawnWindow));
      localStorage.setItem(this.STORAGE_KEY_TITLE_MODE, this.titleMode);
    } catch (_error) {
      logger.warn('failed to save to localStorage');
    }
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

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
        this.loadFromLocalStorage();

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

  private getTitleModeDescription(): string {
    switch (this.titleMode) {
      case TitleMode.NONE:
        return 'Apps control their own titles';
      case TitleMode.FILTER:
        return 'Blocks all title changes';
      case TitleMode.STATIC:
        return 'Shows path and command';
      case TitleMode.DYNAMIC:
        return '○ idle ● active ▶ running';
      default:
        return '';
    }
  }

  private handleBrowse() {
    this.showFileBrowser = true;
  }

  private handleDirectorySelected(e: CustomEvent) {
    this.workingDir = e.detail;
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

    const sessionData: SessionCreateData = {
      command: this.parseCommand(this.command?.trim() || ''),
      workingDir: this.workingDir?.trim() || '',
      spawn_terminal: this.spawnWindow,
      titleMode: this.titleMode,
    };

    // Only add dimensions for web sessions (not external terminal spawns)
    if (!this.spawnWindow) {
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
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify(sessionData),
      });

      if (response.ok) {
        const result = await response.json();

        // Save to localStorage before clearing the fields
        // In test environments, don't save spawn window to avoid cross-test contamination
        const isTestEnvironment =
          window.location.search.includes('test=true') ||
          navigator.userAgent.includes('HeadlessChrome');

        if (isTestEnvironment) {
          // Save everything except spawn window in tests
          const currentSpawnWindow = localStorage.getItem(this.STORAGE_KEY_SPAWN_WINDOW);
          this.saveToLocalStorage();
          // Restore the original spawn window value
          if (currentSpawnWindow !== null) {
            localStorage.setItem(this.STORAGE_KEY_SPAWN_WINDOW, currentSpawnWindow);
          } else {
            localStorage.removeItem(this.STORAGE_KEY_SPAWN_WINDOW);
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
      } else {
        const error = await response.json();
        // Use the detailed error message if available, otherwise fall back to the error field
        const errorMessage = error.details || error.error || 'Unknown error';
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: errorMessage,
          })
        );
      }
    } catch (error) {
      logger.error('error creating session:', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: 'Failed to create session',
        })
      );
    } finally {
      this.isCreating = false;
    }
  }

  private parseCommand(commandStr: string): string[] {
    // Simple command parsing - split by spaces but respect quotes
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < commandStr.length; i++) {
      const char = commandStr[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
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
    // Get app preferences to read repositoryBasePath
    const savedPreferences = localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
    let basePath = '~/';

    if (savedPreferences) {
      try {
        const preferences: AppPreferences = JSON.parse(savedPreferences);
        basePath = preferences.repositoryBasePath || '~/';
      } catch (error) {
        logger.error('Failed to parse app preferences:', error);
      }
    }

    this.isDiscovering = true;

    try {
      const response = await fetch(
        `/api/repositories/discover?path=${encodeURIComponent(basePath)}`,
        {
          headers: this.authClient.getAuthHeader(),
        }
      );

      if (response.ok) {
        this.repositories = await response.json();
        logger.debug(`Discovered ${this.repositories.length} repositories`);
      } else {
        logger.error('Failed to discover repositories');
      }
    } catch (error) {
      logger.error('Error discovering repositories:', error);
    } finally {
      this.isDiscovering = false;
    }
  }

  private handleToggleRepositoryDropdown() {
    this.showRepositoryDropdown = !this.showRepositoryDropdown;
  }

  private handleSelectRepository(repoPath: string) {
    this.workingDir = repoPath;
    this.showRepositoryDropdown = false;
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="modal-backdrop flex items-center justify-center" @click=${this.handleBackdropClick} role="dialog" aria-modal="true">
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-[576px] mx-2 sm:mx-4"
          style="pointer-events: auto;"
          @click=${(e: Event) => e.stopPropagation()}
          data-testid="session-create-modal"
        >
          <div class="p-3 sm:p-4 lg:p-6 mb-1 sm:mb-2 lg:mb-3 border-b border-base relative bg-gradient-to-r from-secondary to-tertiary flex-shrink-0">
            <h2 id="modal-title" class="text-primary text-base sm:text-lg lg:text-xl font-bold">New Session</h2>
            <button
              class="absolute top-2 right-2 sm:top-3 sm:right-3 lg:top-5 lg:right-5 text-muted hover:text-primary transition-all duration-200 p-1.5 sm:p-2 hover:bg-tertiary rounded-lg"
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
              <label class="form-label text-muted text-[10px] sm:text-xs lg:text-sm">Session Name (Optional):</label>
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
              <label class="form-label text-muted text-[10px] sm:text-xs lg:text-sm">Command:</label>
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
            <div class="mb-2 sm:mb-3 lg:mb-5">
              <label class="form-label text-muted text-[10px] sm:text-xs lg:text-sm">Working Directory:</label>
              <div class="flex gap-1.5 sm:gap-2">
                <input
                  type="text"
                  class="input-field py-1.5 sm:py-2 lg:py-3 text-xs sm:text-sm"
                  .value=${this.workingDir}
                  @input=${this.handleWorkingDirChange}
                  placeholder="~/"
                  ?disabled=${this.disabled || this.isCreating}
                  data-testid="working-dir-input"
                />
                <button
                  class="bg-bg-tertiary border border-border rounded-lg p-1.5 sm:p-2 lg:p-3 font-mono text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0"
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
                  class="bg-bg-tertiary border border-border rounded-lg p-1.5 sm:p-2 lg:p-3 font-mono text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0 ${
                    this.showRepositoryDropdown ? 'text-primary border-primary' : ''
                  }"
                  @click=${this.handleToggleRepositoryDropdown}
                  ?disabled=${this.disabled || this.isCreating || this.repositories.length === 0 || this.isDiscovering}
                  title="Choose from repositories"
                  type="button"
                >
                  <svg width="12" height="12" class="sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d="M5.22 1.22a.75.75 0 011.06 0l6.25 6.25a.75.75 0 010 1.06l-6.25 6.25a.75.75 0 01-1.06-1.06L10.94 8 5.22 2.28a.75.75 0 010-1.06z"
                      transform=${this.showRepositoryDropdown ? 'rotate(90 8 8)' : ''}
                    />
                  </svg>
                </button>
              </div>
              ${
                this.showRepositoryDropdown && this.repositories.length > 0
                  ? html`
                    <div class="mt-2 bg-bg-elevated border border-border rounded-lg overflow-hidden">
                      <div class="max-h-48 overflow-y-auto">
                        ${this.repositories.map(
                          (repo) => html`
                            <button
                              @click=${() => this.handleSelectRepository(repo.path)}
                              class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors duration-200 border-b border-border last:border-b-0"
                              type="button"
                            >
                              <div class="flex items-center justify-between">
                                <div>
                                  <div class="text-dark-text text-xs sm:text-sm font-medium">${repo.folderName}</div>
                                  <div class="text-dark-text-muted text-[9px] sm:text-[10px] mt-0.5">${repo.relativePath}</div>
                                </div>
                                <div class="text-dark-text-muted text-[9px] sm:text-[10px]">
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

            <!-- Spawn Window Toggle -->
            <div class="mb-2 sm:mb-3 lg:mb-5 flex items-center justify-between bg-elevated border border-base rounded-lg p-2 sm:p-3 lg:p-4">
              <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Spawn window</span>
                <p class="text-[9px] sm:text-[10px] lg:text-xs text-muted mt-0.5 hidden sm:block">Opens native terminal window</p>
              </div>
              <button
                role="switch"
                aria-checked="${this.spawnWindow}"
                @click=${this.handleSpawnWindowChange}
                class="relative inline-flex h-4 w-8 sm:h-5 sm:w-10 lg:h-6 lg:w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-base ${
                  this.spawnWindow ? 'bg-primary' : 'bg-border'
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

            <!-- Terminal Title Mode -->
            <div class="mb-2 sm:mb-4 lg:mb-6 flex items-center justify-between bg-elevated border border-base rounded-lg p-2 sm:p-3 lg:p-4">
              <div class="flex-1 pr-2 sm:pr-3 lg:pr-4">
                <span class="text-primary text-[10px] sm:text-xs lg:text-sm font-medium">Terminal Title Mode</span>
                <p class="text-[9px] sm:text-[10px] lg:text-xs text-muted mt-0.5 hidden sm:block">
                  ${this.getTitleModeDescription()}
                </p>
              </div>
              <div class="relative">
                <select
                  .value=${this.titleMode}
                  @change=${this.handleTitleModeChange}
                  class="bg-secondary border border-base rounded-lg px-1.5 py-1 pr-6 sm:px-2 sm:py-1.5 sm:pr-7 lg:px-3 lg:py-2 lg:pr-8 text-primary text-[10px] sm:text-xs lg:text-sm transition-all duration-200 hover:border-primary-hover focus:border-primary focus:outline-none appearance-none cursor-pointer"
                  style="min-width: 80px"
                  ?disabled=${this.disabled || this.isCreating}
                >
                  <option value="${TitleMode.NONE}" class="bg-secondary text-primary" ?selected=${this.titleMode === TitleMode.NONE}>None</option>
                  <option value="${TitleMode.FILTER}" class="bg-secondary text-primary" ?selected=${this.titleMode === TitleMode.FILTER}>Filter</option>
                  <option value="${TitleMode.STATIC}" class="bg-secondary text-primary" ?selected=${this.titleMode === TitleMode.STATIC}>Static</option>
                  <option value="${TitleMode.DYNAMIC}" class="bg-secondary text-primary" ?selected=${this.titleMode === TitleMode.DYNAMIC}>Dynamic</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 sm:px-1.5 lg:px-2 text-muted">
                  <svg class="h-2.5 w-2.5 sm:h-3 sm:w-3 lg:h-4 lg:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <!-- Quick Start Section -->
            <div class="mb-2 sm:mb-4 lg:mb-6">
              <label class="form-label text-muted uppercase text-[9px] sm:text-[10px] lg:text-xs tracking-wider mb-1 sm:mb-2 lg:mb-3"
                >Quick Start</label
              >
              <div class="grid grid-cols-2 gap-2 sm:gap-2.5 lg:gap-3 mt-1.5 sm:mt-2">
                ${this.quickStartCommands.map(
                  ({ label, command }) => html`
                    <button
                      @click=${() => this.handleQuickStart(command)}
                      class="${
                        this.command === command
                          ? 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-primary bg-opacity-10 border-primary text-primary hover:bg-opacity-20 font-medium text-[10px] sm:text-xs lg:text-sm'
                          : 'px-2 py-1.5 sm:px-3 sm:py-2 lg:px-4 lg:py-3 rounded-lg border text-left transition-all bg-elevated border-base text-primary hover:bg-hover hover:border-primary hover:text-primary text-[10px] sm:text-xs lg:text-sm'
                      }"
                      ?disabled=${this.disabled || this.isCreating}
                    >
                      <span class="hidden sm:inline">${label === 'gemini' ? '✨ ' : ''}${label === 'claude' ? '✨ ' : ''}${
                        label === 'pnpm run dev' ? '▶️ ' : ''
                      }</span><span class="sm:hidden">${label === 'pnpm run dev' ? '▶️ ' : ''}</span>${label}
                    </button>
                  `
                )}
              </div>
            </div>

            <div class="flex gap-1.5 sm:gap-2 lg:gap-3 mt-2 sm:mt-3 lg:mt-4 xl:mt-6">
              <button
                class="flex-1 bg-elevated border border-base text-primary px-2 py-1 sm:px-3 sm:py-1.5 lg:px-4 lg:py-2 xl:px-6 xl:py-3 rounded-lg font-mono text-[10px] sm:text-xs lg:text-sm transition-all duration-200 hover:bg-hover hover:border-light"
                @click=${this.handleCancel}
                ?disabled=${this.isCreating}
              >
                Cancel
              </button>
              <button
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

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

      logger.debug(
        `loading from localStorage: workingDir=${savedWorkingDir}, command=${savedCommand}, spawnWindow=${savedSpawnWindow}, titleMode=${savedTitleMode}`
      );

      if (savedWorkingDir) {
        this.workingDir = savedWorkingDir;
      }
      if (savedCommand) {
        this.command = savedCommand;
      }
      if (savedSpawnWindow !== null) {
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

      logger.debug(
        `saving to localStorage: workingDir=${workingDir}, command=${command}, spawnWindow=${this.spawnWindow}, titleMode=${this.titleMode}`
      );

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
        // Load from localStorage when form becomes visible
        this.loadFromLocalStorage();
        // Add global keyboard listener
        document.addEventListener('keydown', this.handleGlobalKeyDown);
      } else {
        // Remove global keyboard listener when hidden
        document.removeEventListener('keydown', this.handleGlobalKeyDown);
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
        this.saveToLocalStorage();

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

  private handleQuickStart(command: string) {
    this.command = command;
    this.selectedQuickStart = command;

    // Auto-select dynamic mode for Claude
    if (command.toLowerCase().includes('claude')) {
      this.titleMode = TitleMode.DYNAMIC;
    }
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="modal-backdrop flex items-center justify-center">
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-[576px] mx-2 sm:mx-4"
          style="view-transition-name: create-session-modal"
        >
          <div class="p-4 pb-4 mb-3 border-b border-dark-border relative">
            <h2 class="text-accent-green text-lg font-bold">New Session</h2>
            <button
              class="absolute top-4 right-4 text-dark-text-muted hover:text-dark-text transition-colors p-1"
              @click=${this.handleCancel}
              title="Close"
              aria-label="Close modal"
            >
              <svg
                class="w-6 h-6"
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

          <div class="p-3 sm:p-3 lg:p-4">
            <!-- Session Name -->
            <div class="mb-4">
              <label class="form-label">Session Name (Optional):</label>
              <input
                type="text"
                class="input-field"
                .value=${this.sessionName}
                @input=${this.handleSessionNameChange}
                placeholder="My Session"
                ?disabled=${this.disabled || this.isCreating}
              />
            </div>

            <!-- Command -->
            <div class="mb-4">
              <label class="form-label">Command:</label>
              <input
                type="text"
                class="input-field"
                .value=${this.command}
                @input=${this.handleCommandChange}
                placeholder="zsh"
                ?disabled=${this.disabled || this.isCreating}
              />
            </div>

            <!-- Working Directory -->
            <div class="mb-4">
              <label class="form-label">Working Directory:</label>
              <div class="flex gap-4">
                <input
                  type="text"
                  class="input-field"
                  .value=${this.workingDir}
                  @input=${this.handleWorkingDirChange}
                  placeholder="~/"
                  ?disabled=${this.disabled || this.isCreating}
                />
                <button
                  class="btn-secondary font-mono px-4"
                  @click=${this.handleBrowse}
                  ?disabled=${this.disabled || this.isCreating}
                >
                  📁
                </button>
              </div>
            </div>

            <!-- Spawn Window Toggle -->
            <div class="mb-4 flex items-center justify-between">
              <div class="flex-1 pr-4">
                <span class="text-dark-text text-sm">Spawn window</span>
                <p class="text-xs text-dark-text-muted mt-1">Opens native terminal window</p>
              </div>
              <button
                role="switch"
                aria-checked="${this.spawnWindow}"
                @click=${this.handleSpawnWindowChange}
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-green focus:ring-offset-2 focus:ring-offset-dark-bg ${
                  this.spawnWindow ? 'bg-accent-green' : 'bg-dark-border'
                }"
                ?disabled=${this.disabled || this.isCreating}
              >
                <span
                  class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    this.spawnWindow ? 'translate-x-5' : 'translate-x-0.5'
                  }"
                ></span>
              </button>
            </div>

            <!-- Terminal Title Mode -->
            <div class="mb-4 flex items-center justify-between">
              <div class="flex-1 pr-4">
                <span class="text-dark-text text-sm">Terminal Title Mode</span>
                <p class="text-xs text-dark-text-muted mt-1 opacity-50">
                  ${this.getTitleModeDescription()}
                </p>
              </div>
              <div class="relative">
                <select
                  .value=${this.titleMode}
                  @change=${this.handleTitleModeChange}
                  class="bg-[#1a1a1a] border border-dark-border rounded-lg px-3 py-2 pr-8 text-dark-text text-sm transition-all duration-200 hover:border-accent-green-darker focus:border-accent-green focus:outline-none appearance-none cursor-pointer"
                  style="min-width: 140px"
                  ?disabled=${this.disabled || this.isCreating}
                >
                  <option value="${TitleMode.NONE}" class="bg-[#1a1a1a] text-dark-text" ?selected=${this.titleMode === TitleMode.NONE}>None</option>
                  <option value="${TitleMode.FILTER}" class="bg-[#1a1a1a] text-dark-text" ?selected=${this.titleMode === TitleMode.FILTER}>Filter</option>
                  <option value="${TitleMode.STATIC}" class="bg-[#1a1a1a] text-dark-text" ?selected=${this.titleMode === TitleMode.STATIC}>Static</option>
                  <option value="${TitleMode.DYNAMIC}" class="bg-[#1a1a1a] text-dark-text" ?selected=${this.titleMode === TitleMode.DYNAMIC}>Dynamic</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-dark-text-muted">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <!-- Quick Start Section -->
            <div class="mb-4">
              <label class="form-label text-dark-text-muted uppercase text-xs tracking-wider"
                >Quick Start</label
              >
              <div class="grid grid-cols-2 gap-3 mt-2">
                ${this.quickStartCommands.map(
                  ({ label, command }) => html`
                    <button
                      @click=${() => this.handleQuickStart(command)}
                      class="${
                        this.command === command
                          ? 'px-4 py-3 rounded border text-left transition-all bg-accent-green bg-opacity-20 border-accent-green text-accent-green'
                          : 'px-4 py-3 rounded border text-left transition-all bg-dark-border bg-opacity-10 border-dark-border text-dark-text hover:bg-opacity-20 hover:border-dark-text-secondary'
                      }"
                      ?disabled=${this.disabled || this.isCreating}
                    >
                      ${label === 'gemini' ? '✨ ' : ''}${label === 'claude' ? '✨ ' : ''}${
                        label === 'pnpm run dev' ? '▶️ ' : ''
                      }${label}
                    </button>
                  `
                )}
              </div>
            </div>

            <div class="flex gap-4 mt-4">
              <button
                class="btn-ghost font-mono flex-1 py-3"
                @click=${this.handleCancel}
                ?disabled=${this.isCreating}
              >
                Cancel
              </button>
              <button
                class="btn-primary font-mono flex-1 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                @click=${this.handleCreate}
                ?disabled=${
                  this.disabled ||
                  this.isCreating ||
                  !this.workingDir?.trim() ||
                  !this.command?.trim()
                }
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

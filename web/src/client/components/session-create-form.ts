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
  @property({ type: Boolean }) spawnWindow = true;

  @state() private isCreating = false;
  @state() private showFileBrowser = false;
  @state() private selectedQuickStart = 'zsh';

  private quickStartCommands = [
    { label: 'claude', command: 'claude' },
    { label: 'gemini', command: 'gemini' },
    { label: 'zsh', command: 'zsh' },
    { label: 'bash', command: 'bash' },
    { label: 'python3', command: 'python3' },
    { label: 'node', command: 'node' },
    { label: 'pnpm run dev', command: 'pnpm run dev' },
  ];

  private readonly STORAGE_KEY_WORKING_DIR = 'vibetunnel_last_working_dir';
  private readonly STORAGE_KEY_COMMAND = 'vibetunnel_last_command';
  private readonly STORAGE_KEY_SPAWN_WINDOW = 'vibetunnel_spawn_window';

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
        !this.disabled && !this.isCreating && this.workingDir.trim() && this.command.trim();

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

      logger.debug(
        `loading from localStorage: workingDir=${savedWorkingDir}, command=${savedCommand}, spawnWindow=${savedSpawnWindow}`
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

      // Force re-render to update the input values
      this.requestUpdate();
    } catch (_error) {
      logger.warn('failed to load from localStorage');
    }
  }

  private saveToLocalStorage() {
    try {
      const workingDir = this.workingDir.trim();
      const command = this.command.trim();

      logger.debug(
        `saving to localStorage: workingDir=${workingDir}, command=${command}, spawnWindow=${this.spawnWindow}`
      );

      // Only save non-empty values
      if (workingDir) {
        localStorage.setItem(this.STORAGE_KEY_WORKING_DIR, workingDir);
      }
      if (command) {
        localStorage.setItem(this.STORAGE_KEY_COMMAND, command);
      }
      localStorage.setItem(this.STORAGE_KEY_SPAWN_WINDOW, String(this.spawnWindow));
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
  }

  private handleSessionNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.sessionName = input.value;
  }

  private handleSpawnWindowChange() {
    this.spawnWindow = !this.spawnWindow;
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
    if (!this.workingDir.trim() || !this.command.trim()) {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: 'Please fill in both working directory and command',
        })
      );
      return;
    }

    this.isCreating = true;

    // Use conservative defaults that work well across devices
    // The terminal will auto-resize to fit the actual container after creation
    const terminalCols = 120;
    const terminalRows = 30;

    const sessionData: SessionCreateData = {
      command: this.parseCommand(this.command.trim()),
      workingDir: this.workingDir.trim(),
      spawn_terminal: this.spawnWindow,
      cols: terminalCols,
      rows: terminalRows,
    };

    // Add session name if provided
    if (this.sessionName.trim()) {
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
                      class="px-4 py-3 rounded border text-left transition-all
                        ${
                          this.command === command
                            ? 'bg-accent-green bg-opacity-20 border-accent-green text-accent-green'
                            : 'bg-dark-border bg-opacity-10 border-dark-border text-dark-text hover:bg-opacity-20 hover:border-dark-text-secondary'
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
                  !this.workingDir.trim() ||
                  !this.command.trim()
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

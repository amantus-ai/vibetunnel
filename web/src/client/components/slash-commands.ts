/**
 * Slash Commands Component
 *
 * Provides quick access to Claude Code slash commands with:
 * - Categorized command list
 * - Search/filter functionality
 * - Command descriptions and examples
 * - Mobile-optimized interface
 * - Touch-friendly buttons (44px minimum)
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { detectMobile } from '../utils/mobile-utils.js';
import './modal-wrapper.js';

const logger = createLogger('slash-commands');

interface SlashCommand {
  id: string;
  command: string;
  title: string;
  description: string;
  category: 'project' | 'files' | 'git' | 'development' | 'ai' | 'system';
  example?: string;
  requiresInput?: boolean;
  inputPlaceholder?: string;
}

export interface SlashCommandsCallbacks {
  onExecuteCommand?: (command: string) => void;
  onSendInput?: (text: string) => void;
}

@customElement('slash-commands')
export class SlashCommands extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) session: Session | null = null;
  @property({ type: Object }) callbacks: SlashCommandsCallbacks | null = null;

  @state() private searchQuery = '';
  @state() private selectedCategory: string = 'all';
  @state() private filteredCommands: SlashCommand[] = [];
  @state() private showCommandInput = false;
  @state() private selectedCommand: SlashCommand | null = null;
  @state() private commandInput = '';
  @state() private isMobile = detectMobile();

  private searchInputRef: HTMLInputElement | null = null;
  private commandInputRef: HTMLInputElement | null = null;

  private readonly slashCommands: SlashCommand[] = [
    // Project commands
    {
      id: 'project-overview',
      command: '/overview',
      title: 'Project Overview',
      description: 'Get an overview of the current project structure',
      category: 'project',
      example: '/overview',
    },
    {
      id: 'project-status',
      command: '/status',
      title: 'Project Status',
      description: 'Show current project status and recent changes',
      category: 'project',
      example: '/status',
    },
    {
      id: 'project-plan',
      command: '/plan',
      title: 'Create Plan',
      description: 'Create a development plan for a feature or change',
      category: 'project',
      example: '/plan Add user authentication',
      requiresInput: true,
      inputPlaceholder: 'Describe what you want to plan...',
    },

    // File commands
    {
      id: 'file-read',
      command: '/read',
      title: 'Read File',
      description: 'Read and analyze a specific file',
      category: 'files',
      example: '/read src/main.ts',
      requiresInput: true,
      inputPlaceholder: 'Enter file path to read...',
    },
    {
      id: 'file-edit',
      command: '/edit',
      title: 'Edit File',
      description: 'Edit a file with specific instructions',
      category: 'files',
      example: '/edit src/utils.ts Add error handling',
      requiresInput: true,
      inputPlaceholder: 'File path and instructions...',
    },
    {
      id: 'file-create',
      command: '/create',
      title: 'Create File',
      description: 'Create a new file with specified content',
      category: 'files',
      example: '/create src/types.ts with TypeScript interfaces',
      requiresInput: true,
      inputPlaceholder: 'File path and description...',
    },
    {
      id: 'file-search',
      command: '/search',
      title: 'Search Files',
      description: 'Search for content across project files',
      category: 'files',
      example: '/search function calculateTotal',
      requiresInput: true,
      inputPlaceholder: 'Search term or pattern...',
    },

    // Git commands
    {
      id: 'git-status',
      command: '/git-status',
      title: 'Git Status',
      description: 'Show current git status and changes',
      category: 'git',
      example: '/git-status',
    },
    {
      id: 'git-commit',
      command: '/commit',
      title: 'Git Commit',
      description: 'Create a git commit with AI-generated message',
      category: 'git',
      example: '/commit',
      requiresInput: true,
      inputPlaceholder: 'Optional commit message or description...',
    },
    {
      id: 'git-diff',
      command: '/diff',
      title: 'Git Diff',
      description: 'Show and explain git diff for current changes',
      category: 'git',
      example: '/diff',
    },

    // Development commands
    {
      id: 'dev-test',
      command: '/test',
      title: 'Run Tests',
      description: 'Run tests and analyze results',
      category: 'development',
      example: '/test',
      requiresInput: true,
      inputPlaceholder: 'Optional test pattern or file...',
    },
    {
      id: 'dev-build',
      command: '/build',
      title: 'Build Project',
      description: 'Build the project and handle any issues',
      category: 'development',
      example: '/build',
    },
    {
      id: 'dev-lint',
      command: '/lint',
      title: 'Lint Code',
      description: 'Run linter and fix code quality issues',
      category: 'development',
      example: '/lint',
    },
    {
      id: 'dev-debug',
      command: '/debug',
      title: 'Debug Issue',
      description: 'Help debug a specific issue or error',
      category: 'development',
      example: '/debug TypeError in user validation',
      requiresInput: true,
      inputPlaceholder: 'Describe the issue or error...',
    },

    // AI commands
    {
      id: 'ai-explain',
      command: '/explain',
      title: 'Explain Code',
      description: 'Explain how specific code works',
      category: 'ai',
      example: '/explain this function',
      requiresInput: true,
      inputPlaceholder: 'What do you want explained?',
    },
    {
      id: 'ai-refactor',
      command: '/refactor',
      title: 'Refactor Code',
      description: 'Refactor code with specific improvements',
      category: 'ai',
      example: '/refactor to use async/await',
      requiresInput: true,
      inputPlaceholder: 'How should the code be refactored?',
    },
    {
      id: 'ai-optimize',
      command: '/optimize',
      title: 'Optimize Code',
      description: 'Optimize code for performance or readability',
      category: 'ai',
      example: '/optimize for performance',
      requiresInput: true,
      inputPlaceholder: 'What kind of optimization?',
    },

    // System commands
    {
      id: 'system-help',
      command: '/help',
      title: 'Help',
      description: 'Show available commands and help',
      category: 'system',
      example: '/help',
    },
    {
      id: 'system-clear',
      command: '/clear',
      title: 'Clear Screen',
      description: 'Clear the terminal screen',
      category: 'system',
      example: '/clear',
    },
    {
      id: 'system-reset',
      command: '/reset',
      title: 'Reset Session',
      description: "Reset Claude's context for this session",
      category: 'system',
      example: '/reset',
    },
  ];

  private readonly categories = [
    { id: 'all', name: 'All Commands', icon: '⚡' },
    { id: 'project', name: 'Project', icon: '📁' },
    { id: 'files', name: 'Files', icon: '📄' },
    { id: 'git', name: 'Git', icon: '🔄' },
    { id: 'development', name: 'Development', icon: '🛠️' },
    { id: 'ai', name: 'AI', icon: '🤖' },
    { id: 'system', name: 'System', icon: '⚙️' },
  ];

  connectedCallback() {
    super.connectedCallback();
    this.updateFilteredCommands();
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('visible')) {
      if (this.visible) {
        // Focus search input when opening
        requestAnimationFrame(() => {
          this.searchInputRef?.focus();
        });
      } else {
        // Reset state when closing
        this.searchQuery = '';
        this.selectedCategory = 'all';
        this.showCommandInput = false;
        this.selectedCommand = null;
        this.commandInput = '';
        this.updateFilteredCommands();
      }
    }

    if (changedProperties.has('showCommandInput') && this.showCommandInput) {
      // Focus command input when showing it
      requestAnimationFrame(() => {
        this.commandInputRef?.focus();
      });
    }

    if (changedProperties.has('searchQuery') || changedProperties.has('selectedCategory')) {
      this.updateFilteredCommands();
    }
  }

  private updateFilteredCommands() {
    let commands = this.slashCommands;

    // Filter by category
    if (this.selectedCategory !== 'all') {
      commands = commands.filter((cmd) => cmd.category === this.selectedCategory);
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      commands = commands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query) ||
          cmd.command.toLowerCase().includes(query) ||
          cmd.category.toLowerCase().includes(query)
      );
    }

    this.filteredCommands = commands;
  }

  private handleSearchInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.searchQuery = input.value;
  }

  private handleCategorySelect(categoryId: string) {
    this.selectedCategory = categoryId;
  }

  private handleCommandClick(command: SlashCommand) {
    if (command.requiresInput) {
      this.selectedCommand = command;
      this.showCommandInput = true;
      this.commandInput = '';
    } else {
      this.executeCommand(command.command);
    }
  }

  private handleCommandInputSubmit() {
    if (!this.selectedCommand) return;

    let fullCommand = this.selectedCommand.command;
    if (this.commandInput.trim()) {
      fullCommand += ` ${this.commandInput.trim()}`;
    }

    this.executeCommand(fullCommand);
  }

  private executeCommand(command: string) {
    logger.debug(`Executing slash command: ${command}`);

    if (this.callbacks?.onSendInput) {
      this.callbacks.onSendInput(command);
    }

    this.handleClose();
  }

  private handleBackFromInput() {
    this.showCommandInput = false;
    this.selectedCommand = null;
    this.commandInput = '';
  }

  private handleClose() {
    this.visible = false;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private getCategoryColor(category: string): string {
    const colors = {
      project: 'text-blue-400',
      files: 'text-green-400',
      git: 'text-orange-400',
      development: 'text-purple-400',
      ai: 'text-cyan-400',
      system: 'text-gray-400',
    };
    return colors[category as keyof typeof colors] || 'text-gray-400';
  }

  render() {
    // If not visible, return empty to avoid any rendering
    if (!this.visible) {
      return html``;
    }

    return html`
      <modal-wrapper
        .visible=${this.visible}
        .closeOnBackdrop=${true}
        .closeOnEscape=${true}
        .contentClass=${`slash-commands-modal font-ui text-sm w-full max-w-[90vw] sm:max-w-3xl ${this.isMobile ? 'max-h-[70vh]' : 'max-h-[80vh]'}`}
        ariaLabel="Slash Commands"
        style="z-index: 1050;"
        @close=${this.handleClose}
      >
        <div class="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden" style="margin-bottom: 100px;">
          ${
            !this.showCommandInput
              ? html`
            <!-- Main command list view -->
            <!-- Header with search -->
            <div class="border-b border-border bg-bg-secondary">
              <div class="flex items-center gap-3 p-4">
                <div class="flex-shrink-0 text-primary">
                  <span class="text-xl">/</span>
                </div>
                <input
                  type="text"
                  placeholder="Search slash commands..."
                  class="flex-1 bg-transparent border-none outline-none text-text placeholder-text-muted text-base"
                  .value=${this.searchQuery}
                  @input=${this.handleSearchInput}
                  @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
                  ${(el: HTMLInputElement) => {
                    this.searchInputRef = el;
                  }}
                />
                ${
                  this.searchQuery
                    ? html`
                  <button
                    class="flex-shrink-0 p-1 text-text-muted hover:text-text transition-colors"
                    @click=${() => {
                      this.searchQuery = '';
                      this.searchInputRef?.focus();
                    }}
                    title="Clear search"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                    </svg>
                  </button>
                `
                    : ''
                }
                <button
                  class="flex-shrink-0 p-2 text-text-muted hover:text-text transition-colors"
                  @click=${this.handleClose}
                  title="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
              
              <!-- Category tabs -->
              <div class="flex items-center gap-2 px-4 pb-3 overflow-x-auto">
                ${this.categories.map(
                  (category) => html`
                  <button
                    class="flex-shrink-0 px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${
                      this.selectedCategory === category.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-bg-tertiary hover:bg-surface-hover text-text-muted hover:text-text'
                    }"
                    @click=${() => this.handleCategorySelect(category.id)}
                  >
                    <span>${category.icon}</span>
                    <span>${category.name}</span>
                    ${
                      category.id !== 'all'
                        ? html`
                      <span class="bg-bg/20 text-xs px-1.5 py-0.5 rounded-full">
                        ${this.slashCommands.filter((cmd) => cmd.category === category.id).length}
                      </span>
                    `
                        : ''
                    }
                  </button>
                `
                )}
              </div>
            </div>
            
            <!-- Commands list -->
            <div class="max-h-96 overflow-y-auto">
              ${
                this.filteredCommands.length > 0
                  ? html`
                <div class="p-4 space-y-2">
                  ${this.filteredCommands.map(
                    (command) => html`
                    <button
                      class="w-full text-left p-4 hover:bg-surface-hover transition-colors rounded-lg border border-transparent hover:border-border/50 group"
                      @click=${() => this.handleCommandClick(command)}
                    >
                      <div class="flex items-start justify-between gap-4">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-3 mb-2">
                            <code class="bg-bg-tertiary px-2 py-1 rounded text-primary font-ui text-sm">
                              ${command.command}
                            </code>
                            <span class="text-xs ${this.getCategoryColor(command.category)} opacity-75">
                              ${this.categories.find((c) => c.id === command.category)?.icon || '•'}
                            </span>
                            ${
                              command.requiresInput
                                ? html`
                              <span class="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                                requires input
                              </span>
                            `
                                : ''
                            }
                          </div>
                          <h3 class="font-medium text-text mb-1">${command.title}</h3>
                          <p class="text-sm text-text-muted leading-relaxed mb-2">
                            ${command.description}
                          </p>
                          ${
                            command.example
                              ? html`
                            <code class="text-xs text-text-muted bg-bg-tertiary px-2 py-1 rounded border">
                              ${command.example}
                            </code>
                          `
                              : ''
                          }
                        </div>
                        
                        <div class="flex-shrink-0 text-text-muted group-hover:text-primary transition-colors">
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
                          </svg>
                        </div>
                      </div>
                    </button>
                  `
                  )}
                </div>
              `
                  : html`
                <div class="p-8 text-center text-text-muted">
                  <div class="text-4xl mb-4 opacity-50">/</div>
                  <p class="text-lg font-medium mb-2">No commands found</p>
                  <p class="text-sm">Try a different search term or category</p>
                </div>
              `
              }
            </div>
          `
              : html`
            <!-- Command input view -->
            <div class="border-b border-border bg-bg-secondary">
              <div class="flex items-center gap-3 p-4">
                <button
                  class="flex-shrink-0 p-1 text-text-muted hover:text-text transition-colors"
                  @click=${this.handleBackFromInput}
                  title="Back to commands"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
                  </svg>
                </button>
                <div class="flex-1">
                  <h2 class="text-lg font-semibold text-text">${this.selectedCommand?.title}</h2>
                  <p class="text-sm text-text-muted">${this.selectedCommand?.description}</p>
                </div>
                <button
                  class="flex-shrink-0 p-2 text-text-muted hover:text-text transition-colors"
                  @click=${this.handleClose}
                  title="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
            
            <div class="p-4">
              <div class="mb-4">
                <label class="block text-sm font-medium text-text mb-2">
                  Command: <code class="text-primary">${this.selectedCommand?.command}</code>
                </label>
                <div class="relative">
                  <input
                    type="text"
                    placeholder="${this.selectedCommand?.inputPlaceholder || 'Enter additional parameters...'}"
                    class="w-full bg-bg-secondary border border-border rounded-lg px-4 py-3 text-text placeholder-text-muted focus:border-primary focus:outline-none"
                    .value=${this.commandInput}
                    @input=${(e: Event) => {
                      this.commandInput = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        this.handleCommandInputSubmit();
                      }
                    }}
                    ${(el: HTMLInputElement) => {
                      this.commandInputRef = el;
                    }}
                  />
                </div>
              </div>
              
              ${
                this.selectedCommand?.example
                  ? html`
                <div class="mb-4 p-3 bg-bg-tertiary rounded-lg border border-border">
                  <p class="text-xs text-text-muted mb-2">Example:</p>
                  <code class="text-sm text-text">${this.selectedCommand.example}</code>
                </div>
              `
                  : ''
              }
              
              <div class="flex items-center justify-between gap-3">
                <button
                  class="px-4 py-2 text-sm border border-border rounded-lg hover:bg-surface-hover transition-colors"
                  @click=${this.handleBackFromInput}
                >
                  Cancel
                </button>
                <button
                  class="px-6 py-2 bg-primary hover:bg-primary-hover text-primary-foreground font-medium rounded-lg transition-colors flex items-center gap-2"
                  @click=${this.handleCommandInputSubmit}
                >
                  <span>Execute Command</span>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
          `
          }
        </div>
      </modal-wrapper>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'slash-commands': SlashCommands;
  }
}

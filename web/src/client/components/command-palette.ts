/**
 * Command Palette Component
 *
 * A unified command palette for mobile and desktop that provides quick access to:
 * - Claude Code modes (plan mode, auto-accept, normal)
 * - Clipboard operations (paste, paste from history)
 * - Slash commands
 * - Session management
 * - File operations
 * - Terminal settings
 *
 * Designed with mobile-first approach following UX best practices:
 * - Touch-friendly targets (44px minimum)
 * - Search/filter functionality
 * - Keyboard navigation support
 * - Responsive design
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { detectMobile } from '../utils/mobile-utils.js';
import './modal-wrapper.js';

const logger = createLogger('command-palette');

export interface CommandPaletteCallbacks {
  // Claude Code mode controls
  onTogglePlanMode?: () => void;
  onToggleAutoAccept?: () => void;
  onToggleNormalMode?: () => void;

  // Clipboard operations
  onPasteFromClipboard?: () => void;
  onShowClipboardHistory?: () => void;

  // Slash commands
  onShowSlashCommands?: () => void;
  onExecuteSlashCommand?: (command: string) => void;

  // Session management
  onCreateSession?: () => void;
  onTerminateSession?: () => void;
  onClearSession?: () => void;

  // File operations
  onOpenFileBrowser?: () => void;
  onUploadFile?: () => void;
  onUploadImage?: () => void;

  // Terminal settings
  onOpenTerminalSettings?: () => void;
  onToggleTheme?: () => void;

  // Navigation
  onNavigateBack?: () => void;
  onToggleSidebar?: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'claude' | 'clipboard' | 'commands' | 'session' | 'files' | 'terminal' | 'navigation';
  action: keyof CommandPaletteCallbacks;
  shortcut?: string;
  enabled?: boolean;
  highlight?: boolean;
}

@customElement('command-palette')
export class CommandPalette extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) session: Session | null = null;
  @property({ type: Object }) callbacks: CommandPaletteCallbacks | null = null;
  @property({ type: String }) currentMode: 'normal' | 'plan' | 'auto-accept' = 'normal';
  @property({ type: Boolean }) planModeActive = false;
  @property({ type: Boolean }) autoAcceptActive = false;

  @state() private searchQuery = '';
  @state() private selectedIndex = 0;
  @state() private filteredCommands: CommandItem[] = [];
  @state() private isMobile = detectMobile();

  private searchInputRef: HTMLInputElement | null = null;

  private readonly commands: CommandItem[] = [
    // Claude Code modes
    {
      id: 'claude-plan-mode',
      title: 'Plan Mode',
      description: 'Let Claude plan before executing changes',
      icon: '📋',
      category: 'claude',
      action: 'onTogglePlanMode',
      shortcut: 'Ctrl+P',
      highlight: true,
    },
    {
      id: 'claude-auto-accept',
      title: 'Auto Accept',
      description: "Automatically accept Claude's edits",
      icon: '⚡',
      category: 'claude',
      action: 'onToggleAutoAccept',
      shortcut: 'Ctrl+A',
    },
    {
      id: 'claude-normal-mode',
      title: 'Normal Mode',
      description: 'Standard Claude interaction mode',
      icon: '💬',
      category: 'claude',
      action: 'onToggleNormalMode',
    },

    // Clipboard operations
    {
      id: 'paste-clipboard',
      title: 'Paste from Clipboard',
      description: 'Paste current clipboard content',
      icon: '📋',
      category: 'clipboard',
      action: 'onPasteFromClipboard',
      shortcut: 'Ctrl+V',
      highlight: true,
    },
    {
      id: 'clipboard-history',
      title: 'Clipboard History',
      description: 'View and select from clipboard history',
      icon: '📝',
      category: 'clipboard',
      action: 'onShowClipboardHistory',
    },

    // Slash commands
    {
      id: 'slash-commands',
      title: 'Slash Commands',
      description: 'Access Claude Code slash commands',
      icon: '/',
      category: 'commands',
      action: 'onShowSlashCommands',
      shortcut: '/',
      highlight: true,
    },

    // Session management
    {
      id: 'new-session',
      title: 'New Session',
      description: 'Create a new terminal session',
      icon: '➕',
      category: 'session',
      action: 'onCreateSession',
      shortcut: 'Ctrl+N',
    },
    {
      id: 'terminate-session',
      title: 'Terminate Session',
      description: 'End the current session',
      icon: '🛑',
      category: 'session',
      action: 'onTerminateSession',
      enabled: false, // Will be enabled based on session status
    },
    {
      id: 'clear-session',
      title: 'Clear Session',
      description: 'Clear session output',
      icon: '🧹',
      category: 'session',
      action: 'onClearSession',
    },

    // File operations
    {
      id: 'browse-files',
      title: 'Browse Files',
      description: 'Open file browser',
      icon: '📁',
      category: 'files',
      action: 'onOpenFileBrowser',
      shortcut: 'Ctrl+O',
    },
    {
      id: 'upload-file',
      title: 'Upload File',
      description: 'Upload a file to the session',
      icon: '📤',
      category: 'files',
      action: 'onUploadFile',
    },
    {
      id: 'upload-image',
      title: 'Upload Image',
      description: 'Upload an image for analysis',
      icon: '🖼️',
      category: 'files',
      action: 'onUploadImage',
    },

    // Terminal settings
    {
      id: 'terminal-settings',
      title: 'Terminal Settings',
      description: 'Configure terminal appearance',
      icon: '⚙️',
      category: 'terminal',
      action: 'onOpenTerminalSettings',
    },
    {
      id: 'toggle-theme',
      title: 'Toggle Theme',
      description: 'Switch between light/dark theme',
      icon: '🌓',
      category: 'terminal',
      action: 'onToggleTheme',
      shortcut: 'Ctrl+T',
    },

    // Navigation
    {
      id: 'toggle-sidebar',
      title: 'Toggle Sidebar',
      description: 'Show/hide session sidebar',
      icon: '📋',
      category: 'navigation',
      action: 'onToggleSidebar',
      shortcut: 'Ctrl+B',
    },
    {
      id: 'go-back',
      title: 'Go Back',
      description: 'Return to session list',
      icon: '⬅️',
      category: 'navigation',
      action: 'onNavigateBack',
      shortcut: 'Esc',
    },
  ];

  connectedCallback() {
    super.connectedCallback();
    this.updateFilteredCommands();

    // Add global keyboard listeners
    document.addEventListener('keydown', this.handleGlobalKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleGlobalKeyDown);
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('visible')) {
      if (this.visible) {
        // Focus search input when palette opens
        requestAnimationFrame(() => {
          this.searchInputRef?.focus();
        });
      } else {
        // Reset state when closing
        this.searchQuery = '';
        this.selectedIndex = 0;
        this.updateFilteredCommands();
      }
    }

    if (changedProperties.has('session')) {
      this.updateCommandStates();
    }

    if (changedProperties.has('searchQuery')) {
      this.updateFilteredCommands();
      this.selectedIndex = 0; // Reset selection when search changes
    }
  }

  private updateCommandStates() {
    // Update command enabled states based on session status
    const terminateCommand = this.commands.find((cmd) => cmd.id === 'terminate-session');
    if (terminateCommand) {
      terminateCommand.enabled = this.session?.status === 'running';
    }
  }

  private updateFilteredCommands() {
    const query = this.searchQuery.toLowerCase().trim();

    if (!query) {
      this.filteredCommands = [...this.commands];
    } else {
      this.filteredCommands = this.commands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query) ||
          cmd.category.toLowerCase().includes(query) ||
          cmd.shortcut?.toLowerCase().includes(query)
      );
    }

    // Ensure selectedIndex is within bounds
    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = Math.max(0, this.filteredCommands.length - 1);
    }
  }

  private handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Open command palette with Ctrl+Shift+P (or Cmd+Shift+P on Mac)
    if (e.key === 'P' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.visible = !this.visible;
      return;
    }

    // Handle keyboard navigation when visible
    if (!this.visible) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.handleClose();
        break;

      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
        this.scrollSelectedIntoView();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.scrollSelectedIntoView();
        break;

      case 'Enter':
        e.preventDefault();
        this.executeSelectedCommand();
        break;
    }
  };

  private scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const selectedElement = this.querySelector(`[data-command-index="${this.selectedIndex}"]`);
      selectedElement?.scrollIntoView({ block: 'nearest' });
    });
  }

  private handleSearchInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.searchQuery = input.value;
  }

  private handleCommandClick(_command: CommandItem, index: number) {
    this.selectedIndex = index;
    this.executeSelectedCommand();
  }

  private executeSelectedCommand() {
    const command = this.filteredCommands[this.selectedIndex];
    if (!command || command.enabled === false) return;

    logger.debug(`Executing command: ${command.id}`);

    // Execute the command callback
    const callback = this.callbacks?.[command.action];
    if (callback && typeof callback === 'function') {
      (callback as () => void)();
    }

    // Close palette after execution
    this.handleClose();
  }

  private handleClose() {
    this.visible = false;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private getCategoryIcon(category: string): string {
    const icons = {
      claude: '🤖',
      clipboard: '📋',
      commands: '⚡',
      session: '💻',
      files: '📁',
      terminal: '⚙️',
      navigation: '🧭',
    };
    return icons[category as keyof typeof icons] || '•';
  }

  private getCategoryColor(category: string): string {
    const colors = {
      claude: 'text-blue-400',
      clipboard: 'text-green-400',
      commands: 'text-yellow-400',
      session: 'text-purple-400',
      files: 'text-orange-400',
      terminal: 'text-gray-400',
      navigation: 'text-cyan-400',
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
        .contentClass=${`command-palette-modal font-ui text-sm w-full max-w-[90vw] sm:max-w-2xl ${this.isMobile ? 'max-h-[70vh]' : 'max-h-[70vh]'}`}
        .modalClass="command-palette-backdrop" 
        style="z-index: 1050;"
        ariaLabel="Command Palette"
        @close=${this.handleClose}
      >
        <div class="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden" style="margin-bottom: 100px;">
          <!-- Header with search -->
          <div class="border-b border-border bg-bg-secondary">
            <div class="flex items-center gap-3 p-4">
              <div class="flex-shrink-0 text-primary">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
                </svg>
              </div>
              <input
                type="text"
                placeholder="${this.isMobile ? 'Search commands...' : 'Search commands... (Ctrl+Shift+P)'}"
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
            </div>
          </div>
          
          <!-- Command list -->
          <div class="max-h-96 overflow-y-auto">
            ${
              this.filteredCommands.length > 0
                ? html`
              ${this.filteredCommands.map(
                (command, index) => html`
                <button
                  class="w-full text-left p-4 hover:bg-surface-hover transition-colors flex items-center gap-4 ${index === this.selectedIndex ? 'bg-surface-hover border-l-2 border-primary' : ''} ${command.enabled === false ? 'opacity-50 cursor-not-allowed' : ''}"
                  @click=${() => this.handleCommandClick(command, index)}
                  data-command-index="${index}"
                  ?disabled=${command.enabled === false}
                >
                  <!-- Icon and category -->
                  <div class="flex-shrink-0 flex flex-col items-center gap-1">
                    <span class="text-xl">${command.icon}</span>
                    <span class="text-xs ${this.getCategoryColor(command.category)} opacity-75">
                      ${this.getCategoryIcon(command.category)}
                    </span>
                  </div>
                  
                  <!-- Command info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-baseline justify-between gap-2">
                      <h3 class="font-medium text-text truncate ${command.highlight ? 'text-primary' : ''}">
                        ${command.title}
                      </h3>
                      ${
                        command.shortcut
                          ? html`
                        <kbd class="hidden sm:inline-block px-2 py-1 text-xs bg-bg-tertiary border border-border rounded text-text-muted font-ui">
                          ${command.shortcut}
                        </kbd>
                      `
                          : ''
                      }
                    </div>
                    <p class="text-sm text-text-muted mt-1 leading-tight">
                      ${command.description}
                    </p>
                  </div>
                  
                  <!-- Selection indicator -->
                  ${
                    index === this.selectedIndex
                      ? html`
                    <div class="flex-shrink-0 text-primary">
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
                      </svg>
                    </div>
                  `
                      : ''
                  }
                </button>
              `
              )}
            `
                : html`
              <div class="p-8 text-center text-text-muted">
                <svg width="48" height="48" viewBox="0 0 20 20" fill="currentColor" class="mx-auto mb-4 opacity-50">
                  <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
                </svg>
                <p class="text-lg font-medium mb-2">No commands found</p>
                <p class="text-sm">Try a different search term</p>
              </div>
            `
            }
          </div>
          
          <!-- Footer with help -->
          <div class="border-t border-border bg-bg-secondary px-4 py-3">
            <div class="flex items-center justify-between text-xs text-text-muted">
              <div class="flex items-center gap-4">
                <span class="hidden sm:inline">↑↓ Navigate</span>
                <span class="hidden sm:inline">↵ Execute</span>
                <span class="hidden sm:inline">Esc Close</span>
              </div>
              <span>${this.filteredCommands.length} commands</span>
            </div>
          </div>
        </div>
      </modal-wrapper>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'command-palette': CommandPalette;
  }
}

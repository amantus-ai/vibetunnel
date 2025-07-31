import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../utils/constants.js';

// Terminal-specific quick keys for mobile use
const TERMINAL_QUICK_KEYS = [
  // First row
  { key: 'Escape', label: 'Esc', row: 1 },
  { key: 'Control', label: 'Ctrl', modifier: true, row: 1 },
  { key: 'CtrlExpand', label: '⌃', toggle: true, row: 1 },
  { key: 'F', label: 'F', toggle: true, row: 1 },
  { key: 'Tab', label: 'Tab', row: 1 },
  { key: 'shift_tab', label: '⇤', row: 1 },
  { key: 'ArrowUp', label: '↑', arrow: true, row: 1 },
  { key: 'ArrowDown', label: '↓', arrow: true, row: 1 },
  { key: 'ArrowLeft', label: '←', arrow: true, row: 1 },
  { key: 'ArrowRight', label: '→', arrow: true, row: 1 },
  { key: 'PageUp', label: 'PgUp', row: 1 },
  { key: 'PageDown', label: 'PgDn', row: 1 },
  // Second row
  { key: 'Home', label: 'Home', row: 2 },
  { key: 'Paste', label: 'Paste', row: 2 },
  { key: 'End', label: 'End', row: 2 },
  { key: 'Delete', label: 'Del', row: 2 },
  { key: '`', label: '`', row: 2 },
  { key: '~', label: '~', row: 2 },
  { key: '|', label: '|', row: 2 },
  { key: '/', label: '/', row: 2 },
  { key: '\\', label: '\\', row: 2 },
  { key: '-', label: '-', row: 2 },
  // Third row - additional special characters
  { key: 'Option', label: '⌥', modifier: true, row: 3 },
  { key: 'Command', label: '⌘', modifier: true, row: 3 },
  { key: 'Ctrl+C', label: '^C', combo: true, row: 3 },
  { key: 'Ctrl+Z', label: '^Z', combo: true, row: 3 },
  { key: "'", label: "'", row: 3 },
  { key: '"', label: '"', row: 3 },
  { key: '{', label: '{', row: 3 },
  { key: '}', label: '}', row: 3 },
  { key: '[', label: '[', row: 3 },
  { key: ']', label: ']', row: 3 },
  { key: '(', label: '(', row: 3 },
  { key: ')', label: ')', row: 3 },
];

// Common Ctrl key combinations
const CTRL_SHORTCUTS = [
  { key: 'Ctrl+D', label: '^D', combo: true, description: 'EOF/logout' },
  { key: 'Ctrl+L', label: '^L', combo: true, description: 'Clear screen' },
  { key: 'Ctrl+R', label: '^R', combo: true, description: 'Reverse search' },
  { key: 'Ctrl+W', label: '^W', combo: true, description: 'Delete word' },
  { key: 'Ctrl+U', label: '^U', combo: true, description: 'Clear line' },
  { key: 'Ctrl+A', label: '^A', combo: true, description: 'Start of line' },
  { key: 'Ctrl+E', label: '^E', combo: true, description: 'End of line' },
  { key: 'Ctrl+K', label: '^K', combo: true, description: 'Kill to EOL' },
  { key: 'CtrlFull', label: 'Ctrl…', special: true, description: 'Full Ctrl UI' },
];

// Function keys F1-F12
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => ({
  key: `F${i + 1}`,
  label: `F${i + 1}`,
  func: true,
}));

// Done button - always visible
const DONE_BUTTON = { key: 'Done', label: 'Done', special: true };

@customElement('terminal-quick-keys')
export class TerminalQuickKeys extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Function }) onKeyPress?: (
    key: string,
    isModifier?: boolean,
    isSpecial?: boolean,
    isToggle?: boolean,
    pasteText?: string
  ) => void;
  @property({ type: Boolean }) visible = false;

  @state() private showFunctionKeys = false;
  @state() private showCtrlKeys = false;
  @state() private isLandscape = false;

  private keyRepeatInterval: number | null = null;
  private keyRepeatTimeout: number | null = null;
  private orientationHandler: (() => void) | null = null;

  // Chord system state
  private activeModifiers = new Set<string>();

  connectedCallback() {
    super.connectedCallback();
    // Check orientation on mount
    this.checkOrientation();

    // Set up orientation change listener
    this.orientationHandler = () => {
      this.checkOrientation();
    };

    window.addEventListener('resize', this.orientationHandler);
    window.addEventListener('orientationchange', this.orientationHandler);
  }

  private checkOrientation() {
    // Consider landscape if width is greater than height
    // and width is more than 600px (typical phone landscape width)
    this.isLandscape = window.innerWidth > window.innerHeight && window.innerWidth > 600;
  }

  private getButtonSizeClass(_label: string): string {
    // Use minimal padding to fit more buttons
    return this.isLandscape ? 'px-0.5 py-1' : 'px-1 py-1.5';
  }

  private getButtonFontClass(label: string): string {
    if (label.length >= 4) {
      return 'quick-key-btn-xs'; // 8px
    } else if (label.length === 3) {
      return 'quick-key-btn-small'; // 10px
    } else {
      return 'quick-key-btn-medium'; // 13px
    }
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
  }

  private handleKeyPress(
    key: string,
    isModifier = false,
    isSpecial = false,
    isToggle = false,
    event?: Event
  ) {
    // Prevent default to avoid any focus loss
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isToggle && key === 'F') {
      // Toggle function keys display
      this.showFunctionKeys = !this.showFunctionKeys;
      this.showCtrlKeys = false; // Hide Ctrl keys if showing
      return;
    }

    if (isToggle && key === 'CtrlExpand') {
      // Toggle Ctrl shortcuts display
      this.showCtrlKeys = !this.showCtrlKeys;
      this.showFunctionKeys = false; // Hide function keys if showing
      return;
    }

    // If we're showing function keys and a function key is pressed, hide them
    if (this.showFunctionKeys && key.startsWith('F') && key !== 'F') {
      this.showFunctionKeys = false;
    }

    // If we're showing Ctrl keys and a Ctrl shortcut is pressed (not CtrlFull), hide them
    if (this.showCtrlKeys && key.startsWith('Ctrl+')) {
      this.showCtrlKeys = false;
    }

    // Handle modifier keys for chord system
    if (isModifier && key === 'Option') {
      // If Option is already active, clear it
      if (this.activeModifiers.has('Option')) {
        this.activeModifiers.delete('Option');
      } else {
        // Add Option to active modifiers
        this.activeModifiers.add('Option');
      }
      // Request update to reflect visual state change
      this.requestUpdate();
      return; // Don't send Option key immediately
    }

    // Check for Option+Arrow chord combinations
    if (this.activeModifiers.has('Option') && key.startsWith('Arrow')) {
      // Clear only the Option modifier after use
      this.activeModifiers.delete('Option');
      this.requestUpdate();

      // Send the Option+Arrow combination
      if (this.onKeyPress) {
        // Send Option (ESC) first
        this.onKeyPress('Option', true, false);
        // Then send the arrow key
        this.onKeyPress(key, false, false);
      }
      return;
    }

    // If any non-arrow key is pressed while Option is active, clear Option
    if (this.activeModifiers.has('Option') && !key.startsWith('Arrow')) {
      this.activeModifiers.clear();
      this.requestUpdate();
    }

    // Always pass the key press to the handler - let it decide what to do with special keys
    if (this.onKeyPress) {
      this.onKeyPress(key, isModifier, isSpecial, isToggle);
    }
  }

  private handlePasteImmediate(_e: Event) {
    console.log('[QuickKeys] Paste button touched - delegating to paste handler');

    // Always delegate to the main paste handler in direct-keyboard-manager
    // This preserves user gesture context while keeping all clipboard logic in one place
    if (this.onKeyPress) {
      this.onKeyPress('Paste', false, false);
    }
  }

  private startKeyRepeat(key: string, isModifier: boolean, isSpecial: boolean) {
    // Only enable key repeat for arrow keys
    if (!key.startsWith('Arrow')) return;

    // Clear any existing repeat
    this.stopKeyRepeat();

    // Send first key immediately
    if (this.onKeyPress) {
      this.onKeyPress(key, isModifier, isSpecial, false);
    }

    // Start repeat after 500ms initial delay
    this.keyRepeatTimeout = window.setTimeout(() => {
      // Repeat every 50ms
      this.keyRepeatInterval = window.setInterval(() => {
        if (this.onKeyPress) {
          this.onKeyPress(key, isModifier, isSpecial);
        }
      }, 50);
    }, 500);
  }

  private stopKeyRepeat() {
    if (this.keyRepeatTimeout) {
      clearTimeout(this.keyRepeatTimeout);
      this.keyRepeatTimeout = null;
    }
    if (this.keyRepeatInterval) {
      clearInterval(this.keyRepeatInterval);
      this.keyRepeatInterval = null;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopKeyRepeat();

    // Clean up orientation listener
    if (this.orientationHandler) {
      window.removeEventListener('resize', this.orientationHandler);
      window.removeEventListener('orientationchange', this.orientationHandler);
      this.orientationHandler = null;
    }
  }

  private renderStyles() {
    return html`
      <style>
        
        /* Quick keys container - positioned above keyboard */
        .terminal-quick-keys-container {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: ${Z_INDEX.TERMINAL_QUICK_KEYS};
          background-color: rgb(var(--color-bg-secondary) / 0.98);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          width: 100vw;
          max-width: 100vw;
          /* No safe areas needed when above keyboard */
          padding-left: 0;
          padding-right: 0;
          margin-left: 0;
          margin-right: 0;
          box-sizing: border-box;
        }
        
        /* The actual bar with buttons */
        .quick-keys-bar {
          background: transparent;
          border-top: 1px solid rgb(var(--color-border-base) / 0.5);
          padding: 0.25rem 0;
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        
        /* Button rows - ensure full width */
        .quick-keys-bar > div {
          width: 100%;
          padding-left: 0.125rem;
          padding-right: 0.125rem;
        }
        
        /* Quick key buttons */
        .quick-key-btn {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          flex: 1 1 0;
          min-width: 0;
        }
        
        /* Modifier key styling */
        .modifier-key {
          background-color: rgb(var(--color-bg-tertiary));
          border-color: rgb(var(--color-border-base));
        }
        
        .modifier-key:hover {
          background-color: rgb(var(--color-bg-secondary));
        }
        
        /* Active modifier styling */
        .modifier-key.active {
          background-color: rgb(var(--color-primary));
          border-color: rgb(var(--color-primary));
          color: rgb(var(--color-text-bright));
        }
        
        .modifier-key.active:hover {
          background-color: rgb(var(--color-primary-hover));
        }
        
        /* Arrow key styling */
        .arrow-key {
          font-size: 1rem;
          padding: 0.375rem 0.5rem;
        }
        
        /* Medium font for short character buttons */
        .quick-key-btn-medium {
          font-size: 13px;
        }
        
        /* Small font for mobile keyboard buttons */
        .quick-key-btn-small {
          font-size: 10px;
        }
        
        /* Extra small font for long text buttons */
        .quick-key-btn-xs {
          font-size: 8px;
        }
        
        /* Combo key styling (like ^C, ^Z) */
        .combo-key {
          background-color: rgb(var(--color-bg-tertiary));
          border-color: rgb(var(--color-border-accent));
        }
        
        .combo-key:hover {
          background-color: rgb(var(--color-bg-secondary));
        }
        
        /* Special key styling (like ABC) */
        .special-key {
          background-color: rgb(var(--color-primary));
          border-color: rgb(var(--color-primary));
          color: rgb(var(--color-text-bright));
        }
        
        .special-key:hover {
          background-color: rgb(var(--color-primary-hover));
        }
        
        /* Function key styling */
        .func-key-btn {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          flex: 1 1 0;
          min-width: 0;
        }
        
        /* Scrollable row styling */
        .scrollable-row {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scroll-behavior: smooth;
        }
        
        /* Hide scrollbar but keep functionality */
        .scrollable-row::-webkit-scrollbar {
          display: none;
        }
        
        .scrollable-row {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        
        /* Toggle button styling */
        .toggle-key {
          background-color: rgb(var(--color-bg-secondary));
          border-color: rgb(var(--color-border-accent));
        }
        
        .toggle-key:hover {
          background-color: rgb(var(--color-bg-tertiary));
        }
        
        .toggle-key.active {
          background-color: rgb(var(--color-primary));
          border-color: rgb(var(--color-primary));
          color: rgb(var(--color-text-bright));
        }
        
        .toggle-key.active:hover {
          background-color: rgb(var(--color-primary-hover));
        }
        
        /* Ctrl shortcut button styling */
        .ctrl-shortcut-btn {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          flex: 1 1 0;
          min-width: 0;
        }
        
      </style>
    `;
  }

  render() {
    if (!this.visible) return '';

    // Use the same layout for all mobile devices (phones and tablets)
    return html`
      <div 
        class="terminal-quick-keys-container"
        @mousedown=${(e: Event) => e.preventDefault()}
        @touchstart=${(e: Event) => e.preventDefault()}
      >
        <div class="quick-keys-bar">
          <!-- Row 1 -->
          <div class="flex gap-0.5 mb-0.5">
            ${TERMINAL_QUICK_KEYS.filter((k) => k.row === 1).map(
              ({ key, label, modifier, arrow, toggle }) => html`
                <button
                  type="button"
                  tabindex="-1"
                  class="quick-key-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${modifier ? 'modifier-key' : ''} ${arrow ? 'arrow-key' : ''} ${toggle ? 'toggle-key' : ''} ${toggle && ((key === 'CtrlExpand' && this.showCtrlKeys) || (key === 'F' && this.showFunctionKeys)) ? 'active' : ''} ${modifier && key === 'Option' && this.activeModifiers.has('Option') ? 'active' : ''}"
                  @mousedown=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchstart=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Start key repeat for arrow keys
                    if (arrow) {
                      this.startKeyRepeat(key, modifier || false, false);
                    }
                  }}
                  @touchend=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Stop key repeat
                    if (arrow) {
                      this.stopKeyRepeat();
                    } else {
                      this.handleKeyPress(key, modifier, false, toggle, e);
                    }
                  }}
                  @touchcancel=${(_e: Event) => {
                    // Also stop on touch cancel
                    if (arrow) {
                      this.stopKeyRepeat();
                    }
                  }}
                  @click=${(e: MouseEvent) => {
                    if (e.detail !== 0 && !arrow) {
                      this.handleKeyPress(key, modifier, false, toggle, e);
                    }
                  }}
                >
                  ${label}
                </button>
              `
            )}
          </div>
          
          <!-- Row 2 or Function Keys or Ctrl Shortcuts (with Done button always visible) -->
          ${
            this.showCtrlKeys
              ? html`
              <!-- Ctrl shortcuts row with Done button -->
              <div class="flex gap-0.5 mb-0.5">
                ${CTRL_SHORTCUTS.map(
                  ({ key, label, combo, special }) => html`
                    <button
                      type="button"
                      tabindex="-1"
                      class="ctrl-shortcut-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${combo ? 'combo-key' : ''} ${special ? 'special-key' : ''}"
                      @mousedown=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchstart=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchend=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleKeyPress(key, false, special, false, e);
                      }}
                      @click=${(e: MouseEvent) => {
                        if (e.detail !== 0) {
                          this.handleKeyPress(key, false, special, false, e);
                        }
                      }}
                    >
                      ${label}
                    </button>
                  `
                )}
                <!-- Done button -->
                <button
                  type="button"
                  tabindex="-1"
                  class="quick-key-btn ${this.getButtonFontClass(DONE_BUTTON.label)} min-w-0 ${this.getButtonSizeClass(DONE_BUTTON.label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap special-key"
                  @mousedown=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchstart=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchend=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                  }}
                  @click=${(e: MouseEvent) => {
                    if (e.detail !== 0) {
                      this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                    }
                  }}
                >
                  ${DONE_BUTTON.label}
                </button>
              </div>
            `
              : this.showFunctionKeys
                ? html`
              <!-- Function keys row with Done button -->
              <div class="flex gap-0.5 mb-0.5">
                ${FUNCTION_KEYS.map(
                  ({ key, label }) => html`
                    <button
                      type="button"
                      tabindex="-1"
                      class="func-key-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap"
                      @mousedown=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchstart=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchend=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleKeyPress(key, false, false, false, e);
                      }}
                      @click=${(e: MouseEvent) => {
                        if (e.detail !== 0) {
                          this.handleKeyPress(key, false, false, false, e);
                        }
                      }}
                    >
                      ${label}
                    </button>
                  `
                )}
                <!-- Done button -->
                <button
                  type="button"
                  tabindex="-1"
                  class="quick-key-btn ${this.getButtonFontClass(DONE_BUTTON.label)} min-w-0 ${this.getButtonSizeClass(DONE_BUTTON.label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap special-key"
                  @mousedown=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchstart=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchend=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                  }}
                  @click=${(e: MouseEvent) => {
                    if (e.detail !== 0) {
                      this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                    }
                  }}
                >
                  ${DONE_BUTTON.label}
                </button>
              </div>
            `
                : html`
              <!-- Regular row 2 -->
              <div class="flex gap-0.5 mb-0.5 ">
                ${TERMINAL_QUICK_KEYS.filter((k) => k.row === 2).map(
                  ({ key, label, modifier, combo, special, toggle }) => html`
                    <button
                      type="button"
                      tabindex="-1"
                      class="quick-key-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${modifier ? 'modifier-key' : ''} ${combo ? 'combo-key' : ''} ${special ? 'special-key' : ''} ${toggle ? 'toggle-key' : ''} ${toggle && this.showFunctionKeys ? 'active' : ''}"
                      @mousedown=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchstart=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      @touchend=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (key === 'Paste') {
                          this.handlePasteImmediate(e);
                        } else {
                          this.handleKeyPress(key, modifier || combo, special, false, e);
                        }
                      }}
                      @click=${(e: MouseEvent) => {
                        if (e.detail !== 0) {
                          this.handleKeyPress(key, modifier || combo, special, false, e);
                        }
                      }}
                    >
                      ${label}
                    </button>
                  `
                )}
                <!-- Done button (in regular row 2) -->
                <button
                  type="button"
                  tabindex="-1"
                  class="quick-key-btn ${this.getButtonFontClass(DONE_BUTTON.label)} min-w-0 ${this.getButtonSizeClass(DONE_BUTTON.label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap special-key"
                  @mousedown=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchstart=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchend=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                  }}
                  @click=${(e: MouseEvent) => {
                    if (e.detail !== 0) {
                      this.handleKeyPress(DONE_BUTTON.key, false, DONE_BUTTON.special, false, e);
                    }
                  }}
                >
                  ${DONE_BUTTON.label}
                </button>
              </div>
            `
          }
          
          <!-- Row 3 - Additional special characters (always visible) -->
          <div class="flex gap-0.5 ">
            ${TERMINAL_QUICK_KEYS.filter((k) => k.row === 3).map(
              ({ key, label, modifier, combo, special }) => html`
                <button
                  type="button"
                  tabindex="-1"
                  class="quick-key-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${modifier ? 'modifier-key' : ''} ${combo ? 'combo-key' : ''} ${special ? 'special-key' : ''} ${modifier && key === 'Option' && this.activeModifiers.has('Option') ? 'active' : ''}"
                  @mousedown=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchstart=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  @touchend=${(e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleKeyPress(key, modifier || combo, special, false, e);
                  }}
                  @click=${(e: MouseEvent) => {
                    if (e.detail !== 0) {
                      this.handleKeyPress(key, modifier || combo, special, false, e);
                    }
                  }}
                >
                  ${label}
                </button>
              `
            )}
          </div>
        </div>
      </div>
      ${this.renderStyles()}
    `;
  }
}

import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../utils/constants.js';
import {
  getQuickKeyDefinition,
  loadQuickKeysLayout,
  type QuickKeyDefinition,
  type QuickKeysLayout,
  subscribeToQuickKeysLayout,
} from '../utils/quick-keys-layout.js';

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
  @state() private quickKeysLayout: QuickKeysLayout = loadQuickKeysLayout();

  private keyRepeatInterval: number | null = null;
  private keyRepeatTimeout: number | null = null;
  private orientationHandler: (() => void) | null = null;
  private quickKeysLayoutUnsubscribe?: () => void;

  // Chord system state
  private activeModifiers = new Set<string>();

  // Touch tracking for scroll detection
  private touchStartY = 0;
  private touchStartX = 0;
  private isTouchMoving = false;

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

    // Add passive touch listeners for smooth scrolling
    // We attach to the component host itself since it captures events from shadow DOM
    this.addEventListener('touchstart', this.handleDelegatedTouchStart, { passive: true });
    this.addEventListener('touchmove', this.handleDelegatedTouchMove, { passive: true });

    this.quickKeysLayout = loadQuickKeysLayout();
    this.quickKeysLayoutUnsubscribe = subscribeToQuickKeysLayout(() => {
      this.quickKeysLayout = loadQuickKeysLayout();
    });
  }

  private checkOrientation() {
    // Consider landscape if width is greater than height
    // and width is more than 600px (typical phone landscape width)
    this.isLandscape = window.innerWidth > window.innerHeight && window.innerWidth > 600;
  }

  private getButtonSizeClass(_label: string): string {
    // Increase touch area while preserving space for all three rows.
    return this.isLandscape ? 'px-1 py-2' : 'px-1.5 py-2.5';
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

  // Delegated touch start handler (passive)
  private handleDelegatedTouchStart = (e: TouchEvent) => {
    const target = e
      .composedPath()
      .find((el) => el instanceof HTMLElement && el.classList.contains('quick-key-btn')) as
      | HTMLElement
      | undefined;

    if (!target) return;

    const touch = e.touches[0];
    this.touchStartY = touch.clientY;
    this.touchStartX = touch.clientX;
    this.isTouchMoving = false;

    // Handle key repeat for arrow keys
    const isArrow = target.classList.contains('arrow-key');
    if (isArrow) {
      const key = target.getAttribute('data-key');
      const modifier = target.hasAttribute('data-modifier');
      if (key) {
        this.startKeyRepeat(key, modifier, false);
      }
    }
  };

  // Delegated touch move handler (passive)
  private handleDelegatedTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    const deltaY = Math.abs(touch.clientY - this.touchStartY);
    const deltaX = Math.abs(touch.clientX - this.touchStartX);

    // Reduced threshold from 10px to 5px for better scroll detection
    if (deltaY > 5 || deltaX > 5) {
      this.isTouchMoving = true;

      // Cancel key repeat if scrolling
      if (this.keyRepeatInterval || this.keyRepeatTimeout) {
        this.stopKeyRepeat();
      }
    }
  };

  // Keep handleTouchEnd for non-passive usage in @touchend
  private handleTouchEnd(e: TouchEvent, callback: () => void) {
    if (!this.isTouchMoving) {
      // Only preventDefault for actual taps
      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
      callback();
    }
    // Don't preventDefault if user was scrolling - let iOS handle it naturally
    this.isTouchMoving = false;
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (
      changedProperties.has('visible') ||
      changedProperties.has('showFunctionKeys') ||
      changedProperties.has('showCtrlKeys') ||
      changedProperties.has('isLandscape') ||
      changedProperties.has('quickKeysLayout')
    ) {
      this.dispatchEvent(
        new CustomEvent('quick-keys-layout-change', {
          bubbles: true,
          composed: true,
        })
      );
    }
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

    // Remove passive touch listeners
    this.removeEventListener('touchstart', this.handleDelegatedTouchStart);
    this.removeEventListener('touchmove', this.handleDelegatedTouchMove);
    this.quickKeysLayoutUnsubscribe?.();
    this.quickKeysLayoutUnsubscribe = undefined;
  }

  private getQuickKeyRows(): QuickKeyDefinition[][] {
    return this.quickKeysLayout.map((row) => row.map((key) => getQuickKeyDefinition(key)));
  }

  private renderExpandedToggle(rows: QuickKeyDefinition[][], key: 'CtrlExpand' | 'F') {
    const remainsVisible = [rows[0], ...rows.slice(2)].some((row) =>
      row.some((definition) => definition.key === key)
    );

    return remainsVisible ? '' : this.renderQuickKey(getQuickKeyDefinition(key));
  }

  private renderQuickKey(definition: QuickKeyDefinition) {
    const { key, label, modifier, combo, arrow, toggle } = definition;
    const activeToggle =
      toggle &&
      ((key === 'CtrlExpand' && this.showCtrlKeys) || (key === 'F' && this.showFunctionKeys));
    const activeModifier = modifier && key === 'Option' && this.activeModifiers.has('Option');

    return html`
      <button
        type="button"
        tabindex="-1"
        class="quick-key-btn ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${modifier ? 'modifier-key' : ''} ${combo ? 'combo-key' : ''} ${arrow ? 'arrow-key' : ''} ${toggle ? 'toggle-key' : ''} ${activeToggle || activeModifier ? 'active' : ''}"
        data-key=${key}
        ?data-modifier=${modifier}
        ?data-combo=${combo}
        ?data-arrow=${arrow}
        ?data-toggle=${toggle}
        @mousedown=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        @touchend=${(event: TouchEvent) => {
          this.handleTouchEnd(event, () => {
            if (arrow) {
              this.stopKeyRepeat();
            } else if (key === 'Paste') {
              this.handlePasteImmediate(event);
            } else {
              this.handleKeyPress(key, Boolean(modifier || combo), false, Boolean(toggle), event);
            }
          });
        }}
        @touchcancel=${() => {
          if (arrow) {
            this.stopKeyRepeat();
          }
        }}
        @click=${(event: MouseEvent) => {
          if (event.detail !== 0 && !arrow) {
            this.handleKeyPress(key, Boolean(modifier || combo), false, Boolean(toggle), event);
          }
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderAuxiliaryKey(definition: {
    key: string;
    label: string;
    combo?: boolean;
    special?: boolean;
    func?: boolean;
  }) {
    const { key, label, combo, special, func } = definition;

    return html`
      <button
        type="button"
        tabindex="-1"
        class="${func ? 'func-key-btn' : 'ctrl-shortcut-btn'} ${this.getButtonFontClass(label)} min-w-0 ${this.getButtonSizeClass(label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap ${combo ? 'combo-key' : ''} ${special ? 'special-key' : ''}"
        data-key=${key}
        ?data-combo=${combo}
        ?data-special=${special}
        @mousedown=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        @touchend=${(event: TouchEvent) => {
          this.handleTouchEnd(event, () => {
            this.handleKeyPress(key, false, Boolean(special), false, event);
          });
        }}
        @click=${(event: MouseEvent) => {
          if (event.detail !== 0) {
            this.handleKeyPress(key, false, Boolean(special), false, event);
          }
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderDoneButton() {
    return html`
      <button
        type="button"
        tabindex="-1"
        class="quick-key-btn ${this.getButtonFontClass(DONE_BUTTON.label)} min-w-0 ${this.getButtonSizeClass(DONE_BUTTON.label)} bg-bg-tertiary text-primary font-mono rounded border border-border hover:bg-surface hover:border-primary transition-all whitespace-nowrap special-key"
        data-key=${DONE_BUTTON.key}
        data-special
        @mousedown=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        @touchend=${(event: TouchEvent) => {
          this.handleTouchEnd(event, () => {
            this.handleKeyPress(DONE_BUTTON.key, false, true, false, event);
          });
        }}
        @click=${(event: MouseEvent) => {
          if (event.detail !== 0) {
            this.handleKeyPress(DONE_BUTTON.key, false, true, false, event);
          }
        }}
      >
        ${DONE_BUTTON.label}
      </button>
    `;
  }

  private renderStyles() {
    return html`
      <style>
        
        /* Quick keys container - fixed above keyboard */
        .terminal-quick-keys-container {
          /* position, bottom, left, right are set inline with !important */
          z-index: ${Z_INDEX.TERMINAL_QUICK_KEYS};
          background-color: rgb(var(--color-bg-secondary) / 0.98);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          width: 100%;
          max-width: 100%;
          padding-left: 0;
          padding-right: 0;
          margin-left: 0;
          margin-right: 0;
          box-sizing: border-box;
          /* Prevent overscroll and bouncing */
          overscroll-behavior: none;
          -webkit-overflow-scrolling: auto;
          /* Allow touch events to pass through for scrolling terminal content */
          pointer-events: none;
          /* NO transform, will-change, or contain properties that break position:fixed */
        }
        
        /* The actual bar with buttons */
        .quick-keys-bar {
          background: transparent;
          border-top: 1px solid rgb(var(--color-border-base) / 0.5);
          padding: 0.25rem 0;
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
          /* Re-enable pointer events for the button bar */
          pointer-events: auto;
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
          /* Ensure buttons are interactive */
          pointer-events: auto;
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

    const rows = this.getQuickKeyRows();

    return html`
      <div
        class="terminal-quick-keys-container"
        style="position: fixed !important; bottom: var(--keyboard-offset, 0px) !important; left: 0 !important; right: 0 !important;"
      >
        <div class="quick-keys-bar">
          <div class="flex gap-0.5 mb-0.5">${rows[0].map((key) => this.renderQuickKey(key))}</div>

          ${
            this.showCtrlKeys
              ? html`
              <div class="flex gap-0.5 ${rows.length > 2 ? 'mb-0.5' : ''}">
                ${CTRL_SHORTCUTS.map((key) => this.renderAuxiliaryKey(key))}
                ${this.renderExpandedToggle(rows, 'CtrlExpand')}
                ${this.renderDoneButton()}
              </div>
            `
              : this.showFunctionKeys
                ? html`
              <div class="flex gap-0.5 ${rows.length > 2 ? 'mb-0.5' : ''}">
                ${FUNCTION_KEYS.map((key) => this.renderAuxiliaryKey(key))}
                ${this.renderExpandedToggle(rows, 'F')}
                ${this.renderDoneButton()}
              </div>
            `
                : html`
              <div class="flex gap-0.5 ${rows.length > 2 ? 'mb-0.5' : ''}">
                ${rows[1].map((key) => this.renderQuickKey(key))}
                ${this.renderDoneButton()}
              </div>
            `
          }

          ${rows.slice(2).map(
            (row) => html`
              <div class="flex gap-0.5">${row.map((key) => this.renderQuickKey(key))}</div>
            `
          )}
        </div>
      </div>
      ${this.renderStyles()}
    `;
  }
}

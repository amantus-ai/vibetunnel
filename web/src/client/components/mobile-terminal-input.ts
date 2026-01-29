/**
 * Mobile Terminal Input Component
 *
 * Bottom input area for mobile session view with:
 * - Command input field
 * - Quick action chips (Tab, Clear, History, Ctrl+C)
 * - Send button
 *
 * Matches ShellOps V3 mobile wireframe design.
 */

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('mobile-terminal-input')
export class MobileTerminalInput extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = true;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Object }) callbacks: {
    onSendInput?: (text: string) => void;
    onQuickAction?: (action: 'tab' | 'clear' | 'history' | 'ctrl-c') => void;
    onFocus?: () => void;
    onBlur?: () => void;
  } = {};

  @state() private inputValue = '';

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.inputValue = input.value;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private handleSend() {
    if (this.inputValue.trim() && this.callbacks.onSendInput) {
      this.callbacks.onSendInput(`${this.inputValue}\n`);
      this.inputValue = '';
      // Clear the input field
      const input = this.querySelector('input');
      if (input) {
        input.value = '';
      }
    }
  }

  private handleQuickAction(action: 'tab' | 'clear' | 'history' | 'ctrl-c') {
    if (this.callbacks.onQuickAction) {
      this.callbacks.onQuickAction(action);
    }
  }

  private handleFocus() {
    if (this.callbacks.onFocus) {
      this.callbacks.onFocus();
    }
  }

  private handleBlur() {
    if (this.callbacks.onBlur) {
      this.callbacks.onBlur();
    }
  }

  render() {
    if (!this.visible) {
      return '';
    }

    return html`
      <div
        class="mobile-terminal-input"
        style="
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 100;
          background: #0A0A0A;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 16px;
          padding-bottom: calc(12px + env(safe-area-inset-bottom));
        "
      >
        <!-- Quick Action Chips -->
        <div class="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
          <button
            @click=${() => this.handleQuickAction('tab')}
            class="flex-shrink-0 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all"
            style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #A3A3A3;"
          >
            Tab ⇥
          </button>
          <button
            @click=${() => this.handleQuickAction('clear')}
            class="flex-shrink-0 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all"
            style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #A3A3A3;"
          >
            Clear ⌃L
          </button>
          <button
            @click=${() => this.handleQuickAction('history')}
            class="flex-shrink-0 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all"
            style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #A3A3A3;"
          >
            History ↑
          </button>
          <button
            @click=${() => this.handleQuickAction('ctrl-c')}
            class="flex-shrink-0 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all"
            style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #A3A3A3;"
          >
            ⌃C
          </button>
        </div>

        <!-- Input Row -->
        <div class="flex items-center gap-3">
          <div
            class="flex-1 flex items-center px-4 py-3 rounded-xl"
            style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08);"
          >
            <input
              type="text"
              placeholder="Enter command..."
              .value=${this.inputValue}
              @input=${this.handleInput}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
              ?disabled=${this.disabled}
              class="flex-1 bg-transparent border-none outline-none font-mono text-sm"
              style="color: var(--color-text); caret-color: var(--color-primary);"
            />
          </div>
          <button
            @click=${this.handleSend}
            ?disabled=${this.disabled || !this.inputValue.trim()}
            class="flex items-center justify-center w-12 h-12 rounded-xl transition-all"
            style="
              background: ${this.inputValue.trim() ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.06)'};
              color: ${this.inputValue.trim() ? 'var(--color-bg)' : '#525252'};
              cursor: ${this.inputValue.trim() ? 'pointer' : 'default'};
            "
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 12 3.269 3.125A59.768 59.768 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mobile-terminal-input': MobileTerminalInput;
  }
}

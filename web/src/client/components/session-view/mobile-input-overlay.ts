/**
 * Mobile Input Overlay Component
 *
 * Full-screen overlay for mobile text input with virtual keyboard support.
 * Handles text input, command sending, keyboard height adjustments, and IME composition.
 *
 * ## IME Support for Japanese/CJK Input
 *
 * This overlay includes full support for Input Method Editor (IME) composition
 * for Japanese, Chinese, and Korean text input on mobile devices.
 *
 * **Bug Fixed (GitHub #99):**
 * Added proper IME composition event handling to prevent duplication of
 * Japanese text during typing. The overlay now waits for composition
 * completion before updating the text state.
 *
 * **Implementation:**
 * - `compositionstart`: Sets isComposing=true, prevents input change handling
 * - `compositionupdate`: Tracks intermediate composition text
 * - `compositionend`: Updates text state only with final composed text
 * - `input`: Skipped during composition, normal handling otherwise
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../modal-wrapper.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('mobile-input-overlay');

@customElement('mobile-input-overlay')
export class MobileInputOverlay extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: String }) mobileInputText = '';
  @property({ type: Number }) keyboardHeight = 0;
  @property({ type: Number }) touchStartX = 0;
  @property({ type: Number }) touchStartY = 0;
  @property({ type: Function }) onSend?: (text: string) => void;
  @property({ type: Function }) onSendWithEnter?: (text: string) => void;
  @property({ type: Function }) onCancel?: () => void;
  @property({ type: Function }) onTextChange?: (text: string) => void;
  @property({ type: Function }) handleBack?: () => void;

  // IME composition state tracking for Japanese/CJK input
  private isComposing = false;
  private compositionBuffer = '';

  private touchStartHandler = (e: TouchEvent) => {
    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  };

  private touchEndHandler = (e: TouchEvent) => {
    const touch = e.changedTouches[0];
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;

    const deltaX = touchEndX - this.touchStartX;
    const deltaY = touchEndY - this.touchStartY;

    // Check for horizontal swipe from left edge (back gesture)
    const isSwipeRight = deltaX > 100;
    const isVerticallyStable = Math.abs(deltaY) < 100;
    const startedFromLeftEdge = this.touchStartX < 50;

    if (isSwipeRight && isVerticallyStable && startedFromLeftEdge && this.handleBack) {
      this.handleBack();
    }
  };

  private handleMobileInputChange(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;

    // Skip processing if we're in the middle of IME composition
    if (this.isComposing) {
      return;
    }

    this.mobileInputText = textarea.value;
    this.onTextChange?.(textarea.value);
    // Force update to ensure button states update
    this.requestUpdate();
  }

  private handleCompositionStart = (_e: CompositionEvent) => {
    this.isComposing = true;
    this.compositionBuffer = '';
  };

  private handleCompositionUpdate = (e: CompositionEvent) => {
    this.compositionBuffer = e.data || '';
  };

  private handleCompositionEnd = (e: CompositionEvent) => {
    this.isComposing = false;

    // Get the final composed text
    const finalText = e.data || '';

    // Update the mobile input text with the final composition
    const textarea = e.target as HTMLTextAreaElement;
    if (textarea && finalText) {
      this.mobileInputText = textarea.value;
      this.onTextChange?.(textarea.value);
      this.requestUpdate();
    }

    // Clear composition buffer
    this.compositionBuffer = '';
  };

  private focusMobileTextarea() {
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    // Multiple attempts to ensure focus on mobile
    textarea.focus();

    // iOS hack to show keyboard
    textarea.setAttribute('readonly', 'readonly');
    textarea.focus();
    setTimeout(() => {
      textarea.removeAttribute('readonly');
      textarea.focus();
      // Ensure cursor is at end
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 100);
  }

  private async handleMobileInputSendOnly() {
    // Get the current value from the textarea directly
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.mobileInputText.trim();

    if (!textToSend) return;

    this.onSend?.(textToSend);

    // Clear both the reactive property and textarea
    this.mobileInputText = '';
    if (textarea) {
      textarea.value = '';
    }

    // Trigger re-render to update button state
    this.requestUpdate();
  }

  private async handleMobileInputSend() {
    // Get the current value from the textarea directly
    const textarea = this.querySelector('#mobile-input-textarea') as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.mobileInputText.trim();

    if (!textToSend) return;

    this.onSendWithEnter?.(textToSend);

    // Clear both the reactive property and textarea
    this.mobileInputText = '';
    if (textarea) {
      textarea.value = '';
    }

    // Trigger re-render to update button state
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.handleMobileInputSend();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.onCancel?.();
    }
  }

  private handleFocus(e: FocusEvent) {
    e.stopPropagation();
    logger.log('Mobile input textarea focused');
  }

  private handleBlur(e: FocusEvent) {
    e.stopPropagation();
    logger.log('Mobile input textarea blurred');
  }

  private handleContainerClick(e: Event) {
    e.stopPropagation();
    // Focus textarea when clicking anywhere in the container
    this.focusMobileTextarea();
  }

  updated() {
    // Focus the textarea when the overlay becomes visible
    if (this.visible) {
      setTimeout(() => {
        this.focusMobileTextarea();
      }, 100);
    }
  }

  render() {
    if (!this.visible) return null;

    return html`
      <modal-wrapper
        .visible=${this.visible}
        modalClass="z-40" /* z-40 ensures overlay appears above base UI elements */
        contentClass="fixed inset-0 flex flex-col z-40" /* z-40 matches modal backdrop z-index */
        ariaLabel="Mobile input overlay"
        @close=${() => this.onCancel?.()}
        .closeOnBackdrop=${true}
        .closeOnEscape=${false}
      >
        <div @touchstart=${this.touchStartHandler} @touchend=${this.touchEndHandler} class="h-full flex flex-col">
          <!-- Spacer to push content up above keyboard -->
          <div class="flex-1"></div>

          <div
            class="mobile-input-container font-mono text-sm mx-4 flex flex-col"
            style="background: black; border: 1px solid #569cd6; border-radius: 8px; margin-bottom: ${this.keyboardHeight > 0 ? `${this.keyboardHeight + 180}px` : 'calc(env(keyboard-inset-height, 0px) + 180px)'};/* 180px = estimated quick keyboard height (3 rows) */"
            @click=${this.handleContainerClick}
          >
          <!-- Input Area -->
          <div class="p-4 flex flex-col">
            <textarea
              id="mobile-input-textarea"
              class="w-full font-mono text-sm resize-none outline-none"
              placeholder="Type your command here..."
              .value=${this.mobileInputText}
              @input=${this.handleMobileInputChange}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
              @keydown=${this.handleKeydown}
              @compositionstart=${this.handleCompositionStart}
              @compositionupdate=${this.handleCompositionUpdate}
              @compositionend=${this.handleCompositionEnd}
              style="height: 120px; background: black; color: #d4d4d4; border: none; padding: 12px;"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            ></textarea>
          </div>

          <!-- Controls -->
          <div class="p-4 flex gap-2" style="border-top: 1px solid #444;">
            <button
              class="font-mono px-3 py-2 text-xs transition-colors btn-ghost"
              @click=${() => this.onCancel?.()}
            >
              CANCEL
            </button>
            <button
              class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-ghost"
              @click=${this.handleMobileInputSendOnly}
              ?disabled=${!this.mobileInputText.trim()}
            >
              SEND
            </button>
            <button
              class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-secondary"
              @click=${this.handleMobileInputSend}
              ?disabled=${!this.mobileInputText.trim()}
            >
              SEND + ⏎
            </button>
          </div>
        </div>
        </div>
      </modal-wrapper>
    `;
  }
}

/**
 * Overlay components for SessionView (Ctrl+Alpha, Width Selector, etc.)
 */
import { html, type TemplateResult } from 'lit';
import { COMMON_TERMINAL_WIDTHS } from '../utils/terminal-preferences.js';

export interface OverlayState {
  showWidthSelector: boolean;
  customWidth: string;
  showCtrlAlpha: boolean;
  ctrlSequence: string[];
}

export function renderWidthSelector(
  showWidthSelector: boolean,
  terminalMaxCols: number,
  terminalFontSize: number,
  customWidth: string,
  onWidthSelect: (width: number) => void,
  onFontSizeChange: (size: number) => void,
  onCustomWidthInput: (e: Event) => void,
  onCustomWidthSubmit: () => void,
  onCustomWidthKeydown: (e: KeyboardEvent) => void
): TemplateResult {
  if (!showWidthSelector) return html``;

  return html`
    <div
      class="width-selector-container absolute top-8 right-0 bg-dark-bg-secondary border border-dark-border rounded-md shadow-lg z-50 min-w-48"
    >
      <div class="p-2">
        <div class="text-xs text-dark-text-muted mb-2 px-2">Terminal Width</div>
        ${COMMON_TERMINAL_WIDTHS.map(
          (width) => html`
            <button
              class="w-full text-left px-2 py-1 text-xs hover:bg-dark-border rounded-sm flex justify-between items-center
                ${
                  terminalMaxCols === width.value
                    ? 'bg-dark-border text-accent-green'
                    : 'text-dark-text'
                }"
              @click=${() => onWidthSelect(width.value)}
            >
              <span class="font-mono">${width.label}</span>
              <span class="text-dark-text-muted text-xs">${width.description}</span>
            </button>
          `
        )}
        <div class="border-t border-dark-border mt-2 pt-2">
          <div class="text-xs text-dark-text-muted mb-1 px-2">Custom (20-500)</div>
          <div class="flex gap-1">
            <input
              type="number"
              min="20"
              max="500"
              placeholder="80"
              .value=${customWidth}
              @input=${onCustomWidthInput}
              @keydown=${onCustomWidthKeydown}
              @click=${(e: Event) => e.stopPropagation()}
              class="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono text-dark-text"
            />
            <button
              class="btn-secondary text-xs px-2 py-1"
              @click=${onCustomWidthSubmit}
              ?disabled=${
                !customWidth ||
                Number.parseInt(customWidth) < 20 ||
                Number.parseInt(customWidth) > 500
              }
            >
              Set
            </button>
          </div>
        </div>
        <div class="border-t border-dark-border mt-2 pt-2">
          <div class="text-xs text-dark-text-muted mb-2 px-2">Font Size</div>
          <div class="flex items-center gap-2 px-2">
            <button
              class="btn-secondary text-xs px-2 py-1"
              @click=${() => onFontSizeChange(terminalFontSize - 1)}
              ?disabled=${terminalFontSize <= 8}
            >
              −
            </button>
            <span class="font-mono text-xs text-dark-text min-w-8 text-center">
              ${terminalFontSize}px
            </span>
            <button
              class="btn-secondary text-xs px-2 py-1"
              @click=${() => onFontSizeChange(terminalFontSize + 1)}
              ?disabled=${terminalFontSize >= 32}
            >
              +
            </button>
            <button
              class="btn-ghost text-xs px-2 py-1 ml-auto"
              @click=${() => onFontSizeChange(14)}
              ?disabled=${terminalFontSize === 14}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderCtrlAlphaOverlay(
  showCtrlAlpha: boolean,
  ctrlSequence: string[],
  keyboardHeight: number,
  onCtrlKey: (letter: string) => void,
  onSendSequence: () => void,
  onClearSequence: () => void,
  onBackdrop: (e: Event) => void
): TemplateResult {
  if (!showCtrlAlpha) return html``;

  return html`
    <div
      class="fixed inset-0 z-50 flex flex-col"
      style="background: rgba(0, 0, 0, 0.8);"
      @click=${onBackdrop}
    >
      <!-- Spacer to push content up above keyboard -->
      <div class="flex-1"></div>
      
      <div
        class="font-mono text-sm mx-4 max-w-sm w-full self-center"
        style="background: black; border: 1px solid #569cd6; border-radius: 8px; padding: 10px; margin-bottom: ${keyboardHeight > 0 ? `${keyboardHeight + 180}px` : 'calc(env(keyboard-inset-height, 0px) + 180px)'};/* 180px = estimated quick keyboard height (3 rows) */"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="text-vs-user text-center mb-2 font-bold">Ctrl + Key</div>

        <!-- Help text -->
        <div class="text-xs text-vs-muted text-center mb-3 opacity-70">
          Build sequences like ctrl+c ctrl+c
        </div>

        <!-- Current sequence display -->
        ${
          ctrlSequence.length > 0
            ? html`
              <div class="text-center mb-4 p-2 border border-vs-muted rounded bg-vs-bg">
                <div class="text-xs text-vs-muted mb-1">Current sequence:</div>
                <div class="text-sm text-vs-accent font-bold">
                  ${ctrlSequence.map((letter) => `Ctrl+${letter}`).join(' ')}
                </div>
              </div>
            `
            : ''
        }

        <!-- Grid of A-Z buttons -->
        <div class="grid grid-cols-6 gap-1 mb-3">
          ${[
            'A',
            'B',
            'C',
            'D',
            'E',
            'F',
            'G',
            'H',
            'I',
            'J',
            'K',
            'L',
            'M',
            'N',
            'O',
            'P',
            'Q',
            'R',
            'S',
            'T',
            'U',
            'V',
            'W',
            'X',
            'Y',
            'Z',
          ].map(
            (letter) => html`
              <button
                class="font-mono text-xs transition-all cursor-pointer aspect-square flex items-center justify-center quick-start-btn py-2"
                @click=${() => onCtrlKey(letter)}
              >
                ${letter}
              </button>
            `
          )}
        </div>

        <!-- Common shortcuts info -->
        <div class="text-xs text-vs-muted text-center mb-3">
          <div>Common: C=interrupt, X=exit, O=save, W=search</div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-2 justify-center">
          <button
            class="font-mono px-4 py-2 text-sm transition-all cursor-pointer btn-ghost"
            @click=${() => {
              onBackdrop(new Event('click'));
            }}
          >
            CANCEL
          </button>
          ${
            ctrlSequence.length > 0
              ? html`
                <button
                  class="font-mono px-3 py-2 text-sm transition-all cursor-pointer btn-ghost"
                  @click=${onClearSequence}
                >
                  CLEAR
                </button>
                <button
                  class="font-mono px-3 py-2 text-sm transition-all cursor-pointer btn-secondary"
                  @click=${onSendSequence}
                >
                  SEND
                </button>
              `
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

export function renderMobileInputOverlay(
  showMobileInput: boolean,
  mobileInputText: string,
  keyboardHeight: number,
  onInputChange: (e: Event) => void,
  onSend: () => void,
  onSendOnly: () => void,
  onCancel: () => void,
  onTouchStart: (e: TouchEvent) => void,
  onTouchEnd: (e: TouchEvent) => void,
  onTextareaFocus: (e: FocusEvent) => void,
  onTextareaBlur: (e: FocusEvent) => void,
  onTextareaKeydown: (e: KeyboardEvent) => void
): TemplateResult {
  if (!showMobileInput) return html``;

  return html`
    <div
      class="fixed inset-0 z-40 flex flex-col"
      style="background: rgba(0, 0, 0, 0.8);"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      @touchstart=${onTouchStart}
      @touchend=${onTouchEnd}
    >
      <!-- Spacer to push content up above keyboard -->
      <div class="flex-1"></div>

      <div
        class="mobile-input-container font-mono text-sm mx-4 flex flex-col"
        style="background: black; border: 1px solid #569cd6; border-radius: 8px; margin-bottom: ${keyboardHeight > 0 ? `${keyboardHeight + 180}px` : 'calc(env(keyboard-inset-height, 0px) + 180px)'};/* 180px = estimated quick keyboard height (3 rows) */"
        @click=${(e: Event) => {
          e.stopPropagation();
          // Focus textarea when clicking anywhere in the container
          const textarea = (e.currentTarget as HTMLElement).querySelector('textarea');
          if (textarea) {
            textarea.focus();
          }
        }}
      >
        <!-- Input Area -->
        <div class="p-4 flex flex-col">
          <textarea
            id="mobile-input-textarea"
            class="w-full font-mono text-sm resize-none outline-none"
            placeholder="Type your command here..."
            .value=${mobileInputText}
            @input=${onInputChange}
            @focus=${onTextareaFocus}
            @blur=${onTextareaBlur}
            @keydown=${onTextareaKeydown}
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
            @click=${onCancel}
          >
            CANCEL
          </button>
          <button
            class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-ghost"
            @click=${onSendOnly}
            ?disabled=${!mobileInputText.trim()}
          >
            SEND
          </button>
          <button
            class="flex-1 font-mono px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-secondary"
            @click=${onSend}
            ?disabled=${!mobileInputText.trim()}
          >
            SEND + ⏎
          </button>
        </div>
      </div>
    </div>
  `;
}

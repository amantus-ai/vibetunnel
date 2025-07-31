/**
 * OverlaysContainer Component
 *
 * Container for all overlay components in the session view.
 * Manages modals, floating buttons, and overlay states.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import { Z_INDEX } from '../../utils/constants.js';
import type { TerminalThemeId } from '../../utils/terminal-themes.js';
import type { UIState } from './ui-state-manager.js';
import './mobile-input-overlay.js';
import './ctrl-alpha-overlay.js';
import '../terminal-quick-keys.js';
import '../file-browser.js';
import '../file-picker.js';
import './width-selector.js';

export interface OverlaysCallbacks {
  // Mobile input callbacks
  onMobileInputSendOnly: (text: string) => void;
  onMobileInputSend: (text: string) => void;
  onMobileInputCancel: () => void;
  onMobileInputTextChange: (text: string) => void;

  // Ctrl+Alpha callbacks
  onCtrlKey: (letter: string) => void;
  onSendCtrlSequence: () => void;
  onClearCtrlSequence: () => void;
  onCtrlAlphaCancel: () => void;

  // Quick keys
  onQuickKeyPress: (key: string) => void;

  // File browser/picker
  onCloseFileBrowser: () => void;
  onInsertPath: (e: CustomEvent) => void;
  onFileSelected: (e: CustomEvent) => void;
  onFileError: (e: CustomEvent) => void;
  onCloseFilePicker: () => void;

  // Terminal settings
  onWidthSelect: (width: number) => void;
  onFontSizeChange: (size: number) => void;
  onThemeChange: (theme: TerminalThemeId) => void;
  onCloseWidthSelector: () => void;

  // Keyboard button
  onKeyboardButtonClick: () => void;

  // Navigation
  handleBack: () => void;
}

@customElement('overlays-container')
export class OverlaysContainer extends LitElement {
  // Disable shadow DOM to use parent styles
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Object }) uiState: UIState | null = null;
  @property({ type: Object }) callbacks: OverlaysCallbacks | null = null;

  render() {
    if (!this.uiState || !this.callbacks) {
      return html``;
    }

    return html`
      <!-- Floating Session Exited Banner -->
      ${
        this.session?.status === 'exited'
          ? html`
            <div
              class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
              style="z-index: ${Z_INDEX.SESSION_EXITED_OVERLAY}; pointer-events: none !important;"
            >
              <div
                class="bg-elevated border border-status-warning text-status-warning font-medium text-sm tracking-wide px-6 py-3 rounded-lg shadow-elevated animate-scale-in"
                style="pointer-events: none !important;"
              >
                <span class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-status-warning"></span>
                  SESSION EXITED
                </span>
              </div>
            </div>
          `
          : ''
      }
      
      <!-- Mobile Input Overlay -->
      <mobile-input-overlay
        .visible=${this.uiState.isMobile && this.uiState.showMobileInput}
        .mobileInputText=${this.uiState.mobileInputText}
        .keyboardHeight=${this.uiState.keyboardHeight}
        .touchStartX=${this.uiState.touchStartX}
        .touchStartY=${this.uiState.touchStartY}
        .onSend=${this.callbacks.onMobileInputSendOnly}
        .onSendWithEnter=${this.callbacks.onMobileInputSend}
        .onCancel=${this.callbacks.onMobileInputCancel}
        .onTextChange=${this.callbacks.onMobileInputTextChange}
        .handleBack=${this.callbacks.handleBack}
      ></mobile-input-overlay>
      
      <!-- Ctrl+Alpha Overlay -->
      ${(() => {
        const visible = this.uiState.isMobile && this.uiState.showCtrlAlpha;
        console.log(
          '[OverlaysContainer] Ctrl+Alpha visible:',
          visible,
          'isMobile:',
          this.uiState.isMobile,
          'showCtrlAlpha:',
          this.uiState.showCtrlAlpha,
          'z-index should be above',
          Z_INDEX.TERMINAL_QUICK_KEYS
        );
        return html`
          <ctrl-alpha-overlay
            .visible=${visible}
            .ctrlSequence=${this.uiState.ctrlSequence}
            .keyboardHeight=${this.uiState.keyboardHeight}
            .onCtrlKey=${this.callbacks.onCtrlKey}
            .onSendSequence=${this.callbacks.onSendCtrlSequence}
            .onClearSequence=${this.callbacks.onClearCtrlSequence}
            .onCancel=${this.callbacks.onCtrlAlphaCancel}
          ></ctrl-alpha-overlay>
        `;
      })()}
      
      <!-- Floating Keyboard Button (for direct keyboard mode on mobile) -->
      ${
        this.uiState.isMobile && this.uiState.useDirectKeyboard && !this.uiState.showQuickKeys
          ? html`
            <div
              class="keyboard-button"
              @pointerdown=${(e: PointerEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.callbacks?.onKeyboardButtonClick();
              }}
              title="Show keyboard"
            >
              ⌨
            </div>
          `
          : ''
      }
      
      <!-- Terminal Quick Keys (for direct keyboard mode) -->
      <terminal-quick-keys
        .visible=${this.uiState.isMobile && this.uiState.useDirectKeyboard && this.uiState.showQuickKeys}
        .onKeyPress=${this.callbacks.onQuickKeyPress}
      ></terminal-quick-keys>
      
      <!-- File Browser Modal -->
      <file-browser
        .visible=${this.uiState.showFileBrowser}
        .mode=${'browse'}
        .session=${this.session}
        @browser-cancel=${this.callbacks.onCloseFileBrowser}
        @insert-path=${this.callbacks.onInsertPath}
      ></file-browser>
      
      <!-- File Picker Modal -->
      <file-picker
        .visible=${this.uiState.showImagePicker}
        @file-selected=${this.callbacks.onFileSelected}
        @file-error=${this.callbacks.onFileError}
        @file-cancel=${this.callbacks.onCloseFilePicker}
      ></file-picker>
      
      <!-- Width Selector Modal -->
      <terminal-settings-modal
        .visible=${this.uiState.showWidthSelector}
        .terminalMaxCols=${this.uiState.terminalMaxCols}
        .terminalFontSize=${this.uiState.terminalFontSize}
        .terminalTheme=${this.uiState.terminalTheme}
        .customWidth=${this.uiState.customWidth}
        .isMobile=${this.uiState.isMobile}
        .onWidthSelect=${this.callbacks.onWidthSelect}
        .onFontSizeChange=${this.callbacks.onFontSizeChange}
        .onThemeChange=${this.callbacks.onThemeChange}
        .onClose=${this.callbacks.onCloseWidthSelector}
      ></terminal-settings-modal>
      
      <!-- Drag & Drop Overlay -->
      ${
        this.uiState.isDragOver
          ? html`
            <div class="fixed inset-0 bg-bg/90 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none animate-fade-in">
              <div class="bg-elevated border-2 border-dashed border-primary rounded-xl p-10 text-center max-w-md mx-4 shadow-2xl animate-scale-in">
                <div class="relative mb-6">
                  <div class="w-24 h-24 mx-auto bg-gradient-to-br from-primary to-primary-light rounded-full flex items-center justify-center shadow-glow">
                    <svg class="w-12 h-12 text-base" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                    </svg>
                  </div>
                  <div class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
                </div>
                <h3 class="text-2xl font-bold text-primary mb-3">Drop files here</h3>
                <p class="text-sm text-text-muted mb-4">Files will be uploaded and the path sent to terminal</p>
                <div class="inline-flex items-center gap-2 text-xs text-text-dim bg-bg-secondary px-4 py-2 rounded-lg">
                  <span class="opacity-75">Or press</span>
                  <kbd class="px-2 py-1 bg-bg-tertiary border border-border rounded text-primary font-mono text-xs">⌘V</kbd>
                  <span class="opacity-75">to paste from clipboard</span>
                </div>
              </div>
            </div>
          `
          : ''
      }
    `;
  }
}

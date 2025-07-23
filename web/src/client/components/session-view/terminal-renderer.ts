/**
 * TerminalRenderer Component
 *
 * A pure presentational component that renders the terminal.
 * Handles binary vs text mode selection and terminal configuration.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import type { TerminalThemeId } from '../../utils/terminal-themes.js';
import '../terminal.js';
import '../vibe-terminal-binary.js';

@customElement('terminal-renderer')
export class TerminalRenderer extends LitElement {
  // Disable shadow DOM to use parent styles
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) useBinaryMode = false;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: String }) terminalTheme: TerminalThemeId = 'auto';
  @property({ type: Boolean }) disableClick = false;
  @property({ type: Boolean }) hideScrollButton = false;

  // Event handlers passed as properties
  @property({ type: Object }) onTerminalClick?: (e: Event) => void;
  @property({ type: Object }) onTerminalInput?: (e: CustomEvent) => void;
  @property({ type: Object }) onTerminalResize?: (e: CustomEvent) => void;
  @property({ type: Object }) onTerminalReady?: (e: CustomEvent) => void;

  render() {
    if (!this.session) {
      return html``;
    }

    const commonProps = {
      '.sessionId': this.session.id || '',
      '.sessionStatus': this.session.status || 'running',
      '.cols': 80,
      '.rows': 24,
      '.fontSize': this.terminalFontSize,
      '.fitHorizontally': false,
      '.maxCols': this.terminalMaxCols,
      '.theme': this.terminalTheme,
      '.initialCols': this.session.initialCols || 0,
      '.initialRows': this.session.initialRows || 0,
      '.disableClick': this.disableClick,
      '.hideScrollButton': this.hideScrollButton,
      class: 'w-full h-full p-0 m-0 terminal-container',
      '@click': this.handleClick,
      '@terminal-input': this.handleTerminalInput,
    };

    if (this.useBinaryMode) {
      return html`
        <vibe-terminal-binary
          ...=${commonProps}
          @terminal-resize=${this.handleTerminalResize}
          @terminal-ready=${this.handleTerminalReady}
        ></vibe-terminal-binary>
      `;
    } else {
      return html`
        <vibe-terminal
          ...=${commonProps}
        ></vibe-terminal>
      `;
    }
  }

  private handleClick(e: Event) {
    if (this.onTerminalClick) {
      this.onTerminalClick(e);
    }
  }

  private handleTerminalInput(e: Event) {
    if (this.onTerminalInput) {
      this.onTerminalInput(e as CustomEvent);
    }
  }

  private handleTerminalResize(e: Event) {
    if (this.onTerminalResize) {
      this.onTerminalResize(e as CustomEvent);
    }
  }

  private handleTerminalReady(e: Event) {
    if (this.onTerminalReady) {
      this.onTerminalReady(e as CustomEvent);
    }
  }
}

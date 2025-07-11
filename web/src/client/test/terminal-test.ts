import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import '../components/terminal.js';
import type { Terminal } from '../components/terminal.js';
import { Z_INDEX } from '../utils/constants.js';

@customElement('terminal-test')
export class TerminalTest extends LitElement {
  @state() private cols = 80;
  @state() private rows = 24;
  @state() private inputText = '';

  createRenderRoot() {
    return this;
  }

  private terminalRef = createRef<Terminal>();
  private testData = {
    ansi: '\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m \x1b[34mBlue\x1b[0m \x1b[1;33mBold Yellow\x1b[0m',
    unicode: '🚀 Unicode: 你好世界 • ñ • ü • ö • 🎨',
    longLine:
      'This is a very long line that should wrap around when it reaches the edge of the terminal. '.repeat(
        5
      ),
    progress: '[##########          ] 50% Complete',
  };

  connectedCallback() {
    super.connectedCallback();
    this.setupTerminal();
  }

  private async setupTerminal() {
    await this.updateComplete;
    const terminal = this.terminalRef.value;
    if (!terminal) return;

    // Wait for terminal to be ready
    terminal.addEventListener('terminal-ready', () => {
      this.writeWelcomeMessage();
    });
  }

  private writeWelcomeMessage() {
    const terminal = this.terminalRef.value;
    if (!terminal) return;

    terminal.write('\x1b[1;36mVibeTunnel Terminal Test\x1b[0m\r\n');
    terminal.write('=====================================\r\n\r\n');
    terminal.write('This is a test environment for the terminal component.\r\n');
    terminal.write('Use the buttons above to test various features.\r\n\r\n');
    terminal.write('\x1b[32m$ \x1b[0m');
  }

  private handleTerminalInput(e: CustomEvent) {
    const terminal = this.terminalRef.value;
    if (!terminal) return;

    const input = e.detail;

    // Echo the input
    terminal.write(input);

    // Handle special keys
    if (input === '\r') {
      terminal.write('\n\x1b[32m$ \x1b[0m');
    }
  }

  private handleTerminalResize(e: CustomEvent) {
    console.log('Terminal resized:', e.detail);
  }

  private clearTerminal() {
    const terminal = this.terminalRef.value;
    if (!terminal) return;

    terminal.clear();
    terminal.write('\x1b[32m$ \x1b[0m');
  }

  private writeTestData(type: keyof typeof this.testData) {
    const terminal = this.terminalRef.value;
    if (!terminal) return;

    terminal.write(`${this.testData[type]}\r\n\x1b[32m$ \x1b[0m`);
  }

  private resizeTerminal(newCols: number, newRows: number) {
    this.cols = newCols;
    this.rows = newRows;

    const terminal = this.terminalRef.value;
    if (terminal) {
      terminal.setTerminalSize(newCols, newRows);
    }
  }

  private sendCustomInput() {
    if (!this.inputText) return;

    const terminal = this.terminalRef.value;
    if (!terminal) return;

    terminal.write(`${this.inputText}\r\n\x1b[32m$ \x1b[0m`);
    this.inputText = '';
  }

  render() {
    return html`
      <div class="h-screen flex flex-col bg-background text-foreground font-mono">
        <div class="bg-surface border-b border-gray-800 p-4 font-sans">
          <h1 class="text-2xl font-bold text-emerald-400 mb-4">Terminal Test</h1>
          <div class="flex gap-2 flex-wrap">
            <button
              @click=${this.clearTerminal}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              Clear
            </button>
            <button
              @click=${() => this.writeTestData('ansi')}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              ANSI Colors
            </button>
            <button
              @click=${() => this.writeTestData('unicode')}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              Unicode
            </button>
            <button
              @click=${() => this.writeTestData('longLine')}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              Long Line
            </button>
            <button
              @click=${() => this.writeTestData('progress')}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              Progress Bar
            </button>
            <button
              @click=${() => this.resizeTerminal(80, 24)}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              80x24
            </button>
            <button
              @click=${() => this.resizeTerminal(120, 30)}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              120x30
            </button>
            <button
              @click=${() => this.resizeTerminal(40, 15)}
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-emerald-400 rounded text-sm transition-colors"
            >
              40x15
            </button>
          </div>
        </div>

        <div class="flex-1 relative overflow-hidden bg-black m-4 rounded-lg border border-gray-800">
          <div
            class="absolute top-4 right-4 bg-black/80 border border-gray-800 rounded px-3 py-1.5 text-xs"
            style="z-index: ${Z_INDEX.TERMINAL_OVERLAY};"
          >
            <div>Size: <code class="text-emerald-400">${this.cols}x${this.rows}</code></div>
          </div>

          <vibe-terminal
            ${ref(this.terminalRef)}
            .cols=${this.cols}
            .rows=${this.rows}
            @terminal-input=${this.handleTerminalInput}
            @terminal-resize=${this.handleTerminalResize}
            style="width: 100%; height: 100%;"
          ></vibe-terminal>

          <div class="absolute bottom-4 left-4 right-4 flex gap-2" style="z-index: ${Z_INDEX.TERMINAL_OVERLAY};">
            <input
              type="text"
              placeholder="Type custom text to send..."
              class="flex-1 px-3 py-2 bg-black/80 text-foreground border border-gray-800 rounded font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-emerald-400"
              .value=${this.inputText}
              @input=${(e: Event) => {
                this.inputText = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.sendCustomInput();
                }
              }}
            />
            <button
              @click=${this.sendCustomInput}
              class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-background rounded font-medium text-sm transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'terminal-test': TerminalTest;
  }
}

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('terminal-stats-log')
export class TerminalStatsLog extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @state() private entries: Array<{ time: string; message: string }> = [];
  @state() private isScrolledToBottom = true;

  addEntry(message: string) {
    const now = new Date();
    const time =
      now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) +
      '.' +
      now.getMilliseconds().toString().padStart(3, '0');
    this.entries = [...this.entries, { time, message }];
    if (this.entries.length > 50) {
      this.entries = this.entries.slice(-50);
    }

    this.updateComplete.then(() => {
      const el = this.querySelector('.terminal-stats-log');
      if (el && this.isScrolledToBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  private handleScroll(e: Event) {
    const el = e.target as HTMLDivElement;
    const threshold = 10;
    this.isScrolledToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  render() {
    if (!this.visible) return null;
    return html`
      <style>
        .terminal-stats-log {
          position: absolute;
          bottom: calc(3rem + env(safe-area-inset-bottom));
          left: max(1rem, env(safe-area-inset-left));
          right: max(1rem, env(safe-area-inset-right));
          max-height: 150px;
          overflow-y: auto;
          background: rgb(var(--color-bg-elevated) / 0.95);
          backdrop-filter: blur(10px);
          border: 1px solid rgb(var(--color-border) / 0.3);
          border-radius: 0.5rem;
          padding: 0.5rem;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          line-height: 1.5;
          color: rgb(var(--color-text-muted));
          z-index: 40;
        }
        .terminal-stats-log-entry {
          margin-bottom: 0.25rem;
          display: flex;
          gap: 0.5rem;
        }
        .terminal-stats-log-time {
          color: rgb(var(--color-text-dim));
          flex-shrink: 0;
        }
        .terminal-stats-log-message {
          flex: 1;
        }
      </style>
      <div class="terminal-stats-log" @scroll=${this.handleScroll}>
        ${this.entries.map(
          (entry) => html`<div class="terminal-stats-log-entry">
            <span class="terminal-stats-log-time">${entry.time}</span>
            <span class="terminal-stats-log-message">${entry.message}</span>
          </div>`
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'terminal-stats-log': TerminalStatsLog;
  }
}

import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DisplayInfo, ProcessGroup, WindowInfo } from '../types/screencap.js';
import { createLogger } from '../utils/logger.js';

const _logger = createLogger('screencap-sidebar');

@customElement('screencap-sidebar')
export class ScreencapSidebar extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: rgb(var(--color-bg));
      border-right: 1px solid rgb(var(--color-border));
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgb(var(--color-border)) rgb(var(--color-bg));
    }

    .sidebar-header {
      padding: 1rem;
      border-bottom: 1px solid rgb(var(--color-border));
      background: linear-gradient(to bottom, rgb(var(--color-bg-secondary)), rgb(var(--color-bg-base)));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .sidebar-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: rgb(var(--color-text));
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }

    .sidebar-section {
      padding: 1rem;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      color: rgb(var(--color-text-muted));
      font-size: 0.875rem;
      font-weight: 500;
    }

    .refresh-btn {
      padding: 0.25rem 0.5rem;
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.375rem;
      background: transparent;
      color: rgb(var(--color-text-muted));
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.75rem;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
    }

    .refresh-btn:hover {
      border-color: rgb(var(--color-primary));
      color: rgb(var(--color-primary));
    }

    .refresh-btn.loading {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .process-list,
    .display-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .process-item {
      background: rgb(var(--color-surface));
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.5rem;
      overflow: hidden;
      transition: all 0.2s;
    }

    .process-item:hover {
      border-color: rgb(var(--color-border-light));
    }

    .process-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      cursor: pointer;
      user-select: none;
    }

    .process-header:hover {
      background: rgb(var(--color-bg-elevated));
    }

    .process-icon {
      width: 24px;
      height: 24px;
      border-radius: 0.375rem;
      background: rgb(var(--color-bg-elevated));
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .process-icon img {
      width: 20px;
      height: 20px;
    }

    .process-info {
      flex: 1;
      min-width: 0;
    }

    .process-name {
      font-weight: 500;
      color: rgb(var(--color-text));
      font-size: 0.875rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .process-details {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: rgb(var(--color-text-dim));
      margin-top: 0.125rem;
    }

    .window-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgb(var(--color-bg-elevated));
      color: rgb(var(--color-text-muted));
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
      min-width: 1.5rem;
    }

    .expand-icon {
      width: 16px;
      height: 16px;
      color: rgb(var(--color-text-dim));
      transition: transform 0.2s;
    }

    .expand-icon svg {
      width: 100%;
      height: 100%;
    }

    .process-item.expanded .expand-icon {
      transform: rotate(90deg);
    }

    .window-list {
      display: none;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.5rem 0.75rem 0.75rem 0.75rem;
      background: rgb(var(--color-bg));
    }

    .process-item.expanded .window-list {
      display: flex;
    }

    .window-item {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      padding: 0.75rem;
      background: rgb(var(--color-bg-secondary));
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.875rem;
      color: rgb(var(--color-text));
      gap: 0.25rem;
      min-height: 3.5rem;
    }

    .window-item:hover {
      background: rgb(var(--color-surface));
      border-color: rgb(var(--color-border-light));
    }

    .window-item.selected {
      background: rgb(var(--color-primary));
      border-color: rgb(var(--color-primary));
      color: rgb(var(--color-bg));
      font-weight: 500;
    }

    .window-title {
      flex: 1;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .window-size {
      font-size: 0.75rem;
      opacity: 0.7;
      white-space: nowrap;
    }

    .display-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem;
      background: rgb(var(--color-surface));
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .display-item:hover {
      background: rgb(var(--color-bg-elevated));
      border-color: rgb(var(--color-border-light));
    }

    .display-item.selected {
      background: rgb(var(--color-primary));
      border-color: rgb(var(--color-primary));
    }

    .display-item.selected .display-name {
      color: rgb(var(--color-bg));
      font-weight: 500;
    }

    .display-item.selected .display-size {
      color: rgb(var(--color-bg));
      opacity: 0.8;
    }

    .display-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .display-icon {
      width: 32px;
      height: 24px;
      background: rgb(var(--color-bg-elevated));
      border-radius: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .display-item.selected .display-icon {
      background: rgb(var(--color-text-bright) / 0.2);
    }

    .display-name {
      font-weight: 500;
      color: rgb(var(--color-text));
      font-size: 0.875rem;
    }

    .display-size {
      font-size: 0.75rem;
      color: rgb(var(--color-text-dim));
      margin-top: 0.125rem;
    }

    .all-displays-btn {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid rgb(var(--color-border));
      border-radius: 0.5rem;
      background: linear-gradient(135deg, rgb(var(--color-bg-secondary)), rgb(var(--color-bg-tertiary)));
      color: rgb(var(--color-text));
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .all-displays-btn:hover {
      border-color: rgb(var(--color-primary));
      background: linear-gradient(135deg, rgb(var(--color-bg-tertiary)), rgb(var(--color-surface)));
    }

    .all-displays-btn.selected {
      background: rgb(var(--color-primary));
      border-color: rgb(var(--color-primary));
      color: rgb(var(--color-bg));
      font-weight: 500;
    }
  `;

  @property({ type: String }) captureMode: 'desktop' | 'window' = 'desktop';
  @property({ type: Array }) processGroups: ProcessGroup[] = [];
  @property({ type: Array }) displays: DisplayInfo[] = [];
  @property({ type: Object }) selectedWindow: WindowInfo | null = null;
  @property({ type: Object }) selectedDisplay: DisplayInfo | null = null;
  @property({ type: Boolean }) allDisplaysSelected = false;

  @state() private expandedProcesses = new Set<number>();
  @state() private loadingRefresh = false;

  private toggleProcess(pid: number) {
    if (this.expandedProcesses.has(pid)) {
      this.expandedProcesses.delete(pid);
    } else {
      this.expandedProcesses.add(pid);
    }
    this.requestUpdate();
  }

  private async handleRefresh() {
    this.loadingRefresh = true;
    this.dispatchEvent(new CustomEvent('refresh-request'));

    // Reset loading state after a timeout
    setTimeout(() => {
      this.loadingRefresh = false;
    }, 1000);
  }

  private handleWindowSelect(window: WindowInfo, process: ProcessGroup) {
    this.dispatchEvent(
      new CustomEvent('window-select', {
        detail: { window, process },
      })
    );
  }

  private handleDisplaySelect(display: DisplayInfo) {
    this.dispatchEvent(
      new CustomEvent('display-select', {
        detail: display,
      })
    );
  }

  private handleAllDisplaysSelect() {
    this.dispatchEvent(new CustomEvent('all-displays-select'));
  }

  private getSortedProcessGroups(): ProcessGroup[] {
    // Sort process groups by the size of their largest window (width * height)
    return [...this.processGroups].sort((a, b) => {
      const maxSizeA = Math.max(...a.windows.map((w) => w.width * w.height), 0);
      const maxSizeB = Math.max(...b.windows.map((w) => w.width * w.height), 0);
      return maxSizeB - maxSizeA;
    });
  }

  render() {
    const sortedProcessGroups = this.getSortedProcessGroups();

    return html`
      <div class="sidebar-header">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
          </svg>
          Capture Sources
        </h3>
        <button 
          class="refresh-btn ${this.loadingRefresh ? 'loading' : ''}"
          @click=${this.handleRefresh}
          ?disabled=${this.loadingRefresh}
          title="Refresh sources"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      <!-- Desktop Displays Section -->
      <div class="sidebar-section">
        <div class="section-title">
          <span>Desktop</span>
        </div>
        <div class="display-list">
          ${
            /* Comment out All Displays button until fixed
            this.displays.length > 1
              ? html`
            <button 
              class="all-displays-btn ${this.allDisplaysSelected ? 'selected' : ''}"
              @click=${this.handleAllDisplaysSelect}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z"/>
                <path d="M5 6h14v6H5z" opacity="0.3"/>
              </svg>
              All Displays
            </button>
          `
              : ''
            */
            ''
          }
          ${this.displays.map(
            (display, index) => html`
            <div 
              class="display-item ${!this.allDisplaysSelected && this.selectedDisplay?.id === display.id ? 'selected' : ''}"
              @click=${() => this.handleDisplaySelect(display)}
            >
              <div class="display-info">
                <div class="display-icon">
                  <svg width="24" height="18" viewBox="0 0 24 18" fill="currentColor">
                    <rect x="2" y="2" width="20" height="12" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
                    <line x1="7" y1="17" x2="17" y2="17" stroke="currentColor" stroke-width="2"/>
                    <line x1="12" y1="14" x2="12" y2="17" stroke="currentColor" stroke-width="2"/>
                  </svg>
                </div>
                <div>
                  <div class="display-name">${display.name || `Display ${index + 1}`}</div>
                  <div class="display-size">${display.width} × ${display.height}</div>
                </div>
              </div>
            </div>
          `
          )}
        </div>
      </div>

      <!-- Windows Section -->
      <div class="sidebar-section">
        <div class="section-title">
          <span>Windows</span>
        </div>
        <div class="process-list">
          ${sortedProcessGroups.map(
            (process) => html`
            <div class="process-item ${this.expandedProcesses.has(process.pid) ? 'expanded' : ''}">
              <div class="process-header" @click=${() => this.toggleProcess(process.pid)}>
                <div class="process-icon">
                  ${
                    process.iconData
                      ? html`<img src="data:image/png;base64,${process.iconData}" alt="${process.processName}">`
                      : html`<svg width="20" height="20" viewBox="0 0 24 24" fill="rgb(var(--color-text-dim))">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>`
                  }
                </div>
                <div class="process-info">
                  <div class="process-name">${process.processName}</div>
                  <div class="process-details">
                    <span>PID: ${process.pid}</span>
                  </div>
                </div>
                <span class="window-count">${process.windows.length}</span>
                <div class="expand-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                  </svg>
                </div>
              </div>
              <div class="window-list">
                ${process.windows.map(
                  (window) => html`
                  <div 
                    class="window-item ${this.selectedWindow?.cgWindowID === window.cgWindowID ? 'selected' : ''}"
                    @click=${() => this.handleWindowSelect(window, process)}
                    title="${window.title ?? 'Untitled'}"
                  >
                    <div class="window-title">${window.title ?? 'Untitled'}</div>
                    <div class="window-size">${window.width}×${window.height}</div>
                  </div>
                `
                )}
              </div>
            </div>
          `
          )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'screencap-sidebar': ScreencapSidebar;
  }
}

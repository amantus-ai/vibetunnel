/**
 * Clipboard Manager Component
 *
 * Handles clipboard operations including:
 * - Reading from system clipboard
 * - Maintaining clipboard history
 * - Providing paste preview
 * - Supporting multiple paste formats (text, images, files)
 *
 * Mobile-optimized with touch-friendly interface and 44px minimum touch targets.
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';
import { detectMobile } from '../utils/mobile-utils.js';
import './modal-wrapper.js';

const logger = createLogger('clipboard-manager');

interface ClipboardItem {
  id: string;
  content: string;
  type: 'text' | 'image' | 'file';
  timestamp: number;
  preview?: string;
  size?: number;
}

export interface ClipboardManagerCallbacks {
  onPaste?: (content: string) => void;
  onImagePaste?: (file: File) => void;
  onFilePaste?: (files: FileList) => void;
}

@customElement('clipboard-manager')
export class ClipboardManager extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Object }) callbacks: ClipboardManagerCallbacks | null = null;
  @property({ type: Boolean }) showHistory = false;

  @state() private clipboardHistory: ClipboardItem[] = [];
  @state() private currentClipboard: string = '';
  @state() private isReading = false;
  @state() private error: string | null = null;
  @state() private isMobile = detectMobile();

  private readonly MAX_HISTORY_ITEMS = 20;
  private readonly MAX_PREVIEW_LENGTH = 200;
  private readonly STORAGE_KEY = 'vibetunnel-clipboard-history';

  connectedCallback() {
    super.connectedCallback();
    this.loadClipboardHistory();

    // Read current clipboard when component is opened
    if (this.visible) {
      this.readCurrentClipboard();
    }
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('visible') && this.visible) {
      this.readCurrentClipboard();
      this.error = null;
    }
  }

  private async readCurrentClipboard() {
    if (!navigator.clipboard) {
      this.error = 'Clipboard API not available. Please use Ctrl+V to paste.';
      return;
    }

    this.isReading = true;
    this.error = null;

    try {
      // Try to read text first
      try {
        const text = await navigator.clipboard.readText();
        if (text?.trim()) {
          this.currentClipboard = text;
          this.addToHistory(text, 'text');
        }
      } catch (textError) {
        logger.debug('Failed to read clipboard text:', textError);
      }

      // Try to read other formats if supported
      if ('read' in navigator.clipboard) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            // Handle images
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                const blob = await item.getType(type);
                this.addToHistory(`[Image: ${type}]`, 'image', undefined, blob.size);
                break;
              }
            }
          }
        } catch (readError) {
          logger.debug('Failed to read complex clipboard data:', readError);
        }
      }
    } catch (error) {
      logger.error('Failed to read clipboard:', error);
      this.error = 'Failed to read clipboard. Please ensure clipboard permissions are granted.';
    } finally {
      this.isReading = false;
    }
  }

  private addToHistory(
    content: string,
    type: ClipboardItem['type'],
    preview?: string,
    size?: number
  ) {
    // Don't add empty or duplicate content
    if (!content || content === this.clipboardHistory[0]?.content) {
      return;
    }

    const item: ClipboardItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      type,
      timestamp: Date.now(),
      preview:
        preview ||
        (content.length > this.MAX_PREVIEW_LENGTH
          ? `${content.substring(0, this.MAX_PREVIEW_LENGTH)}...`
          : content),
      size,
    };

    // Add to beginning and limit history size
    this.clipboardHistory = [item, ...this.clipboardHistory.slice(0, this.MAX_HISTORY_ITEMS - 1)];
    this.saveClipboardHistory();
  }

  private loadClipboardHistory() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        this.clipboardHistory = JSON.parse(saved);
      }
    } catch (error) {
      logger.warn('Failed to load clipboard history:', error);
      this.clipboardHistory = [];
    }
  }

  private saveClipboardHistory() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.clipboardHistory));
    } catch (error) {
      logger.warn('Failed to save clipboard history:', error);
    }
  }

  private async handlePasteCurrent() {
    if (!this.currentClipboard) {
      await this.readCurrentClipboard();
    }

    if (this.currentClipboard && this.callbacks?.onPaste) {
      this.callbacks.onPaste(this.currentClipboard);
      this.handleClose();
    }
  }

  private handlePasteFromHistory(item: ClipboardItem) {
    if (item.type === 'text' && this.callbacks?.onPaste) {
      this.callbacks.onPaste(item.content);
      this.handleClose();
    } else if (item.type === 'image' && this.callbacks?.onImagePaste) {
      // For now, just show a message that image pasting from history isn't supported
      this.error =
        'Image pasting from history not yet supported. Please copy the image again and use paste current.';
    }
  }

  private handleClearHistory() {
    this.clipboardHistory = [];
    this.saveClipboardHistory();
  }

  private handleRemoveHistoryItem(itemId: string) {
    this.clipboardHistory = this.clipboardHistory.filter((item) => item.id !== itemId);
    this.saveClipboardHistory();
  }

  private handleClose() {
    this.visible = false;
    this.showHistory = false;
    this.error = null;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) {
      // Less than 1 minute
      return 'Just now';
    } else if (diff < 3600000) {
      // Less than 1 hour
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    } else if (diff < 86400000) {
      // Less than 1 day
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
  }

  private formatSize(bytes?: number): string {
    if (!bytes) return '';

    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }

  private getTypeIcon(type: ClipboardItem['type']): string {
    switch (type) {
      case 'text':
        return '📝';
      case 'image':
        return '🖼️';
      case 'file':
        return '📁';
      default:
        return '📋';
    }
  }

  render() {
    // If not visible, return empty to avoid any rendering
    if (!this.visible) {
      return html``;
    }

    return html`
      <modal-wrapper
        .visible=${this.visible}
        .closeOnBackdrop=${true}
        .closeOnEscape=${true}
        .contentClass=${`clipboard-manager-modal font-ui text-sm w-full max-w-[90vw] sm:max-w-2xl ${this.isMobile ? 'max-h-[70vh]' : 'max-h-[75vh]'}`}
        ariaLabel="Clipboard Manager"
        style="z-index: 1050;"
        @close=${this.handleClose}
      >
        <div class="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden" style="margin-bottom: 100px;">
          <!-- Header -->
          <div class="border-b border-border bg-bg-secondary">
            <div class="flex items-center justify-between p-4">
              <div class="flex items-center gap-3">
                <span class="text-xl">📋</span>
                <h2 class="text-lg font-semibold text-text">
                  ${this.showHistory ? 'Clipboard History' : 'Clipboard Manager'}
                </h2>
              </div>
              <div class="flex items-center gap-2">
                ${
                  !this.showHistory && this.clipboardHistory.length > 0
                    ? html`
                  <button
                    class="px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-surface-hover border border-border rounded-lg transition-colors"
                    @click=${() => {
                      this.showHistory = true;
                    }}
                  >
                    History (${this.clipboardHistory.length})
                  </button>
                `
                    : ''
                }
                <button
                  class="p-2 text-text-muted hover:text-text transition-colors"
                  @click=${this.handleClose}
                  title="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Content -->
          <div class="max-h-96 overflow-y-auto">
            ${
              this.error
                ? html`
              <div class="p-4 bg-status-error/10 border-b border-status-error/20">
                <div class="flex items-start gap-3">
                  <span class="text-status-error mt-0.5">⚠️</span>
                  <div>
                    <p class="text-status-error font-medium">Error</p>
                    <p class="text-sm text-status-error/80 mt-1">${this.error}</p>
                  </div>
                </div>
              </div>
            `
                : ''
            }

            ${
              !this.showHistory
                ? html`
              <!-- Current Clipboard -->
              <div class="p-4">
                <div class="mb-4">
                  <h3 class="text-sm font-medium text-text mb-2 flex items-center gap-2">
                    <span class="text-primary">📋</span>
                    Current Clipboard
                    ${
                      this.isReading
                        ? html`
                      <div class="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    `
                        : ''
                    }
                  </h3>
                  
                  ${
                    this.currentClipboard
                      ? html`
                    <div class="bg-bg-secondary border border-border rounded-lg p-3 mb-3">
                      <pre class="text-sm text-text whitespace-pre-wrap break-all font-ui">${this.currentClipboard.length > 300 ? `${this.currentClipboard.substring(0, 300)}...` : this.currentClipboard}</pre>
                    </div>
                    
                    <button
                      class="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 ${this.isMobile ? 'text-base' : 'text-sm'}"
                      @click=${this.handlePasteCurrent}
                    >
                      <span class="text-lg">📤</span>
                      Paste Current Content
                    </button>
                  `
                      : html`
                    <div class="bg-bg-secondary border border-border rounded-lg p-6 text-center">
                      <p class="text-text-muted mb-3">No clipboard content detected</p>
                      <button
                        class="bg-bg-tertiary hover:bg-surface-hover border border-border px-4 py-2 rounded-lg transition-colors text-sm"
                        @click=${this.readCurrentClipboard}
                        ?disabled=${this.isReading}
                      >
                        ${this.isReading ? 'Reading...' : 'Refresh Clipboard'}
                      </button>
                    </div>
                  `
                  }
                </div>
                
                <!-- Quick paste instructions -->
                <div class="border-t border-border pt-4">
                  <p class="text-xs text-text-muted text-center">
                    You can also use <kbd class="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-xs">Ctrl+V</kbd> to paste directly
                  </p>
                </div>
              </div>
            `
                : html`
              <!-- Clipboard History -->
              <div class="p-4">
                <div class="flex items-center justify-between mb-4">
                  <button
                    class="text-sm text-primary hover:text-primary-hover flex items-center gap-2"
                    @click=${() => {
                      this.showHistory = false;
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
                    </svg>
                    Back to Current
                  </button>
                  
                  ${
                    this.clipboardHistory.length > 0
                      ? html`
                    <button
                      class="text-sm text-status-error hover:text-status-error/80 transition-colors"
                      @click=${this.handleClearHistory}
                    >
                      Clear All
                    </button>
                  `
                      : ''
                  }
                </div>
                
                ${
                  this.clipboardHistory.length > 0
                    ? html`
                  <div class="space-y-2">
                    ${this.clipboardHistory.map(
                      (item) => html`
                      <div class="bg-bg-secondary border border-border rounded-lg p-3 hover:border-primary/50 transition-colors group">
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex items-start gap-3 flex-1 min-w-0">
                            <span class="text-lg flex-shrink-0 mt-0.5">${this.getTypeIcon(item.type)}</span>
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center justify-between gap-2 mb-1">
                                <span class="text-xs text-text-muted">${this.formatTimestamp(item.timestamp)}</span>
                                ${
                                  item.size
                                    ? html`
                                  <span class="text-xs text-text-muted">${this.formatSize(item.size)}</span>
                                `
                                    : ''
                                }
                              </div>
                              <pre class="text-sm text-text whitespace-pre-wrap break-all font-ui leading-relaxed">${item.preview}</pre>
                            </div>
                          </div>
                          
                          <div class="flex items-center gap-1 flex-shrink-0">
                            <button
                              class="p-1.5 text-primary hover:text-primary-hover transition-colors opacity-0 group-hover:opacity-100"
                              @click=${() => this.handlePasteFromHistory(item)}
                              title="Paste this content"
                            >
                              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/>
                                <path d="M3 5a2 2 0 012-2 3 3 0 003 3h4a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L11.414 13H16v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/>
                              </svg>
                            </button>
                            <button
                              class="p-1.5 text-status-error hover:text-status-error/80 transition-colors opacity-0 group-hover:opacity-100"
                              @click=${() => this.handleRemoveHistoryItem(item.id)}
                              title="Remove from history"
                            >
                              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    `
                    )}
                  </div>
                `
                    : html`
                  <div class="text-center py-8">
                    <div class="text-4xl mb-4 opacity-50">📋</div>
                    <p class="text-text-muted mb-2">No clipboard history</p>
                    <p class="text-sm text-text-muted">Copy some content to see it here</p>
                  </div>
                `
                }
              </div>
            `
            }
          </div>
        </div>
      </modal-wrapper>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'clipboard-manager': ClipboardManager;
  }
}

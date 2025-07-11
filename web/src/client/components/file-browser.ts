/**
 * File Browser Component
 *
 * Modal file browser for navigating the filesystem and selecting files/directories.
 * Supports Git status display, file preview with CodeMirror editor, and diff viewing.
 *
 * @fires insert-path - When inserting a file path into terminal (detail: { path: string, type: 'file' | 'directory' })
 * @fires directory-selected - When a directory is selected in 'select' mode (detail: string)
 * @fires browser-cancel - When the browser is cancelled or closed
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { authClient } from '../services/auth-client.js';
import { Z_INDEX } from '../utils/constants.js';
import {
  type GitStatus as GitStatusType,
  getFileIcon,
  getParentDirectoryIcon,
  renderGitStatusBadge,
  UIIcons,
} from '../utils/file-icons.js';
import { createLogger } from '../utils/logger.js';
import { copyToClipboard, formatPathForDisplay } from '../utils/path-utils.js';
import type { Session } from './session-list.js';
import './monaco-editor.js';
import './modal-wrapper.js';

const logger = createLogger('file-browser');

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions?: string;
  isGitTracked?: boolean;
  gitStatus?: GitStatusType;
  isSymlink?: boolean;
}

interface DirectoryListing {
  path: string;
  fullPath: string;
  gitStatus: GitStatus | null;
  files: FileInfo[];
}

interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

interface FilePreview {
  type: 'image' | 'text' | 'binary';
  content?: string;
  language?: string;
  url?: string;
  mimeType?: string;
  size: number;
  humanSize?: string;
}

interface FileDiff {
  path: string;
  diff: string;
  hasDiff: boolean;
}

interface FileDiffContent {
  path: string;
  originalContent: string;
  modifiedContent: string;
  language?: string;
}

@customElement('file-browser')
export class FileBrowser extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: String }) mode: 'browse' | 'select' = 'browse';
  @property({ type: Object }) session: Session | null = null;

  @state() private currentPath = '';
  @state() private currentFullPath = '';
  @state() private files: FileInfo[] = [];
  @state() private loading = false;
  @state() private selectedFile: FileInfo | null = null;
  @state() private preview: FilePreview | null = null;
  @state() private diff: FileDiff | null = null;
  @state() private diffContent: FileDiffContent | null = null;
  @state() private gitFilter: 'all' | 'changed' = 'all';
  @state() private showHidden = false;
  @state() private gitStatus: GitStatus | null = null;
  @state() private previewLoading = false;
  @state() private showDiff = false;
  @state() private errorMessage = '';
  @state() private mobileView: 'list' | 'preview' = 'list';
  @state() private isMobile = window.innerWidth < 768;
  @state() private editingPath = false;
  @state() private pathInputValue = '';

  private editorRef = createRef<HTMLElement>();
  private pathInputRef = createRef<HTMLInputElement>();
  private noAuthMode = false;

  async connectedCallback() {
    super.connectedCallback();

    // Check auth configuration
    await this.checkAuthConfig();

    if (this.visible) {
      this.currentPath = this.session?.workingDir || '.';
      await this.loadDirectory(this.currentPath);
    }
    document.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize);
    this.setupTouchHandlers();
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Only load directory when the component becomes visible or when session changes while visible
    if (changedProperties.has('visible')) {
      if (this.visible) {
        // Component just became visible
        this.currentPath = this.session?.workingDir || '.';
        await this.loadDirectory(this.currentPath);
      }
    } else if (changedProperties.has('session') && this.visible) {
      // Session changed while component is visible
      this.currentPath = this.session?.workingDir || '.';
      await this.loadDirectory(this.currentPath);
    }

    // Monaco editor will handle its own updates through properties
  }

  private async loadDirectory(dirPath: string) {
    this.loading = true;
    try {
      const params = new URLSearchParams({
        path: dirPath,
        showHidden: this.showHidden.toString(),
        gitFilter: this.gitFilter,
      });

      const url = `/api/fs/browse?${params}`;
      logger.debug(`loading directory: ${dirPath}`);
      logger.debug(`fetching URL: ${url}`);

      const headers = this.noAuthMode ? {} : { ...authClient.getAuthHeader() };
      const response = await fetch(url, { headers });
      logger.debug(`response status: ${response.status}`);

      if (response.ok) {
        const data: DirectoryListing = await response.json();
        logger.debug(`received ${data.files?.length || 0} files`);
        this.currentPath = data.path;
        this.currentFullPath = data.fullPath;
        this.files = data.files || [];
        this.gitStatus = data.gitStatus;
        // Clear any previous error message on successful load
        this.errorMessage = '';
      } else {
        let errorMessage = 'Failed to load directory';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response isn't JSON, use default message
          errorMessage = `Failed to load directory (${response.status})`;
        }

        logger.error(`failed to load directory: ${response.status}`, new Error(errorMessage));
        this.showErrorMessage(errorMessage);
      }
    } catch (error) {
      logger.error('error loading directory:', error);
      this.showErrorMessage('Network error loading directory');
    } finally {
      this.loading = false;
    }
  }

  private async loadPreview(file: FileInfo) {
    if (file.type === 'directory') return;

    this.previewLoading = true;
    this.selectedFile = file;
    this.showDiff = false;

    try {
      logger.debug(`loading preview for file: ${file.name}`);
      logger.debug(`file path: ${file.path}`);

      const headers = this.noAuthMode ? {} : { ...authClient.getAuthHeader() };
      const response = await fetch(`/api/fs/preview?path=${encodeURIComponent(file.path)}`, {
        headers,
      });
      if (response.ok) {
        this.preview = await response.json();
        this.requestUpdate(); // Trigger re-render to initialize Monaco if needed
      } else {
        logger.error(`preview failed: ${response.status}`, new Error(await response.text()));
      }
    } catch (error) {
      logger.error('error loading preview:', error);
    } finally {
      this.previewLoading = false;
    }
  }

  private async loadDiff(file: FileInfo) {
    if (file.type === 'directory' || !file.gitStatus || file.gitStatus === 'unchanged') return;

    this.previewLoading = true;
    this.showDiff = true;

    try {
      // Load both the unified diff and the full content for Monaco
      const headers = this.noAuthMode ? {} : { ...authClient.getAuthHeader() };
      const [diffResponse, contentResponse] = await Promise.all([
        fetch(`/api/fs/diff?path=${encodeURIComponent(file.path)}`, {
          headers,
        }),
        fetch(`/api/fs/diff-content?path=${encodeURIComponent(file.path)}`, {
          headers,
        }),
      ]);

      if (diffResponse.ok) {
        this.diff = await diffResponse.json();
      }

      if (contentResponse.ok) {
        this.diffContent = await contentResponse.json();
      }
    } catch (error) {
      logger.error('error loading diff:', error);
    } finally {
      this.previewLoading = false;
    }
  }

  private handleFileClick(file: FileInfo) {
    if (file.type === 'directory') {
      this.loadDirectory(file.path);
    } else {
      // Set the selected file
      this.selectedFile = file;
      // On mobile, switch to preview view
      if (this.isMobile) {
        this.mobileView = 'preview';
      }
      // If git changes filter is active and file has changes, show diff by default
      if (this.gitFilter === 'changed' && file.gitStatus && file.gitStatus !== 'unchanged') {
        this.loadDiff(file);
      } else {
        this.loadPreview(file);
      }
    }
  }

  private async handleCopyToClipboard(text: string) {
    const success = await copyToClipboard(text);
    if (success) {
      logger.debug(`copied to clipboard: ${text}`);
    } else {
      logger.error('failed to copy to clipboard');
    }
  }

  private insertPathIntoTerminal() {
    if (!this.selectedFile) return;

    // Construct absolute path by joining the current directory's full path with the file name
    let absolutePath: string;
    if (this.currentFullPath && this.selectedFile.name) {
      // Join the directory path with the file name
      absolutePath = this.currentFullPath.endsWith('/')
        ? this.currentFullPath + this.selectedFile.name
        : `${this.currentFullPath}/${this.selectedFile.name}`;
    } else {
      // Fallback to relative path if absolute path construction fails
      absolutePath = this.selectedFile.path;
    }

    // Dispatch event with the absolute file path
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: {
          path: absolutePath,
          type: this.selectedFile.type,
        },
        bubbles: true,
        composed: true,
      })
    );

    // Close the file browser
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private showErrorMessage(message: string) {
    this.errorMessage = message;
    // Clear error message after 5 seconds
    setTimeout(() => {
      this.errorMessage = '';
    }, 5000);
  }

  private handleParentClick() {
    // Handle navigation to parent directory
    let parentPath: string;

    if (this.currentFullPath === '/') {
      // Already at root, can't go higher
      return;
    }

    if (this.currentFullPath) {
      // Use full path for accurate parent calculation
      const parts = this.currentFullPath.split('/').filter((part) => part !== '');
      if (parts.length === 0) {
        // We're at root
        parentPath = '/';
      } else {
        // Remove last part to get parent
        parts.pop();
        parentPath = parts.length === 0 ? '/' : `/${parts.join('/')}`;
      }
    } else {
      // Fallback to current path logic
      const parts = this.currentPath.split('/').filter((part) => part !== '');
      if (parts.length <= 1) {
        parentPath = '/';
      } else {
        parts.pop();
        parentPath = `/${parts.join('/')}`;
      }
    }

    this.loadDirectory(parentPath);
  }

  private toggleGitFilter() {
    this.gitFilter = this.gitFilter === 'all' ? 'changed' : 'all';
    this.loadDirectory(this.currentPath);
  }

  private toggleHidden() {
    this.showHidden = !this.showHidden;
    this.loadDirectory(this.currentPath);
  }

  private toggleDiff() {
    if (this.selectedFile?.gitStatus && this.selectedFile.gitStatus !== 'unchanged') {
      if (this.showDiff) {
        this.loadPreview(this.selectedFile);
      } else {
        this.loadDiff(this.selectedFile);
      }
    }
  }

  private handleSelect() {
    if (this.mode === 'select' && this.currentPath) {
      this.dispatchEvent(
        new CustomEvent('directory-selected', {
          detail: this.currentPath,
        })
      );
    }
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private renderPreview() {
    if (this.previewLoading) {
      return html`
        <div class="flex items-center justify-center h-full text-dark-text-muted">
          Loading preview...
        </div>
      `;
    }

    if (this.showDiff && this.diff) {
      return this.renderDiff();
    }

    if (!this.preview) {
      return html`
        <div class="flex flex-col items-center justify-center h-full text-dark-text-muted">
          ${UIIcons.preview}
          <div>Select a file to preview</div>
        </div>
      `;
    }

    switch (this.preview.type) {
      case 'image':
        return html`
          <div class="flex items-center justify-center p-4 h-full">
            <img
              src="${this.preview.url}"
              alt="${this.selectedFile?.name}"
              class="max-w-full max-h-full object-contain rounded"
            />
          </div>
        `;

      case 'text':
        return html`
          <monaco-editor
            ${ref(this.editorRef)}
            .content=${this.preview.content || ''}
            .language=${this.preview.language || ''}
            .filename=${this.selectedFile?.name || ''}
            .readOnly=${true}
            mode="normal"
            class="h-full w-full"
          ></monaco-editor>
        `;

      case 'binary':
        return html`
          <div class="flex flex-col items-center justify-center h-full text-dark-text-muted">
            ${UIIcons.binary}
            <div class="text-lg mb-2">Binary File</div>
            <div class="text-sm">${this.preview.humanSize || `${this.preview.size} bytes`}</div>
            <div class="text-sm text-dark-text-muted mt-2">
              ${this.preview.mimeType || 'Unknown type'}
            </div>
          </div>
        `;
    }
  }

  private renderDiff() {
    // For new files (added or untracked), we might not have a diff but we have diffContent
    if (!this.diffContent && (!this.diff || !this.diff.diff)) {
      return html`
        <div class="flex items-center justify-center h-full text-dark-text-muted">
          No changes in this file
        </div>
      `;
    }

    // If we have diff content, show it in Monaco's diff editor
    if (this.diffContent) {
      return html`
        <monaco-editor
          ${ref(this.editorRef)}
          .originalContent=${this.diffContent.originalContent || ''}
          .modifiedContent=${this.diffContent.modifiedContent || ''}
          .language=${this.diffContent.language || ''}
          .filename=${this.selectedFile?.name || ''}
          .readOnly=${true}
          mode="diff"
          .showModeToggle=${true}
          class="h-full w-full"
        ></monaco-editor>
      `;
    }

    // Fallback to simple diff display
    if (!this.diff) return html``;
    const lines = this.diff.diff.split('\n');
    return html`
      <div class="overflow-auto h-full p-4 font-mono text-xs">
        ${lines.map((line) => {
          let className = 'text-dark-text-muted';
          if (line.startsWith('+')) className = 'text-status-success bg-green-900/20';
          else if (line.startsWith('-')) className = 'text-status-error bg-red-900/20';
          else if (line.startsWith('@@')) className = 'text-status-info font-semibold';

          return html`<div class="whitespace-pre ${className}">${line}</div>`;
        })}
      </div>
    `;
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center" style="z-index: ${Z_INDEX.FILE_BROWSER};" @click=${this.handleCancel}>
        <div class="fixed inset-0 bg-dark-bg flex flex-col" style="z-index: ${Z_INDEX.FILE_BROWSER};" @click=${(e: Event) => e.stopPropagation()}>
        ${
          this.isMobile && this.mobileView === 'preview'
            ? html`
              <div class="absolute top-1/2 left-2 -translate-y-1/2 text-dark-text-muted opacity-50">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                  ></path>
                </svg>
              </div>
            `
            : ''
        }
        <div
          class="w-full h-full flex flex-col overflow-hidden"
          data-testid="file-browser"
        >
          <!-- Compact Header (like session-view) -->
          <div
            class="flex items-center justify-between px-3 py-2 border-b border-dark-border text-sm min-w-0 bg-dark-bg-secondary"
            style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(0.75rem, env(safe-area-inset-left)); padding-right: max(0.75rem, env(safe-area-inset-right));"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <button
                class="text-dark-text-muted hover:text-dark-text font-mono text-xs px-2 py-1 flex-shrink-0 transition-colors flex items-center gap-1"
                @click=${this.handleCancel}
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 19l-7-7 7-7"
                  ></path>
                </svg>
                <span>Back</span>
              </button>
              <div class="text-dark-text min-w-0 flex-1 overflow-hidden">
                ${
                  this.editingPath
                    ? html`
                      <input
                        ${ref(this.pathInputRef)}
                        type="text"
                        .value=${this.pathInputValue}
                        @input=${this.handlePathInput}
                        @keydown=${this.handlePathKeyDown}
                        @blur=${this.handlePathBlur}
                        class="bg-dark-bg border border-dark-border rounded px-2 py-1 text-status-info text-xs sm:text-sm font-mono w-full min-w-0 focus:outline-none focus:border-primary"
                        placeholder="Enter path and press Enter"
                      />
                    `
                    : html`
                      <div
                        class="text-blue-400 text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap font-mono cursor-pointer hover:bg-dark-bg-lighter rounded px-1 py-1 -mx-1"
                        title="${
                          this.currentFullPath || this.currentPath || 'File Browser'
                        } (click to edit)"
                        @click=${this.handlePathClick}
                      >
                        ${formatPathForDisplay(this.currentFullPath || this.currentPath || 'File Browser')}
                      </div>
                    `
                }
              </div>
            </div>
            <div class="flex items-center gap-2 text-xs flex-shrink-0 ml-2">
              ${
                this.errorMessage
                  ? html`
                    <div
                      class="bg-red-500/20 border border-red-500 text-red-400 px-2 py-1 rounded text-xs"
                    >
                      ${this.errorMessage}
                    </div>
                  `
                  : ''
              }
            </div>
          </div>

          <!-- Main content -->
          <div class="flex-1 flex overflow-hidden">
            <!-- File list -->
            <div
              class="${this.isMobile && this.mobileView === 'preview' ? 'hidden' : ''} ${
                this.isMobile ? 'w-full' : 'w-80'
              } bg-dark-bg-secondary border-r border-dark-border flex flex-col"
            >
              <!-- File list header with toggles -->
              <div
                class="bg-dark-bg-secondary border-b border-dark-border p-3 flex items-center justify-between"
              >
                <div class="flex gap-2">
                  <button
                    class="btn-secondary text-xs px-2 py-1 font-mono ${
                      this.gitFilter === 'changed' ? 'bg-primary text-black' : ''
                    }"
                    @click=${this.toggleGitFilter}
                    title="Show only Git changes"
                  >
                    Git Changes
                  </button>
                  <button
                    class="btn-secondary text-xs px-2 py-1 font-mono ${
                      this.showHidden ? 'bg-primary text-black' : ''
                    }"
                    @click=${this.toggleHidden}
                    title="Show hidden files"
                  >
                    Hidden Files
                  </button>
                </div>
                ${
                  this.gitStatus?.branch
                    ? html`
                      <span class="text-dark-text-muted text-xs flex items-center gap-1 font-mono">
                        ${UIIcons.git} ${this.gitStatus.branch}
                      </span>
                    `
                    : ''
                }
              </div>

              <!-- File list content -->
              <div
                class="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30"
              >
                ${
                  this.loading
                    ? html`
                      <div class="flex items-center justify-center h-full text-dark-text-muted">
                        Loading...
                      </div>
                    `
                    : html`
                      ${
                        this.currentFullPath !== '/'
                          ? html`
                            <div
                              class="p-3 hover:bg-dark-bg-lighter cursor-pointer transition-colors flex items-center gap-2 border-b border-dark-border"
                              @click=${this.handleParentClick}
                            >
                              ${getParentDirectoryIcon()}
                              <span class="text-dark-text-muted">..</span>
                            </div>
                          `
                          : ''
                      }
                      ${this.files.map(
                        (file) => html`
                          <div
                            class="p-3 hover:bg-dark-bg-lighter cursor-pointer transition-colors flex items-center gap-2 
                            ${
                              this.selectedFile?.path === file.path
                                ? 'bg-dark-bg-lighter border-l-2 border-primary'
                                : ''
                            }"
                            @click=${() => this.handleFileClick(file)}
                          >
                            <span class="flex-shrink-0 relative">
                              ${getFileIcon(file.name, file.type)}
                              ${
                                file.isSymlink
                                  ? html`
                                    <svg
                                      class="w-3 h-3 text-dark-text-muted absolute -bottom-1 -right-1"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fill-rule="evenodd"
                                        d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                                        clip-rule="evenodd"
                                      />
                                    </svg>
                                  `
                                  : ''
                              }
                            </span>
                            <span
                              class="flex-1 text-sm whitespace-nowrap ${
                                file.type === 'directory' ? 'text-status-info' : 'text-dark-text'
                              }"
                              title="${file.name}${file.isSymlink ? ' (symlink)' : ''}"
                              >${file.name}</span
                            >
                            <span class="flex-shrink-0"
                              >${renderGitStatusBadge(file.gitStatus)}</span
                            >
                          </div>
                        `
                      )}
                    `
                }
              </div>
            </div>

            <!-- Preview pane -->
            <div
              class="${this.isMobile && this.mobileView === 'list' ? 'hidden' : ''} ${
                this.isMobile ? 'w-full' : 'flex-1'
              } bg-dark-bg flex flex-col overflow-hidden"
            >
              ${
                this.selectedFile
                  ? html`
                    <div
                      class="bg-dark-bg-secondary border-b border-dark-border p-3 ${
                        this.isMobile ? 'space-y-2' : 'flex items-center justify-between'
                      }"
                    >
                      <div class="flex items-center gap-2 ${this.isMobile ? 'min-w-0' : ''}">
                        ${
                          this.isMobile
                            ? html`
                              <button
                                @click=${() => {
                                  this.mobileView = 'list';
                                }}
                                class="text-dark-text-muted hover:text-dark-text transition-colors flex-shrink-0"
                                title="Back to files"
                              >
                                <svg
                                  class="w-5 h-5"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M15 19l-7-7 7-7"
                                  ></path>
                                </svg>
                              </button>
                            `
                            : ''
                        }
                        <span class="flex-shrink-0 relative"
                          >${getFileIcon(this.selectedFile.name, this.selectedFile.type)}
                          ${
                            this.selectedFile.isSymlink
                              ? html`
                                <svg
                                  class="w-3 h-3 text-dark-text-muted absolute -bottom-1 -right-1"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fill-rule="evenodd"
                                    d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                                    clip-rule="evenodd"
                                  />
                                </svg>
                              `
                              : ''
                          }
                        </span>
                        <span class="font-mono text-sm ${this.isMobile ? 'truncate' : ''}"
                          >${this.selectedFile.name}${this.selectedFile.isSymlink ? ' →' : ''}</span
                        >
                        ${renderGitStatusBadge(this.selectedFile.gitStatus)}
                      </div>
                      <div
                        class="${
                          this.isMobile ? 'grid grid-cols-2 gap-2' : 'flex gap-2 flex-shrink-0'
                        }"
                      >
                        ${
                          this.selectedFile.type === 'file'
                            ? html`
                              <button
                                class="btn-secondary text-xs px-2 py-1 font-mono"
                                @click=${() =>
                                  this.selectedFile &&
                                  this.handleCopyToClipboard(this.selectedFile.path)}
                                title="Copy path to clipboard (⌘C)"
                              >
                                Copy Path
                              </button>
                              ${
                                this.mode === 'browse'
                                  ? html`
                                    <button
                                      class="btn-primary text-xs px-2 py-1 font-mono"
                                      @click=${this.insertPathIntoTerminal}
                                      title="Insert path into terminal (Enter)"
                                    >
                                      Insert Path
                                    </button>
                                  `
                                  : ''
                              }
                            `
                            : ''
                        }
                        ${
                          this.selectedFile.gitStatus && this.selectedFile.gitStatus !== 'unchanged'
                            ? html`
                              <button
                                class="btn-secondary text-xs px-2 py-1 font-mono ${
                                  this.showDiff ? 'bg-primary text-black' : ''
                                } ${
                                  this.isMobile &&
                                  this.selectedFile.type === 'file' &&
                                  this.mode === 'browse'
                                    ? ''
                                    : 'col-span-2'
                                }"
                                @click=${this.toggleDiff}
                              >
                                ${this.showDiff ? 'View File' : 'View Diff'}
                              </button>
                            `
                            : ''
                        }
                      </div>
                    </div>
                  `
                  : ''
              }
              <div class="flex-1 overflow-hidden">${this.renderPreview()}</div>
            </div>
          </div>

          ${
            this.mode === 'select'
              ? html`
                <div class="p-4 border-t border-dark-border flex gap-4">
                  <button class="btn-ghost font-mono flex-1" @click=${this.handleCancel}>
                    Cancel
                  </button>
                  <button class="btn-primary font-mono flex-1" @click=${this.handleSelect}>
                    Select Directory
                  </button>
                </div>
              `
              : ''
          }
        </div>
        </div>
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);
    this.removeTouchHandlers();
  }

  private async checkAuthConfig() {
    try {
      const response = await fetch('/api/auth/config');
      if (response.ok) {
        const config = await response.json();
        this.noAuthMode = config.noAuth === true;
        logger.debug('Auth config:', config);
      }
    } catch (error) {
      logger.error('Failed to fetch auth config:', error);
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.visible) return;

    if (e.key === 'Escape') {
      // Only handle escape when editing path - modal-wrapper handles the general escape
      if (this.editingPath) {
        e.preventDefault();
        e.stopImmediatePropagation(); // Prevent modal-wrapper from also handling it
        this.cancelPathEdit();
      }
      // Let modal-wrapper handle the escape for closing the modal
    } else if (
      e.key === 'Enter' &&
      this.selectedFile &&
      this.selectedFile.type === 'file' &&
      !this.editingPath
    ) {
      e.preventDefault();
      this.insertPathIntoTerminal();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c' && this.selectedFile) {
      e.preventDefault();
      this.handleCopyToClipboard(this.selectedFile.path);
    }
  };

  private handleResize = () => {
    this.isMobile = window.innerWidth < 768;
    if (!this.isMobile && this.mobileView === 'preview') {
      this.mobileView = 'list';
    }
  };

  private touchStartX = 0;
  private touchStartY = 0;

  private setupTouchHandlers() {
    if (!this.isMobile) return;

    const handleTouchStart = (e: TouchEvent) => {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!this.visible || !this.isMobile) return;

      const deltaX = e.changedTouches[0].clientX - this.touchStartX;
      const deltaY = Math.abs(e.changedTouches[0].clientY - this.touchStartY);

      // Only handle horizontal swipes
      if (Math.abs(deltaX) > 50 && deltaY < 50) {
        if (deltaX > 0) {
          // Swipe right
          if (this.mobileView === 'preview') {
            this.mobileView = 'list';
          } else {
            this.handleCancel();
          }
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);

    // Store handlers for removal
    interface TouchHandlers {
      handleTouchStart: (e: TouchEvent) => void;
      handleTouchEnd: (e: TouchEvent) => void;
    }
    (this as unknown as { _touchHandlers: TouchHandlers })._touchHandlers = {
      handleTouchStart,
      handleTouchEnd,
    };
  }

  private removeTouchHandlers() {
    interface TouchHandlers {
      handleTouchStart: (e: TouchEvent) => void;
      handleTouchEnd: (e: TouchEvent) => void;
    }
    const handlers = (this as unknown as { _touchHandlers?: TouchHandlers })._touchHandlers;
    if (handlers) {
      document.removeEventListener('touchstart', handlers.handleTouchStart);
      document.removeEventListener('touchend', handlers.handleTouchEnd);
    }
  }

  private handlePathClick() {
    this.editingPath = true;
    this.pathInputValue = this.currentFullPath || this.currentPath || '';
    this.requestUpdate();
    // Focus the input after render
    setTimeout(() => {
      if (this.pathInputRef.value) {
        this.pathInputRef.value.focus();
        this.pathInputRef.value.select();
      }
    }, 0);
  }

  private handlePathInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.pathInputValue = input.value;
  }

  private handlePathKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.navigateToPath();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelPathEdit();
    }
  }

  private handlePathBlur() {
    // Don't cancel on blur, let user decide with Escape or Enter
    // this.cancelPathEdit();
  }

  private async navigateToPath() {
    const path = this.pathInputValue.trim();
    if (path) {
      this.editingPath = false;
      await this.loadDirectory(path);
    } else {
      this.cancelPathEdit();
    }
  }

  private cancelPathEdit() {
    this.editingPath = false;
    this.pathInputValue = '';
  }
}

/**
 * Monaco Editor Component
 *
 * A Lit component that wraps Monaco Editor with support for:
 * - Normal code editing mode
 * - Diff mode with inline/side-by-side switching
 * - Automatic language detection
 * - Dark theme matching VibeTunnel's design
 *
 * @fires save - When save is triggered (Cmd/Ctrl+S) in edit mode (detail: { content: string })
 * @fires content-changed - When content changes in edit mode (detail: { content: string })
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { editor } from 'monaco-editor';
import { createLogger } from '../utils/logger.js';
import { initializeMonaco } from '../utils/monaco-loader.js';

const logger = createLogger('monaco-editor');

// Import Monaco Editor types
declare global {
  interface Window {
    monaco: typeof import('monaco-editor');
  }
}

export interface MonacoEditorOptions {
  theme?: string;
  readOnly?: boolean;
  language?: string;
  automaticLayout?: boolean;
  minimap?: { enabled: boolean };
  fontSize?: number;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  scrollBeyondLastLine?: boolean;
  renderWhitespace?: 'all' | 'none' | 'boundary' | 'selection' | 'trailing';
}

@customElement('monaco-editor')
export class MonacoEditor extends LitElement {
  @property({ type: String }) content = '';
  @property({ type: String }) originalContent = '';
  @property({ type: String }) modifiedContent = '';
  @property({ type: String }) language = '';
  @property({ type: String }) filename = '';
  @property({ type: Boolean }) readOnly = false;
  @property({ type: String }) mode: 'normal' | 'diff' = 'normal';
  @property({ type: Boolean }) showModeToggle = false;
  @property({ type: Object }) options: MonacoEditorOptions = {};

  @state() private isLoading = true;
  @state() private diffMode: 'inline' | 'sideBySide' = 'sideBySide';
  @state() private containerWidth = 0;

  private containerRef = createRef<HTMLDivElement>();
  private editor: editor.IStandaloneCodeEditor | editor.IStandaloneDiffEditor | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private monacoLoaded = false;

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.loadMonaco();
    this.setupResizeObserver();
    // Wait for the first render to complete
    await this.updateComplete;
    // Create editor if container is ready
    if (this.containerRef.value && !this.editor && !this.isLoading) {
      await this.createEditor();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disposeEditor();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private async loadMonaco() {
    if (this.monacoLoaded || window.monaco) {
      this.monacoLoaded = true;
      this.isLoading = false;
      return;
    }

    try {
      logger.debug('Loading Monaco Editor...');
      // Initialize Monaco
      await initializeMonaco();
      this.monacoLoaded = true;
      this.isLoading = false;
      logger.debug('Monaco Editor loaded successfully');
    } catch (error) {
      logger.error('Failed to load Monaco Editor:', error);
      this.isLoading = false;
    }
  }

  private setupResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.containerWidth = entry.contentRect.width;
        // Auto-switch diff mode based on width
        if (this.mode === 'diff' && this.editor) {
          const shouldBeInline = this.containerWidth < 768; // Mobile breakpoint
          const newMode = shouldBeInline ? 'inline' : 'sideBySide';
          if (newMode !== this.diffMode) {
            this.diffMode = newMode;
            this.recreateEditor();
          }
        }
        // Trigger Monaco's layout update
        if (this.editor) {
          this.editor.layout();
        }
      }
    });

    if (this.containerRef.value) {
      this.resizeObserver.observe(this.containerRef.value);
    }
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Check if we need to create or recreate the editor
    const needsRecreate =
      changedProperties.has('mode') ||
      (changedProperties.has('content') && !this.editor) ||
      (changedProperties.has('originalContent') && this.mode === 'diff') ||
      (changedProperties.has('modifiedContent') && this.mode === 'diff');

    if (needsRecreate && !this.isLoading && this.containerRef.value) {
      await this.recreateEditor();
    } else if (this.editor && !this.isLoading) {
      // Update existing editor
      if (changedProperties.has('content') && this.mode === 'normal') {
        this.updateContent();
      }
      if (changedProperties.has('language') || changedProperties.has('filename')) {
        this.updateLanguage();
      }
      if (changedProperties.has('readOnly')) {
        this.updateReadOnly();
      }
    }
  }

  private async recreateEditor() {
    this.disposeEditor();
    await this.createEditor();
  }

  private async createEditor() {
    if (!this.containerRef.value || !window.monaco) {
      return;
    }

    try {
      // Set up the dark theme
      this.setupTheme();

      const commonOptions: editor.IEditorConstructionOptions = {
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "'Fira Code', Menlo, Monaco, 'Courier New', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        readOnly: this.readOnly,
        // Enable folding
        folding: true,
        foldingStrategy: 'indentation', // Use indentation-based folding instead of language-aware
        foldingHighlight: true,
        showFoldingControls: 'always',
        // Ensure decorations are visible
        renderLineHighlight: 'all',
        renderLineHighlightOnlyWhenFocus: false,
        ...this.options,
      };

      if (this.mode === 'diff') {
        // Create diff editor with exact options from lemmy
        const diffOptions: editor.IDiffEditorConstructionOptions = {
          readOnly: true,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          renderWhitespace: 'selection',
          renderSideBySide: this.diffMode === 'sideBySide',
          ignoreTrimWhitespace: false,
        };

        this.editor = window.monaco.editor.createDiffEditor(this.containerRef.value, diffOptions);

        // Set models for diff
        const language = this.detectLanguage();
        const timestamp = Date.now();
        const baseUri = `${this.filename || 'untitled'}-${timestamp}`;

        // Create models exactly like lemmy
        const originalModel = window.monaco.editor.createModel(
          this.originalContent || '',
          language,
          window.monaco.Uri.parse(`file:///${baseUri}#original`)
        );
        const modifiedModel = window.monaco.editor.createModel(
          this.modifiedContent || '',
          language,
          window.monaco.Uri.parse(`file:///${baseUri}#modified`)
        );

        logger.debug('Creating diff editor');

        // Set the models exactly like lemmy does
        const diffEditor = this.editor as editor.IStandaloneDiffEditor;
        diffEditor.setModel({
          original: originalModel,
          modified: modifiedModel,
        });

        // Wait for diff computation like lemmy does
        const restoreLayout = () => {
          if (this.editor) {
            this.editor.layout();
          }
        };

        // Listen for diff computation completion
        const disposable = diffEditor.onDidUpdateDiff(() => {
          restoreLayout();
          disposable.dispose();
        });

        // Also try after timeout as fallback
        setTimeout(restoreLayout, 200);
      } else {
        // Create normal editor
        this.editor = window.monaco.editor.create(this.containerRef.value, {
          ...commonOptions,
          value: this.content,
          language: this.detectLanguage(),
        });

        // Add save command
        if (!this.readOnly) {
          (this.editor as editor.IStandaloneCodeEditor).addCommand(
            window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
            () => {
              this.handleSave();
            }
          );

          // Listen for content changes
          (this.editor as editor.IStandaloneCodeEditor).onDidChangeModelContent(() => {
            const content = (this.editor as editor.IStandaloneCodeEditor)?.getValue() || '';
            this.dispatchEvent(
              new CustomEvent('content-changed', {
                detail: { content },
                bubbles: true,
                composed: true,
              })
            );
          });
        }
      }

      logger.debug(`Created ${this.mode} editor`);
    } catch (error) {
      logger.error('Failed to create editor:', error);
    }
  }

  private setupTheme() {
    // Use the default VS dark theme
    if (!window.monaco) return;
    // Theme is already handled by monaco-loader.ts with theme change observer
  }

  private detectLanguage(): string {
    if (this.language) {
      return this.language;
    }

    if (this.filename) {
      const ext = this.filename.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        html: 'html',
        htm: 'html',
        css: 'css',
        scss: 'scss',
        sass: 'sass',
        less: 'less',
        py: 'python',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        cs: 'csharp',
        php: 'php',
        swift: 'swift',
        kt: 'kotlin',
        scala: 'scala',
        r: 'r',
        sql: 'sql',
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',
        fish: 'shell',
        ps1: 'powershell',
        yml: 'yaml',
        yaml: 'yaml',
        xml: 'xml',
        md: 'markdown',
        markdown: 'markdown',
        dockerfile: 'dockerfile',
        makefile: 'makefile',
        gitignore: 'gitignore',
      };

      return languageMap[ext || ''] || 'plaintext';
    }

    return 'plaintext';
  }

  private updateContent() {
    if (!this.editor || this.mode === 'diff') return;

    const currentValue = (this.editor as editor.IStandaloneCodeEditor).getValue();
    if (currentValue !== this.content) {
      (this.editor as editor.IStandaloneCodeEditor).setValue(this.content);
    }
  }

  private updateLanguage() {
    if (!this.editor || !window.monaco) return;

    const language = this.detectLanguage();

    if (this.mode === 'normal') {
      const model = (this.editor as editor.IStandaloneCodeEditor).getModel();
      if (model) {
        window.monaco.editor.setModelLanguage(model, language);
      }
    } else {
      // For diff editor, update both models
      const diffEditor = this.editor as editor.IStandaloneDiffEditor;
      const originalModel = diffEditor.getOriginalEditor().getModel();
      const modifiedModel = diffEditor.getModifiedEditor().getModel();

      if (originalModel) {
        window.monaco.editor.setModelLanguage(originalModel, language);
      }
      if (modifiedModel) {
        window.monaco.editor.setModelLanguage(modifiedModel, language);
      }
    }
  }

  private updateReadOnly() {
    if (!this.editor) return;

    if (this.mode === 'normal') {
      (this.editor as editor.IStandaloneCodeEditor).updateOptions({ readOnly: this.readOnly });
    } else {
      const diffEditor = this.editor as editor.IStandaloneDiffEditor;
      diffEditor.getModifiedEditor().updateOptions({ readOnly: this.readOnly });
    }
  }

  private handleSave() {
    if (this.readOnly || !this.editor || this.mode === 'diff') return;

    const content = (this.editor as editor.IStandaloneCodeEditor).getValue();
    this.dispatchEvent(
      new CustomEvent('save', {
        detail: { content },
        bubbles: true,
        composed: true,
      })
    );
  }

  private toggleDiffMode() {
    if (this.mode !== 'diff') return;

    this.diffMode = this.diffMode === 'inline' ? 'sideBySide' : 'inline';
    // Store current models to reuse
    let originalContent = '';
    let modifiedContent = '';

    if (this.editor) {
      const diffEditor = this.editor as editor.IStandaloneDiffEditor;
      const model = diffEditor.getModel();
      if (model) {
        originalContent = model.original?.getValue() || this.originalContent || '';
        modifiedContent = model.modified?.getValue() || this.modifiedContent || '';
      }
    }

    // Update content before recreating
    this.originalContent = originalContent;
    this.modifiedContent = modifiedContent;

    this.recreateEditor();
  }

  private disposeEditor() {
    if (this.editor) {
      // For diff editor, we need to handle model disposal carefully
      if (this.mode === 'diff') {
        const diffEditor = this.editor as editor.IStandaloneDiffEditor;

        // Get the current model before clearing
        const currentModel = diffEditor.getModel();

        // Clear the model from the editor first to prevent disposal errors
        diffEditor.setModel(null);

        // Now safely dispose the models after they're detached
        if (currentModel) {
          // Small delay to ensure editor has released the models
          setTimeout(() => {
            currentModel.original?.dispose();
            currentModel.modified?.dispose();
          }, 0);
        }
      }

      // Dispose the editor
      this.editor.dispose();
      this.editor = null;
    }
  }

  render() {
    return html`
      <div
        class="monaco-editor-root"
        style="display: block; width: 100%; height: 100%; position: relative;"
      >
        <div
          class="editor-container"
          ${ref(this.containerRef)}
          style="width: 100%; height: 100%; position: relative; background: rgb(var(--color-bg-secondary));"
        >
          ${
            this.isLoading
              ? html`
                <div
                  class="loading"
                  style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: rgb(var(--color-text-muted)); font-family: ui-monospace, monospace;"
                >
                  Loading editor...
                </div>
              `
              : ''
          }
          ${
            this.showModeToggle && this.mode === 'diff' && !this.isLoading
              ? html`
                <button
                  class="mode-toggle"
                  style="position: absolute; top: 10px; right: 10px; z-index: 10; background: rgb(var(--color-surface)); border: 1px solid rgb(var(--color-border)); color: rgb(var(--color-text)); padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;"
                  @click=${this.toggleDiffMode}
                  title="Toggle between inline and side-by-side diff"
                  @mouseenter=${(e: MouseEvent) => {
                    const btn = e.target as HTMLButtonElement;
                    btn.style.background = 'rgb(var(--color-surface-hover))';
                    btn.style.borderColor = 'rgb(var(--color-border-focus))';
                  }}
                  @mouseleave=${(e: MouseEvent) => {
                    const btn = e.target as HTMLButtonElement;
                    btn.style.background = 'rgb(var(--color-surface))';
                    btn.style.borderColor = 'rgb(var(--color-border))';
                  }}
                >
                  ${this.diffMode === 'inline' ? 'Side by Side' : 'Inline'}
                </button>
              `
              : ''
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'monaco-editor': MonacoEditor;
  }
}

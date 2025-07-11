/**
 * Monaco Editor Loader
 *
 * Handles loading and initialization of Monaco Editor for the application.
 * This module ensures Monaco is properly loaded and configured before use.
 */
import { createLogger } from './logger.js';

const logger = createLogger('monaco-loader');

// Declare monaco on window
declare global {
  interface Window {
    monaco: typeof import('monaco-editor');
    require: {
      (dependencies: string[], callback: (...args: unknown[]) => void): void;
      config: (config: { paths: { [key: string]: string } }) => void;
    };
  }
}

// Flag to track if Monaco has been initialized
let isInitialized = false;
let loadingPromise: Promise<void> | null = null;

/**
 * Load Monaco Editor using AMD loader
 */
async function loadMonacoEditor(): Promise<void> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    // Create script tag for loader.js
    const loaderScript = document.createElement('script');
    loaderScript.src = '/monaco-editor/vs/loader.js';

    loaderScript.onload = () => {
      // Configure require
      window.require.config({
        paths: {
          vs: '/monaco-editor/vs',
        },
      });

      // Disable workers - they interfere with diff computation
      // Monaco will fall back to synchronous mode which works fine
      window.MonacoEnvironment = {
        getWorker: (_workerId: string, _label: string): Worker => {
          // Return a dummy worker that will never be used
          // Monaco will fall back to synchronous mode
          return new Worker('data:,');
        },
      };

      // Load monaco
      window.require(['vs/editor/editor.main'], () => {
        logger.debug('Monaco Editor loaded via AMD');
        resolve();
      });
    };

    loaderScript.onerror = () => {
      reject(new Error('Failed to load Monaco loader script'));
    };

    document.head.appendChild(loaderScript);
  });

  return loadingPromise;
}

/**
 * Initialize Monaco Editor with custom configuration
 */
export async function initializeMonaco(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    logger.debug('Loading Monaco Editor...');

    // Load Monaco if not already loaded
    if (!window.monaco) {
      await loadMonacoEditor();
    }

    logger.debug('Initializing Monaco Editor...');

    // Make Monaco available globally
    const monaco = window.monaco;

    // Configure languages
    monaco.languages.register({ id: 'shell' });
    monaco.languages.setMonarchTokensProvider('shell', {
      tokenizer: {
        root: [
          [/^#.*$/, 'comment'],
          [/\$\w+/, 'variable'],
          [
            /\b(echo|cd|ls|grep|find|chmod|mkdir|rm|cp|mv|touch|cat|sed|awk|curl|wget|git|pnpm|npm|yarn|docker|kubectl)\b/,
            'keyword',
          ],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
        ],
      },
    });

    // Set initial theme based on current theme
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');

    // Watch for theme changes
    const themeObserver = new MutationObserver(() => {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark';
      monaco.editor.setTheme(currentTheme ? 'vs-dark' : 'vs');
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Add custom themes if needed
    /*monaco.editor.defineTheme('vibetunnel-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '608b4e' },
        { token: 'keyword', foreground: '569cd6' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'class', foreground: '4ec9b0' },
        { token: 'function', foreground: 'dcdcaa' },
        { token: 'variable', foreground: '9cdcfe' },
        { token: 'constant', foreground: '4fc1ff' },
        { token: 'parameter', foreground: '9cdcfe' },
        { token: 'property', foreground: '9cdcfe' },
        { token: 'punctuation', foreground: 'd4d4d4' },
        { token: 'operator', foreground: 'd4d4d4' },
        { token: 'namespace', foreground: '4ec9b0' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#2a2a2a',
        'editorCursor.foreground': '#10b981',
        'editor.findMatchBackground': '#515c6a',
        'editor.findMatchHighlightBackground': '#ea5e5e55',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
      },
    });*/

    isInitialized = true;
    logger.debug('Monaco Editor initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Monaco Editor:', error);
    throw error;
  }
}

/**
 * Ensure Monaco is loaded and ready
 */
export async function ensureMonacoLoaded(): Promise<typeof import('monaco-editor')> {
  await initializeMonaco();
  return window.monaco;
}

// Export monaco getter - use a getter to avoid accessing window at module load time
export const monaco = typeof window !== 'undefined' ? window.monaco : undefined;

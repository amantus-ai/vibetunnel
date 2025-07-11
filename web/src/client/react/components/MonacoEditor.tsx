import { type editor, KeyCode, KeyMod } from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MonacoEditor');

// Dynamic import for Monaco to avoid loading it until needed
let monacoPromise: Promise<typeof import('monaco-editor')> | null = null;

async function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = import('monaco-editor');
  }
  return monacoPromise;
}

interface MonacoEditorProps {
  value?: string;
  language?: string;
  theme?: 'vs-dark' | 'vs' | 'hc-black';
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  options?: editor.IStandaloneEditorConstructionOptions;
}

export function MonacoEditor({
  value = '',
  language = 'plaintext',
  theme = 'vs-dark',
  onChange,
  onSave,
  readOnly = false,
  className = '',
  options = {},
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize Monaco editor
  useEffect(() => {
    let mounted = true;
    let editorInstance: editor.IStandaloneCodeEditor | null = null;

    const initEditor = async () => {
      if (!containerRef.current) return;

      try {
        const monaco = await loadMonaco();
        if (!mounted) return;

        // Create editor
        editorInstance = monaco.editor.create(containerRef.current, {
          value,
          language,
          theme,
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          ...options,
        });

        editorRef.current = editorInstance;

        // Set up change listener
        const changeDisposable = editorInstance.onDidChangeModelContent(() => {
          if (onChange) {
            onChange(editorInstance?.getValue() ?? '');
          }
        });

        // Set up keyboard shortcuts
        editorInstance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
          if (onSave) {
            onSave(editorInstance?.getValue() ?? '');
          }
        });

        setIsLoading(false);

        // Cleanup
        return () => {
          changeDisposable.dispose();
          editorInstance?.dispose();
        };
      } catch (err) {
        logger.error('Failed to initialize Monaco editor:', err);
        setError('Failed to load editor');
        setIsLoading(false);
      }
    };

    initEditor();

    return () => {
      mounted = false;
      editorInstance?.dispose();
    };
  }, [language, onChange, onSave, options, readOnly, theme, value]);

  // Update editor value when prop changes
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.getValue()) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  // Update editor language when prop changes
  useEffect(() => {
    if (editorRef.current) {
      loadMonaco().then((monaco) => {
        const model = editorRef.current?.getModel();
        if (model) {
          monaco.editor.setModelLanguage(model, language);
        }
      });
    }
  }, [language]);

  // Update editor theme when prop changes
  useEffect(() => {
    if (editorRef.current) {
      loadMonaco().then((monaco) => {
        monaco.editor.setTheme(theme);
      });
    }
  }, [theme]);

  // Update readonly state when prop changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly });
    }
  }, [readOnly]);

  const handleResize = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.layout();
    }
  }, []);

  // Handle resize
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  return (
    <div className={`relative ${className}`} style={{ minHeight: '300px' }}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
          <div className="text-gray-400">Loading editor...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
          <div className="text-red-400">{error}</div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createLogger } from '../../utils/logger';
import { FileBrowser } from '../components/FileBrowser';
import { Header } from '../components/Header';
import { MonacoEditor } from '../components/MonacoEditor';

const logger = createLogger('FileEditorPage');

interface FileContent {
  path: string;
  content: string;
  language: string;
}

export function FileEditorPage() {
  const _navigate = useNavigate();
  const [currentFile, setCurrentFile] = useState<FileContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
        return 'javascript';
      case 'jsx':
        return 'javascript';
      case 'ts':
        return 'typescript';
      case 'tsx':
        return 'typescript';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'scss':
        return 'scss';
      case 'less':
        return 'less';
      case 'md':
        return 'markdown';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      case 'cpp':
      case 'cc':
      case 'cxx':
        return 'cpp';
      case 'c':
        return 'c';
      case 'h':
      case 'hpp':
        return 'cpp';
      case 'java':
        return 'java';
      case 'rb':
        return 'ruby';
      case 'php':
        return 'php';
      case 'sh':
      case 'bash':
        return 'shell';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'xml':
        return 'xml';
      case 'sql':
        return 'sql';
      default:
        return 'plaintext';
    }
  };

  const loadFile = async (path: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/filesystem/read?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }

      const content = await response.text();
      const language = detectLanguage(path);

      setCurrentFile({ path, content, language });
      setHasUnsavedChanges(false);
    } catch (err) {
      logger.error('Failed to load file:', err);
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = useCallback(
    async (content: string) => {
      if (!currentFile) return;

      setIsSaving(true);
      setError(null);

      try {
        const response = await fetch('/api/filesystem/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: currentFile.path,
            content,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save file: ${response.statusText}`);
        }

        setCurrentFile({ ...currentFile, content });
        setHasUnsavedChanges(false);
        logger.log(`Saved ${currentFile.path}`);
      } catch (err) {
        logger.error('Failed to save file:', err);
        setError(err instanceof Error ? err.message : 'Failed to save file');
      } finally {
        setIsSaving(false);
      }
    },
    [currentFile]
  );

  const handleFileSelect = (file: { path: string; type: string }) => {
    if (file.type === 'file') {
      if (hasUnsavedChanges) {
        if (!confirm('You have unsaved changes. Do you want to continue?')) {
          return;
        }
      }
      loadFile(file.path);
    }
  };

  const handleEditorChange = (content: string) => {
    if (currentFile && content !== currentFile.content) {
      setHasUnsavedChanges(true);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title="File Editor"
        showBackButton
        rightContent={
          currentFile && (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-400 font-mono">{currentFile.path}</span>
              {hasUnsavedChanges && <span className="text-sm text-yellow-500">• Modified</span>}
              <button
                type="button"
                onClick={() => saveFile(currentFile.content)}
                disabled={!hasUnsavedChanges || isSaving}
                className="px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* File browser sidebar */}
        <div className="w-80 border-r border-gray-800 overflow-hidden">
          <FileBrowser onFileSelect={handleFileSelect} className="h-full" />
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col">
          {error && (
            <div className="bg-red-900/50 border-b border-red-800 text-red-200 px-4 py-2 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-gray-400">Loading file...</div>
            </div>
          ) : currentFile ? (
            <MonacoEditor
              value={currentFile.content}
              language={currentFile.language}
              onChange={handleEditorChange}
              onSave={saveFile}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <svg
                  className="w-24 h-24 mx-auto text-gray-600 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-400">Select a file to edit</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

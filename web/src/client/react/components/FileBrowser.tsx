import { useCallback, useEffect, useState } from 'react';
import { createLogger } from '../../utils/logger';

const logger = createLogger('FileBrowser');

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions?: string;
  isGitTracked?: boolean;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';
  isSymlink?: boolean;
}

interface DirectoryResponse {
  path: string;
  files: FileInfo[];
  parentPath?: string;
  gitInfo?: {
    isRepo: boolean;
    branch?: string;
  };
}

interface FileBrowserProps {
  initialPath?: string;
  onFileSelect?: (file: FileInfo) => void;
  onPathChange?: (path: string) => void;
  className?: string;
}

export function FileBrowser({
  initialPath = '/',
  onFileSelect,
  onPathChange,
  className = '',
}: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<{ isRepo: boolean; branch?: string } | null>(null);

  const loadDirectory = useCallback(
    async (path: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/filesystem/list?path=${encodeURIComponent(path)}`);
        if (!response.ok) {
          throw new Error(`Failed to load directory: ${response.statusText}`);
        }

        const data: DirectoryResponse = await response.json();
        setFiles(data.files);
        setCurrentPath(data.path);
        setGitInfo(data.gitInfo || null);
        onPathChange?.(data.path);
      } catch (err) {
        logger.error('Failed to load directory:', err);
        setError(err instanceof Error ? err.message : 'Failed to load directory');
      } finally {
        setIsLoading(false);
      }
    },
    [onPathChange]
  );

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const handleItemClick = (item: FileInfo) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else {
      onFileSelect?.(item);
    }
  };

  const handleParentClick = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    setCurrentPath(parentPath);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFileIcon = (item: FileInfo): string => {
    if (item.type === 'directory') return '📁';
    if (item.isSymlink) return '🔗';

    const ext = item.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
        return '📜';
      case 'json':
      case 'xml':
      case 'yaml':
      case 'yml':
        return '📋';
      case 'md':
      case 'txt':
        return '📄';
      case 'css':
      case 'scss':
      case 'less':
        return '🎨';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return '🖼️';
      case 'zip':
      case 'tar':
      case 'gz':
        return '📦';
      default:
        return '📄';
    }
  };

  const getGitStatusColor = (status?: string): string => {
    switch (status) {
      case 'modified':
        return 'text-yellow-500';
      case 'added':
        return 'text-green-500';
      case 'deleted':
        return 'text-red-500';
      case 'untracked':
        return 'text-gray-500';
      default:
        return '';
    }
  };

  return (
    <div className={`bg-gray-900 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-semibold text-white">File Browser</h3>
            {gitInfo?.isRepo && (
              <span className="text-sm text-gray-400">
                <span className="text-gray-500">on</span> {gitInfo.branch}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-400 font-mono">{currentPath}</div>
        </div>
      </div>

      {/* File list */}
      <div className="overflow-auto max-h-[600px]">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">{error}</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 w-24">Size</th>
                <th className="px-4 py-2 w-40">Modified</th>
              </tr>
            </thead>
            <tbody>
              {currentPath !== '/' && (
                <tr
                  className="hover:bg-gray-800 cursor-pointer border-b border-gray-800"
                  onClick={handleParentClick}
                >
                  <td className="px-4 py-2 flex items-center space-x-2">
                    <span>📁</span>
                    <span className="text-gray-300">..</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">-</td>
                  <td className="px-4 py-2 text-gray-500">-</td>
                </tr>
              )}
              {files.map((file) => (
                <tr
                  key={file.path}
                  className="hover:bg-gray-800 cursor-pointer border-b border-gray-800"
                  onClick={() => handleItemClick(file)}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center space-x-2">
                      <span>{getFileIcon(file)}</span>
                      <span className={`text-gray-300 ${getGitStatusColor(file.gitStatus)}`}>
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-sm">
                    {file.type === 'directory' ? '-' : formatFileSize(file.size)}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-sm">{formatDate(file.modified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

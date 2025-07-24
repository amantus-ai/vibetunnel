import * as os from 'os';

/**
 * Convert absolute paths to use ~ for the home directory
 * @param absolutePath The absolute path to prettify
 * @returns The prettified path with ~ for home directory
 */
export function prettifyPath(absolutePath: string): string {
  const homeDir = os.homedir();

  if (absolutePath.startsWith(homeDir)) {
    return `~${absolutePath.slice(homeDir.length)}`;
  }

  return absolutePath;
}

/**
 * Convert multiple paths to use ~ for the home directory
 * @param paths Array of absolute paths to prettify
 * @returns Array of prettified paths
 */
export function prettifyPaths(paths: string[]): string[] {
  return paths.map(prettifyPath);
}

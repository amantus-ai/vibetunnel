import type { AuthClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('autocomplete-manager');

export interface AutocompleteItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  suggestion: string;
  isRepository?: boolean;
}

export interface Repository {
  id: string;
  path: string;
  folderName: string;
  lastModified: string;
  relativePath: string;
}

export class AutocompleteManager {
  private repositories: Repository[] = [];
  private authClient?: AuthClient;

  constructor(authClient?: AuthClient) {
    this.authClient = authClient;
  }

  setAuthClient(authClient: AuthClient | undefined) {
    this.authClient = authClient;
  }

  setRepositories(repositories: Repository[]) {
    this.repositories = repositories;
  }

  async fetchCompletions(path: string): Promise<AutocompleteItem[]> {
    if (!path) return [];

    try {
      // Fetch filesystem completions
      const response = await fetch(`/api/fs/completions?path=${encodeURIComponent(path)}`, {
        headers: this.authClient?.getAuthHeader() || {},
      });

      if (!response.ok) {
        logger.error('Failed to fetch completions');
        return [];
      }

      const data = await response.json();
      const completions: AutocompleteItem[] = data.completions || [];

      // Also search through discovered repositories if user is typing a partial name
      const isSearchingByName =
        !path.includes('/') ||
        ((path.match(/\//g) || []).length === 1 && path.endsWith('/') === false);

      if (isSearchingByName && this.repositories.length > 0) {
        const searchTerm = path.toLowerCase().replace('~/', '');

        // Filter repositories that match the search term
        const matchingRepos = this.repositories
          .filter((repo) => repo.folderName.toLowerCase().includes(searchTerm))
          .map((repo) => ({
            name: repo.folderName,
            path: repo.relativePath,
            type: 'directory' as const,
            suggestion: repo.path,
            isRepository: true,
          }));

        // Merge with filesystem completions, avoiding duplicates
        const existingPaths = new Set(completions.map((c) => c.suggestion));
        const uniqueRepos = matchingRepos.filter((repo) => !existingPaths.has(repo.suggestion));

        completions.push(...uniqueRepos);
      }

      // Sort completions with custom logic
      const sortedCompletions = this.sortCompletions(completions, path);

      // Limit to 20 results for performance
      return sortedCompletions.slice(0, 20);
    } catch (error) {
      logger.error('Error fetching completions:', error);
      return [];
    }
  }

  private sortCompletions(
    completions: AutocompleteItem[],
    originalPath: string
  ): AutocompleteItem[] {
    const searchTerm = originalPath.toLowerCase();
    const lastPathSegment = searchTerm.split('/').pop() || '';

    return completions.sort((a, b) => {
      // 1. Direct name matches come first
      const aNameMatch = a.name.toLowerCase() === lastPathSegment;
      const bNameMatch = b.name.toLowerCase() === lastPathSegment;
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;

      // 2. Name starts with search term
      const aStartsWith = a.name.toLowerCase().startsWith(lastPathSegment);
      const bStartsWith = b.name.toLowerCase().startsWith(lastPathSegment);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // 3. Directories before files
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      // 4. Git repositories before regular directories
      if (a.type === 'directory' && b.type === 'directory') {
        if (a.isRepository && !b.isRepository) return -1;
        if (!a.isRepository && b.isRepository) return 1;
      }

      // 5. Alphabetical order
      return a.name.localeCompare(b.name);
    });
  }

  filterCompletions(completions: AutocompleteItem[], searchTerm: string): AutocompleteItem[] {
    if (!searchTerm) return completions;

    const lowerSearch = searchTerm.toLowerCase();
    return completions.filter((item) => {
      const name = item.name.toLowerCase();
      const path = item.path.toLowerCase();
      return name.includes(lowerSearch) || path.includes(lowerSearch);
    });
  }
}

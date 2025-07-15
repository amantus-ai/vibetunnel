import { createLogger } from '../utils/logger.js';

const logger = createLogger('git-app-launcher');

interface GitApp {
  name: string;
  protocol: string;
  testUrl: string;
}

const GIT_APPS: GitApp[] = [
  {
    name: 'Fork',
    protocol: 'fork:',
    testUrl: 'fork://open',
  },
  {
    name: 'Tower',
    protocol: 'tower:',
    testUrl: 'tower://open',
  },
  {
    name: 'SourceTree',
    protocol: 'sourcetree:',
    testUrl: 'sourcetree://cloneRepo',
  },
  {
    name: 'GitKraken',
    protocol: 'gitkraken:',
    testUrl: 'gitkraken://repo',
  },
  {
    name: 'GitHub Desktop',
    protocol: 'x-github-client:',
    testUrl: 'x-github-client://openRepo',
  },
];

export class GitAppLauncher {
  private static instance: GitAppLauncher;
  private detectedApp: GitApp | null = null;
  private hasDetected = false;

  private constructor() {}

  static getInstance(): GitAppLauncher {
    if (!GitAppLauncher.instance) {
      GitAppLauncher.instance = new GitAppLauncher();
    }
    return GitAppLauncher.instance;
  }

  /**
   * Detect which Git app is installed by trying to open test URLs
   */
  private async detectGitApp(): Promise<void> {
    if (this.hasDetected) return;
    this.hasDetected = true;

    for (const app of GIT_APPS) {
      try {
        const handled = await this.tryOpenUrl(app.testUrl);
        if (handled) {
          this.detectedApp = app;
          logger.log(`Detected ${app.name} as the default Git app`);
          break;
        }
      } catch (error) {
        logger.debug(`Failed to detect ${app.name}:`, error);
      }
    }

    if (!this.detectedApp) {
      logger.warn('No Git app detected');
    }
  }

  /**
   * Try to open a URL without actually navigating away
   */
  private async tryOpenUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      let handled = false;
      const timeout = setTimeout(() => {
        document.body.removeChild(iframe);
        resolve(handled);
      }, 500);

      iframe.onload = () => {
        clearTimeout(timeout);
        document.body.removeChild(iframe);
        resolve(false);
      };

      // If the protocol is handled, this won't trigger an error
      iframe.src = url;
      handled = true;
    });
  }

  /**
   * Open a repository in the detected Git app
   */
  async openRepository(repoPath: string): Promise<boolean> {
    await this.detectGitApp();

    if (!this.detectedApp) {
      logger.warn('No Git app detected, cannot open repository');
      return false;
    }

    const url = this.buildRepoUrl(this.detectedApp, repoPath);
    logger.log(`Opening repository in ${this.detectedApp.name}: ${url}`);

    try {
      window.open(url, '_blank');
      return true;
    } catch (error) {
      logger.error('Failed to open Git app:', error);
      return false;
    }
  }

  /**
   * Build the appropriate URL for opening a repository in the Git app
   */
  private buildRepoUrl(app: GitApp, repoPath: string): string {
    // Expand ~ to the home directory if needed
    const expandedPath = repoPath.startsWith('~/')
      ? repoPath.replace(
          '~',
          `/Users/${(window as Window & { currentUser?: string }).currentUser || 'user'}`
        )
      : repoPath;

    switch (app.name) {
      case 'Fork':
        return `fork://open?path=${encodeURIComponent(expandedPath)}`;
      case 'Tower':
        return `tower://openrepo?path=${encodeURIComponent(expandedPath)}`;
      case 'SourceTree':
        return `sourcetree://cloneRepo?path=${encodeURIComponent(expandedPath)}`;
      case 'GitKraken':
        return `gitkraken://repo/${encodeURIComponent(expandedPath)}`;
      case 'GitHub Desktop':
        return `x-github-client://openRepo/${encodeURIComponent(expandedPath)}`;
      default:
        return '';
    }
  }

  /**
   * Get the name of the detected Git app
   */
  getDetectedAppName(): string | null {
    return this.detectedApp?.name || null;
  }

  /**
   * Check if a Git app has been detected
   */
  hasGitApp(): boolean {
    return this.detectedApp !== null;
  }
}

export const gitAppLauncher = GitAppLauncher.getInstance();

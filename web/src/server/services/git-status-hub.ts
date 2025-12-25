/**
 * Git Status Hub
 *
 * Watches git state for sessions and pushes updates to subscribers.
 * This is used by WebSocket v3 to deliver git status updates.
 */

import * as chokidar from 'chokidar';
import { accessSync } from 'fs';
import { type GitStatusCounts, getDetailedGitStatus } from '../utils/git-status.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('git-status-hub');

export type GitStatusHubEvent = {
  type: 'git-status-update';
  sessionId: string;
  gitModifiedCount: number;
  gitAddedCount: number;
  gitDeletedCount: number;
  gitAheadCount: number;
  gitBehindCount: number;
};

export type GitStatusHubListener = (event: GitStatusHubEvent) => void;

interface WatcherInfo {
  watcher: chokidar.FSWatcher;
  sessionId: string;
  workingDir: string;
  gitRepoPath: string;
  lastStatus?: GitStatusCounts;
  debounceTimer?: NodeJS.Timeout;
  periodicCheckTimer?: NodeJS.Timeout;
  clients: Set<GitStatusHubListener>;
}

export class GitStatusHub {
  private watchers = new Map<string, WatcherInfo>();

  startWatching(sessionId: string, workingDir: string, gitRepoPath: string): void {
    if (this.watchers.has(sessionId)) return;

    const watcher = chokidar.watch(gitRepoPath, {
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/.git/objects/**',
        '**/.git/logs/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/*.log',
        '**/.DS_Store',
      ],
      depth: 0,
      followSymlinks: false,
      usePolling: false,
      awaitWriteFinish: false,
    });

    const gitPaths = [
      `${gitRepoPath}/.git/index`,
      `${gitRepoPath}/.git/HEAD`,
      `${gitRepoPath}/.git/refs/heads`,
    ].filter((p) => {
      try {
        accessSync(p);
        return true;
      } catch {
        return false;
      }
    });
    if (gitPaths.length > 0) watcher.add(gitPaths);

    const watcherInfo: WatcherInfo = {
      watcher,
      sessionId,
      workingDir,
      gitRepoPath,
      clients: new Set(),
    };

    const handleChange = (changedPath: string, eventType: string) => {
      const isGitFile = changedPath.includes('.git');
      if (isGitFile || eventType !== 'change') {
        logger.debug(`git watcher event for session ${sessionId}: ${eventType} ${changedPath}`);
      }

      if (watcherInfo.debounceTimer) clearTimeout(watcherInfo.debounceTimer);
      watcherInfo.debounceTimer = setTimeout(() => {
        this.checkAndBroadcastStatus(watcherInfo);
      }, 300);
    };

    watcher.on('all', (eventType, p) => handleChange(p, eventType));
    watcher.on('error', (error) => {
      logger.error(`git watcher error for session ${sessionId}:`, error);
    });

    this.watchers.set(sessionId, watcherInfo);

    this.checkAndBroadcastStatus(watcherInfo);

    watcherInfo.periodicCheckTimer = setInterval(() => {
      this.checkAndBroadcastStatus(watcherInfo);
    }, 2000);
  }

  addClient(sessionId: string, client: GitStatusHubListener): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (!watcherInfo) return;

    watcherInfo.clients.add(client);
    if (watcherInfo.lastStatus) this.sendStatusUpdate(client, sessionId, watcherInfo.lastStatus);
  }

  removeClient(sessionId: string, client: GitStatusHubListener): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (!watcherInfo) return;

    watcherInfo.clients.delete(client);
    if (watcherInfo.clients.size === 0) this.stopWatching(sessionId);
  }

  stopWatching(sessionId: string): void {
    const watcherInfo = this.watchers.get(sessionId);
    if (!watcherInfo) return;

    watcherInfo.debounceTimer && clearTimeout(watcherInfo.debounceTimer);
    watcherInfo.periodicCheckTimer && clearInterval(watcherInfo.periodicCheckTimer);
    watcherInfo.watcher.close();
    this.watchers.delete(sessionId);
  }

  private async checkAndBroadcastStatus(watcherInfo: WatcherInfo): Promise<void> {
    try {
      const status = await getDetailedGitStatus(watcherInfo.workingDir);
      if (!this.hasStatusChanged(watcherInfo.lastStatus, status)) return;

      watcherInfo.lastStatus = status;
      for (const client of watcherInfo.clients) {
        this.sendStatusUpdate(client, watcherInfo.sessionId, status);
      }
    } catch (error) {
      logger.error(`failed to get git status for session ${watcherInfo.sessionId}:`, error);
    }
  }

  private hasStatusChanged(oldStatus: GitStatusCounts | undefined, newStatus: GitStatusCounts) {
    if (!oldStatus) return true;
    return (
      oldStatus.modified !== newStatus.modified ||
      oldStatus.added !== newStatus.added ||
      oldStatus.staged !== newStatus.staged ||
      oldStatus.deleted !== newStatus.deleted ||
      oldStatus.ahead !== newStatus.ahead ||
      oldStatus.behind !== newStatus.behind
    );
  }

  private sendStatusUpdate(
    client: GitStatusHubListener,
    sessionId: string,
    status: GitStatusCounts
  ) {
    client({
      type: 'git-status-update',
      sessionId,
      gitModifiedCount: status.modified,
      gitAddedCount: status.added,
      gitDeletedCount: status.deleted,
      gitAheadCount: status.ahead,
      gitBehindCount: status.behind,
    });
  }

  cleanup(): void {
    for (const [sessionId] of this.watchers) {
      this.stopWatching(sessionId);
    }
  }
}

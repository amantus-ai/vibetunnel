import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import type { SessionActivity } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('activity-monitor');

interface SessionActivityState {
  sessionId: string;
  isActive: boolean;
  lastActivityTime: number;
  lastFileSize: number;
}

export class ActivityMonitor {
  private controlPath: string;
  private activities: Map<string, SessionActivityState> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly ACTIVITY_TIMEOUT = 500; // 500ms of no activity = inactive
  private readonly CHECK_INTERVAL = 100; // Check every 100ms

  constructor(controlPath: string) {
    this.controlPath = controlPath;
  }

  /**
   * Start monitoring all sessions for activity
   */
  start() {
    logger.log(chalk.green('activity monitor started'));

    // Initial scan of existing sessions
    const sessionCount = this.scanSessions();
    if (sessionCount > 0) {
      logger.log(chalk.blue(`monitoring ${sessionCount} existing sessions`));
    }

    // Set up periodic scanning for new sessions
    this.checkInterval = setInterval(() => {
      this.scanSessions();
      this.updateActivityStates();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop monitoring
   */
  stop() {
    logger.log(chalk.yellow('stopping activity monitor'));

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Close all watchers
    const watcherCount = this.watchers.size;
    for (const [sessionId, watcher] of this.watchers) {
      watcher.close();
      this.watchers.delete(sessionId);
    }

    this.activities.clear();

    if (watcherCount > 0) {
      logger.log(chalk.gray(`closed ${watcherCount} file watchers`));
    }
  }

  /**
   * Scan for sessions and start monitoring new ones
   */
  private scanSessions(): number {
    try {
      if (!fs.existsSync(this.controlPath)) {
        return 0;
      }

      const entries = fs.readdirSync(this.controlPath, { withFileTypes: true });
      let newSessions = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name;

          // Skip if already monitoring
          if (this.activities.has(sessionId)) {
            continue;
          }

          const streamOutPath = path.join(this.controlPath, sessionId, 'stdout');

          // Check if stdout exists
          if (fs.existsSync(streamOutPath)) {
            if (this.startMonitoringSession(sessionId, streamOutPath)) {
              newSessions++;
            }
          }
        }
      }

      // Clean up sessions that no longer exist
      const sessionsToCleanup = [];
      for (const [sessionId, _] of this.activities) {
        const sessionDir = path.join(this.controlPath, sessionId);
        if (!fs.existsSync(sessionDir)) {
          sessionsToCleanup.push(sessionId);
        }
      }

      if (sessionsToCleanup.length > 0) {
        logger.log(chalk.yellow(`cleaning up ${sessionsToCleanup.length} removed sessions`));
        for (const sessionId of sessionsToCleanup) {
          this.stopMonitoringSession(sessionId);
        }
      }

      return newSessions;
    } catch (error) {
      logger.error('failed to scan sessions:', error);
      return 0;
    }
  }

  /**
   * Start monitoring a specific session
   */
  private startMonitoringSession(sessionId: string, streamOutPath: string): boolean {
    try {
      const stats = fs.statSync(streamOutPath);

      // Initialize activity tracking
      this.activities.set(sessionId, {
        sessionId,
        isActive: false,
        lastActivityTime: Date.now(),
        lastFileSize: stats.size,
      });

      // Watch for file changes
      const watcher = fs.watch(streamOutPath, (eventType) => {
        if (eventType === 'change') {
          this.handleFileChange(sessionId, streamOutPath);
        }
      });

      this.watchers.set(sessionId, watcher);
      logger.debug(`started monitoring session ${sessionId}`);
      return true;
    } catch (error) {
      logger.error(`failed to start monitor for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Stop monitoring a specific session
   */
  private stopMonitoringSession(sessionId: string) {
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(sessionId);
    }

    this.activities.delete(sessionId);
    logger.debug(`stopped monitoring session ${sessionId}`);
  }

  /**
   * Handle file change event
   */
  private handleFileChange(sessionId: string, streamOutPath: string) {
    try {
      const activity = this.activities.get(sessionId);
      if (!activity) return;

      // Check if file still exists before trying to stat it
      if (!fs.existsSync(streamOutPath)) {
        // Session has been cleaned up, stop monitoring
        this.stopMonitoringSession(sessionId);
        return;
      }

      const stats = fs.statSync(streamOutPath);

      // Check if file size increased (new output)
      if (stats.size > activity.lastFileSize) {
        const wasActive = activity.isActive;
        activity.isActive = true;
        activity.lastActivityTime = Date.now();
        activity.lastFileSize = stats.size;

        // Log state transition
        if (!wasActive) {
          logger.debug(`session ${sessionId} became active`);
        }

        // Write activity status immediately
        this.writeActivityStatus(sessionId, true);
      }
    } catch (error) {
      // Check if error is ENOENT (file not found)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Session has been cleaned up, stop monitoring
        this.stopMonitoringSession(sessionId);
      } else {
        logger.error(`failed to handle file change for session ${sessionId}:`, error);
      }
    }
  }

  /**
   * Update activity states based on timeout
   */
  private updateActivityStates() {
    const now = Date.now();

    for (const [sessionId, activity] of this.activities) {
      if (activity.isActive && now - activity.lastActivityTime > this.ACTIVITY_TIMEOUT) {
        activity.isActive = false;
        logger.debug(`session ${sessionId} became inactive`);
        this.writeActivityStatus(sessionId, false);
      }
    }
  }

  /**
   * Write activity status to disk
   */
  private writeActivityStatus(sessionId: string, isActive: boolean) {
    try {
      const activityPath = path.join(this.controlPath, sessionId, 'activity.json');
      const sessionJsonPath = path.join(this.controlPath, sessionId, 'session.json');

      const activityData: SessionActivity = {
        isActive,
        timestamp: new Date().toISOString(),
      };

      // Try to read full session data
      if (fs.existsSync(sessionJsonPath)) {
        try {
          const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
          activityData.session = sessionData;
        } catch (_error) {
          // If we can't read session.json, just proceed without session data
          logger.debug(`could not read session.json for ${sessionId}`);
        }
      }

      fs.writeFileSync(activityPath, JSON.stringify(activityData, null, 2));
    } catch (error) {
      logger.error(`failed to write activity status for session ${sessionId}:`, error);
    }
  }

  /**
   * Get activity status for all sessions
   */
  getActivityStatus(): Record<string, SessionActivity> {
    const status: Record<string, SessionActivity> = {};
    const startTime = Date.now();

    // Read from disk to get the most up-to-date status
    try {
      if (!fs.existsSync(this.controlPath)) {
        return status;
      }

      const entries = fs.readdirSync(this.controlPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name;
          const activityPath = path.join(this.controlPath, sessionId, 'activity.json');
          const sessionJsonPath = path.join(this.controlPath, sessionId, 'session.json');

          if (fs.existsSync(activityPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
              status[sessionId] = data;
            } catch (_error) {
              // If we can't read the file, create one from current state
              logger.debug(`could not read activity.json for ${sessionId}`);
              const activity = this.activities.get(sessionId);
              if (activity) {
                const activityStatus: SessionActivity = {
                  isActive: activity.isActive,
                  timestamp: new Date().toISOString(),
                };

                // Try to read full session data
                if (fs.existsSync(sessionJsonPath)) {
                  try {
                    const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
                    activityStatus.session = sessionData;
                  } catch (_error) {
                    // Ignore session.json read errors
                    logger.debug(
                      `could not read session.json for ${sessionId} when creating activity`
                    );
                  }
                }

                status[sessionId] = activityStatus;
              }
            }
          } else if (fs.existsSync(sessionJsonPath)) {
            // No activity file yet, but session exists - create default activity
            try {
              const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
              status[sessionId] = {
                isActive: false,
                timestamp: new Date().toISOString(),
                session: sessionData,
              };
            } catch (_error) {
              // Ignore errors
              logger.debug(`could not read session.json for ${sessionId}`);
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      if (duration > 100) {
        logger.warn(
          `activity status scan took ${duration}ms for ${Object.keys(status).length} sessions`
        );
      }
    } catch (error) {
      logger.error('failed to read activity status:', error);
    }

    return status;
  }

  /**
   * Get activity status for a specific session
   */
  getSessionActivityStatus(sessionId: string): SessionActivity | null {
    const sessionJsonPath = path.join(this.controlPath, sessionId, 'session.json');

    // Try to read from disk first
    try {
      const activityPath = path.join(this.controlPath, sessionId, 'activity.json');
      if (fs.existsSync(activityPath)) {
        const data = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
        return data;
      }
    } catch (_error) {
      // Fall back to creating from current state
      logger.debug(
        `could not read activity.json for session ${sessionId}, creating from current state`
      );
      const activity = this.activities.get(sessionId);
      if (activity) {
        const activityStatus: SessionActivity = {
          isActive: activity.isActive,
          timestamp: new Date().toISOString(),
        };

        // Try to read full session data
        if (fs.existsSync(sessionJsonPath)) {
          try {
            const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
            activityStatus.session = sessionData;
          } catch (_error) {
            // Ignore session.json read errors
            logger.debug(
              `could not read session.json for ${sessionId} in getSessionActivityStatus`
            );
          }
        }

        return activityStatus;
      }
    }

    // If no activity data but session exists, create default
    if (fs.existsSync(sessionJsonPath)) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
        return {
          isActive: false,
          timestamp: new Date().toISOString(),
          session: sessionData,
        };
      } catch (_error) {
        // Ignore errors
        logger.debug(`could not read session.json for ${sessionId} when creating default activity`);
      }
    }

    return null;
  }
}

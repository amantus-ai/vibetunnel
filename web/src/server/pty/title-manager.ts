/**
 * TitleManager - Handles terminal title injection and tracking
 *
 * Responsible for:
 * - Generating terminal titles based on session state
 * - Injecting titles during quiet periods to avoid visual artifacts
 * - Filtering out title sequences from PTY output
 */

import { once } from 'events';
import { TitleMode } from '../../shared/types.js';
import { TitleSequenceFilter } from '../utils/ansi-title-filter.js';
import { createLogger } from '../utils/logger.js';
import { generateTitleSequence, shouldInjectTitle } from '../utils/terminal-title.js';
import type { WriteQueue } from '../utils/write-queue.js';
import type { PtySession } from './types.js';

const logger = createLogger('title-manager');

// Title injection timing constants
const TITLE_UPDATE_INTERVAL_MS = 1000; // How often to check if title needs updating
const TITLE_INJECTION_QUIET_PERIOD_MS = 50; // Minimum quiet period before injecting title
const TITLE_INJECTION_CHECK_INTERVAL_MS = 10; // How often to check for quiet period

/**
 * Configuration for TitleManager
 */
export interface TitleManagerConfig {
  /** Whether to enable title management */
  enabled: boolean;
}

/**
 * Session context needed for title management
 */
export interface TitleSessionContext {
  id: string;
  sessionName?: string;
  workingDir: string;
  command: string[];
  titleMode?: TitleMode;
  isExternalTerminal: boolean;
  stdoutQueue?: WriteQueue;
}

/**
 * Manages terminal title injection for PTY sessions
 */
export class TitleManager {
  private titleFilters = new Map<string, TitleSequenceFilter>();
  private titleUpdateIntervals = new Map<string, NodeJS.Timeout>();
  private titleInjectionTimers = new Map<string, NodeJS.Timeout>();
  private currentTitles = new Map<string, string>();
  private pendingTitles = new Map<string, string>();
  private titleUpdateNeeded = new Map<string, boolean>();
  private lastWriteTimestamps = new Map<string, number>();
  private titleInjectionInProgress = new Map<string, boolean>();
  private initialTitleSent = new Map<string, boolean>();
  private currentWorkingDirs = new Map<string, string>();

  constructor(private readonly config: TitleManagerConfig = { enabled: true }) {}

  /**
   * Initialize title management for a session
   */
  initializeSession(session: PtySession): void {
    if (!this.config.enabled) return;

    // Create title filter for the session
    this.titleFilters.set(session.id, new TitleSequenceFilter());
    this.currentWorkingDirs.set(session.id, session.sessionInfo.workingDir);

    // Setup periodic title updates for static titles
    if (
      session.titleMode !== undefined &&
      session.titleMode !== TitleMode.NONE &&
      session.titleMode !== TitleMode.FILTER &&
      session.isExternalTerminal
    ) {
      const interval = setInterval(() => {
        this.checkAndUpdateTitle(session);
      }, TITLE_UPDATE_INTERVAL_MS);
      this.titleUpdateIntervals.set(session.id, interval);
    }

    // Mark for initial title update
    if (session.isExternalTerminal && session.titleMode === TitleMode.STATIC) {
      this.markTitleUpdateNeeded(session);
      this.initialTitleSent.set(session.id, true);
      logger.debug(`Marked initial title update for session ${session.id}`);
    }
  }

  /**
   * Filter output data to remove title sequences if needed
   */
  filterOutput(sessionId: string, data: string, titleMode?: TitleMode): string {
    if (titleMode === undefined || titleMode === TitleMode.NONE) {
      return data;
    }

    const filter = this.titleFilters.get(sessionId);
    return filter ? filter.filter(data) : data;
  }

  /**
   * Process output data for title update triggers
   */
  processOutputForTitleTriggers(session: PtySession, data: string): void {
    if (session.titleMode !== TitleMode.STATIC || !session.isExternalTerminal) {
      return;
    }

    // Check if we should update title based on data content
    if (!this.initialTitleSent.get(session.id) || shouldInjectTitle(data)) {
      this.markTitleUpdateNeeded(session);
      if (!this.initialTitleSent.get(session.id)) {
        this.initialTitleSent.set(session.id, true);
      }
    }
  }

  /**
   * Record write timestamp for safe title injection
   */
  recordWriteTimestamp(sessionId: string): void {
    this.lastWriteTimestamps.set(sessionId, Date.now());
  }

  /**
   * Update the working directory for a session
   */
  updateWorkingDir(sessionId: string, workingDir: string): void {
    this.currentWorkingDirs.set(sessionId, workingDir);
  }

  /**
   * Get the current working directory for a session
   */
  getWorkingDir(sessionId: string): string | undefined {
    return this.currentWorkingDirs.get(sessionId);
  }

  /**
   * Mark session for title update and trigger immediate check
   */
  markTitleUpdateNeeded(session: PtySession): void {
    logger.debug(`[markTitleUpdateNeeded] Called for session ${session.id}`, {
      titleMode: session.titleMode,
      sessionName: session.sessionInfo.name,
    });

    if (!session.titleMode || session.titleMode === TitleMode.NONE) {
      logger.debug(`[markTitleUpdateNeeded] Skipping - title mode is NONE or undefined`);
      return;
    }

    this.titleUpdateNeeded.set(session.id, true);
    logger.debug(`[markTitleUpdateNeeded] Set titleUpdateNeeded=true, calling checkAndUpdateTitle`);
    this.checkAndUpdateTitle(session);
  }

  /**
   * Update terminal title specifically for session name changes
   * This bypasses title mode checks to ensure name changes are always reflected
   */
  updateTerminalTitleForSessionName(session: PtySession): void {
    if (!session.stdoutQueue || !session.isExternalTerminal) {
      logger.debug(
        `[updateTerminalTitleForSessionName] Early return - no stdout queue or not external terminal`
      );
      return;
    }

    const currentDir = this.currentWorkingDirs.get(session.id) || session.sessionInfo.workingDir;

    // For NONE or FILTER mode, use simple session name
    // For STATIC mode, use the standard generation logic
    const newTitle = generateTitleSequence(
      currentDir,
      session.sessionInfo.command,
      session.sessionInfo.name || 'ShellOps'
    );

    const currentTitle = this.currentTitles.get(session.id);
    if (newTitle && newTitle !== currentTitle) {
      logger.debug(`[updateTerminalTitleForSessionName] Updating title for session name change`);
      this.pendingTitles.set(session.id, newTitle);
      this.titleUpdateNeeded.set(session.id, true);

      // Start injection monitor if not already running
      if (!this.titleInjectionTimers.has(session.id)) {
        this.startTitleInjectionMonitor(session);
      }
    }
  }

  /**
   * Check if title needs updating and write if changed
   */
  private checkAndUpdateTitle(session: PtySession): void {
    logger.debug(`[checkAndUpdateTitle] Called for session ${session.id}`, {
      titleUpdateNeeded: this.titleUpdateNeeded.get(session.id),
      hasStdoutQueue: !!session.stdoutQueue,
      isExternalTerminal: session.isExternalTerminal,
      sessionName: session.sessionInfo.name,
    });

    if (
      !this.titleUpdateNeeded.get(session.id) ||
      !session.stdoutQueue ||
      !session.isExternalTerminal
    ) {
      logger.debug(`[checkAndUpdateTitle] Early return - conditions not met`);
      return;
    }

    // Generate new title
    logger.debug(`[checkAndUpdateTitle] Generating new title...`);
    const newTitle = this.generateTerminalTitle(session);

    const currentTitle = this.currentTitles.get(session.id);

    // Debug logging for title updates
    logger.debug(`[Title Update] Session ${session.id}:`, {
      sessionName: session.sessionInfo.name,
      newTitle: newTitle ? `${newTitle.substring(0, 50)}...` : null,
      currentTitle: currentTitle ? `${currentTitle.substring(0, 50)}...` : null,
      titleChanged: newTitle !== currentTitle,
    });

    // Only proceed if title changed
    if (newTitle && newTitle !== currentTitle) {
      logger.debug(`[checkAndUpdateTitle] Title changed, queueing for injection`);
      // Store pending title
      this.pendingTitles.set(session.id, newTitle);

      // Start injection monitor if not already running
      if (!this.titleInjectionTimers.has(session.id)) {
        logger.debug(`[checkAndUpdateTitle] Starting title injection monitor`);
        this.startTitleInjectionMonitor(session);
      }
    } else {
      logger.debug(`[checkAndUpdateTitle] Title unchanged or null, skipping injection`, {
        newTitleNull: !newTitle,
        titlesEqual: newTitle === currentTitle,
      });
    }

    // Clear flag
    this.titleUpdateNeeded.set(session.id, false);
  }

  /**
   * Monitor for quiet period to safely inject title
   */
  private startTitleInjectionMonitor(session: PtySession): void {
    // Run periodically to find quiet period
    const timer = setInterval(() => {
      const pendingTitle = this.pendingTitles.get(session.id);
      if (!pendingTitle || !session.stdoutQueue) {
        // No title to inject or session ended, stop monitor
        const existingTimer = this.titleInjectionTimers.get(session.id);
        if (existingTimer) {
          clearInterval(existingTimer);
          this.titleInjectionTimers.delete(session.id);
        }
        return;
      }

      const now = Date.now();
      const lastWrite = this.lastWriteTimestamps.get(session.id) || 0;
      const timeSinceLastWrite = now - lastWrite;

      // Check for quiet period and not already injecting
      if (
        timeSinceLastWrite >= TITLE_INJECTION_QUIET_PERIOD_MS &&
        !this.titleInjectionInProgress.get(session.id)
      ) {
        // Safe to inject title - capture the title before clearing it
        const titleToInject = pendingTitle;
        if (!titleToInject) {
          return;
        }

        // Mark injection as in progress
        this.titleInjectionInProgress.set(session.id, true);

        // Update timestamp immediately to prevent quiet period violations
        this.lastWriteTimestamps.set(session.id, Date.now());

        session.stdoutQueue.enqueue(async () => {
          try {
            logger.debug(`[Title Injection] Writing title to stdout for session ${session.id}:`, {
              title: `${titleToInject.substring(0, 50)}...`,
            });

            const canWrite = process.stdout.write(titleToInject);

            if (!canWrite) {
              await once(process.stdout, 'drain');
            }

            // Update tracking after successful write
            this.currentTitles.set(session.id, titleToInject);

            logger.debug(`[Title Injection] Successfully injected title for session ${session.id}`);

            // Clear pending title only after successful write
            if (this.pendingTitles.get(session.id) === titleToInject) {
              this.pendingTitles.delete(session.id);
            }

            // If no more titles pending, stop monitor
            if (!this.pendingTitles.has(session.id)) {
              const existingTimer = this.titleInjectionTimers.get(session.id);
              if (existingTimer) {
                clearInterval(existingTimer);
                this.titleInjectionTimers.delete(session.id);
              }
            }
          } finally {
            // Always clear the in-progress flag
            this.titleInjectionInProgress.set(session.id, false);
          }
        });

        logger.debug(
          `Injected title during quiet period (${timeSinceLastWrite}ms) for session ${session.id}`
        );
      }
    }, TITLE_INJECTION_CHECK_INTERVAL_MS);

    this.titleInjectionTimers.set(session.id, timer);
  }

  /**
   * Generate terminal title based on session mode and state
   */
  private generateTerminalTitle(session: PtySession): string | null {
    if (!session.titleMode || session.titleMode === TitleMode.NONE) {
      return null;
    }

    const currentDir = this.currentWorkingDirs.get(session.id) || session.sessionInfo.workingDir;

    logger.debug(`[generateTerminalTitle] Session ${session.id}:`, {
      titleMode: session.titleMode,
      sessionName: session.sessionInfo.name,
      currentDir,
      command: session.sessionInfo.command,
    });

    if (session.titleMode === TitleMode.STATIC) {
      return generateTitleSequence(
        currentDir,
        session.sessionInfo.command,
        session.sessionInfo.name
      );
    }

    return null;
  }

  /**
   * Cleanup resources for a session
   */
  cleanupSession(sessionId: string): void {
    // Clean up title update interval
    const updateInterval = this.titleUpdateIntervals.get(sessionId);
    if (updateInterval) {
      clearInterval(updateInterval);
      this.titleUpdateIntervals.delete(sessionId);
    }

    // Clean up title injection timer
    const injectionTimer = this.titleInjectionTimers.get(sessionId);
    if (injectionTimer) {
      clearInterval(injectionTimer);
      this.titleInjectionTimers.delete(sessionId);
    }

    // Clean up maps
    this.titleFilters.delete(sessionId);
    this.currentTitles.delete(sessionId);
    this.pendingTitles.delete(sessionId);
    this.titleUpdateNeeded.delete(sessionId);
    this.lastWriteTimestamps.delete(sessionId);
    this.titleInjectionInProgress.delete(sessionId);
    this.initialTitleSent.delete(sessionId);
    this.currentWorkingDirs.delete(sessionId);
  }

  /**
   * Get the title filter for a session
   */
  getTitleFilter(sessionId: string): TitleSequenceFilter | undefined {
    return this.titleFilters.get(sessionId);
  }
}

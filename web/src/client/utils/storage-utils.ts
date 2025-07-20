import type { TitleMode } from '../../shared/types.js';
import { createLogger } from './logger.js';

const logger = createLogger('storage-utils');

/**
 * Storage keys for session creation form
 */
export const SESSION_FORM_STORAGE_KEYS = {
  WORKING_DIR: 'vibetunnel_last_working_dir',
  COMMAND: 'vibetunnel_last_command',
  SPAWN_WINDOW: 'vibetunnel_spawn_window',
  TITLE_MODE: 'vibetunnel_title_mode',
} as const;

/**
 * Session form data stored in localStorage
 */
export interface SessionFormData {
  workingDir?: string;
  command?: string;
  spawnWindow?: boolean;
  titleMode?: TitleMode;
}

/**
 * Load session form data from localStorage
 */
export function loadSessionFormData(): SessionFormData {
  try {
    const workingDir = localStorage.getItem(SESSION_FORM_STORAGE_KEYS.WORKING_DIR) || undefined;
    const command = localStorage.getItem(SESSION_FORM_STORAGE_KEYS.COMMAND) || undefined;
    const spawnWindowStr = localStorage.getItem(SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW);
    const titleModeStr = localStorage.getItem(SESSION_FORM_STORAGE_KEYS.TITLE_MODE);

    return {
      workingDir,
      command,
      spawnWindow: spawnWindowStr !== null ? spawnWindowStr === 'true' : undefined,
      titleMode: titleModeStr ? (titleModeStr as TitleMode) : undefined,
    };
  } catch (error) {
    logger.warn('Failed to load from localStorage:', error);
    return {};
  }
}

/**
 * Save session form data to localStorage
 */
export function saveSessionFormData(data: SessionFormData): void {
  try {
    // Only save non-empty values
    if (data.workingDir) {
      localStorage.setItem(SESSION_FORM_STORAGE_KEYS.WORKING_DIR, data.workingDir);
    }
    if (data.command) {
      localStorage.setItem(SESSION_FORM_STORAGE_KEYS.COMMAND, data.command);
    }
    if (data.spawnWindow !== undefined) {
      localStorage.setItem(SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW, String(data.spawnWindow));
    }
    if (data.titleMode !== undefined) {
      localStorage.setItem(SESSION_FORM_STORAGE_KEYS.TITLE_MODE, data.titleMode);
    }
  } catch (error) {
    logger.warn('Failed to save to localStorage:', error);
  }
}

/**
 * Get a single value from localStorage
 */
export function getSessionFormValue<K extends keyof typeof SESSION_FORM_STORAGE_KEYS>(
  key: K
): string | null {
  try {
    return localStorage.getItem(SESSION_FORM_STORAGE_KEYS[key]);
  } catch (error) {
    logger.warn(`Failed to get ${key} from localStorage:`, error);
    return null;
  }
}

/**
 * Set a single value in localStorage
 */
export function setSessionFormValue<K extends keyof typeof SESSION_FORM_STORAGE_KEYS>(
  key: K,
  value: string
): void {
  try {
    localStorage.setItem(SESSION_FORM_STORAGE_KEYS[key], value);
  } catch (error) {
    logger.warn(`Failed to set ${key} in localStorage:`, error);
  }
}

/**
 * Remove a single value from localStorage
 */
export function removeSessionFormValue<K extends keyof typeof SESSION_FORM_STORAGE_KEYS>(
  key: K
): void {
  try {
    localStorage.removeItem(SESSION_FORM_STORAGE_KEYS[key]);
  } catch (error) {
    logger.warn(`Failed to remove ${key} from localStorage:`, error);
  }
}

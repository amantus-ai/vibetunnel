import { DEFAULT_REPOSITORY_BASE_PATH } from '../shared/constants.js';

export interface QuickStartCommand {
  name?: string; // Optional display name (can include emoji), if empty uses command
  command: string; // The actual command to execute
}

/**
 * Unified notification preferences used across Mac and Web
 * This is the single source of truth for notification settings
 */
export interface NotificationPreferences {
  enabled: boolean;
  sessionStart: boolean;
  sessionExit: boolean;
  commandCompletion: boolean;
  commandError: boolean;
  bell: boolean;
  // UI preferences
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export interface VibeTunnelConfig {
  version: number;
  quickStartCommands: QuickStartCommand[];
  repositoryBasePath?: string;

  // Extended configuration sections - matches Mac ConfigManager
  server?: {
    port: number;
    dashboardAccessMode: string;
    cleanupOnStartup: boolean;
    authenticationMode: string;
  };
  development?: {
    debugMode: boolean;
    useDevServer: boolean;
    devServerPath: string;
    logLevel: string;
  };
  preferences?: {
    preferredGitApp?: string;
    preferredTerminal?: string;
    updateChannel: string;
    showInDock: boolean;
    preventSleepWhenRunning: boolean;
    notifications?: NotificationPreferences;
  };
  remoteAccess?: {
    ngrokEnabled: boolean;
    ngrokTokenPresent: boolean;
  };
  sessionDefaults?: {
    command: string;
    workingDirectory: string;
    spawnWindow: boolean;
    titleMode: string;
  };
}

export const DEFAULT_QUICK_START_COMMANDS: QuickStartCommand[] = [
  { name: '✨ codex', command: 'codex' },
  { name: '✨ claude', command: 'claude' },
  { command: 'gemini3' },
  { command: 'opencode 4' },
  { command: 'zsh' },
  { command: 'node' },
];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  sessionStart: false,
  sessionExit: true,
  commandCompletion: false,
  commandError: true,
  bell: true,
  soundEnabled: true,
  vibrationEnabled: false,
};

/**
 * Recommended notification preferences for new users
 * These are sensible defaults when notifications are enabled
 */
export const RECOMMENDED_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  sessionStart: false,
  sessionExit: true,
  commandCompletion: false,
  commandError: true,
  bell: true,
  soundEnabled: true,
  vibrationEnabled: false,
};

export const DEFAULT_CONFIG: VibeTunnelConfig = {
  version: 2,
  quickStartCommands: DEFAULT_QUICK_START_COMMANDS,
  repositoryBasePath: DEFAULT_REPOSITORY_BASE_PATH,
};

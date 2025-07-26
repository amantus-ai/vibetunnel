import { DEFAULT_REPOSITORY_BASE_PATH } from '../shared/constants.js';

export interface QuickStartCommand {
  name?: string; // Optional display name (can include emoji), if empty uses command
  command: string; // The actual command to execute
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
    notifications?: {
      enabled: boolean;
      sessionStart: boolean;
      sessionExit: boolean;
      commandCompletion: boolean;
      commandError: boolean;
      bell: boolean;
      claudeTurn: boolean;
    };
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
  { name: '✨ claude', command: 'claude' },
  { name: '✨ gemini', command: 'gemini' },
  { command: 'zsh' },
  { command: 'python3' },
  { command: 'node' },
  { name: '▶️ pnpm run dev', command: 'pnpm run dev' },
];

export const DEFAULT_CONFIG: VibeTunnelConfig = {
  version: 2,
  quickStartCommands: DEFAULT_QUICK_START_COMMANDS,
  repositoryBasePath: DEFAULT_REPOSITORY_BASE_PATH,
};

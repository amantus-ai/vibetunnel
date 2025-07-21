import { DEFAULT_REPOSITORY_BASE_PATH } from '../shared/constants.js';

export interface QuickStartCommand {
  name?: string; // Optional display name (can include emoji), if empty uses command
  command: string; // The actual command to execute
}

export interface VibeTunnelConfig {
  version: number;
  quickStartCommands: QuickStartCommand[];
  repositoryBasePath?: string;
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
  version: 1,
  quickStartCommands: DEFAULT_QUICK_START_COMMANDS,
  repositoryBasePath: DEFAULT_REPOSITORY_BASE_PATH,
};

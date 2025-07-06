/**
 * Fish Shell Handler
 *
 * Provides enhanced support for fish shell features including:
 * - Command completion and expansion
 * - History expansion and search
 * - Variable and function expansion
 * - Alias handling
 * - Fish-specific syntax parsing
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

export interface FishExpansionResult {
  expanded: string;
  wasExpanded: boolean;
  suggestions?: string[];
  description?: string;
}

export interface FishConfig {
  aliases: Map<string, string>;
  functions: Map<string, string>;
  abbreviations: Map<string, string>;
  variables: Map<string, string>;
  configPath: string;
}

export class FishHandler {
  private config: FishConfig | null = null;
  private historyPath: string;
  private configPath: string;

  constructor() {
    const homeDir = os.homedir();
    this.configPath = path.join(homeDir, '.config', 'fish', 'config.fish');
    this.historyPath = path.join(homeDir, '.local', 'share', 'fish', 'fish_history');
  }

  /**
   * Initialize fish configuration by parsing config files
   */
  async initialize(): Promise<void> {
    this.config = {
      aliases: new Map(),
      functions: new Map(),
      abbreviations: new Map(),
      variables: new Map(),
      configPath: this.configPath,
    };

    await this.loadConfiguration();
  }

  /**
   * Expand a command using fish-specific rules
   */
  async expandCommand(command: string, _cwd: string = process.cwd()): Promise<FishExpansionResult> {
    if (!this.config) {
      await this.initialize();
    }

    const trimmed = command.trim();
    if (!trimmed) {
      return { expanded: command, wasExpanded: false };
    }

    // Try different expansion types in order of priority
    const expansions = [
      () => this.expandAbbreviation(trimmed),
      () => this.expandAlias(trimmed),
      () => this.expandFunction(trimmed),
      () => this.expandVariables(trimmed),
      () => this.expandHistory(trimmed),
    ];

    for (const expand of expansions) {
      const result = await expand();
      if (result.wasExpanded) {
        return result;
      }
    }

    return { expanded: command, wasExpanded: false };
  }

  /**
   * Get completion suggestions for a partial command
   */
  async getCompletions(partial: string, cwd: string = process.cwd()): Promise<string[]> {
    try {
      // Use fish's built-in completion system
      const fishCmd = `fish -c "complete -C '${partial.replace(/'/g, "\\'")}'}"`;
      const result = execSync(fishCmd, {
        cwd,
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.split('\t')[0]) // Fish completions are tab-separated
        .filter((completion) => completion && completion !== partial);
    } catch (_error) {
      return [];
    }
  }

  /**
   * Search fish history for matching commands
   */
  async searchHistory(query: string, limit: number = 10): Promise<string[]> {
    if (!existsSync(this.historyPath)) {
      return [];
    }

    try {
      const historyContent = readFileSync(this.historyPath, 'utf8');
      const commands: string[] = [];

      // Parse fish history format (YAML-like)
      const lines = historyContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('- cmd: ')) {
          const cmd = line.substring(7).trim();
          if (cmd.includes(query) && !commands.includes(cmd)) {
            commands.push(cmd);
            if (commands.length >= limit) break;
          }
        }
      }

      return commands.reverse(); // Most recent first
    } catch (_error) {
      return [];
    }
  }

  /**
   * Check if the current shell is fish
   */
  static isFishShell(shellPath: string): boolean {
    return shellPath.includes('fish') || path.basename(shellPath) === 'fish';
  }

  /**
   * Get fish shell version
   */
  static getFishVersion(): string | null {
    try {
      const result = execSync('fish --version', { encoding: 'utf8', timeout: 1000 });
      return result.trim();
    } catch {
      return null;
    }
  }

  // Private helper methods

  private async loadConfiguration(): Promise<void> {
    if (!this.config) return;

    // Load main config file
    if (existsSync(this.configPath)) {
      await this.parseConfigFile(this.configPath);
    }

    // Load additional config files from fish directory
    const fishDir = path.dirname(this.configPath);
    const functionsDir = path.join(fishDir, 'functions');
    const _completionsDir = path.join(fishDir, 'completions');

    if (existsSync(functionsDir)) {
      await this.loadFunctions(functionsDir);
    }
  }

  private async parseConfigFile(filePath: string): Promise<void> {
    if (!this.config) return;

    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse aliases (fish uses functions for aliases)
        if (trimmed.startsWith('alias ')) {
          this.parseAlias(trimmed);
        }

        // Parse abbreviations
        if (trimmed.startsWith('abbr ')) {
          this.parseAbbreviation(trimmed);
        }

        // Parse variable assignments
        if (trimmed.startsWith('set ')) {
          this.parseVariable(trimmed);
        }
      }
    } catch (_error) {
      // Silently continue if config can't be parsed
    }
  }

  private async loadFunctions(functionsDir: string): Promise<void> {
    try {
      const files = await import('fs').then((fs) => fs.promises.readdir(functionsDir));

      for (const file of files) {
        if (file.endsWith('.fish')) {
          const funcName = path.basename(file, '.fish');
          const funcPath = path.join(functionsDir, file);
          try {
            const content = readFileSync(funcPath, 'utf8');
            this.config?.functions.set(funcName, content);
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  private parseAlias(line: string): void {
    // Fish alias format: alias name='command'
    const match = line.match(/alias\s+([^=]+)=(.+)/);
    if (match && this.config) {
      const name = match[1].trim();
      let value = match[2].trim();

      // Remove quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      this.config.aliases.set(name, value);
    }
  }

  private parseAbbreviation(line: string): void {
    // Fish abbreviation format: abbr name command
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && this.config) {
      const name = parts[1];
      const value = parts.slice(2).join(' ');
      this.config.abbreviations.set(name, value);
    }
  }

  private parseVariable(line: string): void {
    // Fish variable format: set varname value
    const match = line.match(/set\s+([^\s]+)\s+(.+)/);
    if (match && this.config) {
      const name = match[1];
      const value = match[2];
      this.config.variables.set(name, value);
    }
  }

  private async expandAbbreviation(command: string): Promise<FishExpansionResult> {
    if (!this.config) {
      return { expanded: command, wasExpanded: false };
    }

    const firstWord = command.split(/\s+/)[0];
    const abbr = this.config.abbreviations.get(firstWord);

    if (abbr) {
      const expanded = command.replace(firstWord, abbr);
      return {
        expanded,
        wasExpanded: true,
        description: `Abbreviation: ${firstWord} → ${abbr}`,
      };
    }

    return { expanded: command, wasExpanded: false };
  }

  private async expandAlias(command: string): Promise<FishExpansionResult> {
    if (!this.config) {
      return { expanded: command, wasExpanded: false };
    }

    const firstWord = command.split(/\s+/)[0];
    const alias = this.config.aliases.get(firstWord);

    if (alias) {
      const expanded = command.replace(firstWord, alias);
      return {
        expanded,
        wasExpanded: true,
        description: `Alias: ${firstWord} → ${alias}`,
      };
    }

    return { expanded: command, wasExpanded: false };
  }

  private async expandFunction(command: string): Promise<FishExpansionResult> {
    if (!this.config) {
      return { expanded: command, wasExpanded: false };
    }

    const firstWord = command.split(/\s+/)[0];

    if (this.config.functions.has(firstWord)) {
      return {
        expanded: command,
        wasExpanded: true,
        description: `Fish function: ${firstWord}`,
      };
    }

    return { expanded: command, wasExpanded: false };
  }

  private async expandVariables(command: string): Promise<FishExpansionResult> {
    if (!this.config) {
      return { expanded: command, wasExpanded: false };
    }

    let expanded = command;
    let wasExpanded = false;

    // Replace $variable references
    for (const [name, value] of this.config.variables) {
      const regex = new RegExp(`\\$${name}\\b`, 'g');
      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, value);
        wasExpanded = true;
      }
    }

    return { expanded, wasExpanded };
  }

  private async expandHistory(command: string): Promise<FishExpansionResult> {
    // Fish doesn't use !! syntax like bash, but we can implement basic history expansion
    if (command === '!!') {
      const history = await this.searchHistory('', 1);
      if (history.length > 0) {
        return {
          expanded: history[0],
          wasExpanded: true,
          description: 'Previous command',
        };
      }
    }

    return { expanded: command, wasExpanded: false };
  }
}

// Export singleton instance
export const fishHandler = new FishHandler();

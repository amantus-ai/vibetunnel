/**
 * Terminal preferences management
 * Handles saving and loading terminal-related user preferences
 */

import { createLogger } from './logger.js';
import { detectMobile } from './mobile-utils.js';

const logger = createLogger('terminal-preferences');

export interface TerminalPreferences {
  maxCols: number; // 0 means no limit, positive numbers set max width
  fontSize: number;
  fitHorizontally: boolean;
}

// Common terminal widths
export const COMMON_TERMINAL_WIDTHS = [
  { value: 0, label: '∞', description: 'Unlimited (full width)' },
  { value: 80, label: '80', description: 'Classic terminal' },
  { value: 100, label: '100', description: 'Modern standard' },
  { value: 120, label: '120', description: 'Wide terminal' },
  { value: 132, label: '132', description: 'Mainframe width' },
  { value: 160, label: '160', description: 'Ultra-wide' },
] as const;

const DEFAULT_PREFERENCES: TerminalPreferences = {
  maxCols: 0, // No limit by default - take as much as possible
  fontSize: detectMobile() ? 12 : 14, // 12px on mobile, 14px on desktop
  fitHorizontally: false,
};

const STORAGE_KEY_TERMINAL_PREFS = 'vibetunnel_terminal_preferences';

export class TerminalPreferencesManager {
  private static instance: TerminalPreferencesManager;
  private preferences: TerminalPreferences;

  private constructor() {
    this.preferences = this.loadPreferences();
  }

  static getInstance(): TerminalPreferencesManager {
    if (!TerminalPreferencesManager.instance) {
      TerminalPreferencesManager.instance = new TerminalPreferencesManager();
    }
    return TerminalPreferencesManager.instance;
  }

  private loadPreferences(): TerminalPreferences {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TERMINAL_PREFS);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to handle new properties
        return { ...DEFAULT_PREFERENCES, ...parsed };
      }
    } catch (error) {
      logger.warn('Failed to load terminal preferences', { error });
    }
    return { ...DEFAULT_PREFERENCES };
  }

  private savePreferences() {
    try {
      localStorage.setItem(STORAGE_KEY_TERMINAL_PREFS, JSON.stringify(this.preferences));
    } catch (error) {
      logger.warn('Failed to save terminal preferences', { error });
    }
  }

  getMaxCols(): number {
    return this.preferences.maxCols;
  }

  setMaxCols(maxCols: number) {
    this.preferences.maxCols = Math.max(0, maxCols); // Ensure non-negative
    this.savePreferences();
  }

  getFontSize(): number {
    return this.preferences.fontSize;
  }

  setFontSize(fontSize: number) {
    this.preferences.fontSize = Math.max(8, Math.min(32, fontSize)); // Reasonable bounds
    this.savePreferences();
  }

  getFitHorizontally(): boolean {
    return this.preferences.fitHorizontally;
  }

  setFitHorizontally(fitHorizontally: boolean) {
    this.preferences.fitHorizontally = fitHorizontally;
    this.savePreferences();
  }

  getPreferences(): TerminalPreferences {
    return { ...this.preferences };
  }

  resetToDefaults() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.savePreferences();
  }
}

/**
 * Terminal preferences management
 * Handles saving and loading terminal-related user preferences
 */

export interface TerminalPreferences {
  maxCols: number; // 0 means no limit, positive numbers set max width
  fontSize: number;
  fitHorizontally: boolean;
}

const DEFAULT_PREFERENCES: TerminalPreferences = {
  maxCols: 0, // No limit by default - take as much as possible
  fontSize: 14,
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
      console.warn('Failed to load terminal preferences:', error);
    }
    return { ...DEFAULT_PREFERENCES };
  }

  private savePreferences() {
    try {
      localStorage.setItem(STORAGE_KEY_TERMINAL_PREFS, JSON.stringify(this.preferences));
    } catch (error) {
      console.warn('Failed to save terminal preferences:', error);
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

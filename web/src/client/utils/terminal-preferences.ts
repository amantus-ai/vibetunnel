/**
 * Terminal preferences management
 * Handles saving and loading terminal-related user preferences
 */

import { createLogger } from './logger.js';
import { detectMobile } from './mobile-utils.js';
import type { TerminalThemeId } from './terminal-themes.js';

const logger = createLogger('terminal-preferences');

export interface TerminalPreferences {
  maxCols: number; // 0 means no limit, positive numbers set max width
  fontSize: number;
  fitHorizontally: boolean;
  theme: TerminalThemeId;
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
  theme: 'auto',
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
      console.log('🎨 [PREFS] loadPreferences() raw localStorage value:', saved);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('🎨 [PREFS] loadPreferences() parsed:', parsed);
        // Merge with defaults to handle new properties
        const merged = { ...DEFAULT_PREFERENCES, ...parsed };
        console.log('🎨 [PREFS] loadPreferences() merged with defaults:', merged);
        return merged;
      }
    } catch (error) {
      logger.warn('Failed to load terminal preferences', { error });
    }
    console.log('🎨 [PREFS] loadPreferences() returning defaults:', DEFAULT_PREFERENCES);
    return { ...DEFAULT_PREFERENCES };
  }

  private savePreferences() {
    try {
      const toSave = JSON.stringify(this.preferences);
      console.log('🎨 [PREFS] savePreferences() saving to localStorage:', toSave);
      localStorage.setItem(STORAGE_KEY_TERMINAL_PREFS, toSave);
      console.log('🎨 [PREFS] savePreferences() successfully saved');

      // Verify it was saved correctly
      const verified = localStorage.getItem(STORAGE_KEY_TERMINAL_PREFS);
      console.log('🎨 [PREFS] savePreferences() verification read:', verified);
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

  getTheme(): TerminalThemeId {
    console.log('🎨 [PREFS] getTheme() returning:', this.preferences.theme);
    return this.preferences.theme;
  }

  setTheme(theme: TerminalThemeId) {
    console.log('🎨 [PREFS] setTheme() called with:', theme);
    console.log('🎨 [PREFS] Current theme before:', this.preferences.theme);
    this.preferences.theme = theme;
    console.log('🎨 [PREFS] Theme updated to:', this.preferences.theme);
    this.savePreferences();
    console.log('🎨 [PREFS] savePreferences() called');
  }

  getPreferences(): TerminalPreferences {
    return { ...this.preferences };
  }

  resetToDefaults() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.savePreferences();
  }
}

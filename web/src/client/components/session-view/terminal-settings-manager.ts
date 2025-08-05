/**
 * TerminalSettingsManager
 *
 * Manages terminal configuration settings including:
 * - Terminal width/columns management
 * - Font size settings
 * - Theme selection
 * - Settings persistence via TerminalPreferencesManager
 */
import type { Session } from '../../../shared/types.js';
import { clearCharacterWidthCache } from '../../utils/cursor-position.js';
import { createLogger } from '../../utils/logger.js';
import {
  COMMON_TERMINAL_WIDTHS,
  TerminalPreferencesManager,
} from '../../utils/terminal-preferences.js';
import type { TerminalThemeId } from '../../utils/terminal-themes.js';
import type { Terminal } from '../terminal.js';
import type { VibeTerminalBinary } from '../vibe-terminal-binary.js';

const logger = createLogger('terminal-settings-manager');

export interface TerminalSettingsCallbacks {
  getSession: () => Session | null;
  getTerminalElement: () => Terminal | VibeTerminalBinary | null;
  requestUpdate: () => void;
  setTerminalMaxCols: (cols: number) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalTheme: (theme: TerminalThemeId) => void;
  setShowWidthSelector: (show: boolean) => void;
  setCustomWidth: (width: string) => void;
  getTerminalLifecycleManager: () => {
    setTerminalMaxCols: (cols: number) => void;
    setTerminalFontSize: (size: number) => void;
    setTerminalTheme: (theme: TerminalThemeId) => void;
  } | null;
}

export class TerminalSettingsManager {
  private preferencesManager = TerminalPreferencesManager.getInstance();
  private callbacks: TerminalSettingsCallbacks | null = null;

  // Current settings state
  private terminalMaxCols = 0;
  private terminalFontSize = 14;
  private terminalTheme: TerminalThemeId = 'auto';
  private terminalFitHorizontally = false;

  constructor() {
    // Load initial preferences
    this.loadPreferences();
  }

  setCallbacks(callbacks: TerminalSettingsCallbacks): void {
    this.callbacks = callbacks;

    // Sync initial state with callbacks
    if (callbacks) {
      callbacks.setTerminalMaxCols(this.terminalMaxCols);
      callbacks.setTerminalFontSize(this.terminalFontSize);
      callbacks.setTerminalTheme(this.terminalTheme);
    }
  }

  private loadPreferences(): void {
    this.terminalMaxCols = this.preferencesManager.getMaxCols();
    this.terminalFontSize = this.preferencesManager.getFontSize();
    this.terminalTheme = this.preferencesManager.getTheme();
    logger.debug('Loaded terminal preferences:', {
      maxCols: this.terminalMaxCols,
      fontSize: this.terminalFontSize,
      theme: this.terminalTheme,
    });
  }

  // Getters for current settings
  getMaxCols(): number {
    return this.terminalMaxCols;
  }

  getFontSize(): number {
    return this.terminalFontSize;
  }

  getTheme(): TerminalThemeId {
    return this.terminalTheme;
  }

  // Width management
  handleMaxWidthToggle(): void {
    if (this.callbacks) {
      this.callbacks.setShowWidthSelector(true);
    }
  }

  handleWidthSelect(newMaxCols: number): void {
    if (!this.callbacks) return;

    this.terminalMaxCols = newMaxCols;
    this.preferencesManager.setMaxCols(newMaxCols);
    this.callbacks.setShowWidthSelector(false);
    this.callbacks.setTerminalMaxCols(newMaxCols);

    // Update the terminal lifecycle manager
    const lifecycleManager = this.callbacks.getTerminalLifecycleManager();
    if (lifecycleManager) {
      lifecycleManager.setTerminalMaxCols(newMaxCols);
    }

    // Update the terminal component
    const terminal = this.callbacks.getTerminalElement();
    if (terminal) {
      terminal.maxCols = newMaxCols;
      // Mark that user has manually selected a width
      terminal.setUserOverrideWidth(true);
      // Trigger a resize to apply the new constraint
      terminal.requestUpdate();
    } else {
      logger.warn('Terminal component not found when setting width');
    }
  }

  getCurrentWidthLabel(): string {
    if (!this.callbacks) return '∞';

    const terminal = this.callbacks.getTerminalElement();
    const userOverrideWidth = terminal?.userOverrideWidth || false;
    const initialCols = terminal?.initialCols || 0;
    const session = this.callbacks.getSession();

    // Only apply width restrictions to tunneled sessions (those with 'fwd_' prefix)
    const isTunneledSession = session?.id?.startsWith('fwd_');

    // If no manual selection and we have initial dimensions that are limiting (only for tunneled sessions)
    if (this.terminalMaxCols === 0 && initialCols > 0 && !userOverrideWidth && isTunneledSession) {
      return `≤${initialCols}`; // Shows "≤120" to indicate limited to session width
    } else if (this.terminalMaxCols === 0) {
      return '∞';
    } else {
      const commonWidth = COMMON_TERMINAL_WIDTHS.find((w) => w.value === this.terminalMaxCols);
      return commonWidth ? commonWidth.label : this.terminalMaxCols.toString();
    }
  }

  getWidthTooltip(): string {
    if (!this.callbacks) return 'Terminal width: Unlimited';

    const terminal = this.callbacks.getTerminalElement();
    const userOverrideWidth = terminal?.userOverrideWidth || false;
    const initialCols = terminal?.initialCols || 0;
    const session = this.callbacks.getSession();

    // Only apply width restrictions to tunneled sessions (those with 'fwd_' prefix)
    const isTunneledSession = session?.id?.startsWith('fwd_');

    // If no manual selection and we have initial dimensions that are limiting (only for tunneled sessions)
    if (this.terminalMaxCols === 0 && initialCols > 0 && !userOverrideWidth && isTunneledSession) {
      return `Terminal width: Limited to native terminal width (${initialCols} columns)`;
    } else {
      return `Terminal width: ${this.terminalMaxCols === 0 ? 'Unlimited' : `${this.terminalMaxCols} columns`}`;
    }
  }

  // Font size management
  handleFontSizeChange(newSize: number): void {
    if (!this.callbacks) return;

    // Clamp to reasonable bounds
    const clampedSize = Math.max(8, Math.min(32, newSize));
    this.terminalFontSize = clampedSize;
    this.preferencesManager.setFontSize(clampedSize);
    this.callbacks.setTerminalFontSize(clampedSize);

    // Clear character width cache when font size changes
    clearCharacterWidthCache();

    // Update the terminal lifecycle manager
    const lifecycleManager = this.callbacks.getTerminalLifecycleManager();
    if (lifecycleManager) {
      lifecycleManager.setTerminalFontSize(clampedSize);
    }

    // Update the terminal component
    const terminal = this.callbacks.getTerminalElement();
    if (terminal) {
      terminal.fontSize = clampedSize;
      terminal.requestUpdate();
    }
  }

  // Theme management
  handleThemeChange(newTheme: TerminalThemeId): void {
    if (!this.callbacks) return;

    logger.debug('Changing terminal theme to:', newTheme);

    this.terminalTheme = newTheme;
    this.preferencesManager.setTheme(newTheme);
    this.callbacks.setTerminalTheme(newTheme);

    const lifecycleManager = this.callbacks.getTerminalLifecycleManager();
    if (lifecycleManager) {
      lifecycleManager.setTerminalTheme(newTheme);
    }

    const terminal = this.callbacks.getTerminalElement();
    if (terminal) {
      terminal.theme = newTheme;
      terminal.requestUpdate();
    }
  }

  // Terminal fit toggle
  handleTerminalFitToggle(): void {
    if (!this.callbacks) return;

    this.terminalFitHorizontally = !this.terminalFitHorizontally;
    // Find the terminal component and call its handleFitToggle method
    const terminal = this.callbacks.getTerminalElement() as HTMLElement & {
      handleFitToggle?: () => void;
    };
    if (terminal?.handleFitToggle) {
      // Use the terminal's own toggle method which handles scroll position correctly
      terminal.handleFitToggle();
    }
  }

  // Getters for current state
  getTerminalMaxCols(): number {
    return this.terminalMaxCols;
  }

  getTerminalFontSize(): number {
    return this.terminalFontSize;
  }

  getTerminalTheme(): TerminalThemeId {
    return this.terminalTheme;
  }

  getTerminalFitHorizontally(): boolean {
    return this.terminalFitHorizontally;
  }

  // Initialize terminal with current settings
  initializeTerminal(terminal: Terminal | VibeTerminalBinary): void {
    terminal.maxCols = this.terminalMaxCols;
    terminal.fontSize = this.terminalFontSize;
    terminal.theme = this.terminalTheme;
  }
}

/**
 * UIStateManager
 *
 * Centralizes all UI state management for the session view including:
 * - Modal visibility states
 * - Mobile detection and orientation
 * - Keyboard and input states
 * - Loading states
 * - Terminal dimensions
 */

import { createLogger } from '../../utils/logger.js';
import type { TerminalThemeId } from '../../utils/terminal-themes.js';

const logger = createLogger('ui-state-manager');

export interface UIState {
  // Connection state
  connected: boolean;
  macAppConnected: boolean;

  // Mobile states
  isMobile: boolean;
  isLandscape: boolean;
  showMobileInput: boolean;
  mobileInputText: string;
  useDirectKeyboard: boolean;
  showQuickKeys: boolean;
  keyboardHeight: number;

  // Touch tracking
  touchStartX: number;
  touchStartY: number;

  // Terminal dimensions
  terminalCols: number;
  terminalRows: number;

  // Control sequences
  showCtrlAlpha: boolean;
  ctrlSequence: string[];

  // Modal states
  showFileBrowser: boolean;
  showImagePicker: boolean;
  showWidthSelector: boolean;
  customWidth: string;
  isDragOver: boolean;

  // Terminal settings
  terminalFitHorizontally: boolean;
  terminalMaxCols: number;
  terminalFontSize: number;
  terminalTheme: TerminalThemeId;

  // Binary mode
  useBinaryMode: boolean;

  // View mode
  viewMode: 'terminal' | 'worktree';

  // Keyboard capture
  keyboardCaptureActive: boolean;
}

export interface UIStateCallbacks {
  requestUpdate: () => void;
}

export class UIStateManager {
  private state: UIState = {
    // Connection state
    connected: false,
    macAppConnected: false,

    // Mobile states
    isMobile: false,
    isLandscape: false,
    showMobileInput: false,
    mobileInputText: '',
    useDirectKeyboard: true, // Default to true
    showQuickKeys: false,
    keyboardHeight: 0,

    // Touch tracking
    touchStartX: 0,
    touchStartY: 0,

    // Terminal dimensions
    terminalCols: 0,
    terminalRows: 0,

    // Control sequences
    showCtrlAlpha: false,
    ctrlSequence: [],

    // Modal states
    showFileBrowser: false,
    showImagePicker: false,
    showWidthSelector: false,
    customWidth: '',
    isDragOver: false,

    // Terminal settings
    terminalFitHorizontally: false,
    terminalMaxCols: 0,
    terminalFontSize: 14,
    terminalTheme: 'auto',

    // Binary mode
    useBinaryMode: false,

    // View mode
    viewMode: 'terminal',

    // Keyboard capture
    keyboardCaptureActive: true,
  };

  private callbacks: UIStateCallbacks | null = null;

  setCallbacks(callbacks: UIStateCallbacks): void {
    this.callbacks = callbacks;
  }

  // Get full state
  getState(): Readonly<UIState> {
    return { ...this.state };
  }

  // Connection state
  setConnected(connected: boolean): void {
    this.state.connected = connected;
    this.callbacks?.requestUpdate();
  }

  setMacAppConnected(connected: boolean): void {
    this.state.macAppConnected = connected;
    this.callbacks?.requestUpdate();
  }

  // Mobile states
  setIsMobile(isMobile: boolean): void {
    this.state.isMobile = isMobile;
    this.callbacks?.requestUpdate();
  }

  setIsLandscape(isLandscape: boolean): void {
    this.state.isLandscape = isLandscape;
    this.callbacks?.requestUpdate();
  }

  setShowMobileInput(show: boolean): void {
    this.state.showMobileInput = show;
    this.callbacks?.requestUpdate();
  }

  setMobileInputText(text: string): void {
    this.state.mobileInputText = text;
    this.callbacks?.requestUpdate();
  }

  setUseDirectKeyboard(use: boolean): void {
    this.state.useDirectKeyboard = use;
    this.callbacks?.requestUpdate();
  }

  setShowQuickKeys(show: boolean): void {
    this.state.showQuickKeys = show;
    this.callbacks?.requestUpdate();
  }

  setKeyboardHeight(height: number): void {
    this.state.keyboardHeight = height;
    this.callbacks?.requestUpdate();
  }

  // Touch tracking
  setTouchStart(x: number, y: number): void {
    this.state.touchStartX = x;
    this.state.touchStartY = y;
  }

  // Terminal dimensions
  setTerminalDimensions(cols: number, rows: number): void {
    this.state.terminalCols = cols;
    this.state.terminalRows = rows;
    this.callbacks?.requestUpdate();
  }

  // Control sequences
  setShowCtrlAlpha(show: boolean): void {
    this.state.showCtrlAlpha = show;
    this.callbacks?.requestUpdate();
  }

  setCtrlSequence(sequence: string[]): void {
    this.state.ctrlSequence = sequence;
    this.callbacks?.requestUpdate();
  }

  addCtrlSequence(letter: string): void {
    this.state.ctrlSequence = [...this.state.ctrlSequence, letter];
    this.callbacks?.requestUpdate();
  }

  clearCtrlSequence(): void {
    this.state.ctrlSequence = [];
    this.callbacks?.requestUpdate();
  }

  // Modal states
  setShowFileBrowser(show: boolean): void {
    this.state.showFileBrowser = show;
    this.callbacks?.requestUpdate();
  }

  setShowImagePicker(show: boolean): void {
    this.state.showImagePicker = show;
    this.callbacks?.requestUpdate();
  }

  setShowWidthSelector(show: boolean): void {
    this.state.showWidthSelector = show;
    this.callbacks?.requestUpdate();
  }

  setCustomWidth(width: string): void {
    this.state.customWidth = width;
    this.callbacks?.requestUpdate();
  }

  setIsDragOver(isDragOver: boolean): void {
    this.state.isDragOver = isDragOver;
    this.callbacks?.requestUpdate();
  }

  // Terminal settings
  setTerminalFitHorizontally(fit: boolean): void {
    this.state.terminalFitHorizontally = fit;
    this.callbacks?.requestUpdate();
  }

  setTerminalMaxCols(cols: number): void {
    this.state.terminalMaxCols = cols;
    this.callbacks?.requestUpdate();
  }

  setTerminalFontSize(size: number): void {
    this.state.terminalFontSize = size;
    this.callbacks?.requestUpdate();
  }

  setTerminalTheme(theme: TerminalThemeId): void {
    this.state.terminalTheme = theme;
    this.callbacks?.requestUpdate();
  }

  // Binary mode
  setUseBinaryMode(use: boolean): void {
    this.state.useBinaryMode = use;
    this.callbacks?.requestUpdate();
  }

  // View mode
  setViewMode(mode: 'terminal' | 'worktree'): void {
    this.state.viewMode = mode;
    this.callbacks?.requestUpdate();
  }

  // Keyboard capture
  setKeyboardCaptureActive(active: boolean): void {
    this.state.keyboardCaptureActive = active;
    this.callbacks?.requestUpdate();
  }

  // Mobile input helpers
  toggleMobileInput(): void {
    this.state.showMobileInput = !this.state.showMobileInput;
    this.callbacks?.requestUpdate();
  }

  toggleCtrlAlpha(): void {
    this.state.showCtrlAlpha = !this.state.showCtrlAlpha;
    this.callbacks?.requestUpdate();
  }

  toggleDirectKeyboard(): void {
    this.state.useDirectKeyboard = !this.state.useDirectKeyboard;

    // Save preference
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      const preferences = stored ? JSON.parse(stored) : {};
      preferences.useDirectKeyboard = this.state.useDirectKeyboard;
      localStorage.setItem('vibetunnel_app_preferences', JSON.stringify(preferences));

      // Emit preference change event
      window.dispatchEvent(
        new CustomEvent('app-preferences-changed', {
          detail: preferences,
        })
      );
    } catch (error) {
      logger.error('Failed to save direct keyboard preference', error);
    }

    this.callbacks?.requestUpdate();
  }

  // Check orientation
  checkOrientation(): void {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    this.state.isLandscape = isLandscape;
    this.callbacks?.requestUpdate();
  }

  // Load preferences
  loadDirectKeyboardPreference(): void {
    try {
      const stored = localStorage.getItem('vibetunnel_app_preferences');
      if (stored) {
        const preferences = JSON.parse(stored);
        this.state.useDirectKeyboard = preferences.useDirectKeyboard ?? true; // Default to true
      } else {
        this.state.useDirectKeyboard = true; // Default to true when no settings exist
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
      this.state.useDirectKeyboard = true; // Default to true on error
    }
  }
}

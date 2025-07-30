/**
 * Shared interfaces for session-view components
 *
 * Breaking down the large callback interface into smaller, focused interfaces
 * following the Interface Segregation Principle
 */

/**
 * State management callbacks for basic component state
 */
export interface StateCallbacks {
  getIsMobile(): boolean;
  setIsMobile(value: boolean): void;
  getUseDirectKeyboard(): boolean;
  setUseDirectKeyboard(value: boolean): void;
  setShowQuickKeys(value: boolean): void;
  setShowFileBrowser(value: boolean): void;
  getShowWidthSelector(): boolean;
  setShowWidthSelector(value: boolean): void;
  setCustomWidth(value: string): void;
  setKeyboardHeight(value: number): void;
  setConnected(connected: boolean): void;
  getKeyboardCaptureActive(): boolean;
}

/**
 * UI update and rendering callbacks
 */
export interface UICallbacks {
  requestUpdate(): void;
  focus(): void;
  getDisableFocusManagement(): boolean;
}

/**
 * Navigation and routing callbacks
 */
export interface NavigationCallbacks {
  handleBack(): void;
  handleKeyboardInput(e: KeyboardEvent): Promise<void>;
}

/**
 * DOM operation callbacks
 */
export interface DOMCallbacks {
  querySelector(selector: string): Element | null;
  setTabIndex(value: number): void;
  addEventListener(event: string, handler: EventListener): void;
  removeEventListener(event: string, handler: EventListener): void;
}

/**
 * Loading state management callbacks
 */
export interface LoadingCallbacks {
  startLoading(): void;
  stopLoading(): void;
}

/**
 * Manager access callbacks - provides access to other managers
 * Note: These return minimal interfaces to reduce coupling
 */
export interface ManagerAccessCallbacks {
  getDirectKeyboardManager(): {
    getShowQuickKeys(): boolean;
    setShowQuickKeys?(value: boolean): void;
    ensureHiddenInputVisible(): void;
    cleanup(): void;
  };
  getInputManager(): { isKeyboardShortcut(e: KeyboardEvent): boolean } | null;
  getTerminalLifecycleManager(): {
    resetTerminalSize(): void;
    cleanup(): void;
  } | null;
  getConnectionManager(): {
    setConnected(connected: boolean): void;
    cleanupStreamConnection(): void;
  } | null;
}

/**
 * Combined interface for lifecycle event manager
 * Extends all the smaller interfaces
 */
export interface LifecycleEventManagerCallbacks
  extends StateCallbacks,
    UICallbacks,
    NavigationCallbacks,
    DOMCallbacks,
    LoadingCallbacks,
    ManagerAccessCallbacks {}

/**
 * Event emitter interface for event-driven architecture
 */
export interface SessionViewEventMap {
  'state-change': CustomEvent<{ property: string; value: unknown }>;
  navigation: CustomEvent<{ action: 'back' | 'keyboard-input'; data?: unknown }>;
  'ui-update': CustomEvent<{ type: string }>;
  'loading-change': CustomEvent<{ loading: boolean }>;
  'manager-action': CustomEvent<{ manager: string; action: string; data?: unknown }>;
}

/**
 * Base event emitter class for managers
 */
export class ManagerEventEmitter extends EventTarget {
  emit<K extends keyof SessionViewEventMap>(
    type: K,
    detail: SessionViewEventMap[K]['detail']
  ): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on<K extends keyof SessionViewEventMap>(
    type: K,
    listener: (event: SessionViewEventMap[K]) => void
  ): void {
    this.addEventListener(type, listener as EventListener);
  }

  off<K extends keyof SessionViewEventMap>(
    type: K,
    listener: (event: SessionViewEventMap[K]) => void
  ): void {
    this.removeEventListener(type, listener as EventListener);
  }
}

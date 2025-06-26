/**
 * Lifecycle & Event Manager for Session View
 *
 * Manages the lifecycle events, keyboard/touch handlers, preferences, and
 * overall event coordination for the session view component.
 */
import { createLogger } from '../../utils/logger.js';
import type { AppPreferences } from '../app-settings.js';
import type { Session } from '../session-list.js';

const logger = createLogger('lifecycle-event-manager');

export interface LifecycleEventManagerCallbacks {
  requestUpdate(): void;
  handleBack(): void;
  handleKeyboardInput(e: KeyboardEvent): Promise<void>;
  getIsMobile(): boolean;
  setIsMobile(value: boolean): void;
  getUseDirectKeyboard(): boolean;
  setUseDirectKeyboard(value: boolean): void;
  getDirectKeyboardManager(): {
    getShowQuickKeys(): boolean;
    ensureHiddenInputVisible(): void;
    cleanup(): void;
  };
  setShowQuickKeys(value: boolean): void;
  setShowFileBrowser(value: boolean): void;
  getInputManager(): {
    isKeyboardShortcut(e: KeyboardEvent): boolean;
  } | null;
  getShowWidthSelector(): boolean;
  setShowWidthSelector(value: boolean): void;
  setCustomWidth(value: string): void;
  querySelector(selector: string): Element | null;
  setTabIndex(value: number): void;
  addEventListener(event: string, handler: EventListener): void;
  focus(): void;
  getDisableFocusManagement(): boolean;
  startLoading(): void;
  setKeyboardHeight(value: number): void;
}

export class LifecycleEventManager {
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: LifecycleEventManagerCallbacks | null = null;
  private session: Session | null = null;
  private touchStartX = 0;
  private touchStartY = 0;

  // Event listener tracking
  private keyboardListenerAdded = false;
  private touchListenersAdded = false;
  private visualViewportHandler: (() => void) | null = null;

  constructor() {
    logger.log('LifecycleEventManager initialized');
  }

  setSessionViewElement(element: HTMLElement): void {
    this.sessionViewElement = element;
  }

  setCallbacks(callbacks: LifecycleEventManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  setSession(session: Session | null): void {
    this.session = session;
  }

  handlePreferencesChanged = (e: Event): void => {
    if (!this.callbacks) return;

    const event = e as CustomEvent;
    const preferences = event.detail as AppPreferences;
    this.callbacks.setUseDirectKeyboard(preferences.useDirectKeyboard);

    // Update hidden input based on preference
    const isMobile = this.callbacks.getIsMobile();
    const useDirectKeyboard = this.callbacks.getUseDirectKeyboard();
    const directKeyboardManager = this.callbacks.getDirectKeyboardManager();

    if (isMobile && useDirectKeyboard && !directKeyboardManager.getShowQuickKeys()) {
      directKeyboardManager.ensureHiddenInputVisible();
    } else if (!useDirectKeyboard) {
      // Cleanup direct keyboard manager when disabled
      directKeyboardManager.cleanup();
      this.callbacks.setShowQuickKeys(false);
    }
  };

  keyboardHandler = (e: KeyboardEvent): void => {
    if (!this.callbacks) return;

    // Handle Cmd+O / Ctrl+O to open file browser
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
      e.preventDefault();
      this.callbacks.setShowFileBrowser(true);
      return;
    }

    if (!this.session) return;

    // Check if this is a browser shortcut we should allow
    const inputManager = this.callbacks.getInputManager();
    if (inputManager?.isKeyboardShortcut(e)) {
      return;
    }

    // Handle Escape key specially for exited sessions
    if (e.key === 'Escape' && this.session.status === 'exited') {
      this.callbacks.handleBack();
      return;
    }

    // Only prevent default for keys we're actually going to handle
    e.preventDefault();
    e.stopPropagation();

    this.callbacks.handleKeyboardInput(e);
  };

  touchStartHandler = (e: TouchEvent): void => {
    if (!this.callbacks) return;

    const isMobile = this.callbacks.getIsMobile();
    if (!isMobile) return;

    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  };

  touchEndHandler = (e: TouchEvent): void => {
    if (!this.callbacks) return;

    const isMobile = this.callbacks.getIsMobile();
    if (!isMobile) return;

    const touch = e.changedTouches[0];
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;

    const deltaX = touchEndX - this.touchStartX;
    const deltaY = touchEndY - this.touchStartY;

    // Check for horizontal swipe from left edge (back gesture)
    const isSwipeRight = deltaX > 100;
    const isVerticallyStable = Math.abs(deltaY) < 100;
    const startedFromLeftEdge = this.touchStartX < 50;

    if (isSwipeRight && isVerticallyStable && startedFromLeftEdge) {
      // Trigger back navigation
      this.callbacks.handleBack();
    }
  };

  handleClickOutside = (e: Event): void => {
    if (!this.callbacks) return;

    const showWidthSelector = this.callbacks.getShowWidthSelector();
    if (showWidthSelector) {
      const target = e.target as HTMLElement;
      const widthSelector = this.callbacks.querySelector('.width-selector-container');
      const widthButton = this.callbacks.querySelector('.width-selector-button');

      if (!widthSelector?.contains(target) && !widthButton?.contains(target)) {
        this.callbacks.setShowWidthSelector(false);
        this.callbacks.setCustomWidth('');
      }
    }
  };

  setupLifecycle(): void {
    if (!this.callbacks) return;

    // Make session-view focusable
    this.callbacks.setTabIndex(0);
    this.callbacks.addEventListener('click', () => {
      if (!this.callbacks?.getDisableFocusManagement()) {
        this.callbacks?.focus();
      }
    });

    // Add click outside handler for width selector
    document.addEventListener('click', this.handleClickOutside);

    // Show loading animation if no session yet
    if (!this.session) {
      this.callbacks.startLoading();
    }

    // Detect mobile device - only show onscreen keyboard on actual mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    this.callbacks.setIsMobile(isMobile);

    // Listen for preference changes
    window.addEventListener('app-preferences-changed', this.handlePreferencesChanged);

    this.setupMobileFeatures(isMobile);
    this.setupEventListeners(isMobile);
  }

  private setupMobileFeatures(isMobile: boolean): void {
    if (!this.callbacks) return;

    // Set up VirtualKeyboard API if available and on mobile
    if (isMobile && 'virtualKeyboard' in navigator) {
      // Enable overlays-content mode so keyboard doesn't resize viewport
      try {
        const nav = navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } };
        if (nav.virtualKeyboard) {
          nav.virtualKeyboard.overlaysContent = true;
        }
        logger.log('VirtualKeyboard API: overlaysContent enabled');
      } catch (e) {
        logger.warn('Failed to set virtualKeyboard.overlaysContent:', e);
      }
    } else if (isMobile) {
      logger.log('VirtualKeyboard API not available on this device');
    }

    // Set up Visual Viewport API for Safari keyboard detection
    if (isMobile && window.visualViewport) {
      this.visualViewportHandler = () => {
        const viewport = window.visualViewport;
        if (!viewport || !this.callbacks) return;
        const keyboardHeight = window.innerHeight - viewport.height;

        // Store keyboard height in state
        this.callbacks.setKeyboardHeight(keyboardHeight);

        // Update quick keys component if it exists
        const quickKeys = this.callbacks.querySelector('terminal-quick-keys') as HTMLElement & {
          keyboardHeight: number;
        };
        if (quickKeys) {
          quickKeys.keyboardHeight = keyboardHeight;
        }

        logger.log(`Visual Viewport keyboard height: ${keyboardHeight}px`);
      };

      window.visualViewport.addEventListener('resize', this.visualViewportHandler);
      window.visualViewport.addEventListener('scroll', this.visualViewportHandler);
    }
  }

  private setupEventListeners(isMobile: boolean): void {
    // Only add listeners if not already added
    if (!isMobile && !this.keyboardListenerAdded) {
      document.addEventListener('keydown', this.keyboardHandler);
      this.keyboardListenerAdded = true;
    } else if (isMobile && !this.touchListenersAdded) {
      // Add touch event listeners for mobile swipe gestures
      document.addEventListener('touchstart', this.touchStartHandler, { passive: true });
      document.addEventListener('touchend', this.touchEndHandler, { passive: true });
      this.touchListenersAdded = true;
    }
  }

  cleanup(): void {
    logger.log('LifecycleEventManager cleanup');

    // Clean up event listeners
    document.removeEventListener('click', this.handleClickOutside);
    window.removeEventListener('app-preferences-changed', this.handlePreferencesChanged);

    // Remove global keyboard event listener
    if (!this.callbacks?.getIsMobile() && this.keyboardListenerAdded) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardListenerAdded = false;
    } else if (this.callbacks?.getIsMobile() && this.touchListenersAdded) {
      // Remove touch event listeners
      document.removeEventListener('touchstart', this.touchStartHandler);
      document.removeEventListener('touchend', this.touchEndHandler);
      this.touchListenersAdded = false;
    }

    // Clean up Visual Viewport listener
    if (this.visualViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.visualViewportHandler);
      window.visualViewport.removeEventListener('scroll', this.visualViewportHandler);
      this.visualViewportHandler = null;
    }

    this.sessionViewElement = null;
    this.callbacks = null;
    this.session = null;
  }
}

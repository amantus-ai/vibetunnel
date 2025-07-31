// UI Constants for VibeTunnel

export const BREAKPOINTS = {
  MOBILE: 768,
  TABLET: 1024,
  DESKTOP: 1280,
} as const;

export const SIDEBAR = {
  DEFAULT_WIDTH: 420,
  MIN_WIDTH: 240,
  MAX_WIDTH: 600,
  MOBILE_RIGHT_MARGIN: 80,
} as const;

export const TRANSITIONS = {
  SIDEBAR: 200,
  MOBILE_SLIDE: 200,
  RESIZE_HANDLE: 200,
} as const;

/**
 * Z-Index layering system for UI components
 *
 * Layers (from bottom to top):
 * - 0-49: Base UI elements (terminals, buttons, mobile overlays)
 * - 50-99: Dropdowns and popovers
 * - 100-199: Modal dialogs and their backdrops
 * - 200+: Special overlays that must appear above everything
 *
 * When adding new z-index values:
 * 1. Choose the appropriate range based on the component type
 * 2. Leave gaps between values for future insertions
 * 3. Document why the component needs its specific layer
 */
export const Z_INDEX = {
  // Base UI elements (0-49)
  SESSION_LIST_BOTTOM_BAR: 10,
  TERMINAL_OVERLAY: 15,
  LOG_BUTTON: 20,
  MOBILE_OVERLAY: 25,
  SIDEBAR_MOBILE: 30,
  MOBILE_INPUT_OVERLAY: 40,
  CTRL_ALPHA_OVERLAY: 45,
  TERMINAL_QUICK_KEYS: 48,

  // Dropdowns and popovers (50-99)
  WIDTH_SELECTOR_DROPDOWN: 60,
  BRANCH_SELECTOR_DROPDOWN: 65,
  IME_INPUT: 70, // Invisible IME input for CJK text - needs to be above terminal but below modals

  // Modals and overlays (100-199)
  MODAL_BACKDROP: 100,
  MODAL: 105,
  FILE_PICKER: 110,
  SESSION_EXITED_OVERLAY: 120,
  NOTIFICATION: 150, // Notifications appear above modals but below file browser

  // Special high-priority overlays (200+)
  FILE_BROWSER: 1100, // Must be higher than modal backdrop (1000)
} as const;

export const TERMINAL = {
  MIN_HEIGHT: 200,
  DEFAULT_VISIBLE_ROWS: 24,
  RESIZE_DEBOUNCE: 100,
} as const;

export const TIMING = {
  AUTO_REFRESH_INTERVAL: 1000,
  SESSION_SEARCH_DELAY: 500,
  KILL_ALL_ANIMATION_DELAY: 500,
  ERROR_MESSAGE_TIMEOUT: 5000,
  SUCCESS_MESSAGE_TIMEOUT: 5000,
  KILL_ALL_BUTTON_DISABLE_DURATION: 2000,
} as const;

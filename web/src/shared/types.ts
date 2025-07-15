/**
 * Shared type definitions used by both frontend and backend
 */

/**
 * Session status enum
 */
export type SessionStatus = 'starting' | 'running' | 'exited';

/**
 * Core session information stored in session.json
 * Minimal, clean data persisted to disk
 */
export interface SessionInfo {
  id: string;
  name: string;
  command: string[];
  workingDir: string;
  status: SessionStatus;
  exitCode?: number;
  startedAt: string;
  pid?: number;
  initialCols?: number;
  initialRows?: number;
  /**
   * Byte offset of the last clear event in the session stdout file.
   * Used to quickly seek to the most recent content when replaying casts.
   */
  lastClearOffset?: number;
  version?: string; // VibeTunnel version that created this session
}

/**
 * Session as returned by API endpoints
 * Includes everything from SessionInfo plus additional runtime/computed fields
 */
export interface Session extends SessionInfo {
  lastModified: string;
  active?: boolean;

  // Activity information (for dynamic title mode)
  activityStatus?: {
    isActive: boolean;
    specificStatus?: {
      app: string;
      status: string;
    };
  };

  // Source information (for HQ mode)
  source?: 'local' | 'remote';
  remoteId?: string;
  remoteName?: string;
  remoteUrl?: string;
}

/**
 * Activity status for a session
 */
export interface SessionActivity {
  isActive: boolean;
  timestamp: string;
  session?: SessionInfo;
  specificStatus?: {
    app: string;
    status: string;
  };
}

/**
 * Terminal title management modes
 */
export enum TitleMode {
  NONE = 'none', // No title management
  FILTER = 'filter', // Block all title changes from apps
  STATIC = 'static', // Static title: path — command — session
  DYNAMIC = 'dynamic', // Static + live activity indicators
}

/**
 * Session creation options
 */
export interface SessionCreateOptions {
  sessionId?: string;
  name?: string;
  workingDir?: string;
  cols?: number;
  rows?: number;
  titleMode?: TitleMode;
}

/**
 * Session input (keyboard/special keys)
 */
export interface SessionInput {
  text?: string;
  key?: SpecialKey;
}

/**
 * Special keys that can be sent to sessions
 */
export type SpecialKey =
  | 'arrow_up'
  | 'arrow_down'
  | 'arrow_left'
  | 'arrow_right'
  | 'escape'
  | 'enter'
  | 'ctrl_enter'
  | 'shift_enter'
  | 'backspace'
  | 'tab'
  | 'shift_tab'
  | 'page_up'
  | 'page_down'
  | 'home'
  | 'end'
  | 'delete'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12';

/**
 * Push notification subscription
 */
export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Stored push subscription with metadata
 */
export interface StoredPushSubscription extends PushSubscription {
  id: string;
  deviceId: string;
  userAgent?: string;
  createdAt: string;
  lastUsed: string;
}

/**
 * Push notification preferences
 */
export interface PushNotificationPreferences {
  enabled: boolean;
  sessionExit: boolean;
  sessionStart: boolean;
  sessionError: boolean;
  systemAlerts: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

/**
 * Push notification types
 */
export type PushNotificationType =
  | 'session_exit'
  | 'session_start'
  | 'session_error'
  | 'system_alert'
  | 'test';

/**
 * Push notification data
 */
export interface PushNotificationData {
  type: PushNotificationType;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  requireInteraction?: boolean;
  silent?: boolean;
}

/**
 * Push notification history entry
 */
export interface PushNotificationHistoryEntry {
  id: string;
  timestamp: string;
  type: PushNotificationType;
  title: string;
  body: string;
  success: boolean;
  error?: string;
  deviceId?: string;
}

/**
 * Device registration for push notifications
 */
export interface PushDeviceRegistration {
  deviceId: string;
  subscription: PushSubscription;
  userAgent?: string;
}

/**
 * Server status information
 */
export interface ServerStatus {
  macAppConnected: boolean;
  isHQMode: boolean;
  version: string;
}

/**
 * Standardized error types for screen capture functionality
 * Used across Swift, TypeScript server, and frontend layers
 */

export enum ScreencapErrorCode {
  // Connection errors
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  WEBSOCKET_CLOSED = 'WEBSOCKET_CLOSED',
  UNIX_SOCKET_ERROR = 'UNIX_SOCKET_ERROR',

  // Permission errors
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',

  // Display/Window errors
  DISPLAY_NOT_FOUND = 'DISPLAY_NOT_FOUND',
  DISPLAY_DISCONNECTED = 'DISPLAY_DISCONNECTED',
  WINDOW_NOT_FOUND = 'WINDOW_NOT_FOUND',
  WINDOW_CLOSED = 'WINDOW_CLOSED',

  // Capture errors
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  CAPTURE_NOT_ACTIVE = 'CAPTURE_NOT_ACTIVE',
  INVALID_CAPTURE_TYPE = 'INVALID_CAPTURE_TYPE',

  // WebRTC errors
  WEBRTC_INIT_FAILED = 'WEBRTC_INIT_FAILED',
  WEBRTC_OFFER_FAILED = 'WEBRTC_OFFER_FAILED',
  WEBRTC_ANSWER_FAILED = 'WEBRTC_ANSWER_FAILED',
  WEBRTC_ICE_FAILED = 'WEBRTC_ICE_FAILED',

  // Session errors
  INVALID_SESSION = 'INVALID_SESSION',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // General errors
  INVALID_REQUEST = 'INVALID_REQUEST',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export interface ScreencapError {
  code: ScreencapErrorCode;
  message: string;
  details?: unknown;
  timestamp: string;
}

export function createScreencapError(
  code: ScreencapErrorCode,
  message: string,
  details?: unknown
): ScreencapError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function screencapErrorFromError(error: unknown): ScreencapError {
  if (error && typeof error === 'object' && 'code' in error) {
    const e = error as Record<string, unknown>;
    if (Object.values(ScreencapErrorCode).includes(e.code as ScreencapErrorCode)) {
      return {
        code: e.code as ScreencapErrorCode,
        message: (e.message as string) || 'Unknown error',
        details: e.details,
        timestamp: (e.timestamp as string) || new Date().toISOString(),
      };
    }
  }

  // Convert unknown errors
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: ScreencapErrorCode.INTERNAL_ERROR,
    message,
    details: error,
    timestamp: new Date().toISOString(),
  };
}

export function isScreencapError(error: unknown): error is ScreencapError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    'timestamp' in error &&
    Object.values(ScreencapErrorCode).includes((error as ScreencapError).code)
  );
}

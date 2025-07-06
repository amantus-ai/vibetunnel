/**
 * Unified control socket protocol definitions
 */

export type ControlMessageType = 'request' | 'response' | 'event';
export type ControlCategory = 'terminal' | 'screencap' | 'git' | 'system';

export interface ControlMessage {
  id: string;
  type: ControlMessageType;
  category: ControlCategory;
  action: string;
  payload?: any;
  sessionId?: string;
  error?: string;
}

// Terminal control actions
export interface TerminalSpawnRequest {
  sessionId: string;
  workingDirectory?: string;
  command?: string;
  terminalPreference?: string;
}

export interface TerminalSpawnResponse {
  success: boolean;
  error?: string;
}

// Screen capture control actions
export interface ScreenCaptureApiRequest {
  sessionId: string;
  method: string;
  endpoint: string;
  data?: any;
}

export interface ScreenCaptureWebRTCSignal {
  sessionId: string;
  data: any;
}

// Helper to create control messages
export function createControlMessage(
  category: ControlCategory,
  action: string,
  payload?: any,
  sessionId?: string
): ControlMessage {
  return {
    id: crypto.randomUUID(),
    type: 'request',
    category,
    action,
    payload,
    sessionId,
  };
}

export function createControlResponse(
  request: ControlMessage,
  payload?: any,
  error?: string
): ControlMessage {
  return {
    id: request.id,
    type: 'response',
    category: request.category,
    action: request.action,
    payload,
    sessionId: request.sessionId,
    error,
  };
}

export function createControlEvent(
  category: ControlCategory,
  action: string,
  payload?: any,
  sessionId?: string
): ControlMessage {
  return {
    id: crypto.randomUUID(),
    type: 'event',
    category,
    action,
    payload,
    sessionId,
  };
}

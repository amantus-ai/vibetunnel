/**
 * Type definitions for VibeTunnel sessions
 */

export interface SessionInfo {
  id: string;
  name: string;
  active?: boolean;
  status?: 'RUNNING' | 'EXITED' | 'EXIT' | string;
  created?: string;
  startTime?: string;
  command?: string;
}

export interface SessionResponse {
  id: string;
  name: string;
  success: boolean;
  error?: string;
}

export interface CreateSessionRequest {
  name: string;
  command?: string;
}

export interface BatchOperationResult {
  total: number;
  successful: number;
  failed: number;
}

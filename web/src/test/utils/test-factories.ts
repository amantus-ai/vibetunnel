/**
 * Factory functions for creating test data with sensible defaults
 * This helps reduce duplication and makes tests more maintainable
 */

import type { Session } from '@/shared/types';

interface Activity {
  id: number;
  session_id: string;
  timestamp: Date;
  type: 'input' | 'output' | 'resize' | 'connect' | 'disconnect';
  data: string;
}

interface CreateSessionOptions {
  id?: string;
  name?: string;
  command?: string[];
  workingDir?: string;
  status?: 'running' | 'exited' | 'stopped';
  exitCode?: number;
  startedAt?: string;
  pid?: number;
  lastModified?: string;
  active?: boolean;
  source?: 'local' | 'remote';
  remoteId?: string;
  remoteName?: string;
  remoteUrl?: string;
  // Git-related properties
  gitBranch?: string;
  gitAheadCount?: number;
  gitBehindCount?: number;
  gitHasChanges?: boolean;
  gitIsWorktree?: boolean;
}

interface CreateActivityOptions {
  session_id?: string;
  timestamp?: Date;
  type?: 'input' | 'output' | 'resize' | 'connect' | 'disconnect';
  data?: string;
}

interface CreateAuthConfigOptions {
  enableSSHKeys?: boolean;
  disallowUserPassword?: boolean;
  noAuth?: boolean;
}

interface CreateAuthResultOptions {
  success?: boolean;
  error?: string;
  userId?: string;
  authMethod?: string;
  token?: string;
}

let sessionCounter = 1;
let activityCounter = 1;

/**
 * Creates a test session with sensible defaults
 */
export function createTestSession(options: CreateSessionOptions = {}): Session {
  const id = options.id || `test-session-${sessionCounter++}`;
  const now = new Date();

  return {
    id,
    name: options.name || `Test Session ${id}`,
    command: options.command || ['/bin/bash', '-l'],
    workingDir: options.workingDir || '/home/test',
    status: options.status === 'stopped' ? 'exited' : options.status || 'running',
    exitCode: options.exitCode,
    startedAt: options.startedAt || now.toISOString(),
    pid: options.pid || 12345 + sessionCounter,
    lastModified: options.lastModified || now.toISOString(),
    active: options.active !== undefined ? options.active : true,
    source: options.source || 'local',
    remoteId: options.remoteId,
    remoteName: options.remoteName,
    remoteUrl: options.remoteUrl,
    // Git-related properties
    gitBranch: options.gitBranch,
    gitAheadCount: options.gitAheadCount,
    gitBehindCount: options.gitBehindCount,
    gitHasChanges: options.gitHasChanges,
    gitIsWorktree: options.gitIsWorktree,
  };
}

/**
 * Creates multiple test sessions
 */
export function createTestSessions(count: number, options: CreateSessionOptions = {}): Session[] {
  return Array.from({ length: count }, (_, i) =>
    createTestSession({
      ...options,
      id: options.id ? `${options.id}-${i + 1}` : undefined,
      name: options.name ? `${options.name} ${i + 1}` : undefined,
    })
  );
}

/**
 * Creates a test activity with sensible defaults
 */
export function createTestActivity(options: CreateActivityOptions = {}): Activity {
  const id = activityCounter++;

  return {
    id,
    session_id: options.session_id || 'test-session-1',
    timestamp: options.timestamp || new Date(),
    type: options.type || 'output',
    data: options.data || `Test activity data ${id}`,
  };
}

/**
 * Creates multiple test activities
 */
export function createTestActivities(
  count: number,
  sessionId: string,
  options: Partial<CreateActivityOptions> = {}
): Activity[] {
  return Array.from({ length: count }, (_, i) =>
    createTestActivity({
      ...options,
      session_id: sessionId,
      data: options.data || `Activity ${i + 1}`,
      timestamp: options.timestamp || new Date(Date.now() + i * 1000),
    })
  );
}

/**
 * Creates auth configuration for testing
 */
export function createAuthConfig(options: CreateAuthConfigOptions = {}): CreateAuthConfigOptions {
  return {
    enableSSHKeys: options.enableSSHKeys !== undefined ? options.enableSSHKeys : false,
    disallowUserPassword:
      options.disallowUserPassword !== undefined ? options.disallowUserPassword : false,
    noAuth: options.noAuth !== undefined ? options.noAuth : false,
  };
}

/**
 * Creates auth result for testing
 */
export function createAuthResult(options: CreateAuthResultOptions = {}): CreateAuthResultOptions {
  return {
    success: options.success !== undefined ? options.success : true,
    error: options.error,
    userId: options.userId || 'testuser',
    authMethod: options.authMethod || 'password',
    token: options.token || `test-token-${Math.random().toString(36).substr(2, 9)}`,
  };
}

/**
 * Creates localStorage data for vibe-tunnel
 */
export function createLocalStorageData(commands: string[] = []): Record<string, string> {
  const defaultCommands =
    commands.length > 0 ? commands : ['npm run dev', 'git status', 'pnpm test'];

  return {
    'vibe-tunnel-commands': JSON.stringify(defaultCommands),
    'vibe-tunnel-token': 'test-auth-token',
    'vibe-tunnel-user': 'testuser',
  };
}

/**
 * Creates WebSocket mock data
 */
export function createWebSocketMessage(type: string, data: unknown = {}): string {
  return JSON.stringify({ type, data });
}

/**
 * Creates SSE event data
 */
export function createSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Reset factory counters (useful for test isolation)
 */
export function resetFactoryCounters(): void {
  sessionCounter = 1;
  activityCounter = 1;
}

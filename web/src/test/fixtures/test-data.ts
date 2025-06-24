/**
 * Common test data fixtures for unit tests
 */

import type { SessionEntryWithId, SessionWithId } from '../../server/types';

export const mockSessions: SessionWithId[] = [
  {
    id: 'session-1',
    cmdline: ['bash', '-l'],
    name: 'Production Server',
    cwd: '/home/user/projects',
    pid: 12345,
    status: 'running',
    started_at: '2025-01-01T10:00:00Z',
    exit_code: null,
    term: 'xterm-256color',
    spawn_type: 'pty',
    cols: 120,
    rows: 40,
  },
  {
    id: 'session-2',
    cmdline: ['pnpm', 'run', 'dev'],
    name: 'Development Server',
    cwd: '/home/user/projects/app',
    pid: 12346,
    status: 'running',
    started_at: '2025-01-01T10:30:00Z',
    exit_code: null,
    term: 'xterm-256color',
    spawn_type: 'pty',
    cols: 120,
    rows: 40,
  },
  {
    id: 'session-3',
    cmdline: ['python', 'script.py'],
    name: 'Data Processing',
    cwd: '/home/user/scripts',
    pid: 12347,
    status: 'exited',
    started_at: '2025-01-01T09:00:00Z',
    exit_code: 0,
    term: 'xterm-256color',
    spawn_type: 'pty',
    cols: 80,
    rows: 24,
  },
];

export const mockSessionEntries: SessionEntryWithId[] = mockSessions.map((session) => ({
  ...session,
  source: 'local' as const,
}));

export const mockActivityStatus = {
  'session-1': {
    isActive: true,
    timestamp: '2025-01-01T10:45:00Z',
    session: mockSessions[0],
  },
  'session-2': {
    isActive: false,
    timestamp: '2025-01-01T10:35:00Z',
    session: mockSessions[1],
  },
  'session-3': {
    isActive: false,
    timestamp: '2025-01-01T09:30:00Z',
    session: mockSessions[2],
  },
};

export const mockRemotes = [
  {
    id: 'remote-1',
    name: 'Development Server',
    url: 'http://dev.example.com:3000',
    token: 'dev-token-123',
    registeredAt: '2025-01-01T08:00:00Z',
  },
  {
    id: 'remote-2',
    name: 'Staging Server',
    url: 'http://staging.example.com:3000',
    token: 'staging-token-456',
    registeredAt: '2025-01-01T08:30:00Z',
  },
];

export const mockAsciinemaHeader = {
  version: 2,
  width: 80,
  height: 24,
  timestamp: 1704103200,
  env: {
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
  },
};

export const mockAsciinemaEvents = [
  [0, 'o', 'Welcome to VibeTunnel\\r\\n'],
  [0.5, 'o', '$ '],
  [1, 'i', 'ls'],
  [1.1, 'o', 'ls\\r\\n'],
  [1.2, 'o', 'file1.txt  file2.txt  directory/\\r\\n'],
  [1.3, 'o', '$ '],
];

export const mockBinaryBuffer = new Uint8Array([
  // Magic bytes "VT"
  0x56,
  0x54,
  // Version
  0x01,
  // Flags
  0x00,
  // Dimensions (cols: 80, rows: 24)
  0x00,
  0x50,
  0x00,
  0x18,
  // Cursor (x: 2, y: 0, viewport: 0)
  0x00,
  0x02,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  // Reserved
  0x00,
  0x00,
  0x00,
  0x00,
  // Sample row data...
  0xfd, // Content marker
  0x01,
  0x48, // 'H'
  0x01,
  0x65, // 'e'
  0x01,
  0x6c, // 'l'
  0x01,
  0x6c, // 'l'
  0x01,
  0x6f, // 'o'
  0xfe, // Empty row marker
]);

export const mockAuthToken = 'test-auth-token-abc123';

export const mockUser = {
  username: 'testuser',
  token: mockAuthToken,
};

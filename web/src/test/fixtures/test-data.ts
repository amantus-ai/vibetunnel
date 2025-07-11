/**
 * Common test data fixtures for unit tests
 */

import type { Session } from '../../shared/types';

export const mockSessions: Session[] = [
  {
    id: 'session-1',
    command: ['bash', '-l'],
    name: 'Production Server',
    workingDir: '/home/user/projects',
    pid: 12345,
    status: 'running',
    startedAt: '2025-01-01T10:00:00Z',
    exitCode: undefined,
    source: 'local',
    initialCols: 120,
    initialRows: 40,
    lastModified: '2025-01-01T10:00:00Z',
    active: true,
  },
  {
    id: 'session-2',
    command: ['pnpm', 'run', 'dev'],
    name: 'Development Server',
    workingDir: '/home/user/projects/app',
    pid: 12346,
    status: 'running',
    startedAt: '2025-01-01T10:30:00Z',
    exitCode: undefined,
    source: 'local',
    initialCols: 120,
    initialRows: 40,
    lastModified: '2025-01-01T10:30:00Z',
    active: true,
  },
  {
    id: 'session-3',
    command: ['python', 'script.py'],
    name: 'Data Processing',
    workingDir: '/home/user/scripts',
    pid: 12347,
    status: 'exited',
    startedAt: '2025-01-01T09:00:00Z',
    exitCode: 0,
    source: 'local',
    initialCols: 80,
    initialRows: 24,
    lastModified: '2025-01-01T09:00:00Z',
    active: false,
  },
];

// mockSessionEntries no longer needed with new Session type

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

// Asciinema fixtures for stream pruning tests
export const mockAsciinemaWithClears = {
  header: {
    version: 2,
    width: 120,
    height: 40,
    timestamp: 1704103200,
  },
  events: [
    // Initial content
    [0, 'o', 'Line 1: Initial content that will be cleared\\r\\n'],
    [0.1, 'o', 'Line 2: More content\\r\\n'],
    [0.2, 'o', 'Line 3: Even more content\\r\\n'],
    [0.3, 'r', '80x24'], // Resize
    [0.4, 'o', 'Line 4: Content after resize\\r\\n'],
    [0.5, 'o', 'Line 5: More content to clear\\r\\n'],
    // First clear
    [0.6, 'o', '\u001b[3J'], // Clear scrollback
    [0.7, 'o', '\u001b[H\u001b[2J'], // Home + clear screen
    [0.8, 'o', 'Line 6: Content after first clear\\r\\n'],
    [0.9, 'o', 'Line 7: More content\\r\\n'],
    [1.0, 'r', '100x30'], // Another resize
    [1.1, 'o', 'Line 8: Content with new dimensions\\r\\n'],
    // Second clear (this should be the last one)
    [1.2, 'o', '\u001b[2J\u001b[3J\u001b[H'], // Clear in one command
    [1.3, 'o', 'Line 9: Final content that should remain\\r\\n'],
    [1.4, 'o', 'Line 10: This should be visible\\r\\n'],
    [1.5, 'o', 'Line 11: Last line\\r\\n'],
    ['exit', 0, 'test-session'],
  ],
};

export const mockAsciinemaWithClearMidLine = {
  header: {
    version: 2,
    width: 80,
    height: 24,
    timestamp: 1704103200,
  },
  events: [
    [0, 'o', 'Before clear'],
    [0.1, 'o', 'This has a clear \u001b[3J in the middle'],
    [0.2, 'o', 'After clear\\r\\n'],
    ['exit', 0, 'test-session'],
  ],
};

export const mockAsciinemaNoClears = {
  header: {
    version: 2,
    width: 80,
    height: 24,
    timestamp: 1704103200,
  },
  events: [
    [0, 'o', 'Line 1: No clears in this stream\\r\\n'],
    [0.1, 'o', 'Line 2: Just regular content\\r\\n'],
    [0.2, 'o', 'Line 3: Should replay everything\\r\\n'],
    ['exit', 0, 'test-session'],
  ],
};

// Real-world asciinema data from Claude session with multiple clears
export const mockRealWorldAsciinema = {
  header: {
    version: 2,
    width: 80,
    height: 24,
    timestamp: 1751323457,
    command: 'claude',
    title: 'Claude session',
  },
  events: [
    // Initial content before first clear
    [1189.0, 'o', 'Some previous Claude output that will be cleared\\r\\n'],
    [1189.1, 'o', 'More content before clear...\\r\\n'],
    [1189.2, 'r', '179x60'], // Terminal resize
    [1189.455, 'o', '\u001b[2J\u001b[3J\u001b[H'], // First clear
    [1189.5, 'o', 'Content after first clear\\r\\n'],
    [1190.0, 'o', 'More content...\\r\\n'],
    [1190.325, 'o', '\u001b[2J\u001b[3J\u001b[H'], // Second clear
    [1190.4, 'o', 'Content after second clear\\r\\n'],
    // ... more content ...
    [1361.0, 'o', 'Final Claude output before last clear\\r\\n'],
    [1361.137, 'o', '\u001b[2J\u001b[3J\u001b[H'], // Third clear
    [1361.2, 'o', 'Some content after third clear\\r\\n'],
    [1362.0, 'r', '180x61'], // Another resize
    [1362.264, 'o', '\u001b[2J\u001b[3J\u001b[H'], // Fourth and final clear
    // Content after the last clear - this should be preserved
    [
      1362.29,
      'o',
      '\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K\u001b[G\u001b[38;2;215;119;87m╭───────────────────────────────────────────────────╮\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m│\u001b[39m \u001b[38;2;215;119;87m✻\u001b[39m Welcome to \u001b[1mClaude Code\u001b[22m!                         \u001b[38;2;215;119;87m│\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m│\u001b[39m                                                   \u001b[38;2;215;119;87m│\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m│\u001b[39m   \u001b[3m\u001b[38;2;153;153;153m/help for help, /status for your current setup\u001b[39m\u001b[23m  \u001b[38;2;215;119;87m│\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m│\u001b[39m                                                   \u001b[38;2;215;119;87m│\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m│\u001b[39m   \u001b[38;2;153;153;153mcwd: /Users/badlogic/workspaces/vibetunnel/web\u001b[39m  \u001b[38;2;215;119;87m│\u001b[39m\\r\\n',
    ],
    [
      1362.29,
      'o',
      '\u001b[38;2;215;119;87m╰───────────────────────────────────────────────────╯\u001b[39m\\r\\n\\r\\n\\r\\n ',
    ],
    ['exit', 0, 'claude-session'],
  ],
};

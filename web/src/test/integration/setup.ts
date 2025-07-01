// Setup for integration tests - unmock node-pty to allow real PTY creation
import { vi } from 'vitest';

// Unmock node-pty for integration tests
vi.unmock('node-pty');

// Setup for integration tests - unmock native addon to allow real PTY creation
import { vi } from 'vitest';

// Unmock native addon for integration tests
vi.unmock('../server/pty/native-addon-adapter.js');

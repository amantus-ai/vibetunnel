// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  restoreLocalStorage,
  setupFetchMock,
  setupLocalStorageMock,
  waitForAsync,
} from '@/test/utils/component-helpers';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client';

// Mock AuthClient
vi.mock('../services/auth-client');

// Import component type
import type { FileBrowser } from './file-browser';

describe('FileBrowser', () => {
  let element: FileBrowser;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let mockAuthClient: AuthClient;
  let _localStorageMock: ReturnType<typeof setupLocalStorageMock>;

  beforeAll(async () => {
    // Import components to register custom elements
    await import('./file-browser');
    await import('./modal-wrapper');
    await import('./monaco-editor');
  });

  beforeEach(async () => {
    // Setup localStorage mock with isolation
    _localStorageMock = setupLocalStorageMock();

    // Setup fetch mock
    fetchMock = setupFetchMock();

    // Create mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Mock authClient.instance
    vi.mocked(await import('../services/auth-client')).authClient = mockAuthClient;

    // Create component
    element = await fixture<FileBrowser>(html`
      <file-browser
        .visible=${false}
        .mode=${'browse'}
        .session=${{ id: 'test-session', workingDir: '/home/user' } as Session}
      ></file-browser>
    `);
  });

  afterEach(() => {
    vi.clearAllMocks();
    restoreLocalStorage();
    fetchMock.clear();
  });

  describe('handleSelect method - absolute path fix', () => {
    it('should use currentFullPath when available instead of currentPath', async () => {
      // Set up the component in select mode but not visible yet
      element.mode = 'select';

      // Manually set the internal state to simulate a directory with relative path
      // This simulates the state after navigating to a directory that returned relative paths
      element.currentPath = '../..';
      element.currentFullPath = '/Users/steipete/Desktop';

      // Now make it visible (this would normally trigger a load, but we'll skip that)
      element.visible = true;
      await element.updateComplete;

      // Listen for directory-selected event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('directory-selected', resolve as EventListener, { once: true });
      });

      // Call handleSelect directly (simulating a click on select button)
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();

      // Wait for event
      const event = await eventPromise;

      // Verify the event contains the absolute path (currentFullPath), not the relative path
      expect(event.detail).toBe('/Users/steipete/Desktop');
      expect(event.detail).not.toBe('../..');
    });

    it('should fall back to currentPath when currentFullPath is not available', async () => {
      // Set up the component in select mode
      element.mode = 'select';

      // Mock the initial directory load that will happen when visible is set
      fetchMock.mockResponse(
        `/api/fs/browse?path=${encodeURIComponent('/home/user')}&showHidden=false&gitFilter=all`,
        {
          path: '/home/user',
          fullPath: '/home/user',
          gitStatus: null,
          files: [],
        }
      );

      element.visible = true;
      await element.updateComplete;
      await waitForAsync();

      // Now manually override to simulate old server response without fullPath
      element.currentPath = '/home/user/projects';
      element.currentFullPath = '';

      // Listen for directory-selected event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('directory-selected', resolve as EventListener, { once: true });
      });

      // Call handleSelect directly
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();

      // Wait for event
      const event = await eventPromise;

      // Should use currentPath as fallback
      expect(event.detail).toBe('/home/user/projects');
    });

    it('should not dispatch event when currentPath is empty', async () => {
      element.mode = 'select';

      // Mock the initial directory load
      fetchMock.mockResponse(
        `/api/fs/browse?path=${encodeURIComponent('/home/user')}&showHidden=false&gitFilter=all`,
        {
          path: '/home/user',
          fullPath: '/home/user',
          gitStatus: null,
          files: [],
        }
      );

      element.visible = true;
      await element.updateComplete;
      await waitForAsync();

      // Now clear the paths to test empty path behavior
      element.currentPath = '';
      element.currentFullPath = '';

      // Listen for directory-selected event
      let eventFired = false;
      element.addEventListener('directory-selected', () => {
        eventFired = true;
      });

      // Call handleSelect directly
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();

      // Wait a bit to ensure no event is fired
      await waitForAsync(50);

      expect(eventFired).toBe(false);
    });

    it('should not dispatch event when not in select mode', async () => {
      // Setup component in browse mode
      element.mode = 'browse';
      element.visible = true;
      element.currentPath = '/some/path';
      element.currentFullPath = '/Users/test/some/path';
      await element.updateComplete;

      // Listen for directory-selected event
      let eventFired = false;
      element.addEventListener('directory-selected', () => {
        eventFired = true;
      });

      // Call handleSelect directly
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();

      await waitForAsync(50);

      expect(eventFired).toBe(false);
    });
  });

  describe('integration with directory navigation', () => {
    it('should correctly pass absolute path when selecting after navigation', async () => {
      element.mode = 'select';

      // Mock initial load response when component becomes visible
      // File browser uses /api/fs/browse when not in noAuthMode
      fetchMock.mockResponse(
        `/api/fs/browse?path=${encodeURIComponent('/home/user')}&showHidden=false&gitFilter=all`,
        {
          path: '/home/user',
          fullPath: '/home/user',
          gitStatus: null,
          files: [
            {
              name: 'Desktop',
              path: 'Desktop',
              type: 'directory',
              size: 0,
              modified: '2025-01-15T10:00:00Z',
            },
          ],
        }
      );

      element.visible = true;
      await element.updateComplete;
      await waitForAsync();

      // Mock response for navigating to Desktop with relative paths
      // File browser uses /api/fs/browse when not in noAuthMode
      fetchMock.mockResponse(
        `/api/fs/browse?path=${encodeURIComponent('Desktop')}&showHidden=false&gitFilter=all`,
        {
          path: '..',
          fullPath: '/Users/steipete/Desktop',
          gitStatus: null,
          files: [
            {
              name: '..',
              path: '../..',
              type: 'directory',
              size: 0,
              modified: '2025-01-15T10:00:00Z',
            },
          ],
        }
      );

      // Simulate navigation to Desktop
      await element.loadDirectory('Desktop');
      await waitForAsync();

      // After loading, currentPath will be set to fullPath (due to line 179 in file-browser.ts)
      // and currentFullPath will also be set to fullPath
      expect(element.currentPath).toBe('/Users/steipete/Desktop');
      expect(element.currentFullPath).toBe('/Users/steipete/Desktop');

      // Listen for directory-selected event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('directory-selected', resolve as EventListener, { once: true });
      });

      // Select this directory
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();
      const event = await eventPromise;

      // Should get absolute path
      expect(event.detail).toBe('/Users/steipete/Desktop');
    });

    it('should handle multiple parent directory navigations correctly', async () => {
      element.mode = 'select';

      // Start at a deep directory
      element.currentPath = '.';
      element.currentFullPath = '/Users/steipete/Projects/vibetunnel/web';
      element.visible = true;
      await element.updateComplete;

      // Simulate state after navigating up multiple levels
      element.currentPath = '../../..';
      element.currentFullPath = '/Users/steipete';

      // Listen for event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('directory-selected', resolve as EventListener, { once: true });
      });

      // Select directory
      // biome-ignore lint/suspicious/noExplicitAny: Need to access private method for testing
      (element as any).handleSelect();
      const event = await eventPromise;

      // Should return absolute path, not relative
      expect(event.detail).toBe('/Users/steipete');
      expect(event.detail).not.toContain('..');
    });
  });
});

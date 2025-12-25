// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupFetchMock } from '@/test/utils/component-helpers';
import { createMockSession } from '@/test/utils/lit-test-utils';
import { resetFactoryCounters } from '@/test/utils/test-factories';
import type { AuthClient } from '../services/auth-client';

// Mock AuthClient
vi.mock('../services/auth-client');

// Mock copyToClipboard and formatPathForDisplay
vi.mock('../utils/path-utils', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
  formatPathForDisplay: vi.fn((path) => path), // Just return the path as-is for tests
}));

// Import component type
import type { SessionCard } from './session-card';

describe('SessionCard', () => {
  let element: SessionCard;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let mockAuthClient: AuthClient;

  beforeAll(async () => {
    // Import components to register custom elements
    await import('./session-card');
    await import('./vibe-terminal-buffer');
    await import('./copy-icon');
    await import('./clickable-path');
    await import('./inline-edit');
  });

  beforeEach(async () => {
    // Reset factory counters for test isolation
    resetFactoryCounters();

    // Setup fetch mock
    fetchMock = setupFetchMock();

    // Create mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create default session
    const mockSession = createMockSession();

    // Create component
    element = await fixture<SessionCard>(html`
      <session-card .session=${mockSession} .authClient=${mockAuthClient}></session-card>
    `);

    await element.updateComplete;
  });

  afterEach(() => {
    element?.remove();
    fetchMock.clear();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create component with default state', () => {
      expect(element).toBeDefined();
      expect(element.killing).toBe(false);
    });

    it('should render session details', async () => {
      // Wait for inline-edit to render
      await element.updateComplete;

      const inlineEdit = element.querySelector('inline-edit') as HTMLElement & { value: string };
      expect(inlineEdit).toBeTruthy();

      // Check that inline-edit has the correct value
      const sessionText = inlineEdit?.value;
      expect(sessionText).toBeTruthy();
      expect(sessionText).toContain('Test Session');

      // Should have status indicator
      const statusText = element.textContent;
      expect(statusText).toContain('running');
    });

    it('should render terminal buffer', () => {
      const terminalBuffer = element.querySelector('vibe-terminal-buffer') as HTMLElement & {
        sessionId: string;
      };
      expect(terminalBuffer).toBeTruthy();
      // Component uses property binding, not attribute
      expect(terminalBuffer?.sessionId).toBe(element.session.id);
    });
  });

  describe('session display', () => {
    it('should display session name or command', async () => {
      // Test with name
      element.session = createMockSession({ name: 'Test Session' });
      await element.updateComplete;

      let inlineEdit = element.querySelector('inline-edit') as HTMLElement & { value: string };
      expect(inlineEdit).toBeTruthy();
      expect(inlineEdit.value).toContain('Test Session');

      // Test without name (falls back to command)
      const sessionWithoutName = createMockSession({ command: ['npm', 'run', 'dev'] });
      sessionWithoutName.name = ''; // Explicitly set to empty string
      element.session = sessionWithoutName;
      await element.updateComplete;

      inlineEdit = element.querySelector('inline-edit') as HTMLElement & { value: string };
      expect(inlineEdit).toBeTruthy();
      expect(inlineEdit.value).toBe('npm run dev');
    });

    it('should show running status with success color', async () => {
      element.session = createMockSession({ status: 'running' });
      await element.updateComplete;

      const statusElement = element.querySelector('.text-status-success');
      expect(statusElement).toBeTruthy();
      expect(statusElement?.textContent).toContain('running');
    });

    it('should show exited status with warning color', async () => {
      element.session = createMockSession({ status: 'exited' });
      await element.updateComplete;

      // The status text is in a span with status color class
      const statusSpan = element.querySelector('.text-status-warning');
      expect(statusSpan).toBeTruthy();

      // Check the whole card contains 'exited'
      expect(element.textContent).toContain('exited');
    });

    it('should show waiting status when inactive', async () => {
      element.session = createMockSession({ active: false });
      await element.updateComplete;

      const statusText = element.textContent;
      expect(statusText).toContain('waiting');
    });

    it('should display Git branch when available', async () => {
      const mockBranch = 'feature/awesome-feature';
      element.session = createMockSession({ gitBranch: mockBranch });
      await element.updateComplete;

      const gitBranchElement = element.querySelector('.bg-surface-2');
      expect(gitBranchElement).toBeTruthy();
      expect(gitBranchElement?.textContent).toBe(mockBranch);
    });

    it('should display Git ahead/behind counts', async () => {
      element.session = createMockSession({
        gitBranch: 'main',
        gitAheadCount: 3,
        gitBehindCount: 2,
      });
      await element.updateComplete;

      // Find the Git status section specifically
      const gitStatusElements = element.querySelectorAll(
        '.flex.items-center.gap-1.text-\\[10px\\]'
      );
      const gitStatusElement = Array.from(gitStatusElements).find((el) =>
        el.querySelector('.bg-surface-2')
      );

      expect(gitStatusElement).toBeTruthy();

      // Find ahead count within the Git status section
      const aheadElement = gitStatusElement?.querySelector('.text-status-success');
      expect(aheadElement).toBeTruthy();
      expect(aheadElement?.textContent).toContain('3');

      // Find behind count within the Git status section
      const behindElement = gitStatusElement?.querySelector('.text-status-warning');
      expect(behindElement).toBeTruthy();
      expect(behindElement?.textContent).toContain('2');
    });

    it('should display Git changes indicator', async () => {
      element.session = createMockSession({
        gitBranch: 'main',
        gitHasChanges: true,
      });
      await element.updateComplete;

      const changesElement = element.querySelector('.text-yellow-500');
      expect(changesElement).toBeTruthy();
      expect(changesElement?.textContent).toContain('●');
    });

    it('should display Git worktree indicator', async () => {
      element.session = createMockSession({
        gitBranch: 'worktree-branch',
        gitIsWorktree: true,
      });
      await element.updateComplete;

      const worktreeElement = element.querySelector('.text-purple-400');
      expect(worktreeElement).toBeTruthy();
      expect(worktreeElement?.getAttribute('title')).toBe('Git worktree');
    });

    it('should not display Git status when no branch is set', async () => {
      element.session = createMockSession({ gitBranch: undefined });
      await element.updateComplete;

      const gitBranchElement = element.querySelector('.bg-surface-2');
      expect(gitBranchElement).toBeFalsy();
    });

    it('should display working directory', () => {
      const workingDir = element.querySelector('clickable-path') as HTMLElement & { path: string };
      expect(workingDir).toBeTruthy();
      // Component uses property binding, not attribute
      expect(workingDir?.path).toBe(element.session.workingDir);
    });
  });

  describe('click handling', () => {
    it('should emit session-select event when card is clicked', async () => {
      const selectHandler = vi.fn();
      element.addEventListener('session-select', selectHandler);

      const card = element.querySelector('.card');
      if (card) {
        (card as HTMLElement).click();

        expect(selectHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: element.session,
          })
        );
      }
    });

    it('should copy PID when PID is clicked', async () => {
      const { copyToClipboard } = await import('../utils/path-utils');
      const mockPid = 12345;
      element.session = createMockSession({ pid: mockPid });
      await element.updateComplete;

      const pidElement = element.querySelector('#session-pid-copy');
      if (pidElement) {
        (pidElement as HTMLElement).click();

        expect(copyToClipboard).toHaveBeenCalledWith(mockPid.toString());
      }
    });

    it('should prevent event bubbling on kill button click', async () => {
      const selectHandler = vi.fn();
      element.addEventListener('session-select', selectHandler);

      const killButton = element.querySelector('#session-kill-button');
      if (killButton) {
        (killButton as HTMLElement).click();

        // Should not trigger session select
        expect(selectHandler).not.toHaveBeenCalled();
      }
    });
  });

  describe('kill functionality', () => {
    it('should show kill button for running sessions', async () => {
      element.session = createMockSession({ status: 'running' });
      await element.updateComplete;

      const killButton = element.querySelector('#session-kill-button');
      expect(killButton).toBeTruthy();
    });

    it('should show cleanup button for exited sessions', async () => {
      element.session = createMockSession({ status: 'exited' });
      await element.updateComplete;

      const cleanupButton = element.querySelector('#session-kill-button');
      expect(cleanupButton).toBeTruthy();
    });

    it('should not show kill button for other statuses', async () => {
      element.session = createMockSession({ status: 'unknown' as 'running' | 'exited' });
      await element.updateComplete;

      const killButton = element.querySelector('#session-kill-button');
      expect(killButton).toBeFalsy();
    });

    it('should handle successful kill', async () => {
      fetchMock.mockResponse(`/api/sessions/${element.session.id}`, { success: true });

      const killedHandler = vi.fn();
      element.addEventListener('session-killed', killedHandler);

      await element.kill();

      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();
      expect(killedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            sessionId: element.session.id,
            session: element.session,
          },
        })
      );
    });

    it('should handle kill error', async () => {
      fetchMock.mockResponse(
        `/api/sessions/${element.session.id}`,
        { error: 'Permission denied' },
        { status: 403 }
      );

      const errorHandler = vi.fn();
      element.addEventListener('session-kill-error', errorHandler);

      await element.kill();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            sessionId: element.session.id,
            error: expect.stringContaining('Failed to terminate session'),
          },
        })
      );
    });

    it('should show killing animation', async () => {
      // Mock a slow response
      fetchMock.mockResponse(
        `/api/sessions/${element.session.id}`,
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );

      const killPromise = element.kill();

      // Should be in killing state
      expect(element.killing).toBe(true);

      // Should show killing UI
      await element.updateComplete;
      const killingText = element.querySelector('.text-status-error .text-sm');
      expect(killingText?.textContent).toContain('Killing session...');

      await killPromise;

      // Should no longer be killing
      expect(element.killing).toBe(false);
    });

    it('should prevent multiple simultaneous kills', async () => {
      fetchMock.mockResponse(`/api/sessions/${element.session.id}`, { success: true });

      // Start first kill
      const firstKill = element.kill();

      // Try second kill immediately
      const secondKill = element.kill();

      // Second kill should return false immediately
      expect(await secondKill).toBe(false);

      // First kill should succeed
      expect(await firstKill).toBe(true);
    });

    it('should handle cleanup for exited sessions', async () => {
      element.session = createMockSession({ status: 'exited' });
      await element.updateComplete;

      fetchMock.mockResponse(`/api/sessions/${element.session.id}`, { success: true });

      const killedHandler = vi.fn();
      element.addEventListener('session-killed', killedHandler);

      await element.kill();

      // Should use DELETE endpoint for exited sessions
      const calls = fetchMock.getCalls();
      const deleteCall = calls.find((call) =>
        call[0].includes(`/api/sessions/${element.session.id}`)
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]?.method).toBe('DELETE');
      expect(killedHandler).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('should apply opacity when killing', async () => {
      element.killing = true;
      await element.updateComplete;

      const card = element.querySelector('.card');
      expect(card?.classList.contains('opacity-60')).toBe(true);
    });

    it('should apply exited styling for exited sessions', async () => {
      element.session = createMockSession({ status: 'exited' });
      await element.updateComplete;

      const preview = element.querySelector('.session-preview');
      expect(preview?.classList.contains('session-exited')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clean up intervals on disconnect', () => {
      // Set up some intervals
      element.killing = true;

      // Disconnect
      element.disconnectedCallback();

      // Intervals should be cleared (no way to directly test, but should not throw)
      expect(() => element.disconnectedCallback()).not.toThrow();
    });
  });
});

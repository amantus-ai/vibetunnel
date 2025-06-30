import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import '../../../client/components/session-list.js';
import type { SessionList } from '../../../client/components/session-list.js';
import type { Session } from '../../../shared/types.js';

// Mock auth client
const mockAuthClient = {
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
};

describe('SessionList', () => {
  let element: SessionList;

  beforeEach(async () => {
    element = await fixture<SessionList>(html`
      <session-list .authClient=${mockAuthClient}></session-list>
    `);
  });

  describe('Activity display', () => {
    it('should show activity inline with path', async () => {
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'claude (~)',
          command: ['claude'],
          workingDir: '/Users/test/projects',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: '; Thinking& (5s · ‘ 1.2k tokens)',
            },
          },
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      const activityElement = element.querySelector('.text-status-warning');
      expect(activityElement?.textContent?.trim()).toBe('; Thinking& (5s · ‘ 1.2k tokens)');

      // Should show path after activity with separator
      const pathContainer = element.querySelector('.text-xs.text-dark-text-muted.truncate.flex');
      expect(pathContainer?.textContent).toContain('·');
      expect(pathContainer?.textContent).toContain('~/projects');
    });

    it('should show full path when no activity', async () => {
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'vim file.txt',
          command: ['vim', 'file.txt'],
          workingDir: '/Users/test/very/long/path/to/project',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      const pathElement = element.querySelector('.text-xs.text-dark-text-muted.truncate.flex');
      expect(pathElement?.textContent?.trim()).toBe('~/very/long/path/to/project');
      
      // No activity indicator should be present
      const activityElement = element.querySelector('.text-status-warning');
      expect(activityElement).toBeNull();
    });

    it('should not cause layout jumps when activity appears/disappears', async () => {
      const sessionWithoutActivity: Session = {
        id: 'test-1',
        name: 'claude',
        command: ['claude'],
        workingDir: '/Users/test/project',
        status: 'running',
        startedAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      element.sessions = [sessionWithoutActivity];
      element.compactMode = true;
      await element.updateComplete;

      // Measure height without activity
      const container = element.querySelector('.flex.items-center.gap-2.p-3');
      const heightWithoutActivity = container?.getBoundingClientRect().height || 0;

      // Add activity
      const sessionWithActivity: Session = {
        ...sessionWithoutActivity,
        activityStatus: {
          isActive: true,
          specificStatus: {
            app: 'claude',
            status: '; Thinking& (10s)',
          },
        },
      };

      element.sessions = [sessionWithActivity];
      await element.updateComplete;

      // Measure height with activity
      const heightWithActivity = container?.getBoundingClientRect().height || 0;

      // Heights should be the same (no jump)
      expect(heightWithActivity).toBe(heightWithoutActivity);
    });

    it('should show correct activity indicator colors', async () => {
      const sessions: Session[] = [
        // Claude active (pulsing green)
        {
          id: 'claude-active',
          name: 'claude',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: '; Thinking&',
            },
          },
        },
        // Generic active (solid green)
        {
          id: 'generic-active',
          name: 'npm run dev',
          command: ['npm', 'run', 'dev'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
          },
        },
        // Idle (green outline)
        {
          id: 'idle',
          name: 'vim',
          command: ['vim'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: false,
          },
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      const indicators = element.querySelectorAll('.w-2.h-2.rounded-full');
      
      // Claude active - should have pulsing animation
      expect(indicators[0]?.classList.contains('bg-accent-green')).toBe(true);
      expect(indicators[0]?.classList.contains('animate-pulse')).toBe(true);

      // Generic active - solid green, no animation
      expect(indicators[1]?.classList.contains('bg-status-success')).toBe(true);
      expect(indicators[1]?.classList.contains('animate-pulse')).toBe(false);

      // Idle - green with outline
      expect(indicators[2]?.classList.contains('bg-status-success')).toBe(true);
      expect(indicators[2]?.classList.contains('ring-1')).toBe(true);
      expect(indicators[2]?.classList.contains('ring-status-success')).toBe(true);
    });

    it('should handle very long activity status gracefully', async () => {
      const longStatus = '; ' + 'A'.repeat(100) + '& (999s)';
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'claude',
          command: ['claude'],
          workingDir: '/Users/test/project',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: longStatus,
            },
          },
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      const activityElement = element.querySelector('.text-status-warning');
      expect(activityElement?.classList.contains('flex-shrink-0')).toBe(true);
      
      // Path should still be visible but truncated
      const pathElement = element.querySelector('.truncate:last-child');
      expect(pathElement?.textContent).toContain('~/project');
    });

    it('should show correct tooltip on activity indicator', async () => {
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'claude',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: '; Thinking&',
            },
          },
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      const indicator = element.querySelector('.w-2.h-2.rounded-full');
      expect(indicator?.getAttribute('title')).toBe('Active: claude');
    });
  });

  describe('Session rendering in compact mode', () => {
    it('should render session with activity status', async () => {
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'Test Session',
          command: ['node', 'server.js'],
          workingDir: '/home/user/project',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          activityStatus: {
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: '+ Searching& (2s)',
            },
          },
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      // Check that session is rendered
      const sessionElement = element.querySelector('.flex.items-center.gap-2.p-3');
      expect(sessionElement).toBeTruthy();

      // Check command display
      const commandElement = element.querySelector('.text-sm.font-mono.text-accent-green');
      expect(commandElement?.textContent?.trim()).toBe('node server.js');

      // Check activity status is displayed
      const statusElement = element.querySelector('.text-status-warning');
      expect(statusElement?.textContent?.trim()).toBe('+ Searching& (2s)');
    });

    it('should handle sessions without activity status', async () => {
      const sessions: Session[] = [
        {
          id: 'test-1',
          name: 'Test Session',
          command: ['vim'],
          workingDir: '/home/user/project',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
      ];

      element.sessions = sessions;
      element.compactMode = true;
      await element.updateComplete;

      // Should still render session
      const sessionElement = element.querySelector('.flex.items-center.gap-2.p-3');
      expect(sessionElement).toBeTruthy();

      // Should not have activity status
      const statusElement = element.querySelector('.text-status-warning');
      expect(statusElement).toBeNull();
    });
  });
});
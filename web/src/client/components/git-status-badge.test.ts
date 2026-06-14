// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '@/shared/types';
import { createMockSession } from '@/test/utils/lit-test-utils';
import type { GitStatusBadge } from './git-status-badge';

describe('GitStatusBadge', () => {
  beforeAll(async () => {
    await import('./git-status-badge');
  });

  it('renders branch info with truncation and title', async () => {
    const session = {
      ...createMockSession(),
      gitRepoPath: '/tmp/repo',
      gitBranch: 'feature/super-long-branch-name',
    } as Session;

    const element = await fixture<GitStatusBadge>(html`
      <git-status-badge .session=${session}></git-status-badge>
    `);

    await element.updateComplete;

    const branchSpan = element.querySelector('span.text-muted-foreground');
    expect(branchSpan).toBeTruthy();
    expect(branchSpan?.classList.contains('truncate')).toBe(true);
    expect(branchSpan?.classList.contains('min-w-0')).toBe(true);
    expect(branchSpan?.getAttribute('title')).toBe('feature/super-long-branch-name');
  });

  it('renders line insertion and deletion counts', async () => {
    const session = {
      ...createMockSession(),
      gitRepoPath: '/tmp/repo',
      gitBranch: 'main',
      gitInsertionCount: 12,
      gitDeletionCount: 3,
    } as Session;

    const element = await fixture<GitStatusBadge>(html`
      <git-status-badge .session=${session}></git-status-badge>
    `);

    await element.updateComplete;

    expect(element.textContent).toContain('+12');
    expect(element.textContent).toContain('-3');
    expect(element.querySelector('[title="Line insertions"]')).toBeTruthy();
    expect(element.querySelector('[title="Line deletions"]')).toBeTruthy();
  });
});

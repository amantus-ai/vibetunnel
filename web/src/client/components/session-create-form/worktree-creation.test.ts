// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitService } from '../../services/git-service.js';
import './git-branch-selector.js';
import type { GitBranchSelector } from './git-branch-selector.js';

describe('Worktree Creation UI', () => {
  let element: GitBranchSelector;
  let _mockGitService: GitService;

  beforeEach(async () => {
    // Create mock git service
    _mockGitService = {
      checkGitRepo: vi.fn(),
      listWorktrees: vi.fn(),
      createWorktree: vi.fn(),
      deleteWorktree: vi.fn(),
      switchBranch: vi.fn(),
      setFollowMode: vi.fn(),
    } as unknown as GitService;

    // Create element
    element = document.createElement('git-branch-selector') as GitBranchSelector;
    element.gitRepoInfo = {
      isGitRepo: true,
      repoPath: '/test/repo',
      currentBranch: 'main',
      hasChanges: false,
      isWorktree: false,
    };
    element.availableBranches = ['main', 'develop', 'feature/existing'];
    element.currentBranch = 'main';
    element.selectedBaseBranch = 'main';

    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    vi.clearAllMocks();
  });

  describe('Branch Name Validation', () => {
    it('should validate branch names correctly', () => {
      // @ts-expect-error - accessing private method for testing
      const validate = (name: string) => element.validateBranchName(name);

      // Valid names
      expect(validate('feature/new-feature')).toBeNull();
      expect(validate('bugfix/123')).toBeNull();
      expect(validate('release-1.0')).toBeNull();

      // Invalid names
      expect(validate('-invalid')).toContain('cannot start or end with a hyphen');
      expect(validate('invalid-')).toContain('cannot start or end with a hyphen');
      expect(validate('feature..branch')).toContain('invalid characters');
      expect(validate('feature~branch')).toContain('invalid characters');
      expect(validate('feature^branch')).toContain('invalid characters');
      expect(validate('feature:branch')).toContain('invalid characters');
      expect(validate('branch.lock')).toContain('cannot end with .lock');
      expect(validate('feature//branch')).toContain('consecutive slashes');
      expect(validate('HEAD')).toContain('reserved Git name');
      expect(validate('FETCH_HEAD')).toContain('reserved Git name');

      // Existing branch
      expect(validate('feature/existing')).toContain('already exists');
    });
  });

  describe.skip('Worktree Creation Flow - UI redesigned', () => {
    it('should show create worktree button when not in worktree', async () => {
      const createButton = element.shadowRoot?.querySelector('button[title="Create new worktree"]');
      expect(createButton).toBeTruthy();
    });

    it('should show worktree creation form when button clicked', async () => {
      const createButton = element.shadowRoot?.querySelector(
        'button[title="Create new worktree"]'
      ) as HTMLButtonElement;
      createButton.click();
      await element.updateComplete;

      // @ts-expect-error - accessing private property
      expect(element.showCreateWorktree).toBe(true);

      // Check form elements
      const input = element.shadowRoot?.querySelector('input[placeholder="New branch name"]');
      expect(input).toBeTruthy();

      const createBtn = element.shadowRoot?.querySelector('button:has-text("Create")');
      expect(createBtn).toBeTruthy();

      const cancelBtn = element.shadowRoot?.querySelector('button:has-text("Cancel")');
      expect(cancelBtn).toBeTruthy();
    });

    it('should dispatch create-worktree event with valid branch name', async () => {
      // Show creation form
      // @ts-expect-error - accessing private property
      element.showCreateWorktree = true;
      await element.updateComplete;

      // Set branch name
      const input = element.shadowRoot?.querySelector(
        'input[placeholder="New branch name"]'
      ) as HTMLInputElement;
      input.value = 'feature/new-branch';
      input.dispatchEvent(new Event('input'));
      await element.updateComplete;

      // Listen for event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('create-worktree', resolve as EventListener, { once: true });
      });

      // Click create
      const createBtn = Array.from(element.shadowRoot?.querySelectorAll('button') || []).find(
        (btn) => btn.textContent?.includes('Create')
      ) as HTMLButtonElement;
      createBtn.click();

      // Verify event
      const event = await eventPromise;
      expect(event.detail).toEqual({
        branchName: 'feature/new-branch',
        baseBranch: 'main',
      });

      // @ts-expect-error - accessing private property
      expect(element.isCreatingWorktree).toBe(true);
    });

    it('should show error for invalid branch name', async () => {
      // Show creation form
      // @ts-expect-error - accessing private property
      element.showCreateWorktree = true;
      await element.updateComplete;

      // Set invalid branch name
      const input = element.shadowRoot?.querySelector(
        'input[placeholder="New branch name"]'
      ) as HTMLInputElement;
      input.value = '-invalid-name';
      input.dispatchEvent(new Event('input'));
      await element.updateComplete;

      // Listen for error event
      const errorPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('error', resolve as EventListener, { once: true });
      });

      // Click create
      const createBtn = Array.from(element.shadowRoot?.querySelectorAll('button') || []).find(
        (btn) => btn.textContent?.includes('Create')
      ) as HTMLButtonElement;
      createBtn.click();

      // Verify error event
      const event = await errorPromise;
      expect(event.detail).toContain('cannot start or end with a hyphen');

      // Should not set isCreatingWorktree for validation errors
      // @ts-expect-error - accessing private property
      expect(element.isCreatingWorktree).toBe(false);
    });

    it('should disable create button when branch name is empty', async () => {
      // Show creation form
      // @ts-expect-error - accessing private property
      element.showCreateWorktree = true;
      await element.updateComplete;

      const createBtn = Array.from(element.shadowRoot?.querySelectorAll('button') || []).find(
        (btn) => btn.textContent?.includes('Create')
      ) as HTMLButtonElement;

      expect(createBtn.disabled).toBe(true);

      // Type something
      const input = element.shadowRoot?.querySelector(
        'input[placeholder="New branch name"]'
      ) as HTMLInputElement;
      input.value = 'feature/test';
      input.dispatchEvent(new Event('input'));
      await element.updateComplete;

      expect(createBtn.disabled).toBe(false);
    });

    it('should clear form when cancel is clicked', async () => {
      // Show creation form and add text
      // @ts-expect-error - accessing private property
      element.showCreateWorktree = true;
      // @ts-expect-error - accessing private property
      element.newBranchName = 'test-branch';
      await element.updateComplete;

      // Click cancel
      const cancelBtn = element.shadowRoot?.querySelector(
        'button:has-text("Cancel")'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await element.updateComplete;

      // @ts-expect-error - accessing private property
      expect(element.showCreateWorktree).toBe(false);
      // @ts-expect-error - accessing private property
      expect(element.newBranchName).toBe('');
    });

    it('should handle escape key to cancel', async () => {
      // Show creation form
      // @ts-expect-error - accessing private property
      element.showCreateWorktree = true;
      await element.updateComplete;

      // Press escape on input
      const input = element.shadowRoot?.querySelector(
        'input[placeholder="New branch name"]'
      ) as HTMLInputElement;
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      input.dispatchEvent(escapeEvent);
      await element.updateComplete;

      // @ts-expect-error - accessing private property
      expect(element.showCreateWorktree).toBe(false);
    });
  });

  describe.skip('Loading States - UI redesigned', () => {
    it('should show loading state during creation', async () => {
      // @ts-expect-error - accessing private property
      element.isCreatingWorktree = true;
      await element.updateComplete;

      // Check that inputs are disabled
      const allInputs = element.shadowRoot?.querySelectorAll('input, button, select');
      allInputs?.forEach((input) => {
        if (input.hasAttribute('disabled') !== undefined) {
          expect(input.hasAttribute('disabled')).toBe(true);
        }
      });

      // Check loading text
      const createBtn = Array.from(element.shadowRoot?.querySelectorAll('button') || []).find(
        (btn) => btn.textContent?.includes('Creating...')
      );
      expect(createBtn).toBeTruthy();
    });
  });
});

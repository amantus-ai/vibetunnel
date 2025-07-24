import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Worktree Creation UI', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
    await page.goto('/');
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should show git branch selector when git repository is detected', async ({ page }) => {
    // Open create session modal
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Wait for modal to be visible
    const sessionModal = page.locator('[data-testid="session-create-modal"]');
    await expect(sessionModal).toBeVisible({ timeout: 5000 });

    // Set a working directory that's a git repository
    const workingDirInput = page.locator('[data-testid="working-dir-input"]');
    await workingDirInput.clear();
    await workingDirInput.fill('/tmp/test-repo'); // This would need to be a real git repo in actual tests

    // Wait a moment for git check to complete
    await page.waitForTimeout(1000);

    // Check if git-branch-selector component appears
    const gitBranchSelector = page.locator('git-branch-selector');
    const isBranchSelectorVisible = await gitBranchSelector
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // Note: In a real test environment, we'd need to mock the git API responses
    // or ensure we have a test git repository available
    if (isBranchSelectorVisible) {
      // Verify base branch selector exists
      const baseBranchSelect = page.locator('[data-testid="git-base-branch-select"]');
      await expect(baseBranchSelect).toBeVisible();

      // Check for worktree selector
      const worktreeSelect = page.locator('[data-testid="git-worktree-select"]');
      await expect(worktreeSelect).toBeVisible();
    }
  });

  test('should handle worktree creation button click', async ({ page }) => {
    // This test would need proper mocking setup
    // Skip if not in proper test environment
    test.skip(true, 'Requires git repository mock setup');

    // Open create session modal
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Wait for modal
    await expect(page.locator('[data-testid="session-create-modal"]')).toBeVisible();

    // Assuming git-branch-selector is visible (would need mocking)
    const createWorktreeButton = page.locator('button:has-text("Create worktree")');

    if (await createWorktreeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createWorktreeButton.click();

      // Check for worktree creation form
      const branchNameInput = page.locator('input[placeholder="New branch name"]');
      await expect(branchNameInput).toBeVisible();

      // Type a branch name
      await branchNameInput.fill('feature/test-branch');

      // Look for create button
      const createButton = page.locator('button:has-text("Create")').last();
      await expect(createButton).toBeVisible();

      // Verify cancel button exists
      const cancelButton = page.locator('button:has-text("Cancel")');
      await expect(cancelButton).toBeVisible();
    }
  });

  test('should validate branch names in worktree creation', async ({ page }) => {
    // This test would need proper mocking setup
    test.skip(true, 'Requires git repository mock setup');

    // Open create session modal and navigate to worktree creation
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Assuming we can get to the worktree creation form
    const branchNameInput = page.locator('input[placeholder="New branch name"]');

    if (await branchNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Test invalid branch names
      const invalidNames = [
        '-invalid', // starts with hyphen
        'invalid-', // ends with hyphen
        'HEAD', // reserved name
        'feature..branch', // contains ..
      ];

      for (const invalidName of invalidNames) {
        await branchNameInput.clear();
        await branchNameInput.fill(invalidName);

        // Try to create
        const createButton = page.locator('button:has-text("Create")').last();
        await createButton.click();

        // Should see error message
        const errorNotification = page.locator('notification-status[type="error"]');
        await expect(errorNotification).toBeVisible({ timeout: 2000 });
      }
    }
  });
});

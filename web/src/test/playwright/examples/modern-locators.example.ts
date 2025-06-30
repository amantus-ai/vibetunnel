import { expect, test } from '@playwright/test';

/**
 * Examples of modern Playwright locator patterns
 * These patterns are more resilient to UI changes
 */

test.describe('Modern Locator Patterns', () => {
  // ❌ OLD: CSS selectors that are brittle
  test.skip('old patterns to avoid', async ({ page }) => {
    // Avoid these patterns:
    await page.locator('.btn.btn-primary').click();
    await page.locator('#submit-button').click();
    await page.locator('div > form > button:nth-child(2)').click();
    await page.locator('[class*="session-card"]').click();
  });

  // ✅ NEW: User-facing locators that are resilient
  test('modern patterns to use', async ({ page }) => {
    // Prefer role-based locators
    await page.getByRole('button', { name: 'Create Session' }).click();
    await page.getByRole('link', { name: 'Documentation' }).click();
    await page.getByRole('heading', { name: 'Active Sessions' }).isVisible();
    
    // Use semantic HTML roles
    await page.getByRole('navigation').getByText('Settings').click();
    await page.getByRole('main').getByRole('article').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    
    // Text-based locators for user-visible content
    await page.getByText('Welcome to VibeTunnel').isVisible();
    await page.getByText(/session.*active/i).click(); // Regex for flexibility
    
    // Label-based locators for forms
    await page.getByLabel('Session Name').fill('my-session');
    await page.getByLabel('Command').fill('bash');
    
    // Placeholder text for inputs
    await page.getByPlaceholder('Enter session name').fill('test-session');
    
    // Test IDs for complex components (when necessary)
    await page.getByTestId('session-terminal').isVisible();
    await page.getByTestId('session-status').containsText('Running');
    
    // Alt text for images
    await page.getByAltText('Session preview').click();
    
    // Title attribute
    await page.getByTitle('Create New Session').click();
  });

  // ✅ Combining locators for precision
  test('advanced locator patterns', async ({ page }) => {
    // Chain locators for scoping
    const sessionCard = page.getByRole('article').filter({ hasText: 'my-session' });
    await sessionCard.getByRole('button', { name: 'Kill' }).click();
    
    // Use within() for scoping
    await page.getByRole('region', { name: 'Session List' }).within(async () => {
      await page.getByRole('button', { name: 'Create' }).click();
    });
    
    // Filter by multiple conditions
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Running' })
      .filter({ has: page.getByRole('button', { name: 'Kill' }) })
      .first()
      .click();
    
    // Nth item when needed (but prefer other methods)
    await page.getByRole('listitem').nth(2).click();
    
    // Parent/child navigation
    const row = page.getByRole('row').filter({ hasText: 'test-session' });
    await row.getByRole('cell').last().click();
  });

  // ✅ Waiting strategies with modern locators
  test('efficient waiting patterns', async ({ page }) => {
    // Wait for specific text
    await expect(page.getByText('Session created')).toBeVisible({ timeout: 5000 });
    
    // Wait for count
    await expect(page.getByRole('listitem')).toHaveCount(3);
    
    // Wait for element state
    await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
    await expect(page.getByRole('progressbar')).toBeHidden();
    
    // Wait for attribute
    await expect(page.getByTestId('session-status')).toHaveAttribute('data-status', 'running');
    
    // Wait for CSS class
    await expect(page.getByRole('article').first()).toHaveClass(/active/);
  });

  // ✅ Form interaction patterns
  test('form handling with modern locators', async ({ page }) => {
    // Complete form using labels
    await page.getByLabel('Username').fill('testuser');
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('checkbox', { name: 'Remember me' }).check();
    await page.getByRole('combobox', { name: 'Shell' }).selectOption('bash');
    await page.getByRole('button', { name: 'Submit' }).click();
    
    // Radio button selection
    await page.getByRole('radio', { name: 'Dark mode' }).check();
    
    // File upload
    await page.getByLabel('Upload file').setInputFiles('/path/to/file.txt');
  });

  // ✅ Assertions with modern locators
  test('assertion patterns', async ({ page }) => {
    // Text content assertions
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
    await expect(page.getByTestId('user-name')).toContainText('John');
    
    // Visibility assertions
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Count assertions
    await expect(page.getByRole('row')).toHaveCount(10);
    
    // Value assertions
    await expect(page.getByLabel('Email')).toHaveValue('test@example.com');
    
    // Focus assertions
    await expect(page.getByLabel('Search')).toBeFocused();
  });
});
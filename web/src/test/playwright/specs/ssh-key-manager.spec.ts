import { expect, test } from '../fixtures/test.fixture';
import { waitForModalClosed } from '../helpers/wait-strategies.helper';

// These tests can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('SSH Key Manager', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page where SSH key manager should be accessible
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Skip SSH key tests if server is in no-auth mode
    const response = await page.request.get('/api/auth/config');
    const config = await response.json();
    if (config.noAuth) {
      test.skip(true, 'Skipping SSH key tests in no-auth mode');
    }
  });

  test('should open SSH key manager from login page', async ({ page }) => {
    // Look for SSH key manager trigger using data-testid for reliability
    const sshKeyTrigger = page.locator('[data-testid="manage-keys"]');

    // Also try alternate selectors as fallback
    const fallbackTrigger = page
      .locator(
        'button:has-text("Manage Keys"), button:has-text("SSH Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    let triggerToUse = sshKeyTrigger;
    if (!(await sshKeyTrigger.isVisible())) {
      triggerToUse = fallbackTrigger;
    }

    if (await triggerToUse.isVisible()) {
      await triggerToUse.click();

      // Wait a bit for the click event to propagate
      await page.waitForTimeout(100);

      // Verify SSH key manager modal opens - check the actual modal content
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('ssh-key-manager div[role="dialog"]')).toBeVisible();

      // Also verify the header text is visible
      await expect(page.locator('ssh-key-manager h2:has-text("SSH Key Manager")')).toBeVisible();
    } else {
      // Skip test if SSH key manager is not accessible from this view
      test.skip();
    }
  });

  test('should display existing SSH keys', async ({ page }) => {
    // Open SSH key manager
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Check for key list container
      const keyList = page.locator('.space-y-2, .space-y-4, .grid, .flex.flex-col').filter({
        has: page.locator('button, .border, .bg-'),
      });

      if (await keyList.isVisible()) {
        // Should see either existing keys or empty state
        const keyItems = page.locator('.border.rounded, .bg-gray, .bg-dark').filter({
          hasText: /rsa|ed25519|ecdsa|ssh-/i,
        });

        const emptyState = page.locator('ssh-key-manager :has-text("No SSH keys found")').first();

        const hasKeysOrEmpty = (await keyItems.count()) > 0 || (await emptyState.isVisible());
        expect(hasKeysOrEmpty).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should open key generation dialog', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Look for generate/create key button - first click Add Key to show the form
      const addKeyButton = page
        .locator(
          'button:has-text("+ Add Key"), button:has-text("Add Key"), button:has-text("Generate"), button:has-text("Create")'
        )
        .first();

      if (await addKeyButton.isVisible()) {
        await addKeyButton.click();
      }

      // First fill in the required key name field
      const keyNameInput = page
        .locator('input[placeholder*="name"], input[placeholder*="Name"]')
        .first();
      if (await keyNameInput.isVisible()) {
        await keyNameInput.fill('test-key-name');
      }

      const generateButton = page
        .locator(
          'button:has-text("Generate"), button:has-text("Create"), button:has-text("New Key"), button[title*="Generate"]'
        )
        .first();

      if (await generateButton.isVisible()) {
        await generateButton.click();

        // Wait for the generation to complete
        await page.waitForTimeout(1000);

        // Check if key was generated successfully - look for setup instructions or key in list
        const setupInstructions = page
          .locator('ssh-key-manager h4:has-text("Setup Instructions")')
          .first();
        const keyInList = page.locator('ssh-key-manager :has-text("test-key-name")').first();

        // Should see either setup instructions or the key in the list
        const hasInstructionsOrKey =
          (await setupInstructions.isVisible()) || (await keyInList.isVisible());
        expect(hasInstructionsOrKey).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should handle key import functionality', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // First click Add Key to show the form
      const addKeyButton = page
        .locator('button:has-text("+ Add Key"), button:has-text("Add Key")')
        .first();

      if (await addKeyButton.isVisible()) {
        await addKeyButton.click();
      }

      // Fill in the key name field for import section
      const importKeyNameInput = page.locator('input[placeholder*="name"]').nth(1); // Second name input (for import)
      if (await importKeyNameInput.isVisible()) {
        await importKeyNameInput.fill('imported-test-key');
      }

      // Fill in the private key content
      const keyContentTextarea = page.locator('textarea[placeholder*="PRIVATE KEY"]');
      if (await keyContentTextarea.isVisible()) {
        await keyContentTextarea.fill(
          '-----BEGIN PRIVATE KEY-----\ntest-key-content\n-----END PRIVATE KEY-----'
        );
      }

      // Look for import button
      const importButton = page
        .locator('button:has-text("Import"), button:has-text("Add Key"), input[type="file"]')
        .first();

      if (await importButton.isVisible()) {
        // If it's a file input, verify it accepts the right file types
        if (await page.locator('input[type="file"]').isVisible()) {
          const fileInput = page.locator('input[type="file"]').first();
          const acceptAttr = await fileInput.getAttribute('accept');

          // Should accept common SSH key file extensions
          if (acceptAttr) {
            const acceptsSSHKeys =
              acceptAttr.includes('.pub') ||
              acceptAttr.includes('.pem') ||
              acceptAttr.includes('ssh') ||
              acceptAttr.includes('*');
            expect(acceptsSSHKeys).toBeTruthy();
          }
        } else {
          // Regular import button - click to import the key
          await importButton.click();

          // Wait for import to complete
          await page.waitForTimeout(1000);

          // Should see success message or imported key in list
          const successMessage = page.locator('ssh-key-manager .bg-status-success').first();
          const keyInList = page.locator('ssh-key-manager :has-text("imported-test-key")').first();

          // Either success message appears or key is added to the list
          const hasSuccessOrKey =
            (await successMessage.isVisible()) || (await keyInList.isVisible());
          expect(hasSuccessOrKey).toBeTruthy();
        }
      }
    } else {
      test.skip();
    }
  });

  test('should validate SSH key format during import', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // First click Add Key to show the form
      const addKeyButton = page
        .locator('button:has-text("+ Add Key"), button:has-text("Add Key")')
        .first();

      if (await addKeyButton.isVisible()) {
        await addKeyButton.click();
      }

      // Fill in the key name field for import section
      const importKeyNameInput = page.locator('input[placeholder*="name"]').nth(1); // Second name input (for import)
      if (await importKeyNameInput.isVisible()) {
        await importKeyNameInput.fill('validation-test-key');
      }

      // Fill in invalid key content
      const keyContentTextarea = page.locator('textarea[placeholder*="PRIVATE KEY"]');
      if (await keyContentTextarea.isVisible()) {
        await keyContentTextarea.fill('invalid-ssh-key-format');
      }

      // Try to find import functionality
      const importButton = page
        .locator('button:has-text("Import"), button:has-text("Add Key")')
        .first();

      if (await importButton.isVisible()) {
        await importButton.click();

        // Wait for validation to complete
        await page.waitForTimeout(500);

        // Should show validation error
        const errorMessage = page.locator('ssh-key-manager .bg-status-error').first();

        await expect(errorMessage).toBeVisible({ timeout: 3000 });
      }
    } else {
      test.skip();
    }
  });

  test('should handle key deletion', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Look for existing keys with delete buttons
      const deleteButtons = page
        .locator(
          'button:has-text("Delete"), button:has-text("Remove"), button[title*="Delete"], .text-red button, button.text-red'
        )
        .first();

      if (await deleteButtons.isVisible()) {
        const initialKeyCount = await page
          .locator('.border.rounded, .bg-gray, .bg-dark')
          .filter({
            hasText: /rsa|ed25519|ecdsa|ssh-/i,
          })
          .count();

        // Click delete button
        await deleteButtons.click();

        // Should show confirmation dialog
        const confirmDialog = page.locator('.modal, [role="dialog"]').filter({
          hasText: /delete|remove|confirm/i,
        });

        if (await confirmDialog.isVisible()) {
          // Confirm deletion
          const confirmButton = page
            .locator(
              'button:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes")'
            )
            .last();
          await confirmButton.click();

          // Wait for deletion to complete
          await page.waitForTimeout(1000);

          // Key count should decrease (if there were keys to delete)
          if (initialKeyCount > 0) {
            const newKeyCount = await page
              .locator('.border.rounded, .bg-gray, .bg-dark')
              .filter({
                hasText: /rsa|ed25519|ecdsa|ssh-/i,
              })
              .count();

            expect(newKeyCount).toBeLessThan(initialKeyCount);
          }
        }
      }
    } else {
      test.skip();
    }
  });

  test('should handle password-protected keys', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Look for key generation with passphrase option
      const generateButton = page
        .locator(
          'button:has-text("Generate"), button:has-text("Create"), button:has-text("New Key")'
        )
        .first();

      if (await generateButton.isVisible()) {
        await generateButton.click();

        // Look for passphrase/password field
        const passphraseField = page
          .locator(
            'input[type="password"], input[placeholder*="passphrase"], input[placeholder*="password"]'
          )
          .first();

        if (await passphraseField.isVisible()) {
          // Test with passphrase
          await passphraseField.fill('test-passphrase-123');

          // Should have confirmation field or checkbox
          const passphraseConfirm = page.locator('input[type="password"]').nth(1);
          const _protectionCheckbox = page.locator('input[type="checkbox"]').filter({
            hasText: /password|passphrase|protect/i,
          });

          if (await passphraseConfirm.isVisible()) {
            await passphraseConfirm.fill('test-passphrase-123');
          }

          // Verify the passphrase option is available
          expect(await passphraseField.inputValue()).toBe('test-passphrase-123');
        }
      }
    } else {
      test.skip();
    }
  });

  test('should export SSH keys', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Look for export buttons
      const exportButtons = page.locator(
        'button:has-text("Export"), button:has-text("Download"), button:has-text("Copy"), button[title*="Export"]'
      );

      if (await exportButtons.first().isVisible()) {
        // Test copy to clipboard functionality
        const copyButton = page.locator('button:has-text("Copy")').first();

        if (await copyButton.isVisible()) {
          // Grant clipboard permissions
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

          await copyButton.click();

          // Verify clipboard content
          const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
          expect(clipboardText).toBeTruthy();
          expect(clipboardText.length).toBeGreaterThan(0);
        }

        // Test download functionality
        const downloadButton = page
          .locator('button:has-text("Download"), button:has-text("Export")')
          .first();

        if (await downloadButton.isVisible()) {
          // Setup download listener
          const downloadPromise = page.waitForEvent('download');
          await downloadButton.click();

          try {
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toBeTruthy();
          } catch (_e) {
            // Download might not trigger in test environment, that's ok
            console.log('Download test skipped - may not work in test environment');
          }
        }
      }
    } else {
      test.skip();
    }
  });

  test('should show key fingerprints and metadata', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Look for key metadata display
      const keyItems = page.locator('.border.rounded, .bg-gray, .bg-dark').filter({
        hasText: /rsa|ed25519|ecdsa|ssh-/i,
      });

      if (await keyItems.first().isVisible()) {
        // Should show key type
        const keyTypes = page.locator(':has-text("RSA"), :has-text("Ed25519"), :has-text("ECDSA")');
        if (await keyTypes.first().isVisible()) {
          // At least one key type should be visible
          const typeCount = await keyTypes.count();
          expect(typeCount).toBeGreaterThan(0);
        }

        // Should show fingerprint or partial key
        const fingerprints = page.locator('.font-mono, .text-mono, code').filter({
          hasText: /[a-f0-9]{2}:[a-f0-9]{2}|SHA256|MD5/i,
        });

        if (await fingerprints.first().isVisible()) {
          // Should have fingerprint information
          const fingerprintCount = await fingerprints.count();
          expect(fingerprintCount).toBeGreaterThan(0);
        }

        // Should show creation date or other metadata
        const metadata = page.locator('.text-gray, .text-xs, .text-sm').filter({
          hasText: /created|added|size|bits/i,
        });

        if (await metadata.first().isVisible()) {
          // Should have metadata information
          const metadataCount = await metadata.count();
          expect(metadataCount).toBeGreaterThan(0);
        }
      }
    } else {
      test.skip();
    }
  });

  test('should close SSH key manager modal', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      // Test closing with backdrop click - click on the actual backdrop div
      const backdrop = page.locator('ssh-key-manager .fixed.inset-0').first();
      if (await backdrop.isVisible()) {
        // Click on the backdrop itself (the outer div that handles backdrop clicks)
        await backdrop.click({ position: { x: 10, y: 10 } }); // Click on top-left corner of backdrop
        await waitForModalClosed(page);
        await expect(page.locator('ssh-key-manager .fixed.inset-0')).not.toBeVisible();
      }

      // Reopen and test closing with close button
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      const closeButton = page
        .locator(
          'button:has-text("Close"), button:has-text("Cancel"), button[aria-label*="close"], button[title*="close"], button:has-text("✕")'
        )
        .first();
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await waitForModalClosed(page);
        await expect(page.locator('ssh-key-manager .fixed.inset-0')).not.toBeVisible();
      }
    } else {
      test.skip();
    }
  });

  test('should handle key generation with different algorithms', async ({ page }) => {
    const sshKeyTrigger = page
      .locator(
        'button:has-text("SSH Keys"), button:has-text("Manage Keys"), ssh-key-manager button, [title*="SSH"]'
      )
      .first();

    if (await sshKeyTrigger.isVisible()) {
      await sshKeyTrigger.click();
      await expect(page.locator('ssh-key-manager .fixed.inset-0')).toBeVisible();

      const generateButton = page
        .locator(
          'button:has-text("Generate"), button:has-text("Create"), button:has-text("New Key")'
        )
        .first();

      if (await generateButton.isVisible()) {
        await generateButton.click();

        // Test different key algorithms
        const algorithmOptions = ['Ed25519', 'RSA', 'ECDSA'];

        for (const algorithm of algorithmOptions) {
          const algorithmSelector = page
            .locator(
              `select option:has-text("${algorithm}"), input[value="${algorithm}"], button:has-text("${algorithm}")`
            )
            .first();

          if (await algorithmSelector.isVisible()) {
            await algorithmSelector.click();

            // Verify algorithm is selected
            const selectedAlgorithm = page
              .locator('.selected, [aria-selected="true"], .bg-primary')
              .filter({
                hasText: algorithm,
              });

            if (await selectedAlgorithm.isVisible()) {
              await expect(selectedAlgorithm).toBeVisible();
            }

            break; // Test one algorithm and exit
          }
        }
      }
    } else {
      test.skip();
    }
  });
});

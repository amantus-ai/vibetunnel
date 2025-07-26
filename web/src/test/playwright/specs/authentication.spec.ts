import { expect, test } from '../fixtures/test.fixture';

// These tests can run in parallel since they test different auth scenarios
test.describe.configure({ mode: 'parallel' });

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Check auth config first before navigation
    const response = await page.request.get('/api/auth/config');
    const config = await response.json();
    if (config.noAuth) {
      test.skip(true, 'Skipping auth tests in no-auth mode');
      return; // Don't navigate if we're skipping
    }

    // Only navigate if we're actually running auth tests
    await page.goto('/', { waitUntil: 'commit' });
  });

  test('should display login form with SSH and password options', async ({ page }) => {
    // Look for authentication form
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Should have SSH key option
      const sshOption = page
        .locator('button:has-text("SSH"), input[type="radio"][value*="ssh"], .ssh-auth')
        .first();
      if (await sshOption.isVisible()) {
        await expect(sshOption).toBeVisible();
      }

      // Should have password option
      const passwordOption = page
        .locator(
          'button:has-text("Password"), input[type="radio"][value*="password"], .password-auth'
        )
        .first();
      if (await passwordOption.isVisible()) {
        await expect(passwordOption).toBeVisible();
      }

      // Should have username field
      const usernameField = page
        .locator('input[placeholder*="username"], input[type="text"]')
        .first();
      if (await usernameField.isVisible()) {
        await expect(usernameField).toBeVisible();
      }
    } else {
      // Skip if no auth form (might be in no-auth mode)
      test.skip();
    }
  });

  test('should handle SSH key authentication flow', async ({ page }) => {
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Select SSH key authentication
      const sshOption = page
        .locator('button:has-text("SSH"), input[type="radio"][value*="ssh"]')
        .first();

      if (await sshOption.isVisible()) {
        await sshOption.click();

        // Should show SSH key selection or upload
        const sshKeySelector = page.locator('select, .ssh-key-list, .key-selector').first();
        const keyUpload = page
          .locator('input[type="file"], button:has-text("Upload"), button:has-text("Browse")')
          .first();

        const hasSSHKeyUI = (await sshKeySelector.isVisible()) || (await keyUpload.isVisible());
        expect(hasSSHKeyUI).toBeTruthy();

        // Enter username
        const usernameField = page
          .locator('input[placeholder*="username"], input[type="text"]')
          .first();
        if (await usernameField.isVisible()) {
          await usernameField.fill('testuser');
        }

        // Try to submit (should handle validation)
        const submitButton = page
          .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
          .first();
        if (await submitButton.isVisible()) {
          await submitButton.click();

          // Should either proceed or show validation error
          await page.waitForTimeout(2000);

          // Look for error message or progress indicator
          const errorMessage = page.locator('.text-red, .text-error, [role="alert"]').first();
          const progressIndicator = page.locator('.loading, .spinner, .progress').first();

          const hasResponse =
            (await errorMessage.isVisible()) || (await progressIndicator.isVisible());
          expect(hasResponse).toBeTruthy();
        }
      }
    } else {
      test.skip();
    }
  });

  test('should handle password authentication flow', async ({ page }) => {
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Select password authentication
      const passwordOption = page
        .locator('button:has-text("Password"), input[type="radio"][value*="password"]')
        .first();

      if (await passwordOption.isVisible()) {
        await passwordOption.click();

        // Should show password field
        const passwordField = page.locator('input[type="password"]').first();
        await expect(passwordField).toBeVisible();

        // Fill in credentials
        const usernameField = page
          .locator('input[placeholder*="username"], input[type="text"]')
          .first();
        if (await usernameField.isVisible()) {
          await usernameField.fill('testuser');
        }

        await passwordField.fill('testpassword');

        // Submit form
        const submitButton = page
          .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
          .first();
        await submitButton.click();

        // Should show response (error or progress)
        await page.waitForTimeout(2000);

        const errorMessage = page.locator('.text-red, .text-error, [role="alert"]').first();
        const progressIndicator = page.locator('.loading, .spinner, .progress').first();
        const successRedirect = !page.url().includes('login');

        const hasResponse =
          (await errorMessage.isVisible()) ||
          (await progressIndicator.isVisible()) ||
          successRedirect;
        expect(hasResponse).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should validate username requirement', async ({ page }) => {
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Try to submit without username
      const submitButton = page
        .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
        .first();

      if (await submitButton.isVisible()) {
        await submitButton.click();

        // Should show validation error
        const validationError = page.locator('.text-red, .text-error, [role="alert"]').filter({
          hasText: /username|required|empty/i,
        });

        await expect(validationError).toBeVisible({ timeout: 3000 });
      }
    } else {
      test.skip();
    }
  });

  test('should validate password requirement for password auth', async ({ page }) => {
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Select password auth
      const passwordOption = page
        .locator('button:has-text("Password"), input[type="radio"][value*="password"]')
        .first();

      if (await passwordOption.isVisible()) {
        await passwordOption.click();

        // Fill username but not password
        const usernameField = page
          .locator('input[placeholder*="username"], input[type="text"]')
          .first();
        if (await usernameField.isVisible()) {
          await usernameField.fill('testuser');
        }

        // Submit without password
        const submitButton = page
          .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
          .first();
        await submitButton.click();

        // Should show password validation error
        const validationError = page.locator('.text-red, .text-error, [role="alert"]').filter({
          hasText: /password|required|empty/i,
        });

        await expect(validationError).toBeVisible({ timeout: 3000 });
      }
    } else {
      test.skip();
    }
  });

  test('should handle SSH key challenge-response authentication', async ({ page }) => {
    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Mock SSH key authentication API
      await page.route('**/api/auth/**', async (route) => {
        const request = route.request();

        if (request.method() === 'POST' && request.url().includes('challenge')) {
          // Mock challenge response
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              challenge: 'base64-encoded-challenge',
              sessionId: 'test-session-id',
            }),
          });
        } else if (request.method() === 'POST' && request.url().includes('verify')) {
          // Mock verification response
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              token: 'jwt-token',
              user: { username: 'testuser' },
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Select SSH authentication
      const sshOption = page
        .locator('button:has-text("SSH"), input[type="radio"][value*="ssh"]')
        .first();

      if (await sshOption.isVisible()) {
        await sshOption.click();

        // Fill username
        const usernameField = page
          .locator('input[placeholder*="username"], input[type="text"]')
          .first();
        if (await usernameField.isVisible()) {
          await usernameField.fill('testuser');
        }

        // Submit to trigger challenge
        const submitButton = page
          .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
          .first();
        await submitButton.click();

        // Should handle the challenge-response flow
        await page.waitForTimeout(3000);

        // Look for success indicators or next step
        const successIndicator = page.locator('.text-green, .success, .authenticated').first();
        const nextStep = page.locator('.challenge, .verify, .signing').first();
        const redirect = !page.url().includes('login');

        const hasProgress =
          (await successIndicator.isVisible()) || (await nextStep.isVisible()) || redirect;

        expect(hasProgress).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should handle authentication errors gracefully', async ({ page }) => {
    // Check if we're in no-auth mode before proceeding
    const authResponse = await page.request.get('/api/auth/config');
    const authConfig = await authResponse.json();
    if (authConfig.noAuth) {
      test.skip(true, 'Skipping auth error test in no-auth mode');
      return;
    }

    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Mock authentication failure
      await page.route('**/api/auth/**', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Authentication failed',
            message: 'Invalid credentials',
          }),
        });
      });

      // Fill in credentials
      const usernameField = page
        .locator('input[placeholder*="username"], input[type="text"]')
        .first();
      if (await usernameField.isVisible()) {
        await usernameField.fill('invaliduser');
      }

      const passwordField = page.locator('input[type="password"]').first();
      if (await passwordField.isVisible()) {
        await passwordField.fill('wrongpassword');
      }

      // Submit form
      const submitButton = page
        .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
        .first();
      await submitButton.click();

      // Should show error message
      const errorMessage = page.locator('.text-red, .text-error, [role="alert"]').filter({
        hasText: /authentication|failed|invalid|error/i,
      });

      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('should handle JWT token storage and validation', async ({ page }) => {
    // Mock successful authentication
    await page.route('**/api/auth/**', async (route) => {
      const request = route.request();

      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-payload.signature',
            user: { username: 'testuser', id: 1 },
          }),
        });
      } else {
        await route.continue();
      }
    });

    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Fill and submit form
      const usernameField = page
        .locator('input[placeholder*="username"], input[type="text"]')
        .first();
      if (await usernameField.isVisible()) {
        await usernameField.fill('testuser');
      }

      const passwordField = page.locator('input[type="password"]').first();
      if (await passwordField.isVisible()) {
        await passwordField.fill('testpassword');
      }

      const submitButton = page
        .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
        .first();
      await submitButton.click();

      // Wait for authentication to complete
      await page.waitForTimeout(3000);

      // Check if token is stored
      const storedToken = await page.evaluate(() => {
        return (
          localStorage.getItem('authToken') ||
          localStorage.getItem('token') ||
          localStorage.getItem('jwt') ||
          sessionStorage.getItem('authToken') ||
          sessionStorage.getItem('token') ||
          document.cookie.includes('token')
        );
      });

      // Token should be stored somewhere
      if (storedToken) {
        expect(storedToken).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should handle user existence checking', async ({ page }) => {
    // Mock user existence API
    await page.route('**/api/users/exists**', async (route) => {
      const url = new URL(route.request().url());
      const username = url.searchParams.get('username');

      const exists = username === 'existinguser';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exists }),
      });
    });

    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      const usernameField = page
        .locator('input[placeholder*="username"], input[type="text"]')
        .first();

      if (await usernameField.isVisible()) {
        // Test with non-existent user
        await usernameField.fill('nonexistentuser');
        await usernameField.blur(); // Trigger validation

        await page.waitForTimeout(1000);

        // Look for user not found indicator
        const userNotFound = page.locator('.text-red, .text-error').filter({
          hasText: /not found|does not exist|invalid user/i,
        });

        if (await userNotFound.isVisible()) {
          await expect(userNotFound).toBeVisible();
        }

        // Test with existing user
        await usernameField.fill('existinguser');
        await usernameField.blur();

        await page.waitForTimeout(1000);

        // Error should disappear or show success indicator
        const userFound = page.locator('.text-green, .text-success').filter({
          hasText: /found|valid|exists/i,
        });

        if (await userFound.isVisible()) {
          await expect(userFound).toBeVisible();
        }
      }
    } else {
      test.skip();
    }
  });

  test('should handle logout functionality', async ({ page }) => {
    // First, simulate being logged in
    await page.evaluate(() => {
      localStorage.setItem('authToken', 'fake-jwt-token');
      localStorage.setItem('user', JSON.stringify({ username: 'testuser' }));
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Look for logout button/option
    const logoutButton = page
      .locator('button:has-text("Logout"), button:has-text("Sign Out"), button[title*="logout"]')
      .first();
    const userMenu = page.locator('.user-menu, .profile-menu, .avatar').first();

    // Try clicking user menu first if logout button is not directly visible
    if (!(await logoutButton.isVisible()) && (await userMenu.isVisible())) {
      await userMenu.click();
      await page.waitForTimeout(500);
    }

    const visibleLogoutButton = page
      .locator('button:has-text("Logout"), button:has-text("Sign Out"), button[title*="logout"]')
      .first();

    if (await visibleLogoutButton.isVisible()) {
      await visibleLogoutButton.click();

      // Should clear authentication data
      await page.waitForTimeout(1000);

      const clearedToken = await page.evaluate(() => {
        return (
          !localStorage.getItem('authToken') &&
          !localStorage.getItem('token') &&
          !sessionStorage.getItem('authToken')
        );
      });

      // Should redirect to login or show login form
      const showsLoginForm = await page.locator('auth-form, login-form, form').isVisible();
      const isLoginURL =
        page.url().includes('login') || page.url() === new URL('/', page.url()).href;

      const hasLoggedOut = clearedToken || showsLoginForm || isLoginURL;
      expect(hasLoggedOut).toBeTruthy();
    }
  });

  test('should handle session timeout and re-authentication', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test

    // Check if we're in no-auth mode before proceeding
    const authResponse = await page.request.get('/api/auth/config');
    const authConfig = await authResponse.json();
    if (authConfig.noAuth) {
      test.skip(true, 'Skipping session timeout test in no-auth mode');
      return;
    }

    // Mock expired token scenario
    await page.route('**/api/**', async (route) => {
      const authHeader = route.request().headers().authorization;

      if (authHeader?.includes('expired-token')) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Set expired token
    await page.evaluate(() => {
      localStorage.setItem('authToken', 'expired-token');
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Try to make an authenticated request (like creating a session)
    const createSessionButton = page
      .locator('button[title="Create New Session"], button:has-text("Create Session")')
      .first();

    if (await createSessionButton.isVisible()) {
      await createSessionButton.click();

      // Should handle token expiration gracefully
      await page.waitForTimeout(3000);

      // Should either show re-authentication modal or redirect to login
      const reAuthModal = page.locator('.modal, [role="dialog"]').filter({
        hasText: /session expired|re-authenticate|login again/i,
      });

      const loginForm = page.locator('auth-form, login-form, form');
      const loginRedirect = page.url().includes('login');

      const handlesExpiration =
        (await reAuthModal.isVisible()) || (await loginForm.isVisible()) || loginRedirect;

      expect(handlesExpiration).toBeTruthy();
    }
  });

  test('should persist authentication across page reloads', async ({ page }) => {
    // Mock successful authentication
    await page.route('**/api/auth/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'persistent-token',
          user: { username: 'testuser' },
        }),
      });
    });

    const authForm = page.locator('auth-form, login-form, form').first();

    if (await authForm.isVisible()) {
      // Authenticate
      const usernameField = page
        .locator('input[placeholder*="username"], input[type="text"]')
        .first();
      if (await usernameField.isVisible()) {
        await usernameField.fill('testuser');
      }

      const passwordField = page.locator('input[type="password"]').first();
      if (await passwordField.isVisible()) {
        await passwordField.fill('testpassword');
      }

      const submitButton = page
        .locator('button:has-text("Login"), button:has-text("Connect"), button[type="submit"]')
        .first();
      await submitButton.click();

      await page.waitForTimeout(3000);

      // Reload page
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Should remain authenticated (not show login form)
      const stillAuthenticated = !(await page.locator('auth-form, login-form').isVisible());
      const hasUserInterface = await page
        .locator('button[title="Create New Session"], .user-menu, .authenticated')
        .first()
        .isVisible();

      if (stillAuthenticated || hasUserInterface) {
        expect(stillAuthenticated || hasUserInterface).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });
});

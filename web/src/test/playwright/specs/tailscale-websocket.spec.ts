import { expect, test } from '@playwright/test';

type TestWindow = Window & {
  __appLogs?: string[];
  __websocketConnected?: boolean;
  __websocketUrl?: string;
};

test.describe('Tailscale WebSocket Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const globalWindow = window as TestWindow;
      globalWindow.__appLogs = [];
      const levels = ['log', 'warn', 'error', 'debug'];
      const stringify = (value: unknown) => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      levels.forEach((level) => {
        const original = console[level as keyof Console].bind(console);
        console[level as keyof Console] = (...args: unknown[]) => {
          try {
            globalWindow.__appLogs.push(args.map(stringify).join(' '));
          } catch {
            // Ignore log capture errors
          }
          original(...args);
        };
      });
    });

    // Mock the fetch calls to simulate Tailscale authentication
    await page.route('**/api/auth/config', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          enableSSHKeys: false,
          disallowUserPassword: false,
          noAuth: false,
          tailscaleAuth: true,
          authenticatedUser: 'testuser@example.com',
          tailscaleUser: {
            login: 'testuser@example.com',
            name: 'Test User',
            profilePic: 'https://example.com/avatar.jpg',
          },
        }),
      });
    });

    // Mock the tailscale token endpoint
    await page.route('**/api/auth/tailscale-token', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            token: 'mock-tailscale-jwt-token-for-websocket-auth',
            userId: 'testuser@example.com',
            authMethod: 'tailscale',
            expiresIn: '24h',
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock the sessions API to return empty list initially
    await page.route('**/api/sessions', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Mock WebSocket connection to prevent real connection attempts
    await page.addInitScript(() => {
      // Mock WebSocket for buffer subscriptions
      class MockWebSocket extends EventTarget {
        url: string;
        readyState: number = WebSocket.OPEN;

        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        constructor(url: string) {
          super();
          this.url = url;

          // Simulate successful connection for valid tokens
          setTimeout(() => {
            if (url.includes('token=mock-tailscale-jwt-token-for-websocket-auth')) {
              const event = new Event('open');
              this.dispatchEvent(event);

              // Mark as authenticated WebSocket connection
              const globalWindow = window as TestWindow;
              globalWindow.__websocketConnected = true;
              globalWindow.__websocketUrl = url;
            } else {
              // Simulate rejection for missing/invalid tokens
              const event = new CloseEvent('close', { code: 1006, reason: 'Unauthorized' });
              this.dispatchEvent(event);
            }
          }, 100);
        }

        send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          // Mock send - do nothing
        }

        close(code?: number, reason?: string) {
          this.readyState = WebSocket.CLOSED;
          const event = new CloseEvent('close', { code: code || 1000, reason: reason || '' });
          this.dispatchEvent(event);
        }
      }

      // Replace WebSocket globally
      window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    });
  });

  test('should fetch and store WebSocket token for Tailscale users', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for the app to initialize and detect Tailscale auth
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) => log.includes('Authenticated via Tailscale'));
      },
      { timeout: 10000 }
    );

    // Check that the token was fetched and stored
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) =>
          log.includes('WebSocket token stored for Tailscale user')
        );
      },
      { timeout: 5000 }
    );

    // Verify token is in localStorage
    const storedToken = await page.evaluate(() => {
      return localStorage.getItem('vibetunnel_auth_token');
    });

    expect(storedToken).toBe('mock-tailscale-jwt-token-for-websocket-auth');
  });

  test('should use token for WebSocket connections', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for authentication and WebSocket connection
    await page.waitForFunction(
      () => {
        return (window as TestWindow).__websocketConnected === true;
      },
      { timeout: 10000 }
    );

    // Verify WebSocket was connected with the token
    const websocketUrl = await page.evaluate(() => {
      return (window as TestWindow).__websocketUrl;
    });

    expect(websocketUrl).toContain('token=mock-tailscale-jwt-token-for-websocket-auth');
  });

  test('should show warning when token fetch fails', async ({ page }) => {
    // Mock token endpoint to fail
    await page.route('**/api/auth/tailscale-token', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Token generation failed' }),
      });
    });

    // Navigate to the app
    await page.goto('/');

    // Wait for the warning message
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) =>
          log.includes('Failed to fetch WebSocket token, sessions may not load properly')
        );
      },
      { timeout: 10000 }
    );

    // Verify no token is stored
    const storedToken = await page.evaluate(() => {
      return localStorage.getItem('vibetunnel_auth_token');
    });

    expect(storedToken).toBeNull();
  });

  test('should handle token fetch network errors gracefully', async ({ page }) => {
    // Mock token endpoint to throw network error
    await page.route('**/api/auth/tailscale-token', (route) => {
      route.abort('failed');
    });

    // Navigate to the app
    await page.goto('/');

    // Wait for the error handling
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) => log.includes('Error fetching WebSocket token'));
      },
      { timeout: 10000 }
    );

    // App should still initialize even with token fetch failure
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) => log.includes('Authenticated via Tailscale'));
      },
      { timeout: 5000 }
    );
  });

  test('should work with existing token in localStorage', async ({ page }) => {
    // Pre-populate localStorage with a token
    await page.addInitScript(() => {
      localStorage.setItem('vibetunnel_auth_token', 'existing-token-123');
    });

    // Navigate to the app
    await page.goto('/');

    // Should still fetch new token for Tailscale users to ensure freshness
    await page.waitForFunction(
      () => {
        const logs = (window as TestWindow).__appLogs || [];
        return logs.some((log: string) =>
          log.includes('WebSocket token stored for Tailscale user')
        );
      },
      { timeout: 10000 }
    );

    // Verify token was updated
    const storedToken = await page.evaluate(() => {
      return localStorage.getItem('vibetunnel_auth_token');
    });

    expect(storedToken).toBe('mock-tailscale-jwt-token-for-websocket-auth');
  });
});

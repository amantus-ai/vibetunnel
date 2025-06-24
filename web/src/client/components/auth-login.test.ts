import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import {
  typeInInput,
  submitForm,
  clickElement,
  waitForElement,
  getTextContent,
  elementExists,
  setupFetchMock,
} from '@/test/utils/component-helpers';
import { AuthClient } from '../services/auth-client';

// Mock AuthClient
vi.mock('../services/auth-client');

// Import component type
import type { AuthLogin } from './auth-login';

describe('AuthLogin', () => {
  let element: AuthLogin;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let mockAuthClient: AuthClient;

  beforeAll(async () => {
    // Import component to register custom element
    await import('./auth-login');
  });

  beforeEach(async () => {
    // Setup fetch mock
    fetchMock = setupFetchMock();
    
    // Create mock auth client
    mockAuthClient = {
      getCurrentSystemUser: vi.fn(() => Promise.resolve('testuser')),
      getUserAvatar: vi.fn(() => Promise.resolve('/avatar.png')),
      authenticateWithPassword: vi.fn(),
      authenticate: vi.fn(), // The component uses authenticate, not authenticateWithSSHKey
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as any;
    
    // Mock auth config
    fetchMock.mockResponse('/api/auth/config', {
      enableSSHKeys: true,
      disallowUserPassword: false,
      noAuth: false,
    });
    
    // Create component
    element = await fixture<AuthLogin>(html`
      <auth-login .authClient=${mockAuthClient}></auth-login>
    `);
    
    await element.updateComplete;
    // Wait for initial loading
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(() => {
    element.remove();
    fetchMock.clear();
  });

  describe('initialization', () => {
    it('should create component and load user info', () => {
      expect(element).toBeDefined();
      expect(mockAuthClient.getCurrentSystemUser).toHaveBeenCalled();
      expect(mockAuthClient.getUserAvatar).toHaveBeenCalledWith('testuser');
    });

    it('should display current user', async () => {
      // Look for user in the rendered content
      const content = element.textContent;
      expect(content).toContain('testuser');
    });

    it('should show user avatar', async () => {
      const avatar = element.querySelector('img[alt*="Avatar"]');
      expect(avatar).toBeTruthy();
      expect(avatar?.getAttribute('src')).toBe('/avatar.png');
    });

    it('should load auth configuration', async () => {
      const calls = fetchMock.getCalls();
      const configCall = calls.find(call => call[0] === '/api/auth/config');
      expect(configCall).toBeTruthy();
    });

    it('should auto-login when no auth required', async () => {
      // Create new component with no-auth config
      fetchMock.mockResponse('/api/auth/config', {
        enableSSHKeys: false,
        disallowUserPassword: false,
        noAuth: true,
      });
      
      const authHandler = vi.fn();
      const noAuthElement = await fixture<AuthLogin>(html`
        <auth-login 
          .authClient=${mockAuthClient}
          @auth-success=${authHandler}>
        </auth-login>
      `);
      
      // Wait for auto-login
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(authHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            success: true,
            authMethod: 'no-auth',
          })
        })
      );
      
      noAuthElement.remove();
    });
  });

  describe('password authentication', () => {
    it('should show password form', () => {
      const passwordForm = element.querySelector('form');
      const passwordInput = element.querySelector('input[type="password"]');
      expect(passwordForm).toBeTruthy();
      expect(passwordInput).toBeTruthy();
    });

    it('should handle successful password login', async () => {
      mockAuthClient.authenticateWithPassword.mockResolvedValue({
        success: true,
        userId: 'testuser',
        authMethod: 'password',
      });
      
      const authHandler = vi.fn();
      element.addEventListener('auth-success', authHandler);
      
      // Type password
      await typeInInput(element, 'input[type="password"]', 'testpass123');
      
      // Submit form
      const form = element.querySelector('form');
      if (form) {
        await submitForm(element, 'form');
      }
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(mockAuthClient.authenticateWithPassword).toHaveBeenCalledWith(
        'testuser',
        'testpass123'
      );
      expect(authHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            success: true,
            userId: 'testuser',
          })
        })
      );
    });

    it('should handle password login failure', async () => {
      mockAuthClient.authenticateWithPassword.mockResolvedValue({
        success: false,
        error: 'Invalid password',
      });
      
      // Type password and submit
      await typeInInput(element, 'input[type="password"]', 'wrongpass');
      await submitForm(element, 'form');
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should show error
      const errorText = getTextContent(element, '.error-message') || 
                       element.textContent;
      expect(errorText).toContain('Invalid password');
    });

    it('should disable form while loading', async () => {
      mockAuthClient.authenticateWithPassword.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 200))
      );
      
      const submitButton = element.querySelector('button[type="submit"]') as HTMLButtonElement;
      
      // Submit form
      await submitForm(element, 'form');
      
      // Button should be disabled during loading
      expect(submitButton?.disabled).toBe(true);
      
      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 250));
    });

    it('should not show password form when disabled', async () => {
      // Create component with password disabled
      fetchMock.mockResponse('/api/auth/config', {
        enableSSHKeys: true,
        disallowUserPassword: true,
        noAuth: false,
      });
      
      const disabledElement = await fixture<AuthLogin>(html`
        <auth-login .authClient=${mockAuthClient}></auth-login>
      `);
      
      await disabledElement.updateComplete;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const passwordInput = disabledElement.querySelector('input[type="password"]');
      expect(passwordInput).toBeFalsy();
      
      disabledElement.remove();
    });
  });

  describe('SSH key authentication', () => {
    it('should show SSH key button when enabled', () => {
      // Look for any button with SSH-related text
      const buttons = element.querySelectorAll('button');
      let sshButton = null;
      buttons.forEach(btn => {
        if (btn.textContent?.toLowerCase().includes('ssh') || 
            btn.getAttribute('title')?.toLowerCase().includes('ssh')) {
          sshButton = btn;
        }
      });
      expect(sshButton).toBeTruthy();
    });

    it('should handle successful SSH key auth', async () => {
      mockAuthClient.authenticate.mockResolvedValue({
        success: true,
        userId: 'testuser',
        authMethod: 'ssh-key',
      });
      
      const authHandler = vi.fn();
      element.addEventListener('auth-success', authHandler);
      
      // Click SSH button - look for "Login with SSH Key" text
      const buttons = element.querySelectorAll('button');
      let sshButton = null;
      buttons.forEach(btn => {
        if (btn.textContent?.includes('Login with SSH Key')) {
          sshButton = btn;
        }
      });
      if (sshButton) {
        (sshButton as HTMLElement).click();
        await element.updateComplete;
      }
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(mockAuthClient.authenticate).toHaveBeenCalledWith('testuser');
      expect(authHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            success: true,
            authMethod: 'ssh-key',
          })
        })
      );
    });

    it('should handle SSH key auth failure', async () => {
      mockAuthClient.authenticate.mockResolvedValue({
        success: false,
        error: 'SSH key not authorized',
      });
      
      // Click SSH button - look for "Login with SSH Key" text
      const buttons = element.querySelectorAll('button');
      let sshButton = null;
      buttons.forEach(btn => {
        if (btn.textContent?.includes('Login with SSH Key')) {
          sshButton = btn;
        }
      });
      if (sshButton) {
        (sshButton as HTMLElement).click();
        await element.updateComplete;
      }
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Component shows the error from the auth result
      const errorDiv = element.querySelector('.bg-status-error');
      expect(errorDiv?.textContent).toBeTruthy();
      expect(errorDiv?.textContent).toContain('SSH key not authorized');
    });

    it('should not show SSH button when disabled', async () => {
      // Create component with SSH disabled
      fetchMock.mockResponse('/api/auth/config', {
        enableSSHKeys: false,
        disallowUserPassword: false,
        noAuth: false,
      });
      
      const disabledElement = await fixture<AuthLogin>(html`
        <auth-login .authClient=${mockAuthClient}></auth-login>
      `);
      
      await disabledElement.updateComplete;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const sshButton = disabledElement.querySelector('button[title*="SSH"]') ||
                       disabledElement.querySelector('button[title*="key"]');
      expect(sshButton).toBeFalsy();
      
      disabledElement.remove();
    });
  });

  describe('error handling', () => {
    it('should handle user info loading error', async () => {
      mockAuthClient.getCurrentSystemUser.mockRejectedValue(new Error('Network error'));
      
      const errorElement = await fixture<AuthLogin>(html`
        <auth-login .authClient=${mockAuthClient}></auth-login>
      `);
      
      await errorElement.updateComplete;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const errorText = errorElement.textContent;
      expect(errorText).toContain('Failed to load user information');
      
      errorElement.remove();
    });

    it('should handle auth config loading error', async () => {
      fetchMock.mockResponse('/api/auth/config', 
        { error: 'Config error' }, 
        { status: 500 }
      );
      
      const configElement = await fixture<AuthLogin>(html`
        <auth-login .authClient=${mockAuthClient}></auth-login>
      `);
      
      await configElement.updateComplete;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should still render with default config
      expect(configElement.querySelector('form')).toBeTruthy();
      
      configElement.remove();
    });
  });

  describe('UI elements', () => {
    it('should show title', () => {
      const title = element.querySelector('h2')?.textContent;
      expect(title).toContain('VibeTunnel');
    });

    it('should show login prompt', () => {
      // Look for authentication prompt text
      const content = element.textContent;
      expect(content).toBeTruthy();
      expect(content).toContain('Please authenticate to continue');
    });

    it('should have accessible password input', () => {
      const passwordInput = element.querySelector('input[type="password"]');
      expect(passwordInput).toBeTruthy();
      // Check for either placeholder or label
      const hasPlaceholder = passwordInput?.getAttribute('placeholder');
      const hasAriaLabel = passwordInput?.getAttribute('aria-label');
      expect(hasPlaceholder || hasAriaLabel).toBeTruthy();
    });
  });
});
// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clickElement,
  restoreLocalStorage,
  setupFetchMock,
  setupLocalStorageMock,
  typeInInput,
  waitForAsync,
} from '@/test/utils/component-helpers';
import type { AuthClient } from '../services/auth-client';

// Mock AuthClient
vi.mock('../services/auth-client');

// localStorage mock will be created in beforeEach

// Import component type
import type { SessionCreateForm } from './session-create-form';

describe('SessionCreateForm', () => {
  let element: SessionCreateForm;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let mockAuthClient: AuthClient;
  let localStorageMock: ReturnType<typeof setupLocalStorageMock>;

  beforeAll(async () => {
    // Import components to register custom elements
    await import('./session-create-form');
    await import('./file-browser');
  });

  beforeEach(async () => {
    // Setup localStorage mock with isolation
    localStorageMock = setupLocalStorageMock();

    // Spy on localStorage methods for assertions
    vi.spyOn(localStorageMock, 'setItem');
    vi.spyOn(localStorageMock, 'getItem');

    // Setup fetch mock
    fetchMock = setupFetchMock();

    // Create mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create component
    element = await fixture<SessionCreateForm>(html`
      <session-create-form .authClient=${mockAuthClient} .visible=${true}></session-create-form>
    `);

    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    fetchMock.clear();
    restoreLocalStorage();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create component with default state', () => {
      expect(element).toBeDefined();
      expect(element.workingDir).toBe('~/');
      expect(element.command).toBe('zsh');
      expect(element.sessionName).toBe('');
      expect(element.isCreating).toBe(false);
    });

    it('should load saved values from localStorage', async () => {
      localStorageMock.getItem.mockImplementation((key) => {
        if (key === 'vibetunnel_last_working_dir') return '/home/user/projects';
        if (key === 'vibetunnel_last_command') return 'npm run dev';
        return null;
      });

      const newElement = await fixture<SessionCreateForm>(html`
        <session-create-form .authClient=${mockAuthClient} .visible=${true}></session-create-form>
      `);

      expect(newElement.workingDir).toBe('/home/user/projects');
      expect(newElement.command).toBe('npm run dev');

      newElement.remove();
    });

    it('should render modal when visible', () => {
      const modal = element.querySelector('.modal-backdrop');
      expect(modal).toBeTruthy();
    });

    it('should not render modal when not visible', async () => {
      element.visible = false;
      await element.updateComplete;

      const modal = element.querySelector('.modal-backdrop');
      expect(modal).toBeFalsy();
    });
  });

  describe('form fields', () => {
    it('should update session name on input', async () => {
      await typeInInput(element, 'input[placeholder="My Session"]', 'Test Session');

      expect(element.sessionName).toBe('Test Session');
    });

    it('should update command on input', async () => {
      await typeInInput(element, 'input[placeholder="zsh"]', 'python3');

      expect(element.command).toBe('python3');
    });

    it('should update working directory on input', async () => {
      const changeHandler = vi.fn();
      element.addEventListener('working-dir-change', changeHandler);

      await typeInInput(element, 'input[placeholder="~/"]', '/usr/local');

      expect(element.workingDir).toBe('/usr/local');
      expect(changeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: '/usr/local',
        })
      );
    });

    it('should disable fields when creating', async () => {
      element.isCreating = true;
      await element.updateComplete;

      const inputs = element.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.disabled).toBe(true);
      });
    });
  });

  describe('quick start buttons', () => {
    it('should render quick start commands', () => {
      const quickStartButtons = element.querySelectorAll('.grid button');
      expect(quickStartButtons.length).toBeGreaterThan(0);

      // Check for specific commands
      const buttonTexts = Array.from(quickStartButtons).map((btn) => btn.textContent?.trim());
      expect(buttonTexts).toContain('zsh');
      expect(buttonTexts).toContain('bash');
      expect(buttonTexts).toContain('python3');
    });

    it('should update command when quick start is clicked', async () => {
      const pythonButton = Array.from(element.querySelectorAll('.grid button')).find((btn) =>
        btn.textContent?.includes('python3')
      );

      if (pythonButton) {
        (pythonButton as HTMLElement).click();
        await element.updateComplete;

        expect(element.command).toBe('python3');
      }
    });

    it('should highlight selected quick start', async () => {
      element.command = 'node';
      await element.updateComplete;

      const nodeButton = Array.from(element.querySelectorAll('.grid button')).find((btn) =>
        btn.textContent?.includes('node')
      );

      expect(nodeButton?.classList.contains('bg-accent-green')).toBe(true);
    });
  });

  describe('session creation', () => {
    it('should create session with valid data', async () => {
      fetchMock.mockResponse('/api/sessions', {
        sessionId: 'new-session-123',
        message: 'Session created',
      });

      const createdHandler = vi.fn();
      element.addEventListener('session-created', createdHandler);

      // Fill form
      element.sessionName = 'Test Session';
      element.command = 'npm run dev';
      element.workingDir = '/home/user/project';
      await element.updateComplete;

      // Click create button - the Create button is the last button in the flex gap
      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      );
      if (createButton) {
        (createButton as HTMLElement).click();
        await element.updateComplete;
        await waitForAsync();
      }

      // Wait for the request to complete
      await waitForAsync();

      // Check request - filter for session creation calls
      const calls = fetchMock.getCalls();
      const sessionCall = calls.find((call) => call[0] === '/api/sessions');
      expect(sessionCall).toBeTruthy();
      expect(sessionCall?.[1]?.body).toBeTruthy();

      const requestBody = JSON.parse((sessionCall?.[1]?.body as string) || '{}');
      expect(requestBody).toEqual({
        name: 'Test Session',
        command: ['npm', 'run', 'dev'],
        workingDir: '/home/user/project',
        spawn_terminal: false,
        cols: 120,
        rows: 30,
      });

      expect(createdHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            sessionId: 'new-session-123',
            message: 'Session created',
          },
        })
      );
    });

    it('should save to localStorage on successful creation', async () => {
      fetchMock.mockResponse('/api/sessions', { sessionId: 'new-session-123' });

      element.command = 'npm start';
      element.workingDir = '/projects/app';
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      );
      if (createButton) {
        (createButton as HTMLElement).click();
        await element.updateComplete;
        await waitForAsync();
      }

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'vibetunnel_last_working_dir',
        '/projects/app'
      );
      expect(localStorageMock.setItem).toHaveBeenCalledWith('vibetunnel_last_command', 'npm start');
    });

    it('should clear command and name after creation', async () => {
      fetchMock.mockResponse('/api/sessions', { sessionId: 'new-session-123' });

      element.sessionName = 'Test';
      element.command = 'ls';
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      );
      if (createButton) {
        (createButton as HTMLElement).click();
        await element.updateComplete;
        await waitForAsync();
      }

      expect(element.command).toBe('');
      expect(element.sessionName).toBe('');
    });

    it('should handle creation error', async () => {
      fetchMock.mockResponse(
        '/api/sessions',
        { error: 'Failed to create session', details: 'Permission denied' },
        { status: 403 }
      );

      const errorHandler = vi.fn();
      element.addEventListener('error', errorHandler);

      element.command = 'test';
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      );
      if (createButton) {
        (createButton as HTMLElement).click();
        await element.updateComplete;
        await waitForAsync();
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: 'Permission denied',
        })
      );
    });

    it('should validate required fields', async () => {
      const errorHandler = vi.fn();
      element.addEventListener('error', errorHandler);

      // Empty command but valid working directory
      element.command = '';
      element.workingDir = '/test';
      await element.updateComplete;

      // The create button should be disabled, but let's click anyway to test validation
      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      ) as HTMLButtonElement;

      // The button should be disabled due to empty command
      expect(createButton?.disabled).toBe(true);

      // Force a click through the handleCreate method directly
      await element.handleCreate();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: 'Please fill in both working directory and command',
        })
      );
    });

    it('should parse command with quotes correctly', async () => {
      fetchMock.mockResponse('/api/sessions', { sessionId: 'new-session-123' });

      element.command = 'echo "hello world" \'single quote\'';
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      );
      if (createButton) {
        (createButton as HTMLElement).click();
        await element.updateComplete;
        await waitForAsync();
      }

      const calls = fetchMock.getCalls();
      const sessionCall = calls.find((call) => call[0] === '/api/sessions');
      expect(sessionCall).toBeTruthy();
      const requestBody = JSON.parse((sessionCall?.[1]?.body as string) || '{}');
      expect(requestBody.command).toEqual(['echo', 'hello world', 'single quote']);
    });

    it('should disable create button when fields are empty', async () => {
      element.command = '';
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find(
        (btn) => btn.textContent?.trim() === 'Create'
      ) as HTMLButtonElement;
      expect(createButton?.disabled).toBe(true);
    });
  });

  describe('file browser integration', () => {
    it('should show file browser when browse button is clicked', async () => {
      const browseButton =
        element.querySelector('button[title*="📁"]') ||
        element.querySelector('button:has-text("📁")') ||
        Array.from(element.querySelectorAll('button')).find((btn) =>
          btn.textContent?.includes('📁')
        );

      if (browseButton) {
        (browseButton as HTMLElement).click();
        await element.updateComplete;

        expect(element.showFileBrowser).toBe(true);

        const fileBrowser = element.querySelector('file-browser');
        expect(fileBrowser).toBeTruthy();
      }
    });

    it('should update working directory when directory is selected', async () => {
      element.showFileBrowser = true;
      await element.updateComplete;

      const fileBrowser = element.querySelector('file-browser');
      if (fileBrowser) {
        fileBrowser.dispatchEvent(
          new CustomEvent('directory-selected', {
            detail: '/new/directory/path',
          })
        );

        expect(element.workingDir).toBe('/new/directory/path');
        expect(element.showFileBrowser).toBe(false);
      }
    });

    it('should hide file browser on cancel', async () => {
      element.showFileBrowser = true;
      await element.updateComplete;

      const fileBrowser = element.querySelector('file-browser');
      if (fileBrowser) {
        fileBrowser.dispatchEvent(new CustomEvent('browser-cancel'));

        expect(element.showFileBrowser).toBe(false);
      }
    });
  });

  describe('keyboard shortcuts', () => {
    it('should close on Escape key', async () => {
      const cancelHandler = vi.fn();
      element.addEventListener('cancel', cancelHandler);

      // Simulate global escape key
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(cancelHandler).toHaveBeenCalled();
    });

    it('should create on Enter key when form is valid', async () => {
      fetchMock.mockResponse('/api/sessions', { sessionId: 'new-session-123' });

      element.command = 'test';
      element.workingDir = '/test';
      await element.updateComplete;

      const createdHandler = vi.fn();
      element.addEventListener('session-created', createdHandler);

      // Simulate global enter key
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);

      // Wait for async operation
      await waitForAsync();
      await element.updateComplete;

      expect(createdHandler).toHaveBeenCalled();
    });

    it('should not create on Enter when form is invalid', async () => {
      const errorHandler = vi.fn();
      element.addEventListener('error', errorHandler);

      element.command = '';
      await element.updateComplete;

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);

      // Should not trigger any action
      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  describe('cancel functionality', () => {
    it('should emit cancel event when cancel button is clicked', async () => {
      const cancelHandler = vi.fn();
      element.addEventListener('cancel', cancelHandler);

      await clickElement(element, '.btn-ghost');

      expect(cancelHandler).toHaveBeenCalled();
    });

    it('should emit cancel event when close button is clicked', async () => {
      const cancelHandler = vi.fn();
      element.addEventListener('cancel', cancelHandler);

      const closeButton = element.querySelector('[aria-label="Close modal"]');
      if (closeButton) {
        (closeButton as HTMLElement).click();
        expect(cancelHandler).toHaveBeenCalled();
      }
    });
  });

  describe('form state', () => {
    it('should show loading state when creating', async () => {
      element.isCreating = true;
      await element.updateComplete;

      const createButton = Array.from(element.querySelectorAll('button')).find((btn) =>
        btn.textContent?.includes('Creating')
      );
      expect(createButton).toBeTruthy();
    });

    it('should disable cancel button when creating', async () => {
      element.isCreating = true;
      await element.updateComplete;

      const cancelButton = element.querySelector('.btn-ghost') as HTMLButtonElement;
      expect(cancelButton.disabled).toBe(true);
    });
  });
});

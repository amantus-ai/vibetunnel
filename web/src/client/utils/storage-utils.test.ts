/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleMode } from '../../shared/types';
import {
  getSessionFormValue,
  loadSessionFormData,
  removeSessionFormValue,
  SESSION_FORM_STORAGE_KEYS,
  saveSessionFormData,
  setSessionFormValue,
} from './storage-utils';

describe('storage-utils', () => {
  let mockStorage: { [key: string]: string };

  beforeEach(() => {
    // Create a mock localStorage that persists between calls
    mockStorage = {};

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStorage[key];
        }),
        clear: vi.fn(() => {
          mockStorage = {};
        }),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadSessionFormData', () => {
    it('should return empty object when localStorage is empty', () => {
      const result = loadSessionFormData();
      expect(result).toEqual({});
    });

    it('should load all stored values correctly', () => {
      mockStorage[SESSION_FORM_STORAGE_KEYS.WORKING_DIR] = '/home/user/projects';
      mockStorage[SESSION_FORM_STORAGE_KEYS.COMMAND] = 'npm run dev';
      mockStorage[SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW] = 'true';
      mockStorage[SESSION_FORM_STORAGE_KEYS.TITLE_MODE] = TitleMode.DYNAMIC;

      const result = loadSessionFormData();

      expect(result).toEqual({
        workingDir: '/home/user/projects',
        command: 'npm run dev',
        spawnWindow: true,
        titleMode: TitleMode.DYNAMIC,
      });
    });

    it('should handle false spawn window value', () => {
      mockStorage[SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW] = 'false';

      const result = loadSessionFormData();
      expect(result.spawnWindow).toBe(false);
    });

    it('should return undefined for missing values', () => {
      mockStorage[SESSION_FORM_STORAGE_KEYS.WORKING_DIR] = '/home/user';

      const result = loadSessionFormData();
      expect(result.workingDir).toBe('/home/user');
      expect(result.command).toBeUndefined();
      expect(result.spawnWindow).toBeUndefined();
      expect(result.titleMode).toBeUndefined();
    });

    it('should handle localStorage errors gracefully', () => {
      window.localStorage.getItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      const result = loadSessionFormData();
      expect(result).toEqual({});
    });
  });

  describe('saveSessionFormData', () => {
    it('should save all provided values', () => {
      saveSessionFormData({
        workingDir: '/projects',
        command: 'zsh',
        spawnWindow: true,
        titleMode: TitleMode.STATIC,
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.WORKING_DIR,
        '/projects'
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.COMMAND,
        'zsh'
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW,
        'true'
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.TITLE_MODE,
        TitleMode.STATIC
      );
    });

    it('should only save non-empty values', () => {
      saveSessionFormData({
        workingDir: '',
        command: 'bash',
        spawnWindow: false,
      });

      expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.WORKING_DIR,
        ''
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.COMMAND,
        'bash'
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW,
        'false'
      );
    });

    it('should handle undefined values', () => {
      saveSessionFormData({
        workingDir: '/home',
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.WORKING_DIR,
        '/home'
      );
      expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    });

    it('should handle localStorage errors gracefully', () => {
      window.localStorage.setItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => {
        saveSessionFormData({ workingDir: '/test' });
      }).not.toThrow();
    });
  });

  describe('getSessionFormValue', () => {
    it('should get specific values from localStorage', () => {
      mockStorage[SESSION_FORM_STORAGE_KEYS.COMMAND] = 'python3';

      const result = getSessionFormValue('COMMAND');
      expect(result).toBe('python3');
    });

    it('should return null for missing values', () => {
      const result = getSessionFormValue('WORKING_DIR');
      expect(result).toBeNull();
    });

    it('should handle localStorage errors gracefully', () => {
      window.localStorage.getItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      const result = getSessionFormValue('COMMAND');
      expect(result).toBeNull();
    });
  });

  describe('setSessionFormValue', () => {
    it('should set specific values in localStorage', () => {
      setSessionFormValue('SPAWN_WINDOW', 'true');

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW,
        'true'
      );
      expect(mockStorage[SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW]).toBe('true');
    });

    it('should handle localStorage errors gracefully', () => {
      window.localStorage.setItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => {
        setSessionFormValue('TITLE_MODE', TitleMode.FILTER);
      }).not.toThrow();
    });
  });

  describe('removeSessionFormValue', () => {
    it('should remove specific values from localStorage', () => {
      mockStorage[SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW] = 'true';

      removeSessionFormValue('SPAWN_WINDOW');

      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW
      );
      expect(mockStorage[SESSION_FORM_STORAGE_KEYS.SPAWN_WINDOW]).toBeUndefined();
    });

    it('should handle localStorage errors gracefully', () => {
      window.localStorage.removeItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => {
        removeSessionFormValue('COMMAND');
      }).not.toThrow();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { TERMINAL_THEMES } from '../../client/utils/terminal-themes.js';

describe('terminal-themes', () => {
  it('should include all expected theme IDs', () => {
    const themeIds = TERMINAL_THEMES.map((t) => t.id);
    expect(themeIds).toContain('auto');
    expect(themeIds).toContain('dark');
    expect(themeIds).toContain('light');
  });

  it('should have valid theme structure', () => {
    TERMINAL_THEMES.forEach((theme) => {
      expect(theme).toHaveProperty('id');
      expect(theme).toHaveProperty('name');
      expect(theme).toHaveProperty('description');
      expect(theme).toHaveProperty('colors');
      expect(typeof theme.id).toBe('string');
      expect(typeof theme.name).toBe('string');
      expect(typeof theme.description).toBe('string');
      expect(typeof theme.colors).toBe('object');
    });
  });

  it('should have unique theme IDs', () => {
    const themeIds = TERMINAL_THEMES.map((t) => t.id);
    const uniqueIds = [...new Set(themeIds)];
    expect(themeIds).toHaveLength(uniqueIds.length);
  });

  it('should have non-empty names and descriptions', () => {
    TERMINAL_THEMES.forEach((theme) => {
      expect(theme.name.trim()).not.toBe('');
      expect(theme.description.trim()).not.toBe('');
    });
  });

  it('should have valid color format for themes with colors', () => {
    TERMINAL_THEMES.forEach((theme) => {
      if (theme.id !== 'auto') {
        // auto theme has empty colors object
        Object.values(theme.colors).forEach((color) => {
          if (typeof color === 'string' && color.startsWith('#')) {
            // Basic hex color validation
            expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
          }
        });
      }
    });
  });
});

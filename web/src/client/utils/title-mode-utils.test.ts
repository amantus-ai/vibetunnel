import { describe, expect, it } from 'vitest';
import { TitleMode } from '../../shared/types';
import { getTitleModeDescription, getTitleModeDisplayName } from './title-mode-utils';

describe('title-mode-utils', () => {
  describe('getTitleModeDescription', () => {
    it('should return correct description for NONE mode', () => {
      expect(getTitleModeDescription(TitleMode.NONE)).toBe('Apps control their own titles');
    });

    it('should return correct description for FILTER mode', () => {
      expect(getTitleModeDescription(TitleMode.FILTER)).toBe('Blocks all title changes');
    });

    it('should return correct description for STATIC mode', () => {
      expect(getTitleModeDescription(TitleMode.STATIC)).toBe('Shows path and command');
    });

    it('should return correct description for DYNAMIC mode', () => {
      expect(getTitleModeDescription(TitleMode.DYNAMIC)).toBe('Legacy alias of static');
    });

    it('should return empty string for unknown mode', () => {
      // @ts-expect-error Testing invalid input
      expect(getTitleModeDescription('UNKNOWN')).toBe('');
    });

    it('should handle all TitleMode enum values', () => {
      // Ensure all enum values are covered
      Object.values(TitleMode).forEach((mode) => {
        const description = getTitleModeDescription(mode);
        expect(description).toBeTruthy();
        expect(typeof description).toBe('string');
      });
    });
  });

  describe('getTitleModeDisplayName', () => {
    it('should return correct display name for NONE mode', () => {
      expect(getTitleModeDisplayName(TitleMode.NONE)).toBe('None');
    });

    it('should return correct display name for FILTER mode', () => {
      expect(getTitleModeDisplayName(TitleMode.FILTER)).toBe('Filter');
    });

    it('should return correct display name for STATIC mode', () => {
      expect(getTitleModeDisplayName(TitleMode.STATIC)).toBe('Static');
    });

    it('should return correct display name for DYNAMIC mode', () => {
      expect(getTitleModeDisplayName(TitleMode.DYNAMIC)).toBe('Dynamic (legacy)');
    });

    it('should return the input value for unknown mode', () => {
      // @ts-expect-error Testing invalid input
      expect(getTitleModeDisplayName('CUSTOM_MODE')).toBe('CUSTOM_MODE');
    });

    it('should handle all TitleMode enum values', () => {
      // Ensure all enum values are covered
      Object.values(TitleMode).forEach((mode) => {
        const displayName = getTitleModeDisplayName(mode);
        expect(displayName).toBeTruthy();
        expect(typeof displayName).toBe('string');
        // Display names should start with uppercase
        expect(displayName[0]).toBe(displayName[0].toUpperCase());
      });
    });
  });

  describe('consistency between functions', () => {
    it('should have descriptions for all modes that have display names', () => {
      Object.values(TitleMode).forEach((mode) => {
        const displayName = getTitleModeDisplayName(mode);
        const description = getTitleModeDescription(mode);

        // If we have a display name, we should have a description
        if (displayName && displayName !== mode) {
          expect(description).toBeTruthy();
          expect(description.length).toBeGreaterThan(0);
        }
      });
    });
  });
});

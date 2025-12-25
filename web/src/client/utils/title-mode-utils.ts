import { TitleMode } from '../../shared/types.js';

/**
 * Get a human-readable description for a title mode
 * @param titleMode The title mode to describe
 * @returns Description of what the title mode does
 */
export function getTitleModeDescription(titleMode: TitleMode): string {
  switch (titleMode) {
    case TitleMode.NONE:
      return 'Apps control their own titles';
    case TitleMode.FILTER:
      return 'Blocks all title changes';
    case TitleMode.STATIC:
      return 'Shows path and command';
    case TitleMode.DYNAMIC:
      return 'Legacy alias of static';
    default:
      return '';
  }
}

/**
 * Get display name for a title mode
 * @param titleMode The title mode
 * @returns Display name for UI
 */
export function getTitleModeDisplayName(titleMode: TitleMode): string {
  switch (titleMode) {
    case TitleMode.NONE:
      return 'None';
    case TitleMode.FILTER:
      return 'Filter';
    case TitleMode.STATIC:
      return 'Static';
    case TitleMode.DYNAMIC:
      return 'Dynamic (legacy)';
    default:
      return titleMode;
  }
}

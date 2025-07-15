/**
 * Theme detection utilities
 */

/**
 * Gets the current effective theme (light or dark)
 * Handles both explicit theme setting and system preference
 */
export function getCurrentTheme(): 'light' | 'dark' {
  const explicitTheme = document.documentElement.getAttribute('data-theme');

  if (explicitTheme === 'dark') return 'dark';
  if (explicitTheme === 'light') return 'light';

  // No explicit theme set, use system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Checks if the current effective theme is dark mode
 */
export function isDarkMode(): boolean {
  return getCurrentTheme() === 'dark';
}

/**
 * Gets a color value based on current theme
 * @param lightColor Color to use in light mode
 * @param darkColor Color to use in dark mode
 */
export function getThemeColor(lightColor: string, darkColor: string): string {
  return isDarkMode() ? darkColor : lightColor;
}

/**
 * Gets URL-encoded color for SVG based on current theme
 * @param lightColor Color to use in light mode (will be URL-encoded)
 * @param darkColor Color to use in dark mode (will be URL-encoded)
 */
export function getThemeColorEncoded(lightColor: string, darkColor: string): string {
  const color = getThemeColor(lightColor, darkColor);
  return encodeURIComponent(color);
}

/**
 * Gets a CSS custom property value as RGB color
 * @param property CSS custom property name (without --)
 */
function getCSSColorAsHex(property: string): string {
  const rgb = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${property}`)
    .trim();

  if (!rgb) return '#000000'; // fallback

  // Convert "r g b" format to hex
  const [r, g, b] = rgb.split(' ').map((n) => Number.parseInt(n, 10));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Gets URL-encoded text color for SVG arrows based on current theme
 * Uses CSS custom properties for consistent theming
 */
export function getTextColorEncoded(): string {
  const color = getCSSColorAsHex('text');
  return encodeURIComponent(color);
}

/**
 * Creates a media query listener for system theme changes
 */
export function createSystemThemeListener(callback: (isDark: boolean) => void): MediaQueryList {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => callback(e.matches));
  return mediaQuery;
}

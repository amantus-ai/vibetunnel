/**
 * URL utility functions for test helpers
 */

/**
 * Extracts the base URL from a page URL, handling edge cases
 * @param pageUrl The current page URL
 * @returns The base URL for API calls
 */
export function extractBaseUrl(pageUrl: string): string {
  // Default fallback
  const defaultUrl = 'http://localhost:4022';

  // Handle empty or invalid URLs
  if (!pageUrl || pageUrl === 'about:blank' || pageUrl === 'data:,') {
    return defaultUrl;
  }

  // Handle non-HTTP URLs
  if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
    return defaultUrl;
  }

  try {
    const url = new URL(pageUrl);
    // Return protocol + host (no pathname)
    return `${url.protocol}//${url.host}`;
  } catch {
    // If URL parsing fails, return default
    return defaultUrl;
  }
}

/**
 * Validates if a URL is valid and reachable for API calls
 * @param url The URL to validate
 * @returns True if the URL is valid
 */
export function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

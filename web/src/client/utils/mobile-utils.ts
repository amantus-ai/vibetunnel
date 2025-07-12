/**
 * Mobile device detection utilities
 * Provides consistent mobile detection across the application
 */

/**
 * Detect if the current device is a mobile device (phone or tablet).
 * Uses the same logic as index.html for consistency.
 *
 * @returns true if the device is mobile (iPhone, iPad, iPod, Android)
 */
export function detectMobile(): boolean {
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (!!navigator.maxTouchPoints && navigator.maxTouchPoints > 1)
  );
}

/**
 * Detect if the current device is running iOS.
 *
 * @returns true if the device is running iOS
 */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Detect if the current device is running Android.
 *
 * @returns true if the device is running Android
 */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * Get the mobile platform type.
 *
 * @returns 'ios' | 'android' | 'other' | 'desktop'
 */
export function getMobilePlatform(): 'ios' | 'android' | 'other' | 'desktop' {
  if (!detectMobile()) {
    return 'desktop';
  }

  if (isIOS()) {
    return 'ios';
  }

  if (isAndroid()) {
    return 'android';
  }

  return 'other';
}

/**
 * Accessibility utility functions and directives for Lit components
 */

import { directive, Directive, PartInfo, PartType } from 'lit/directive.js';
import { nothing } from 'lit';

/**
 * Keyboard navigation keys
 */
export const KEYS = {
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown'
} as const;

/**
 * ARIA live region priorities
 */
export type AriaLive = 'polite' | 'assertive' | 'off';

/**
 * Announce message to screen readers
 */
export function announceToScreenReader(
  message: string, 
  priority: AriaLive = 'polite',
  delay = 100
): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.style.position = 'absolute';
  announcement.style.left = '-10000px';
  announcement.style.width = '1px';
  announcement.style.height = '1px';
  announcement.style.overflow = 'hidden';
  
  document.body.appendChild(announcement);
  
  // Delay to ensure screen readers catch the change
  setTimeout(() => {
    announcement.textContent = message;
    
    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, delay);
}

/**
 * Focus trap directive for modal-like components
 */
class FocusTrapDirective extends Directive {
  private element?: HTMLElement;
  private firstFocusable?: HTMLElement;
  private lastFocusable?: HTMLElement;
  private active = false;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error('focusTrap directive must be used on an element');
    }
  }

  update(part: any, [active]: [boolean]) {
    this.element = part.element;
    this.active = active;

    if (active) {
      this.trapFocus();
    } else {
      this.releaseFocus();
    }

    return this.render(active);
  }

  render(active: boolean) {
    return nothing;
  }

  private trapFocus() {
    if (!this.element) return;

    const focusableElements = this.element.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    this.firstFocusable = focusableElements[0];
    this.lastFocusable = focusableElements[focusableElements.length - 1];

    // Focus first element
    this.firstFocusable.focus();

    // Add event listeners
    this.element.addEventListener('keydown', this.handleKeyDown);
  }

  private releaseFocus() {
    if (!this.element) return;
    this.element.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== KEYS.TAB || !this.firstFocusable || !this.lastFocusable) return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === this.firstFocusable) {
        e.preventDefault();
        this.lastFocusable.focus();
      }
    } else {
      // Tab
      if (document.activeElement === this.lastFocusable) {
        e.preventDefault();
        this.firstFocusable.focus();
      }
    }
  };
}

export const focusTrap = directive(FocusTrapDirective);

/**
 * Keyboard navigation handler
 */
export interface KeyboardNavOptions {
  onEnter?: () => void;
  onSpace?: () => void;
  onEscape?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onHome?: () => void;
  onEnd?: () => void;
  preventDefault?: boolean;
}

export function handleKeyboardNav(
  event: KeyboardEvent,
  options: KeyboardNavOptions
): void {
  const { key } = event;
  const { preventDefault = true } = options;

  let handled = true;

  switch (key) {
    case KEYS.ENTER:
      options.onEnter?.();
      break;
    case KEYS.SPACE:
      options.onSpace?.();
      break;
    case KEYS.ESCAPE:
      options.onEscape?.();
      break;
    case KEYS.ARROW_UP:
      options.onArrowUp?.();
      break;
    case KEYS.ARROW_DOWN:
      options.onArrowDown?.();
      break;
    case KEYS.ARROW_LEFT:
      options.onArrowLeft?.();
      break;
    case KEYS.ARROW_RIGHT:
      options.onArrowRight?.();
      break;
    case KEYS.HOME:
      options.onHome?.();
      break;
    case KEYS.END:
      options.onEnd?.();
      break;
    default:
      handled = false;
  }

  if (handled && preventDefault) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * Roving tabindex for list navigation
 */
export class RovingTabindex {
  private items: HTMLElement[] = [];
  private currentIndex = 0;

  constructor(
    private container: HTMLElement,
    private itemSelector: string
  ) {
    this.init();
  }

  private init() {
    this.updateItems();
    this.container.addEventListener('keydown', this.handleKeyDown);
    this.container.addEventListener('click', this.handleClick);
  }

  private updateItems() {
    this.items = Array.from(
      this.container.querySelectorAll<HTMLElement>(this.itemSelector)
    );
    this.items.forEach((item, index) => {
      item.setAttribute('tabindex', index === this.currentIndex ? '0' : '-1');
    });
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    handleKeyboardNav(e, {
      onArrowDown: () => this.focusNext(),
      onArrowUp: () => this.focusPrevious(),
      onHome: () => this.focusFirst(),
      onEnd: () => this.focusLast()
    });
  };

  private handleClick = (e: Event) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>(this.itemSelector);
    if (item && this.items.includes(item)) {
      this.currentIndex = this.items.indexOf(item);
      this.updateTabIndices();
    }
  };

  private focusNext() {
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.focusCurrent();
  }

  private focusPrevious() {
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.focusCurrent();
  }

  private focusFirst() {
    this.currentIndex = 0;
    this.focusCurrent();
  }

  private focusLast() {
    this.currentIndex = this.items.length - 1;
    this.focusCurrent();
  }

  private focusCurrent() {
    this.updateTabIndices();
    this.items[this.currentIndex]?.focus();
  }

  private updateTabIndices() {
    this.items.forEach((item, index) => {
      item.setAttribute('tabindex', index === this.currentIndex ? '0' : '-1');
    });
  }

  destroy() {
    this.container.removeEventListener('keydown', this.handleKeyDown);
    this.container.removeEventListener('click', this.handleClick);
  }
}

/**
 * Skip to main content link component
 */
export function renderSkipLink(targetId = 'main-content') {
  return `
    <a 
      href="#${targetId}" 
      class="skip-link"
      style="
        position: absolute;
        left: -10000px;
        top: auto;
        width: 1px;
        height: 1px;
        overflow: hidden;
      "
      onFocus="this.style.left = '0'; this.style.width = 'auto'; this.style.height = 'auto';"
      onBlur="this.style.left = '-10000px'; this.style.width = '1px'; this.style.height = '1px';"
    >
      Skip to main content
    </a>
  `;
}

/**
 * Generate unique IDs for form controls
 */
let idCounter = 0;
export function generateId(prefix = 'a11y'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get contrast ratio between two colors
 */
export function getContrastRatio(color1: string, color2: string): number {
  // Convert colors to RGB
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  
  if (!rgb1 || !rgb2) return 0;
  
  // Calculate relative luminance
  const l1 = getRelativeLuminance(rgb1);
  const l2 = getRelativeLuminance(rgb2);
  
  // Calculate contrast ratio
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const { r, g, b } = rgb;
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  const rLin = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLin = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLin = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}
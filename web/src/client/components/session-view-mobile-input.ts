/**
 * Mobile input handling for SessionView component
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('session-view-mobile');

export interface MobileInputManager {
  hiddenInput: HTMLInputElement | null;
  focusRetentionInterval: number | null;
  visualViewportHandler: (() => void) | null;
  showQuickKeys: boolean;
  keyboardHeight: number;
}

export function createHiddenInput(
  sendInputText: (text: string) => void,
  showMobileInput: boolean,
  showCtrlAlpha: boolean,
  onFocus: () => void,
  onBlur: (e: FocusEvent) => void
): HTMLInputElement {
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'text';
  hiddenInput.style.position = 'absolute';
  hiddenInput.style.top = '0';
  hiddenInput.style.left = '0';
  hiddenInput.style.width = '100%';
  hiddenInput.style.height = '100%';
  hiddenInput.style.opacity = '0'; // Completely transparent
  hiddenInput.style.fontSize = '16px'; // Prevent zoom on iOS
  hiddenInput.style.zIndex = '10'; // Above terminal content
  hiddenInput.style.border = 'none';
  hiddenInput.style.outline = 'none';
  hiddenInput.style.background = 'transparent';
  hiddenInput.style.color = 'transparent';
  hiddenInput.style.caretColor = 'transparent'; // Hide the cursor
  hiddenInput.style.cursor = 'default'; // Normal cursor
  hiddenInput.autocapitalize = 'off';
  hiddenInput.autocomplete = 'off';
  hiddenInput.setAttribute('autocorrect', 'off');
  hiddenInput.setAttribute('spellcheck', 'false');
  hiddenInput.setAttribute('aria-hidden', 'true');

  // Prevent click events from propagating to terminal
  hiddenInput.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  // Also handle touchstart to ensure mobile taps don't propagate
  hiddenInput.addEventListener('touchstart', (e) => {
    e.stopPropagation();
  });

  // Handle input events
  hiddenInput.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value) {
      // Don't send input to terminal if mobile input overlay or Ctrl overlay is visible
      if (!showMobileInput && !showCtrlAlpha) {
        // Send each character to terminal
        sendInputText(input.value);
      }
      // Always clear the input to prevent buffer buildup
      input.value = '';
    }
  });

  // Handle special keys
  hiddenInput.addEventListener('keydown', (e) => {
    // Don't process special keys if mobile input overlay or Ctrl overlay is visible
    if (showMobileInput || showCtrlAlpha) {
      return;
    }

    // Prevent default for all keys to stop browser shortcuts
    if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key)) {
      e.preventDefault();
    }

    if (e.key === 'Enter') {
      sendInputText('enter');
    } else if (e.key === 'Backspace') {
      // Always send backspace to terminal
      sendInputText('backspace');
    } else if (e.key === 'Tab') {
      sendInputText('tab');
    } else if (e.key === 'Escape') {
      sendInputText('escape');
    }
  });

  // Handle focus/blur for quick keys visibility
  hiddenInput.addEventListener('focus', onFocus);
  hiddenInput.addEventListener('blur', onBlur);

  return hiddenInput;
}

export function setupVisualViewportHandler(
  onResize: (keyboardHeight: number) => void
): (() => void) | null {
  if (!window.visualViewport) return null;

  const handler = () => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keyboardHeight = window.innerHeight - viewport.height;
    onResize(keyboardHeight);
  };

  window.visualViewport.addEventListener('resize', handler);
  window.visualViewport.addEventListener('scroll', handler);

  return handler;
}

export function cleanupVisualViewportHandler(handler: (() => void) | null): void {
  if (!handler || !window.visualViewport) return;

  window.visualViewport.removeEventListener('resize', handler);
  window.visualViewport.removeEventListener('scroll', handler);
}

export function startFocusRetention(
  hiddenInput: HTMLInputElement,
  showQuickKeys: boolean,
  showMobileInput: boolean,
  showCtrlAlpha: boolean,
  disableFocusManagement: boolean
): number {
  return setInterval(() => {
    if (
      !disableFocusManagement &&
      showQuickKeys &&
      hiddenInput &&
      document.activeElement !== hiddenInput &&
      !showMobileInput &&
      !showCtrlAlpha
    ) {
      logger.log('Refocusing hidden input to maintain keyboard');
      hiddenInput.focus();
    }
  }, 300) as unknown as number;
}

export function adjustTextareaForKeyboard(
  textarea: HTMLTextAreaElement,
  controls: HTMLElement
): () => void {
  const adjustLayout = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const windowHeight = window.innerHeight;
    const keyboardHeight = windowHeight - viewportHeight;

    // If keyboard is visible (viewport height is significantly smaller)
    if (keyboardHeight > 100) {
      // Move controls above the keyboard
      controls.style.transform = `translateY(-${keyboardHeight}px)`;
      controls.style.transition = 'transform 0.3s ease';

      // Calculate available space to match closed keyboard layout
      const header = textarea
        .closest('.fixed')
        ?.querySelector('.flex.items-center.justify-between.p-4.border-b') as HTMLElement;
      const headerHeight = header?.offsetHeight || 60;
      const controlsHeight = controls?.offsetHeight || 120;

      // Calculate exact space to maintain same gap as when keyboard is closed
      const availableHeight = viewportHeight - headerHeight - controlsHeight;
      const inputArea = textarea.parentElement as HTMLElement;

      if (inputArea && availableHeight > 0) {
        // Set the input area to exactly fill the space, maintaining natural flex behavior
        inputArea.style.height = `${availableHeight}px`;
        inputArea.style.maxHeight = `${availableHeight}px`;
        inputArea.style.overflow = 'hidden';
        inputArea.style.display = 'flex';
        inputArea.style.flexDirection = 'column';
        inputArea.style.paddingBottom = '0px'; // Remove any extra padding

        // Let textarea use flex-1 behavior but constrain the container
        textarea.style.height = 'auto'; // Let it grow naturally
        textarea.style.maxHeight = 'none'; // Remove height constraints
        textarea.style.marginBottom = '8px'; // Keep consistent margin
        textarea.style.flex = '1'; // Fill available space
      }
    } else {
      // Reset position when keyboard is hidden
      controls.style.transform = 'translateY(0px)';
      controls.style.transition = 'transform 0.3s ease';

      // Reset textarea height and constraints to original flex behavior
      const inputArea = textarea.parentElement as HTMLElement;
      if (inputArea) {
        inputArea.style.height = '';
        inputArea.style.maxHeight = '';
        inputArea.style.overflow = '';
        inputArea.style.display = '';
        inputArea.style.flexDirection = '';
        inputArea.style.paddingBottom = '';
        textarea.style.height = '';
        textarea.style.maxHeight = '';
        textarea.style.flex = '';
      }
    }
  };

  // Listen for viewport changes (keyboard show/hide)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustLayout);
  }

  // Initial adjustment
  requestAnimationFrame(adjustLayout);

  // Return cleanup function
  return () => {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', adjustLayout);
    }
  };
}

export function focusMobileTextarea(textarea: HTMLTextAreaElement): void {
  // Multiple attempts to ensure focus on mobile
  textarea.focus();

  // iOS hack to show keyboard
  textarea.setAttribute('readonly', 'readonly');
  textarea.focus();
  setTimeout(() => {
    textarea.removeAttribute('readonly');
    textarea.focus();
    // Ensure cursor is at end
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, 100);
}

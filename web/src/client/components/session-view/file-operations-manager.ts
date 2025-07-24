/**
 * FileOperationsManager
 *
 * Handles all file-related operations for the session view including:
 * - Drag and drop file handling
 * - File upload functionality
 * - Clipboard paste handling for files/images
 * - Path insertion into terminal
 */
import type { Session } from '../../../shared/types.js';
import { createLogger } from '../../utils/logger.js';
import type { FilePicker } from '../file-picker.js';
import type { InputManager } from './input-manager.js';

const logger = createLogger('file-operations-manager');

export interface FileOperationsCallbacks {
  getSession: () => Session | null;
  getInputManager: () => InputManager | null;
  querySelector: (selector: string) => Element | null;
  setIsDragOver: (value: boolean) => void;
  setShowFileBrowser: (value: boolean) => void;
  setShowImagePicker: (value: boolean) => void;
  getIsMobile: () => boolean;
  getShowFileBrowser: () => boolean;
  getShowImagePicker: () => boolean;
  getShowMobileInput: () => boolean;
  dispatchEvent: (event: Event) => boolean;
  requestUpdate: () => void;
}

export class FileOperationsManager {
  private callbacks: FileOperationsCallbacks | null = null;
  private dragCounter = 0;
  private dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private globalDragOverTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound event handlers for cleanup
  private boundHandleDragOver: (e: DragEvent) => void;
  private boundHandleDragEnter: (e: DragEvent) => void;
  private boundHandleDragLeave: (e: DragEvent) => void;
  private boundHandleDrop: (e: DragEvent) => void;
  private boundHandlePaste: (e: ClipboardEvent) => void;
  private boundHandleDragEnd: (e: DragEvent) => void;
  private boundGlobalDragOver: (e: DragEvent) => void;

  constructor() {
    // Bind event handlers
    this.boundHandleDragOver = this.handleDragOver.bind(this);
    this.boundHandleDragEnter = this.handleDragEnter.bind(this);
    this.boundHandleDragLeave = this.handleDragLeave.bind(this);
    this.boundHandleDrop = this.handleDrop.bind(this);
    this.boundHandlePaste = this.handlePaste.bind(this);
    this.boundHandleDragEnd = this.handleDragEnd.bind(this);
    this.boundGlobalDragOver = this.handleGlobalDragOver.bind(this);
  }

  setCallbacks(callbacks: FileOperationsCallbacks): void {
    this.callbacks = callbacks;
  }

  setupEventListeners(element: HTMLElement): void {
    element.addEventListener('dragover', this.boundHandleDragOver);
    element.addEventListener('dragenter', this.boundHandleDragEnter);
    element.addEventListener('dragleave', this.boundHandleDragLeave);
    element.addEventListener('drop', this.boundHandleDrop);
    document.addEventListener('paste', this.boundHandlePaste);
    // Add dragend to handle cancelled drag operations
    document.addEventListener('dragend', this.boundHandleDragEnd);
    // Add global dragover to detect when dragging outside our element
    document.addEventListener('dragover', this.boundGlobalDragOver, true);
  }

  removeEventListeners(element: HTMLElement): void {
    element.removeEventListener('dragover', this.boundHandleDragOver);
    element.removeEventListener('dragenter', this.boundHandleDragEnter);
    element.removeEventListener('dragleave', this.boundHandleDragLeave);
    element.removeEventListener('drop', this.boundHandleDrop);
    document.removeEventListener('paste', this.boundHandlePaste);
    document.removeEventListener('dragend', this.boundHandleDragEnd);
    document.removeEventListener('dragover', this.boundGlobalDragOver, true);

    // Clear any pending timers
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }
    if (this.globalDragOverTimer) {
      clearTimeout(this.globalDragOverTimer);
      this.globalDragOverTimer = null;
    }

    // Reset drag state
    this.dragCounter = 0;
    if (this.callbacks) {
      this.callbacks.setIsDragOver(false);
    }
  }

  // File browser methods
  openFileBrowser(): void {
    if (this.callbacks) {
      this.callbacks.setShowFileBrowser(true);
    }
  }

  closeFileBrowser(): void {
    if (this.callbacks) {
      this.callbacks.setShowFileBrowser(false);
    }
  }

  // File picker methods
  openFilePicker(): void {
    if (!this.callbacks) return;

    if (!this.callbacks.getIsMobile()) {
      // On desktop, directly open the file picker without showing the dialog
      const filePicker = this.callbacks.querySelector('file-picker') as FilePicker | null;
      if (filePicker && typeof filePicker.openFilePicker === 'function') {
        filePicker.openFilePicker();
      }
    } else {
      // On mobile, show the file picker dialog
      this.callbacks.setShowImagePicker(true);
    }
  }

  closeFilePicker(): void {
    if (this.callbacks) {
      this.callbacks.setShowImagePicker(false);
    }
  }

  // Image operations
  selectImage(): void {
    if (!this.callbacks) return;

    const filePicker = this.callbacks.querySelector('file-picker') as FilePicker | null;
    if (filePicker && typeof filePicker.openImagePicker === 'function') {
      filePicker.openImagePicker();
    } else {
      logger.error('File picker component not found or openImagePicker method not available');
    }
  }

  openCamera(): void {
    if (!this.callbacks) return;

    const filePicker = this.callbacks.querySelector('file-picker') as FilePicker | null;
    if (filePicker && typeof filePicker.openCamera === 'function') {
      filePicker.openCamera();
    } else {
      logger.error('File picker component not found or openCamera method not available');
    }
  }

  async pasteImage(): Promise<void> {
    if (!this.callbacks) return;

    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const clipboardItem of clipboardItems) {
        const imageTypes = clipboardItem.types.filter((type) => type.startsWith('image/'));

        for (const imageType of imageTypes) {
          const blob = await clipboardItem.getType(imageType);
          const file = new File([blob], `pasted-image.${imageType.split('/')[1]}`, {
            type: imageType,
          });

          await this.uploadFile(file);
          logger.log(`Successfully pasted image from clipboard`);
          return;
        }
      }

      // No image found in clipboard
      logger.log('No image found in clipboard');
      this.callbacks.dispatchEvent(
        new CustomEvent('error', {
          detail: 'No image found in clipboard',
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      logger.error('Failed to paste image from clipboard:', error);
      this.callbacks.dispatchEvent(
        new CustomEvent('error', {
          detail: 'Failed to access clipboard. Please check permissions.',
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  // File selection handling
  async handleFileSelected(path: string): Promise<void> {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    const inputManager = this.callbacks.getInputManager();

    if (!path || !session || !inputManager) return;

    // Close the file picker
    this.callbacks.setShowImagePicker(false);

    // Escape the path for shell use (wrap in quotes if it contains spaces)
    const escapedPath = path.includes(' ') ? `"${path}"` : path;

    // Send the path to the terminal
    await inputManager.sendInputText(escapedPath);

    logger.log(`inserted file path into terminal: ${escapedPath}`);
  }

  handleFileError(error: string): void {
    if (!this.callbacks) return;

    logger.error('File picker error:', error);
    this.callbacks.dispatchEvent(new CustomEvent('error', { detail: error }));
  }

  // Path insertion
  async insertPath(path: string, type: string): Promise<void> {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();

    if (!path || !session) return;

    // Escape the path for shell use (wrap in quotes if it contains spaces)
    const escapedPath = path.includes(' ') ? `"${path}"` : path;

    // Send the path to the terminal
    const inputManager = this.callbacks.getInputManager();
    if (inputManager) {
      await inputManager.sendInputText(escapedPath);
    }

    logger.log(`inserted ${type} path into terminal: ${escapedPath}`);
  }

  // Reset drag state
  resetDragState(): void {
    // Clear any pending drag leave timer
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }

    this.dragCounter = 0;
    if (this.callbacks) {
      this.callbacks.setIsDragOver(false);
    }
  }

  // Drag & Drop handlers
  handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Clear any pending timers
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }
    if (this.globalDragOverTimer) {
      clearTimeout(this.globalDragOverTimer);
      this.globalDragOverTimer = null;
    }

    // Check if the drag contains files
    if (e.dataTransfer?.types.includes('Files') && this.callbacks) {
      this.callbacks.setIsDragOver(true);
    }
  }

  handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Clear any pending drag leave timer
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }

    this.dragCounter++;

    // Check if the drag contains files
    if (e.dataTransfer?.types.includes('Files') && this.callbacks) {
      this.callbacks.setIsDragOver(true);
    }
  }

  handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.dragCounter--;

    // Use a timer to handle the drag leave to avoid flicker when moving between elements
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
    }

    this.dragLeaveTimer = setTimeout(() => {
      // Check if we're really outside the drop zone
      if (this.dragCounter <= 0 && this.callbacks) {
        this.callbacks.setIsDragOver(false);
        this.dragCounter = 0; // Reset to 0 to handle any counting inconsistencies
      }
    }, 100); // Small delay to handle rapid enter/leave events
  }

  async handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    // Clear any pending drag leave timer
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }

    if (this.callbacks) {
      this.callbacks.setIsDragOver(false);
    }
    this.dragCounter = 0; // Reset counter on drop

    const files = Array.from(e.dataTransfer?.files || []);

    if (files.length === 0) {
      logger.warn('No files found in drop');
      return;
    }

    // Upload all files sequentially
    for (const file of files) {
      try {
        await this.uploadFile(file);
        logger.log(`Successfully uploaded file: ${file.name}`);
      } catch (error) {
        logger.error(`Failed to upload file: ${file.name}`, error);
      }
    }
  }

  handleDragEnd(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Clear any pending drag leave timer
    if (this.dragLeaveTimer) {
      clearTimeout(this.dragLeaveTimer);
      this.dragLeaveTimer = null;
    }

    // Reset drag state when drag operation ends (e.g., user cancels with ESC)
    this.dragCounter = 0;
    if (this.callbacks) {
      this.callbacks.setIsDragOver(false);
    }

    logger.debug('Drag operation ended, resetting drag state');
  }

  handleGlobalDragOver(_e: DragEvent): void {
    // Clear any existing timer
    if (this.globalDragOverTimer) {
      clearTimeout(this.globalDragOverTimer);
      this.globalDragOverTimer = null;
    }

    // If we have an active drag state, set a timer to clear it if no drag events occur
    if (this.callbacks && this.dragCounter > 0) {
      this.globalDragOverTimer = setTimeout(() => {
        // If no drag events have occurred for 500ms, assume the drag left the window
        this.dragCounter = 0;
        if (this.callbacks) {
          this.callbacks.setIsDragOver(false);
        }
        logger.debug('No drag events detected, clearing drag state');
      }, 500);
    }
  }

  // Paste handler
  async handlePaste(e: ClipboardEvent): Promise<void> {
    if (!this.callbacks) return;

    // Check if paste handling should be enabled
    const showFileBrowser = this.callbacks.getShowFileBrowser();
    const showImagePicker = this.callbacks.getShowImagePicker();
    const showMobileInput = this.callbacks.getShowMobileInput();

    if (!this.shouldHandlePaste(showFileBrowser, showImagePicker, showMobileInput)) {
      return; // Don't handle paste when modals are open
    }

    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter((item) => item.kind === 'file');

    if (fileItems.length === 0) {
      return; // Let normal paste handling continue
    }

    e.preventDefault(); // Prevent default paste behavior for files

    // Upload all pasted files
    for (const fileItem of fileItems) {
      const file = fileItem.getAsFile();
      if (file) {
        try {
          await this.uploadFile(file);
          logger.log(`Successfully pasted and uploaded file: ${file.name}`);
        } catch (error) {
          logger.error(`Failed to upload pasted file: ${file?.name}`, error);
        }
      }
    }
  }

  // File upload
  private async uploadFile(file: File): Promise<void> {
    if (!this.callbacks) return;

    try {
      // Get the file picker component and use its upload method
      const filePicker = this.callbacks.querySelector('file-picker') as FilePicker | null;
      if (filePicker && typeof filePicker.uploadFile === 'function') {
        await filePicker.uploadFile(file);
      } else {
        logger.error('File picker component not found or upload method not available');
      }
    } catch (error) {
      logger.error('Failed to upload dropped/pasted file:', error);
      this.callbacks.dispatchEvent(
        new CustomEvent('error', {
          detail: error instanceof Error ? error.message : 'Failed to upload file',
        })
      );
    }
  }

  // Check if paste handling should be enabled
  shouldHandlePaste(
    showFileBrowser: boolean,
    showImagePicker: boolean,
    showMobileInput: boolean
  ): boolean {
    return !showFileBrowser && !showImagePicker && !showMobileInput;
  }
}

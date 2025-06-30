/**
 * File Picker Component
 *
 * Allows users to pick files from various sources,
 * upload them to the server, and send the path to the terminal.
 *
 * @fires file-selected - When a file is uploaded and ready (detail: { path: string })
 * @fires file-error - When an error occurs (detail: string)
 */

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { authClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('file-picker');

interface UploadResponse {
  success: boolean;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  path: string;
  relativePath: string;
  error?: string;
}

@customElement('file-picker')
export class FilePicker extends LitElement {
  // Disable shadow DOM for Tailwind compatibility
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Boolean }) showPathOption = true; // Whether to show "Send path to terminal" option
  @state() private uploading = false;
  @state() private uploadProgress = 0;

  private fileInput: HTMLInputElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.createFileInput();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.fileInput) {
      this.fileInput.remove();
      this.fileInput = null;
    }
  }

  private createFileInput() {
    // Create a hidden file input element
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '*/*';
    this.fileInput.capture = 'environment'; // Use rear camera by default on mobile
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    document.body.appendChild(this.fileInput);
  }

  private async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      await this.uploadFileToServer(file);
    } catch (error) {
      logger.error('Failed to upload file:', error);
      this.dispatchEvent(
        new CustomEvent('file-error', {
          detail: error instanceof Error ? error.message : 'Failed to upload file',
        })
      );
    }

    // Reset the input value so the same file can be selected again
    input.value = '';
  }

  /**
   * Public method to upload a file programmatically (for drag & drop, paste)
   */
  async uploadFile(file: File): Promise<void> {
    return this.uploadFileToServer(file);
  }

  private async uploadFileToServer(file: File): Promise<void> {
    this.uploading = true;
    this.uploadProgress = 0;

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Create XMLHttpRequest for upload progress
      const xhr = new XMLHttpRequest();

      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            this.uploadProgress = (e.loaded / e.total) * 100;
          }
        });

        xhr.addEventListener('load', () => {
          this.uploading = false;

          if (xhr.status === 200) {
            try {
              const response: UploadResponse = JSON.parse(xhr.responseText);
              if (response.success) {
                logger.log(`File uploaded successfully: ${response.filename}`);
                this.dispatchEvent(
                  new CustomEvent('file-selected', {
                    detail: {
                      path: response.path,
                      relativePath: response.relativePath,
                      filename: response.filename,
                      originalName: response.originalName,
                      size: response.size,
                      mimetype: response.mimetype,
                    },
                  })
                );
                resolve();
              } else {
                reject(new Error(response.error || 'Upload failed'));
              }
            } catch (_error) {
              reject(new Error('Invalid response from server'));
            }
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          this.uploading = false;
          reject(new Error('Upload failed'));
        });

        xhr.addEventListener('abort', () => {
          this.uploading = false;
          reject(new Error('Upload aborted'));
        });

        xhr.open('POST', '/api/files/upload');

        // Add auth headers
        const authHeaders = authClient.getAuthHeader();
        for (const [key, value] of Object.entries(authHeaders)) {
          xhr.setRequestHeader(key, value);
        }

        xhr.send(formData);
      });
    } catch (error) {
      this.uploading = false;
      throw error;
    }
  }

  private handleFileClick() {
    if (!this.fileInput) {
      this.createFileInput();
    }

    if (this.fileInput) {
      // Remove capture attribute for general file selection
      this.fileInput.removeAttribute('capture');
      this.fileInput.click();
    }
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('file-cancel'));
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click=${this.handleCancel}>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 m-4 max-w-sm w-full" @click=${(e: Event) => e.stopPropagation()}>
          <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            Select File
          </h3>
          
          ${
            this.uploading
              ? html`
            <div class="mb-4">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm text-gray-600 dark:text-gray-400">Uploading...</span>
                <span class="text-sm text-gray-600 dark:text-gray-400">${Math.round(this.uploadProgress)}%</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  class="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                  style="width: ${this.uploadProgress}%"
                ></div>
              </div>
            </div>
          `
              : html`
            <div class="space-y-3">
              <button
                @click=${this.handleFileClick}
                class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition-colors"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <span>Choose File</span>
              </button>
            </div>
          `
          }
          
          <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <button
              @click=${this.handleCancel}
              class="w-full bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
              ?disabled=${this.uploading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

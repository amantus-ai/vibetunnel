/**
 * File Icons Utility
 *
 * Provides icon rendering for different file types and git statuses.
 * Icons are rendered as Lit template results using inline SVGs.
 */
import { html, type TemplateResult } from 'lit';

export type FileType = 'file' | 'directory';
export type GitStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';

/**
 * Get the appropriate icon for a file based on its name and type
 */
export function getFileIcon(fileName: string, type: FileType): TemplateResult {
  if (type === 'directory') {
    return html`
      <svg class="w-5 h-5 text-status-info" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    `;
  }

  const ext = fileName.split('.').pop()?.toLowerCase();

  // Icon map for different file extensions
  const iconMap: Record<string, TemplateResult> = {
    // JavaScript/TypeScript
    js: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3a1 1 0 011 1v2a1 1 0 11-2 0V9h-.5a.5.5 0 000 1H10a1 1 0 110 2H8.5A2.5 2.5 0 016 9.5V8a1 1 0 011-1h3z"
      />
    </svg>`,
    mjs: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3a1 1 0 011 1v2a1 1 0 11-2 0V9h-.5a.5.5 0 000 1H10a1 1 0 110 2H8.5A2.5 2.5 0 016 9.5V8a1 1 0 011-1h3z"
      />
    </svg>`,
    cjs: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3a1 1 0 011 1v2a1 1 0 11-2 0V9h-.5a.5.5 0 000 1H10a1 1 0 110 2H8.5A2.5 2.5 0 016 9.5V8a1 1 0 011-1h3z"
      />
    </svg>`,
    ts: html`<svg class="w-5 h-5 text-status-info" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3h4v1h-1v4a1 1 0 11-2 0V8h-1a1 1 0 110-2zM6 7h2v6H6V7z"
      />
    </svg>`,
    tsx: html`<svg class="w-5 h-5 text-status-info" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3h4v1h-1v4a1 1 0 11-2 0V8h-1a1 1 0 110-2zM6 7h2v6H6V7z"
      />
    </svg>`,
    jsx: html`<svg class="w-5 h-5 text-status-info" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm2 6a2 2 0 114 0 2 2 0 01-4 0zm6-2a2 2 0 104 0 2 2 0 00-4 0z"
      />
    </svg>`,

    // Web files
    html: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm1 2h10v2H5V5zm0 4h10v2H5V9zm0 4h6v2H5v-2z"
      />
    </svg>`,
    htm: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm1 2h10v2H5V5zm0 4h10v2H5V9zm0 4h6v2H5v-2z"
      />
    </svg>`,
    css: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm4 6a2 2 0 100 4 2 2 0 000-4zm4-2a2 2 0 100 4 2 2 0 000-4z"
      />
    </svg>`,
    scss: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm4 6a2 2 0 100 4 2 2 0 000-4zm4-2a2 2 0 100 4 2 2 0 000-4z"
      />
    </svg>`,
    sass: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm4 6a2 2 0 100 4 2 2 0 000-4zm4-2a2 2 0 100 4 2 2 0 000-4z"
      />
    </svg>`,
    less: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm4 6a2 2 0 100 4 2 2 0 000-4zm4-2a2 2 0 100 4 2 2 0 000-4z"
      />
    </svg>`,

    // Config and data files
    json: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    jsonc: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    xml: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    yaml: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    yml: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,

    // Documentation
    md: html`<svg class="w-5 h-5 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm2 0v8h12V6H4zm2 2h8v1H6V8zm0 2h8v1H6v-1zm0 2h6v1H6v-1z"
      />
    </svg>`,
    markdown: html`<svg class="w-5 h-5 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm2 0v8h12V6H4zm2 2h8v1H6V8zm0 2h8v1H6v-1zm0 2h6v1H6v-1z"
      />
    </svg>`,
    txt: html`<svg class="w-5 h-5 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm0 2h12v10H4V5zm2 2v6h8V7H6zm2 1h4v1H8V8zm0 2h4v1H8v-1z"
      />
    </svg>`,
    text: html`<svg class="w-5 h-5 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm0 2h12v10H4V5zm2 2v6h8V7H6zm2 1h4v1H8V8zm0 2h4v1H8v-1z"
      />
    </svg>`,

    // Images
    png: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    jpg: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    jpeg: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    gif: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    webp: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    bmp: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
      />
    </svg>`,
    svg: html`<svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm6 6L8 7l2 2 2-2-2 2 2 2-2-2-2 2 2-2z"
      />
    </svg>`,

    // Archives
    zip: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    tar: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    gz: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    rar: html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,
    '7z': html`<svg class="w-5 h-5 text-status-warning" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>`,

    // Documents
    pdf: html`<svg class="w-5 h-5 text-status-error" fill="currentColor" viewBox="0 0 20 20">
      <path d="M4 18h12V6h-4V2H4v16zm8-14v4h4l-4-4zM6 10h8v1H6v-1zm0 2h8v1H6v-1zm0 2h6v1H6v-1z" />
    </svg>`,

    // Scripts
    sh: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 000 2h11.586l-2.293 2.293a1 1 0 101.414 1.414L17.414 6H19a1 1 0 100-2H3zM3 11a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 101.414 1.414L9.414 13H11a1 1 0 100-2H3z"
      />
    </svg>`,
    bash: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 000 2h11.586l-2.293 2.293a1 1 0 101.414 1.414L17.414 6H19a1 1 0 100-2H3zM3 11a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 101.414 1.414L9.414 13H11a1 1 0 100-2H3z"
      />
    </svg>`,
    zsh: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 000 2h11.586l-2.293 2.293a1 1 0 101.414 1.414L17.414 6H19a1 1 0 100-2H3zM3 11a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 101.414 1.414L9.414 13H11a1 1 0 100-2H3z"
      />
    </svg>`,
    fish: html`<svg class="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 000 2h11.586l-2.293 2.293a1 1 0 101.414 1.414L17.414 6H19a1 1 0 100-2H3zM3 11a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 101.414 1.414L9.414 13H11a1 1 0 100-2H3z"
      />
    </svg>`,
  };

  // Return the icon if found, otherwise return default file icon
  return iconMap[ext || ''] || getDefaultFileIcon();
}

/**
 * Get the default file icon
 */
export function getDefaultFileIcon(): TemplateResult {
  return html`
    <svg class="w-5 h-5 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
        clip-rule="evenodd"
      />
    </svg>
  `;
}

/**
 * Get the parent directory icon
 */
export function getParentDirectoryIcon(): TemplateResult {
  return html`
    <svg class="w-5 h-5 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
        clip-rule="evenodd"
      />
    </svg>
  `;
}

/**
 * Render a git status badge
 */
export function renderGitStatusBadge(status?: GitStatus): TemplateResult | string {
  if (!status || status === 'unchanged') return '';

  const labels: Record<GitStatus, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    untracked: '?',
    unchanged: '',
  };

  const colorClasses: Record<GitStatus, string> = {
    modified: 'bg-status-warning/20 text-status-warning',
    added: 'bg-status-success/20 text-status-success',
    deleted: 'bg-status-error/20 text-status-error',
    untracked: 'bg-text-dim/20 text-text-dim',
    unchanged: '',
  };

  return html`
    <span class="text-xs px-1.5 py-0.5 rounded font-bold ${colorClasses[status]}">
      ${labels[status]}
    </span>
  `;
}

/**
 * Icons for UI elements
 */
export const UIIcons = {
  close: html`
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  `,

  folder: html`
    <svg class="w-6 h-6 text-status-info" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  `,

  git: html`
    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
      <path
        fill-rule="evenodd"
        d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"
      />
    </svg>
  `,

  preview: html`
    <svg class="w-16 h-16 mb-4 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        fill-rule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
        clip-rule="evenodd"
      />
    </svg>
  `,

  binary: html`
    <svg class="w-16 h-16 mb-4 text-text-dim" fill="currentColor" viewBox="0 0 20 20">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
      />
    </svg>
  `,
};

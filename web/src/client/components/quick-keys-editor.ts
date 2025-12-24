/**
 * Quick Keys Editor Component
 *
 * Modal component for editing quick keys via drag and drop.
 * Supports reordering keys within/between rows and hiding keys.
 */
import { css, html, LitElement, type PropertyValues, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Z_INDEX } from '../utils/constants.js';
import {
  DEFAULT_LAYOUT,
  QUICK_KEY_DEFINITIONS,
  type QuickKeyDefinition,
  type QuickKeyId,
  quickKeysPreferencesManager,
} from '../utils/quick-keys-preferences.js';

// Map from key ID to definition for quick lookups
const KEY_DEFINITION_MAP = new Map<string, QuickKeyDefinition>(
  QUICK_KEY_DEFINITIONS.map((def) => [def.key, def as QuickKeyDefinition])
);

@customElement('quick-keys-editor')
export class QuickKeysEditor extends LitElement {
  @property({ type: Boolean }) isOpen = false;

  // Draft layout - array of rows, each row is array of key IDs
  @state() private draftRows: QuickKeyId[][] = [];
  @state() private draggedKey: QuickKeyId | null = null;
  @state() private dropTarget: { row: number; index: number } | 'hidden' | null = null;

  private dragGhost: HTMLElement | null = null;
  private boundHandleDragMove: (e: TouchEvent | MouseEvent) => void;
  private boundHandleDragEnd: (e: TouchEvent | MouseEvent) => void;

  constructor() {
    super();
    this.boundHandleDragMove = this.handleDragMove.bind(this);
    this.boundHandleDragEnd = this.handleDragEnd.bind(this);
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (changedProperties.has('isOpen') && this.isOpen) {
      // Clone current layout for editing
      this.draftRows = quickKeysPreferencesManager.getLayout();
    }
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('close'));
    this.draggedKey = null;
    this.dropTarget = null;
  }

  private async save(): Promise<void> {
    await quickKeysPreferencesManager.setLayout(this.draftRows);
    this.close();
  }

  private reset(): void {
    this.draftRows = structuredClone(DEFAULT_LAYOUT);
  }

  private getHiddenKeys(): QuickKeyDefinition[] {
    const usedKeys = new Set(this.draftRows.flat());
    return QUICK_KEY_DEFINITIONS.filter((d) => !usedKeys.has(d.key)) as QuickKeyDefinition[];
  }

  private getDefinition(key: QuickKeyId): QuickKeyDefinition {
    const def = KEY_DEFINITION_MAP.get(key);
    if (!def) {
      throw new Error(`Unknown key: ${key}`);
    }
    return def;
  }

  private handleDragStart(e: TouchEvent | MouseEvent, key: QuickKeyId) {
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    this.draggedKey = key;

    // Create ghost element
    const tile = e.currentTarget as HTMLElement;
    this.dragGhost = tile.cloneNode(true) as HTMLElement;
    this.dragGhost.classList.add('drag-ghost');
    this.dragGhost.style.left = `${clientX - 30}px`;
    this.dragGhost.style.top = `${clientY - 20}px`;
    document.body.appendChild(this.dragGhost);

    // For mouse: add document-level listeners
    if (!('touches' in e)) {
      document.addEventListener('mousemove', this.boundHandleDragMove);
      document.addEventListener('mouseup', this.boundHandleDragEnd);
    }
  }

  private handleDragMove(e: TouchEvent | MouseEvent) {
    if (!this.draggedKey || !this.dragGhost) return;
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    this.dragGhost.style.left = `${clientX - 30}px`;
    this.dragGhost.style.top = `${clientY - 20}px`;
    this.dropTarget = this.findDropTarget(clientX, clientY);
  }

  private handleDragEnd(e: TouchEvent | MouseEvent) {
    if (!this.draggedKey) return;
    e.preventDefault();

    if (this.dropTarget === 'hidden') {
      this.removeKeyFromRows(this.draggedKey);
    } else if (this.dropTarget) {
      this.moveKey(this.draggedKey, this.dropTarget.row, this.dropTarget.index);
    }

    this.cleanupDrag();
  }

  private handleDragCancel() {
    this.cleanupDrag();
  }

  private cleanupDrag() {
    document.removeEventListener('mousemove', this.boundHandleDragMove);
    document.removeEventListener('mouseup', this.boundHandleDragEnd);
    this.dragGhost?.remove();
    this.dragGhost = null;
    this.draggedKey = null;
    this.dropTarget = null;
  }

  private findDropTarget(x: number, y: number): { row: number; index: number } | 'hidden' | null {
    const hiddenSection = this.renderRoot.querySelector('.hidden-section');
    if (hiddenSection) {
      const rect = hiddenSection.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return 'hidden';
      }
    }

    const rowElements = this.renderRoot.querySelectorAll('.key-row');
    for (const rowEl of rowElements) {
      const rect = rowEl.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;

      const row = Number.parseInt(rowEl.getAttribute('data-row') || '0', 10);
      const tiles = rowEl.querySelectorAll('.key-tile');

      for (let i = 0; i < tiles.length; i++) {
        const tileRect = tiles[i].getBoundingClientRect();
        if (x < tileRect.left + tileRect.width / 2) {
          return { row, index: i };
        }
      }
      return { row, index: tiles.length };
    }

    return null;
  }

  /** Remove key from all rows (hide it) */
  private removeKeyFromRows(key: QuickKeyId) {
    this.draftRows = this.draftRows.map((row) => row.filter((k) => k !== key));
    this.requestUpdate();
  }

  /** Move key to new position */
  private moveKey(key: QuickKeyId, toRow: number, toIndex: number) {
    // Remove from current position
    let fromRow = -1;
    let fromIndex = -1;
    for (let r = 0; r < this.draftRows.length; r++) {
      const i = this.draftRows[r].indexOf(key);
      if (i !== -1) {
        fromRow = r;
        fromIndex = i;
        break;
      }
    }

    // Create a mutable copy
    const newRows = this.draftRows.map((row) => [...row]);

    // If not found in rows (was hidden), just insert
    if (fromRow === -1) {
      newRows[toRow].splice(toIndex, 0, key);
    } else {
      // Remove from source
      newRows[fromRow].splice(fromIndex, 1);
      // Adjust target index if same row and moving forward
      const adjustedIndex = fromRow === toRow && fromIndex < toIndex ? toIndex - 1 : toIndex;
      newRows[toRow].splice(adjustedIndex, 0, key);
    }

    this.draftRows = newRows;
    this.requestUpdate();
  }

  static styles = css`
    .editor-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: ${unsafeCSS(Z_INDEX.QUICK_KEYS_EDITOR)};
    }

    .editor-modal {
      background: rgb(var(--color-bg-primary));
      border-radius: 12px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      padding: 16px;
    }

    .editor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .editor-header h2 {
      color: rgb(var(--color-text-primary));
      font-size: 18px;
      font-weight: bold;
      margin: 0;
    }

    .close-btn {
      background: none;
      border: none;
      color: rgb(var(--color-text-muted));
      cursor: pointer;
      font-size: 20px;
      padding: 4px 8px;
    }

    .close-btn:hover {
      color: rgb(var(--color-text-primary));
    }

    .editor-hint {
      color: rgb(var(--color-text-muted));
      font-size: 14px;
      margin-bottom: 16px;
    }

    .key-row {
      margin-bottom: 12px;
      padding: 8px;
      border-radius: 8px;
      background: rgb(var(--color-bg-secondary));
    }

    .key-row.drop-active {
      outline: 2px dashed rgb(var(--color-primary));
    }

    .row-label {
      font-size: 12px;
      color: rgb(var(--color-text-muted));
      margin-bottom: 4px;
      display: block;
    }

    .key-tiles {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }

    .key-tile {
      padding: 8px 12px;
      background: rgb(var(--color-bg-tertiary));
      border: 1px solid rgb(var(--color-border-base));
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      cursor: grab;
      user-select: none;
      touch-action: none;
      color: rgb(var(--color-text-primary));
    }

    .key-tile.dragging {
      opacity: 0.3;
    }

    .drop-indicator {
      width: 3px;
      height: 32px;
      background: transparent;
      border-radius: 2px;
      transition: background 0.15s;
    }

    .drop-indicator.active {
      background: rgb(var(--color-primary));
    }

    .hidden-section {
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      background: rgb(var(--color-bg-secondary));
      border: 1px dashed rgb(var(--color-border-base));
      min-height: 60px;
    }

    .hidden-section.drop-active {
      border-color: rgb(var(--color-status-error));
      background: rgb(var(--color-status-error) / 0.1);
    }

    .hidden-section h3 {
      font-size: 12px;
      color: rgb(var(--color-text-muted));
      margin: 0 0 8px 0;
    }

    .hidden-keys {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .empty-hint {
      color: rgb(var(--color-text-muted));
      font-size: 12px;
      font-style: italic;
    }

    .editor-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid rgb(var(--color-border-base));
    }

    .btn-secondary {
      background: rgb(var(--color-bg-tertiary));
      border: 1px solid rgb(var(--color-border-base));
      color: rgb(var(--color-text-primary));
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }

    .btn-secondary:hover {
      background: rgb(var(--color-bg-secondary));
    }

    .btn-primary {
      background: rgb(var(--color-primary));
      border: 1px solid rgb(var(--color-primary));
      color: rgb(var(--color-text-bright));
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }

    .btn-primary:hover {
      background: rgb(var(--color-primary-hover));
    }

    .drag-ghost {
      position: fixed;
      pointer-events: none;
      z-index: 1001;
      opacity: 0.9;
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 8px 12px;
      background: rgb(var(--color-bg-tertiary));
      border: 1px solid rgb(var(--color-border-base));
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: rgb(var(--color-text-primary));
    }
  `;

  render() {
    if (!this.isOpen) return html``;

    const hidden = this.getHiddenKeys();

    return html`
      <div class="editor-overlay" @click=${this.close}>
        <div class="editor-modal" @click=${(e: Event) => e.stopPropagation()}>
          <div class="editor-header">
            <h2>Edit Quick Keys</h2>
            <button class="close-btn" @click=${this.close}>\u2715</button>
          </div>

          <p class="editor-hint">Drag to reorder. Drag out to hide.</p>

          <div class="rows-container">
            ${this.draftRows.map((row, rowIndex) => this.renderRow(rowIndex, row))}
          </div>

          <div class="hidden-section ${this.dropTarget === 'hidden' ? 'drop-active' : ''}">
            <h3>Hidden</h3>
            <div class="hidden-keys">
              ${
                hidden.length === 0
                  ? html`<span class="empty-hint">Drag keys here to hide</span>`
                  : hidden.map((def) => this.renderKeyTile(def.key))
              }
            </div>
          </div>

          <div class="editor-footer">
            <button class="btn-secondary" @click=${this.reset}>Reset to Defaults</button>
            <button class="btn-primary" @click=${this.save}>Done</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRow(rowIndex: number, keys: QuickKeyId[]) {
    const isDropTarget =
      this.dropTarget && this.dropTarget !== 'hidden' && this.dropTarget.row === rowIndex;

    return html`
      <div class="key-row ${isDropTarget ? 'drop-active' : ''}" data-row=${rowIndex}>
        <span class="row-label">Row ${rowIndex + 1}</span>
        <div class="key-tiles">
          ${keys.map(
            (key, i) => html`
              ${this.renderDropIndicator(rowIndex, i)} ${this.renderKeyTile(key)}
            `
          )}
          ${this.renderDropIndicator(rowIndex, keys.length)}
        </div>
      </div>
    `;
  }

  private renderKeyTile(key: QuickKeyId) {
    const def = this.getDefinition(key);
    const isDragging = this.draggedKey === key;

    return html`
      <div
        class="key-tile ${isDragging ? 'dragging' : ''}"
        data-key=${key}
        @touchstart=${(e: TouchEvent) => this.handleDragStart(e, key)}
        @touchmove=${this.boundHandleDragMove}
        @touchend=${this.boundHandleDragEnd}
        @touchcancel=${() => this.handleDragCancel()}
        @mousedown=${(e: MouseEvent) => this.handleDragStart(e, key)}
      >
        ${def.label}
      </div>
    `;
  }

  private renderDropIndicator(row: number, index: number) {
    const isActive =
      this.dropTarget &&
      this.dropTarget !== 'hidden' &&
      this.dropTarget.row === row &&
      this.dropTarget.index === index;

    return html`<div class="drop-indicator ${isActive ? 'active' : ''}"></div>`;
  }
}

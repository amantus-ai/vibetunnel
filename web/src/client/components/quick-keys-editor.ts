/**
 * Quick Keys Editor Component
 *
 * Modal component for editing quick keys via drag and drop.
 * Supports reordering keys within/between rows and hiding keys.
 * Features live reordering as you drag.
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) isOpen = false;

  // Draft layout - array of rows, each row is array of key IDs
  @state() private draftRows: QuickKeyId[][] = [];
  @state() private draggedKey: QuickKeyId | null = null;
  @state() private isDraggingOverHidden = false;

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
    this.cleanupDrag();
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
    this.dragGhost.className =
      'fixed pointer-events-none z-[1100] opacity-90 scale-110 shadow-lg px-3 py-2 bg-bg-tertiary border border-border rounded-md font-mono text-xs text-primary';
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

    // Check if over hidden section
    const hiddenSection = this.querySelector('.hidden-section');
    if (hiddenSection) {
      const rect = hiddenSection.getBoundingClientRect();
      const isOverHidden =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;

      if (isOverHidden !== this.isDraggingOverHidden) {
        this.isDraggingOverHidden = isOverHidden;
      }

      if (isOverHidden) {
        return; // Don't do live reordering when over hidden section
      }
    }

    // Find drop target and do live reordering
    const dropTarget = this.findDropTarget(clientX, clientY);
    if (dropTarget) {
      this.liveReorder(this.draggedKey, dropTarget.row, dropTarget.index);
    }
  }

  private handleDragEnd(e: TouchEvent | MouseEvent) {
    if (!this.draggedKey) return;
    e.preventDefault();

    // If dropped on hidden section, remove the key
    if (this.isDraggingOverHidden) {
      this.removeKeyFromRows(this.draggedKey);
    }
    // Otherwise, the live reordering already placed it in the right spot

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
    this.isDraggingOverHidden = false;
  }

  private findDropTarget(x: number, y: number): { row: number; index: number } | null {
    const rowElements = this.querySelectorAll('.key-row');
    for (const rowEl of rowElements) {
      const rect = rowEl.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;

      const row = Number.parseInt(rowEl.getAttribute('data-row') || '0', 10);
      const tiles = rowEl.querySelectorAll('.key-tile:not(.dragging)');

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

  /** Live reorder - move key to new position during drag */
  private liveReorder(key: QuickKeyId, toRow: number, toIndex: number) {
    // Find current position
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

    // If not found (was hidden), insert at target
    if (fromRow === -1) {
      const newRows = this.draftRows.map((row) => [...row]);
      newRows[toRow].splice(toIndex, 0, key);
      this.draftRows = newRows;
      return;
    }

    // Calculate effective target index (accounting for the dragged item)
    let effectiveIndex = toIndex;
    if (fromRow === toRow && fromIndex < toIndex) {
      effectiveIndex = toIndex; // Will be adjusted after removal
    }

    // Skip if already in the right place
    if (fromRow === toRow) {
      // Account for the removal shifting indices
      const adjustedTarget = fromIndex < toIndex ? toIndex - 1 : toIndex;
      if (fromIndex === adjustedTarget) {
        return; // Already in place
      }
    }

    // Create a mutable copy and move
    const newRows = this.draftRows.map((row) => [...row]);
    newRows[fromRow].splice(fromIndex, 1);

    // Adjust target index if same row and moving forward
    if (fromRow === toRow && fromIndex < toIndex) {
      effectiveIndex = toIndex - 1;
    }

    newRows[toRow].splice(effectiveIndex, 0, key);
    this.draftRows = newRows;
  }

  render() {
    if (!this.isOpen) return html``;

    const hidden = this.getHiddenKeys();

    return html`
      <div
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1050]"
        @click=${this.close}
      >
        <div
          class="bg-bg-secondary border border-border rounded-xl w-[90%] max-w-[500px] max-h-[80vh] overflow-y-auto p-4 shadow-2xl"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-primary text-lg font-bold">Edit Quick Keys</h2>
            <button
              class="text-muted hover:text-primary transition-colors text-xl px-2 py-1"
              @click=${this.close}
            >
              ✕
            </button>
          </div>

          <p class="text-muted text-sm mb-4">Drag to reorder. Drag to Hidden area to hide.</p>

          <div class="space-y-3">
            ${this.draftRows.map((row, rowIndex) => this.renderRow(rowIndex, row))}
          </div>

          <div
            class="hidden-section mt-4 p-3 rounded-lg bg-bg-tertiary border border-dashed transition-colors ${this.isDraggingOverHidden ? 'border-status-error bg-status-error/10' : 'border-border'}"
          >
            <h3 class="text-xs text-muted mb-2 font-medium">Hidden</h3>
            <div class="flex flex-wrap gap-1 min-h-[40px]">
              ${
                hidden.length === 0
                  ? html`<span class="text-muted text-xs italic">Drag keys here to hide</span>`
                  : hidden.map((def) => this.renderKeyTile(def.key))
              }
            </div>
          </div>

          <div class="flex justify-between mt-4 pt-4 border-t border-border">
            <button
              class="px-4 py-2 bg-bg-tertiary border border-border text-primary rounded-md hover:bg-bg text-sm transition-colors"
              @click=${this.reset}
            >
              Reset to Defaults
            </button>
            <button
              class="px-4 py-2 bg-primary border border-primary text-white rounded-md hover:bg-primary-hover text-sm transition-colors"
              @click=${this.save}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRow(rowIndex: number, keys: QuickKeyId[]) {
    return html`
      <div class="key-row p-2 rounded-lg bg-bg-tertiary" data-row=${rowIndex}>
        <span class="text-xs text-muted mb-1 block">Row ${rowIndex + 1}</span>
        <div class="flex flex-wrap gap-1 min-h-[36px]">
          ${keys.map((key) => this.renderKeyTile(key))}
          ${keys.length === 0 ? html`<span class="text-muted text-xs italic py-2">Empty row</span>` : ''}
        </div>
      </div>
    `;
  }

  private renderKeyTile(key: QuickKeyId) {
    const def = this.getDefinition(key);
    const isDragging = this.draggedKey === key;

    return html`
      <div
        class="key-tile px-3 py-2 bg-bg border border-border rounded-md font-mono text-xs cursor-grab select-none touch-none transition-opacity ${isDragging ? 'dragging opacity-30' : 'text-primary'}"
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
}

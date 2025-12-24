/**
 * Quick Keys Editor Component
 *
 * Modal component for editing quick keys via drag and drop.
 * Uses flex layout matching the actual keyboard - each row is one line.
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

// Throttle interval for drag updates (ms)
const DRAG_THROTTLE_MS = 80;

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

  // Throttling
  private lastDragUpdate = 0;
  private pendingDragUpdate: number | null = null;

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
      'fixed pointer-events-none z-[1100] opacity-95 scale-105 shadow-xl px-2 py-1.5 bg-primary/20 border-2 border-primary rounded font-mono text-xs text-primary';
    this.dragGhost.style.left = `${clientX - 20}px`;
    this.dragGhost.style.top = `${clientY - 15}px`;
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

    // Always update ghost position immediately
    this.dragGhost.style.left = `${clientX - 20}px`;
    this.dragGhost.style.top = `${clientY - 15}px`;

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
        return;
      }
    }

    // Throttle the reorder logic
    const now = Date.now();
    if (now - this.lastDragUpdate < DRAG_THROTTLE_MS) {
      // Schedule an update if we don't have one pending
      if (this.pendingDragUpdate === null) {
        this.pendingDragUpdate = window.setTimeout(
          () => {
            this.pendingDragUpdate = null;
            this.processDragMove(clientX, clientY);
          },
          DRAG_THROTTLE_MS - (now - this.lastDragUpdate)
        );
      }
      return;
    }

    this.processDragMove(clientX, clientY);
  }

  private processDragMove(clientX: number, clientY: number) {
    if (!this.draggedKey) return;

    this.lastDragUpdate = Date.now();

    // Find drop target and do live reordering
    const dropTarget = this.findDropTarget(clientX, clientY);
    if (dropTarget) {
      this.liveReorder(this.draggedKey, dropTarget.row, dropTarget.index);
    }
  }

  private handleDragEnd(e: TouchEvent | MouseEvent) {
    if (!this.draggedKey) return;
    e.preventDefault();

    // Cancel any pending drag update
    if (this.pendingDragUpdate !== null) {
      clearTimeout(this.pendingDragUpdate);
      this.pendingDragUpdate = null;
    }

    // If dropped on hidden section, remove the key
    if (this.isDraggingOverHidden) {
      this.removeKeyFromRows(this.draggedKey);
    }

    this.cleanupDrag();
  }

  private handleDragCancel() {
    if (this.pendingDragUpdate !== null) {
      clearTimeout(this.pendingDragUpdate);
      this.pendingDragUpdate = null;
    }
    this.cleanupDrag();
  }

  private cleanupDrag() {
    document.removeEventListener('mousemove', this.boundHandleDragMove);
    document.removeEventListener('mouseup', this.boundHandleDragEnd);
    this.dragGhost?.remove();
    this.dragGhost = null;
    this.draggedKey = null;
    this.isDraggingOverHidden = false;
    this.lastDragUpdate = 0;
  }

  /**
   * Find drop target - simple since each row is one visual line (no wrapping).
   * Just find the row by Y, then find position in row by X.
   */
  private findDropTarget(x: number, y: number): { row: number; index: number } | null {
    const rowElements = this.querySelectorAll('.key-row');

    for (const rowEl of rowElements) {
      const rowRect = rowEl.getBoundingClientRect();
      const row = Number.parseInt(rowEl.getAttribute('data-row') || '0', 10);

      // Check if Y is within this row (with some padding)
      if (y < rowRect.top - 10 || y > rowRect.bottom + 10) continue;

      const tiles = Array.from(rowEl.querySelectorAll('.key-tile:not(.dragging)'));

      // Empty row - insert at position 0
      if (tiles.length === 0) return { row, index: 0 };

      // Find insertion point based on X position
      for (let i = 0; i < tiles.length; i++) {
        const rect = tiles[i].getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (x < midX) {
          return { row, index: i };
        }
      }

      // After all tiles - insert at end
      return { row, index: tiles.length };
    }

    return null;
  }

  /** Remove key from all rows (hide it) */
  private removeKeyFromRows(key: QuickKeyId) {
    this.draftRows = this.draftRows.map((row) => row.filter((k) => k !== key));
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

    // Skip if already in the right place
    if (fromRow === toRow) {
      const adjustedTarget = fromIndex < toIndex ? toIndex - 1 : toIndex;
      if (fromIndex === adjustedTarget) {
        return;
      }
    }

    // Create a mutable copy and move
    const newRows = this.draftRows.map((row) => [...row]);
    newRows[fromRow].splice(fromIndex, 1);

    // Adjust target index if same row and moving forward
    let effectiveIndex = toIndex;
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
          class="bg-bg-secondary border border-border rounded-xl w-[95%] max-w-[600px] max-h-[80vh] overflow-y-auto p-4 shadow-2xl"
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

          <!-- Preview area with minimal padding to match actual keyboard -->
          <div class="space-y-1 bg-bg-secondary/50 rounded-lg p-1">
            ${this.draftRows.map((row, rowIndex) => this.renderRow(rowIndex, row))}
          </div>

          <div
            class="hidden-section mt-4 p-3 rounded-lg bg-bg-tertiary border border-dashed transition-colors ${this.isDraggingOverHidden ? 'border-status-error bg-status-error/10' : 'border-border'}"
          >
            <h3 class="text-xs text-muted mb-2 font-medium">Hidden</h3>
            <div class="flex flex-wrap gap-1 min-h-[32px]">
              ${
                hidden.length === 0
                  ? html`<span class="text-muted text-xs italic py-2">Drag keys here to hide</span>`
                  : hidden.map((def) => this.renderHiddenKeyTile(def.key))
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

  /** Render a row using flex layout - matches actual keyboard */
  private renderRow(rowIndex: number, keys: QuickKeyId[]) {
    return html`
      <div class="key-row px-0.5 py-0.5" data-row=${rowIndex}>
        <div class="flex gap-0.5 min-h-[28px]">
          ${
            keys.length === 0
              ? html`<span class="text-muted/50 text-[10px] italic flex-1 text-center border border-dashed border-border rounded py-1">Empty</span>`
              : keys.map((key) => this.renderKeyTile(key))
          }
        </div>
      </div>
    `;
  }

  /** Render a key tile in the main rows - uses flex: 1 like actual keyboard */
  private renderKeyTile(key: QuickKeyId) {
    const def = this.getDefinition(key);
    const isDragging = this.draggedKey === key;

    return html`
      <div
        class="key-tile flex-1 min-w-0 px-0.5 py-1 bg-bg-tertiary border border-border rounded font-mono text-[10px] cursor-grab select-none touch-none text-center truncate transition-colors ${isDragging ? 'dragging opacity-40 border-primary bg-primary/10' : 'text-primary hover:border-primary/50'}"
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

  /** Render a key tile in the hidden section - fixed width, wraps */
  private renderHiddenKeyTile(key: QuickKeyId) {
    const def = this.getDefinition(key);

    return html`
      <div
        class="key-tile px-2 py-1.5 bg-bg border border-border rounded font-mono text-xs cursor-grab select-none touch-none text-center text-primary hover:border-primary/50 hover:bg-bg-secondary transition-colors"
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

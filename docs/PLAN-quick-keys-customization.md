# Plan: Customizable Mobile Quick Keys

## Overview

Allow users to **reorder** and **show/hide** the mobile quick key buttons.

**Features:**
- Drag to reorder keys within/between rows
- Drag out to hide keys
- Drag hidden keys back to restore

**Not included:** No remapping. Keys always send their original action.

---

## Data Model

### Key Definitions (Source of Truth)

```typescript
// web/src/client/utils/quick-keys-preferences.ts

export const QUICK_KEY_DEFINITIONS = [
  // Row 1 (12 keys)
  { key: 'Escape', label: 'Esc' },
  { key: 'Control', label: 'Ctrl', modifier: true },
  { key: 'CtrlExpand', label: '⌃', toggle: true },
  { key: 'F', label: 'F', toggle: true },
  { key: 'Tab', label: 'Tab' },
  { key: 'shift_tab', label: '⇤' },
  { key: 'ArrowUp', label: '↑', arrow: true },
  { key: 'ArrowDown', label: '↓', arrow: true },
  { key: 'ArrowLeft', label: '←', arrow: true },
  { key: 'ArrowRight', label: '→', arrow: true },
  { key: 'PageUp', label: 'PgUp' },
  { key: 'PageDown', label: 'PgDn' },
  // Row 2 (10 keys)
  { key: 'Home', label: 'Home' },
  { key: 'Paste', label: 'Paste' },
  { key: 'End', label: 'End' },
  { key: 'Delete', label: 'Del' },
  { key: '`', label: '`' },
  { key: '~', label: '~' },
  { key: '|', label: '|' },
  { key: '/', label: '/' },
  { key: '\\', label: '\\' },
  { key: '-', label: '-' },
  // Row 3 (12 keys)
  { key: 'Option', label: '⌥', modifier: true },
  { key: 'Command', label: '⌘', modifier: true },
  { key: 'Ctrl+C', label: '^C', combo: true },
  { key: 'Ctrl+Z', label: '^Z', combo: true },
  { key: "'", label: "'" },
  { key: '"', label: '"' },
  { key: '{', label: '{' },
  { key: '}', label: '}' },
  { key: '[', label: '[' },
  { key: ']', label: ']' },
  { key: '(', label: '(' },
  { key: ')', label: ')' },
] as const;
```

### Types

```typescript
// Derived from QUICK_KEY_DEFINITIONS - compile-time safe
export type QuickKeyId = typeof QUICK_KEY_DEFINITIONS[number]['key'];

// Static definition (from QUICK_KEY_DEFINITIONS)
export interface QuickKeyDefinition {
  key: QuickKeyId;
  label: string;
  modifier?: boolean;  // Control, Option, Command - held as chord
  arrow?: boolean;     // Arrow keys - support key repeat
  toggle?: boolean;    // F, CtrlExpand - toggle expansion views
  combo?: boolean;     // Ctrl+C, Ctrl+Z - pre-defined combinations
  func?: boolean;      // F1-F12 function keys
  special?: boolean;   // Done button, CtrlFull - special handling
  description?: string; // Tooltip text (used by CTRL_SHORTCUTS)
}

// Storage format - array of rows, each row is array of key IDs
export type QuickKeysLayout = QuickKeyId[][];

// In-memory state for rendering
export interface QuickKeysState {
  rows: QuickKeyDefinition[][];  // Full definitions, ready to render
  hidden: QuickKeyDefinition[];  // Keys not in any row
}
```

### Storage

**Server-side persistence** via `ConfigService` in `~/.vibetunnel/config.json`:

```typescript
// Added to VibeTunnelConfig
quickKeysLayout?: QuickKeyId[][];
```

- Syncs across all browsers connecting to this server
- Uses existing config validation (Zod) and file watching
- API: `GET /api/config` and `PUT /api/config`
- Dynamic rows: user can have any number of rows
- Hidden keys: keys in `QUICK_KEY_DEFINITIONS` not present in any row
- Missing/invalid: use default layout

Example in config.json:
```json
{
  "version": 1,
  "quickStartCommands": [...],
  "quickKeysLayout": [
    ["Escape", "Control", "Tab", "ArrowUp", "ArrowDown"],
    ["Home", "Paste", "Delete"],
    ["Option", "Command", "Ctrl+C"]
  ]
}
```

---

## Preferences Manager

### File: `web/src/client/utils/quick-keys-preferences.ts`

### Class: QuickKeysPreferencesManager

```typescript
export const DEFAULT_LAYOUT: QuickKeysLayout = [
  ['Escape', 'Control', 'CtrlExpand', 'F', 'Tab', 'shift_tab',
   'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'],
  ['Home', 'Paste', 'End', 'Delete', '`', '~', '|', '/', '\\', '-'],
  ['Option', 'Command', 'Ctrl+C', 'Ctrl+Z', "'", '"', '{', '}', '[', ']', '(', ')'],
];

export class QuickKeysPreferencesManager {
  private static instance: QuickKeysPreferencesManager;
  private layout: QuickKeysLayout = structuredClone(DEFAULT_LAYOUT);
  private listeners = new Set<() => void>();
  private loaded = false;

  private constructor() {
    // Don't load in constructor - call load() explicitly
  }

  static getInstance(): QuickKeysPreferencesManager {
    if (!QuickKeysPreferencesManager.instance) {
      QuickKeysPreferencesManager.instance = new QuickKeysPreferencesManager();
    }
    return QuickKeysPreferencesManager.instance;
  }

  /** Fetch layout from server */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        if (this.isValidLayout(config.quickKeysLayout)) {
          this.layout = config.quickKeysLayout;
        }
      }
    } catch {
      // Use defaults
    }
    this.loaded = true;
    this.notify();
  }

  /** Update layout from server config (called when config changes) */
  updateFromConfig(config: { quickKeysLayout?: QuickKeysLayout }): void {
    if (this.isValidLayout(config.quickKeysLayout)) {
      this.layout = config.quickKeysLayout;
      this.notify();
    }
  }

  private isValidLayout(data: unknown): data is QuickKeysLayout {
    if (!Array.isArray(data)) return false;
    const validKeys = new Set(QUICK_KEY_DEFINITIONS.map(d => d.key));
    return data.every(row =>
      Array.isArray(row) && row.every(key => validKeys.has(key))
    );
  }

  private async save(): Promise<void> {
    try {
      await fetch('/api/config/quick-keys-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.layout),
      });
    } catch (error) {
      console.error('Failed to save quick keys layout:', error);
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): QuickKeysState {
    const usedKeys = new Set(this.layout.flat());
    const rows = this.layout.map(row =>
      row.map(key => QUICK_KEY_DEFINITIONS.find(d => d.key === key)!)
    );
    const hidden = QUICK_KEY_DEFINITIONS.filter(d => !usedKeys.has(d.key));
    return { rows, hidden };
  }

  getLayout(): QuickKeysLayout {
    return structuredClone(this.layout);
  }

  async setLayout(layout: QuickKeysLayout): Promise<void> {
    this.layout = structuredClone(layout);
    await this.save();
  }

  async resetToDefaults(): Promise<void> {
    this.layout = structuredClone(DEFAULT_LAYOUT);
    await this.save();
  }
}

export const quickKeysPreferencesManager = QuickKeysPreferencesManager.getInstance();
```

---

## Server-Side Changes

### 1. Update Types: `web/src/types/config.ts`

```typescript
// Add to VibeTunnelConfig interface
quickKeysLayout?: string[][];
```

### 2. Update Schema: `web/src/server/services/config-service.ts`

```typescript
// Add to ConfigSchema
quickKeysLayout: z.array(z.array(z.string())).optional(),
```

### 3. Add Route: `web/src/server/routes/config.ts`

```typescript
// PUT /api/config/quick-keys-layout
router.put('/quick-keys-layout', async (req, res) => {
  try {
    const layout = req.body;
    if (!Array.isArray(layout) || !layout.every(row => Array.isArray(row))) {
      return res.status(400).json({ error: 'Invalid layout format' });
    }
    const config = configService.getConfig();
    configService.updateConfig({ ...config, quickKeysLayout: layout });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save layout' });
  }
});
```

---

## Terminal Quick Keys Component

### File: `web/src/client/components/terminal-quick-keys.ts`

### Changes

**1. Move key definitions to preferences file:**

Remove `TERMINAL_QUICK_KEYS` constant. Import from preferences:

```typescript
import {
  QUICK_KEY_DEFINITIONS,
  type QuickKeyDefinition,
} from '../utils/quick-keys-preferences.js';
```

**2. Add rows property:**

```typescript
// Rows of keys to render (from QuickKeysState.rows)
@property({ type: Array }) rows?: QuickKeyDefinition[][];
```

**3. Update render method:**

Replace hardcoded row filtering:
```typescript
// Old:
TERMINAL_QUICK_KEYS.filter((k) => k.row === 1)

// New:
this.rows?.[0] ?? QUICK_KEY_DEFINITIONS.filter((_, i) => i < 12)
```

Or simpler - render all rows dynamically:
```typescript
${(this.rows ?? DEFAULT_ROWS).map((row, rowIndex) => html`
  <div class="quick-key-row">
    ${row.map(key => this.renderKey(key))}
  </div>
`)}
```

No other changes needed. Key behavior, toggles, modifiers, arrow repeat all work the same.

---

## Quick Keys Editor Component

### File: `web/src/client/components/quick-keys-editor.ts`

### Overview

Modal component for editing quick keys via drag and drop.

### State

```typescript
@customElement('quick-keys-editor')
export class QuickKeysEditor extends LitElement {
  @property({ type: Boolean }) isOpen = false;

  // Draft layout - array of rows, each row is array of key IDs
  @state() private draftRows: QuickKeyId[][] = [];
  @state() private draggedKey: QuickKeyId | null = null;
  @state() private dropTarget: { row: number; index: number } | 'hidden' | null = null;

  private dragGhost: HTMLElement | null = null;
}
```

### Lifecycle & Methods

```typescript
updated(changedProperties: PropertyValues) {
  super.updated(changedProperties);
  if (changedProperties.has('isOpen') && this.isOpen) {
    // Clone current layout for editing
    this.draftRows = quickKeysPreferencesManager.getLayout();
  }
}

close(): void {
  this.dispatchEvent(new CustomEvent('close'));
  this.draggedKey = null;
  this.dropTarget = null;
}

private save(): void {
  quickKeysPreferencesManager.setLayout(this.draftRows);
  this.close();
}

private reset(): void {
  this.draftRows = structuredClone(DEFAULT_LAYOUT);
}

private getHiddenKeys(): QuickKeyDefinition[] {
  const usedKeys = new Set(this.draftRows.flat());
  return QUICK_KEY_DEFINITIONS.filter(d => !usedKeys.has(d.key));
}

private getDefinition(key: QuickKeyId): QuickKeyDefinition {
  return QUICK_KEY_DEFINITIONS.find(d => d.key === key)!;
}
```

### UI Layout

```
┌─────────────────────────────────────────┐
│  Edit Quick Keys                     ✕  │
├─────────────────────────────────────────┤
│  Drag to reorder. Drag out to hide.    │
├─────────────────────────────────────────┤
│  Row 1:                                 │
│  ┌─────┬─────┬─────┬─────┬─────────┐   │
│  │ Esc │Ctrl │  ⌃  │  F  │ Tab ... │   │
│  └─────┴─────┴─────┴─────┴─────────┘   │
├─────────────────────────────────────────┤
│  Row 2:                                 │
│  ┌─────┬─────┬─────┬─────┬─────────┐   │
│  │Home │Paste│ Del │  `  │  ~  ... │   │
│  └─────┴─────┴─────┴─────┴─────────┘   │
├─────────────────────────────────────────┤
│  Row 3:                                 │
│  ┌─────┬─────┬─────┬─────┬─────────┐   │
│  │  ⌥  │  ⌘  │ ^C  │ ^Z  │  '  ... │   │
│  └─────┴─────┴─────┴─────┴─────────┘   │
├─────────────────────────────────────────┤
│  Hidden:                                │
│  ┌─────┬─────┬─────┐                    │
│  │ End │  /  │  -  │  (drag to restore)│
│  └─────┴─────┴─────┘                    │
├─────────────────────────────────────────┤
│  [Reset to Defaults]           [Done]   │
└─────────────────────────────────────────┘
```

### Render Method

```typescript
render() {
  if (!this.isOpen) return html``;

  const hidden = this.getHiddenKeys();

  return html`
    <div class="editor-overlay" style="z-index: ${Z_INDEX.QUICK_KEYS_EDITOR}"
         @click=${this.close}>
      <div class="editor-modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="editor-header">
          <h2>Edit Quick Keys</h2>
          <button class="close-btn" @click=${this.close}>✕</button>
        </div>

        <p class="editor-hint">Drag to reorder. Drag out to hide.</p>

        <div class="rows-container">
          ${this.draftRows.map((row, rowIndex) => this.renderRow(rowIndex, row))}
        </div>

        <div class="hidden-section ${this.dropTarget === 'hidden' ? 'drop-active' : ''}">
          <h3>Hidden</h3>
          <div class="hidden-keys">
            ${hidden.length === 0
              ? html`<span class="empty-hint">Drag keys here to hide</span>`
              : hidden.map(def => this.renderKeyTile(def.key))}
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
  const isDropTarget = this.dropTarget &&
    this.dropTarget !== 'hidden' &&
    this.dropTarget.row === rowIndex;

  return html`
    <div class="key-row ${isDropTarget ? 'drop-active' : ''}" data-row=${rowIndex}>
      <span class="row-label">Row ${rowIndex + 1}</span>
      <div class="key-tiles">
        ${keys.map((key, i) => html`
          ${this.renderDropIndicator(rowIndex, i)}
          ${this.renderKeyTile(key)}
        `)}
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
      @touchmove=${this.handleDragMove}
      @touchend=${this.handleDragEnd}
      @touchcancel=${this.handleDragCancel}
      @mousedown=${(e: MouseEvent) => this.handleDragStart(e, key)}
    >
      ${def.label}
    </div>
  `;
}

private renderDropIndicator(row: number, index: number) {
  const isActive = this.dropTarget &&
    this.dropTarget !== 'hidden' &&
    this.dropTarget.row === row &&
    this.dropTarget.index === index;

  return html`<div class="drop-indicator ${isActive ? 'active' : ''}"></div>`;
}
```

### Drag and Drop Handlers

Supports both touch and mouse events as first-class input methods.

```typescript
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
    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);
  }
}

private handleDragMove = (e: TouchEvent | MouseEvent) => {
  if (!this.draggedKey || !this.dragGhost) return;
  e.preventDefault();

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  this.dragGhost.style.left = `${clientX - 30}px`;
  this.dragGhost.style.top = `${clientY - 20}px`;
  this.dropTarget = this.findDropTarget(clientX, clientY);
};

private handleDragEnd = (e: TouchEvent | MouseEvent) => {
  if (!this.draggedKey) return;
  e.preventDefault();

  if (this.dropTarget === 'hidden') {
    this.removeKeyFromRows(this.draggedKey);
  } else if (this.dropTarget) {
    this.moveKey(this.draggedKey, this.dropTarget.row, this.dropTarget.index);
  }

  this.cleanupDrag();
};

private handleDragCancel = () => {
  this.cleanupDrag();
};

private cleanupDrag() {
  document.removeEventListener('mousemove', this.handleDragMove);
  document.removeEventListener('mouseup', this.handleDragEnd);
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

  for (const rowEl of this.renderRoot.querySelectorAll('.key-row')) {
    const rect = rowEl.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;

    const row = parseInt(rowEl.getAttribute('data-row') || '0');
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
  this.draftRows = this.draftRows.map(row => row.filter(k => k !== key));
  this.requestUpdate();
}

/** Move key to new position */
private moveKey(key: QuickKeyId, toRow: number, toIndex: number) {
  // Remove from current position
  let fromRow = -1, fromIndex = -1;
  for (let r = 0; r < this.draftRows.length; r++) {
    const i = this.draftRows[r].indexOf(key);
    if (i !== -1) { fromRow = r; fromIndex = i; break; }
  }

  // If not found in rows (was hidden), just insert
  if (fromRow === -1) {
    this.draftRows[toRow].splice(toIndex, 0, key);
  } else {
    // Remove from source
    this.draftRows[fromRow].splice(fromIndex, 1);
    // Adjust target index if same row and moving forward
    const adjustedIndex = (fromRow === toRow && fromIndex < toIndex) ? toIndex - 1 : toIndex;
    this.draftRows[toRow].splice(adjustedIndex, 0, key);
  }

  this.requestUpdate();
}
```

### Styles

**Note:** Import `Z_INDEX` from constants and add `QUICK_KEYS_EDITOR: 115` to the constants file.

```typescript
import { Z_INDEX } from '../utils/constants.js';

// Use inline style for z-index since it comes from JS constant
// In render(), apply: style="z-index: ${Z_INDEX.QUICK_KEYS_EDITOR}"

static styles = css`
  .editor-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    /* z-index applied via inline style using Z_INDEX.QUICK_KEYS_EDITOR */
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
    border: 1px solid rgb(var(--color-border));
    border-radius: 6px;
    font-family: monospace;
    font-size: 12px;
    cursor: grab;
    user-select: none;
    touch-action: none;
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
    border: 1px dashed rgb(var(--color-border));
    min-height: 60px;
  }

  .hidden-section.drop-active {
    border-color: rgb(var(--color-error));
    background: rgb(var(--color-error) / 0.1);
  }

  .hidden-section h3 {
    font-size: 12px;
    color: rgb(var(--color-text-muted));
    margin-bottom: 8px;
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
    border-top: 1px solid rgb(var(--color-border));
  }

  .drag-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 1001;
    opacity: 0.9;
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
`;
```

---

## Settings Integration

### File: `web/src/client/components/settings.ts`

### Changes

**1. Import editor:**
```typescript
import './quick-keys-editor.js';
```

**2. Add state:**
```typescript
@state() private showQuickKeysEditor = false;
```

**3. Add section in render (mobile only):**

```typescript
${this.mediaState.isMobile ? html`
  <div class="settings-section">
    <h3 class="text-md font-bold text-primary mb-3">Quick Keys</h3>
    <div class="p-4 bg-bg-tertiary rounded-lg border border-border/50">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <label class="text-primary font-medium">Customize Quick Keys</label>
          <p class="text-muted text-xs mt-1">
            Reorder or hide keyboard shortcuts
          </p>
        </div>
        <button
          class="btn-secondary text-xs px-3 py-1.5"
          @click=${() => this.showQuickKeysEditor = true}
        >
          Edit
        </button>
      </div>
    </div>
  </div>
` : ''}

<quick-keys-editor
  .isOpen=${this.showQuickKeysEditor}
  @close=${() => this.showQuickKeysEditor = false}
></quick-keys-editor>
```

**4. No separate method needed** - inline handlers used above.

---

## Overlays Container Integration

### File: `web/src/client/components/session-view/overlays-container.ts`

### Changes

**1. Import:**
```typescript
import {
  quickKeysPreferencesManager,
  type QuickKeyDefinition,
} from '../../utils/quick-keys-preferences.js';
```

**2. Add state:**
```typescript
@state() private quickKeysRows?: QuickKeyDefinition[][];
private quickKeysUnsubscribe?: () => void;
```

**3. In connectedCallback:**
```typescript
this.quickKeysRows = quickKeysPreferencesManager.getState().rows;
this.quickKeysUnsubscribe = quickKeysPreferencesManager.subscribe(() => {
  this.quickKeysRows = quickKeysPreferencesManager.getState().rows;
});
```

**4. In disconnectedCallback:**
```typescript
this.quickKeysUnsubscribe?.();
```

**5. In render, pass to terminal-quick-keys:**
```typescript
<terminal-quick-keys
  .visible=${this.showQuickKeys}
  .onKeyPress=${this.handleQuickKeyPress}
  .rows=${this.quickKeysRows}
></terminal-quick-keys>
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| All keys hidden | Allowed. Quick keys bar renders empty rows. User can reset via settings. |
| Empty row | Row still renders (allows drop target). Empty rows could be pruned on save. |
| New keys in future | New keys added to `QUICK_KEY_DEFINITIONS` appear in hidden section automatically. |
| Corrupted localStorage | `isValidLayout()` catches invalid data, resets to defaults. |
| Done button | Not in configurable list. Always visible in terminal-quick-keys. |

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `web/src/types/config.ts` | Modify | Add `quickKeysLayout` to `VibeTunnelConfig` |
| `web/src/server/services/config-service.ts` | Modify | Add `quickKeysLayout` to Zod schema |
| `web/src/server/routes/config.ts` | Modify | Add `PUT /api/config/quick-keys-layout` |
| `web/src/client/utils/quick-keys-preferences.ts` | Create | `QUICK_KEY_DEFINITIONS`, types, manager (API-based) |
| `web/src/client/utils/constants.ts` | Modify | Add `QUICK_KEYS_EDITOR: 115` to Z_INDEX |
| `web/src/client/components/quick-keys-editor.ts` | Create | Drag-drop editor modal (touch + mouse) |
| `web/src/client/components/terminal-quick-keys.ts` | Modify | Add `rows` prop, render dynamically |
| `web/src/client/components/settings.ts` | Modify | Add Quick Keys section (mobile) |
| `web/src/client/components/session-view/overlays-container.ts` | Modify | Subscribe and pass rows |

---

## Implementation Order

1. **Server: Types**
   - Add `quickKeysLayout?: string[][]` to `VibeTunnelConfig` in `web/src/types/config.ts`

2. **Server: Schema**
   - Add `quickKeysLayout: z.array(z.array(z.string())).optional()` to `ConfigSchema` in `config-service.ts`

3. **Server: Route**
   - Add `PUT /api/config/quick-keys-layout` endpoint in `config.ts`

4. **Client: Preferences Manager**
   - Create `quick-keys-preferences.ts`
   - `QUICK_KEY_DEFINITIONS` with `as const`
   - `QuickKeyId`, `QuickKeyDefinition`, `QuickKeysLayout`, `QuickKeysState` types
   - `QuickKeysPreferencesManager` with async `load()`, `setLayout()`, `resetToDefaults()`

5. **Client: Constants**
   - Add `QUICK_KEYS_EDITOR: 115` to Z_INDEX

6. **Client: Terminal Quick Keys**
   - Add `rows?: QuickKeyDefinition[][]` property
   - Render rows dynamically
   - Test: defaults still work

7. **Client: Overlays Container**
   - Call `quickKeysPreferencesManager.load()` on connect
   - Subscribe to changes
   - Pass `rows` to terminal-quick-keys

8. **Client: Editor**
   - Create `quick-keys-editor.ts`
   - Drag-drop with touch AND mouse
   - Async `save()` and `reset()`

9. **Client: Settings**
   - Add Quick Keys section (mobile only)
   - Wire up editor

10. **Verify**
    - Run `pnpm run check`
    - Test sync across browsers

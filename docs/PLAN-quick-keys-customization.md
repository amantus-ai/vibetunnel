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

### Types

```typescript
// web/src/client/utils/quick-keys-preferences.ts

interface QuickKeyConfig {
  key: string;       // Identifier: 'Escape', 'Ctrl+C', 'ArrowUp', etc.
  enabled: boolean;  // Visible or hidden
  row: number;       // 1, 2, or 3
  order: number;     // 0-based position within row
}

interface QuickKeysPreferences {
  version: 1;
  keys: QuickKeyConfig[];  // Only stores overrides, not full list
}
```

### Default Keys (34 total)

**Row 1 (12 keys):**
| Key | Label | Flags |
|-----|-------|-------|
| Escape | Esc | |
| Control | Ctrl | modifier |
| CtrlExpand | ⌃ | toggle |
| F | F | toggle |
| Tab | Tab | |
| shift_tab | ⇤ | |
| ArrowUp | ↑ | arrow |
| ArrowDown | ↓ | arrow |
| ArrowLeft | ← | arrow |
| ArrowRight | → | arrow |
| PageUp | PgUp | |
| PageDown | PgDn | |

**Row 2 (10 keys):**
| Key | Label | Flags |
|-----|-------|-------|
| Home | Home | |
| Paste | Paste | |
| End | End | |
| Delete | Del | |
| ` | ` | |
| ~ | ~ | |
| \| | \| | |
| / | / | |
| \\ | \\ | |
| - | - | |

**Row 3 (12 keys):**
| Key | Label | Flags |
|-----|-------|-------|
| Option | ⌥ | modifier |
| Command | ⌘ | modifier |
| Ctrl+C | ^C | combo |
| Ctrl+Z | ^Z | combo |
| ' | ' | |
| " | " | |
| { | { | |
| } | } | |
| [ | [ | |
| ] | ] | |
| ( | ( | |
| ) | ) | |

### Storage

- localStorage key: `vibetunnel_quick_keys_preferences`
- Sparse storage: empty `keys` array = all defaults
- Only store keys that differ from defaults (position changed or hidden)

---

## Preferences Manager

### File: `web/src/client/utils/quick-keys-preferences.ts`

### Exports

```typescript
// Static key definition (metadata for rendering and behavior)
export interface QuickKeyDefinition {
  key: string;
  label: string;
  row: number;
  modifier?: boolean;  // Control, Option, Command - held as chord
  arrow?: boolean;     // Arrow keys - support key repeat
  toggle?: boolean;    // F, CtrlExpand - toggle expansion views
  combo?: boolean;     // Ctrl+C, Ctrl+Z - pre-defined combinations
  func?: boolean;      // F1-F12 function keys
  special?: boolean;   // Done button, CtrlFull - special handling
  description?: string; // Tooltip text (used by CTRL_SHORTCUTS)
}

// Array of all key definitions
export const QUICK_KEY_DEFINITIONS: QuickKeyDefinition[];

// User configuration for a key
export interface QuickKeyConfig {
  key: string;
  enabled: boolean;
  row: number;
  order: number;
}

// Full preferences structure
export interface QuickKeysPreferences {
  version: number;
  keys: QuickKeyConfig[];
}

// Singleton manager
export class QuickKeysPreferencesManager { ... }

// Convenience singleton export
export const quickKeysPreferencesManager: QuickKeysPreferencesManager;
```

### Class: QuickKeysPreferencesManager

**Pattern:** Singleton following `TerminalPreferencesManager`

```typescript
const STORAGE_KEY = 'vibetunnel_quick_keys_preferences';

export class QuickKeysPreferencesManager {
  private static instance: QuickKeysPreferencesManager;
  private preferences: QuickKeysPreferences;
  private listeners: (() => void)[] = [];

  private constructor() {
    this.preferences = this.loadPreferences();
  }

  static getInstance(): QuickKeysPreferencesManager {
    if (!QuickKeysPreferencesManager.instance) {
      QuickKeysPreferencesManager.instance = new QuickKeysPreferencesManager();
    }
    return QuickKeysPreferencesManager.instance;
  }

  private loadPreferences(): QuickKeysPreferences {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { version: 1, keys: [], ...parsed };
      }
    } catch (e) {
      // Corrupted data, use defaults
    }
    return { version: 1, keys: [] };
  }

  private savePreferences(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Subscribe to changes. Returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /**
   * Get full config merged with defaults.
   * Returns all keys with their effective row/order/enabled state.
   */
  getEffectiveKeys(): QuickKeyConfig[] {
    const result: QuickKeyConfig[] = [];

    for (let i = 0; i < QUICK_KEY_DEFINITIONS.length; i++) {
      const def = QUICK_KEY_DEFINITIONS[i];
      const override = this.preferences.keys.find(k => k.key === def.key);

      if (override) {
        result.push({ ...override });
      } else {
        // Default: enabled, original row, order = index within row
        const sameRowBefore = QUICK_KEY_DEFINITIONS
          .slice(0, i)
          .filter(d => d.row === def.row)
          .length;
        result.push({
          key: def.key,
          enabled: true,
          row: def.row,
          order: sameRowBefore,
        });
      }
    }

    return result;
  }

  /**
   * Get visible keys for a specific row, sorted by order.
   */
  getKeysForRow(row: number): QuickKeyConfig[] {
    return this.getEffectiveKeys()
      .filter(k => k.row === row && k.enabled)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Get all hidden keys.
   */
  getHiddenKeys(): QuickKeyConfig[] {
    return this.getEffectiveKeys().filter(k => !k.enabled);
  }

  /**
   * Set key visibility.
   */
  setKeyEnabled(key: string, enabled: boolean): void {
    this.ensureOverride(key);
    const config = this.preferences.keys.find(k => k.key === key);
    if (config) {
      config.enabled = enabled;
      this.savePreferences();
    }
  }

  /**
   * Move key to new position.
   */
  moveKey(key: string, toRow: number, toOrder: number): void {
    const effective = this.getEffectiveKeys();
    const moving = effective.find(k => k.key === key);
    if (!moving) return;

    const fromRow = moving.row;
    const fromOrder = moving.order;

    // No-op if same position
    if (fromRow === toRow && fromOrder === toOrder) return;

    // Ensure all affected keys have overrides
    effective.forEach(k => this.ensureOverride(k.key));

    // Remove from source row (decrement orders after it)
    for (const k of this.preferences.keys) {
      if (k.row === fromRow && k.order > fromOrder) {
        k.order--;
      }
    }

    // Adjust target if same row and moving forward
    let targetOrder = toOrder;
    if (fromRow === toRow && fromOrder < toOrder) {
      targetOrder--;
    }

    // Make room in target row (increment orders at and after target)
    for (const k of this.preferences.keys) {
      if (k.row === toRow && k.order >= targetOrder && k.key !== key) {
        k.order++;
      }
    }

    // Move the key
    const config = this.preferences.keys.find(k => k.key === key);
    if (config) {
      config.row = toRow;
      config.order = targetOrder;
      config.enabled = true; // Restore if was hidden
    }

    this.savePreferences();
  }

  /**
   * Ensure a key has an override entry in preferences.
   */
  private ensureOverride(key: string): void {
    if (this.preferences.keys.find(k => k.key === key)) return;

    const effective = this.getEffectiveKeys();
    const current = effective.find(k => k.key === key);
    if (current) {
      this.preferences.keys.push({ ...current });
    }
  }

  /**
   * Reset to defaults.
   */
  resetToDefaults(): void {
    this.preferences = { version: 1, keys: [] };
    this.savePreferences();
  }
}
```

---

## Terminal Quick Keys Component

### File: `web/src/client/components/terminal-quick-keys.ts`

### Changes

**1. Move key definitions to preferences file:**

Remove `TERMINAL_QUICK_KEYS` constant from this file. Import from preferences:

```typescript
import {
  QUICK_KEY_DEFINITIONS,
  type QuickKeyConfig,
  type QuickKeyDefinition,
} from '../utils/quick-keys-preferences.js';
```

**2. Add keyConfig property:**

```typescript
@property({ type: Array }) keyConfig?: QuickKeyConfig[];
```

**3. Add helper method:**

```typescript
/**
 * Get visible keys for a row, with full metadata for rendering.
 */
private getVisibleKeysForRow(row: number): QuickKeyDefinition[] {
  let configs: QuickKeyConfig[];

  if (this.keyConfig) {
    configs = this.keyConfig
      .filter(k => k.row === row && k.enabled)
      .sort((a, b) => a.order - b.order);
  } else {
    // No config = use defaults
    return QUICK_KEY_DEFINITIONS.filter(k => k.row === row);
  }

  // Map configs back to QuickKeyDefinition for rendering metadata
  return configs
    .map(config => QUICK_KEY_DEFINITIONS.find(d => d.key === config.key))
    .filter((d): d is QuickKeyDefinition => d !== undefined);
}
```

**4. Update render method:**

Replace all instances of:
```typescript
TERMINAL_QUICK_KEYS.filter((k) => k.row === 1)
```

With:
```typescript
this.getVisibleKeysForRow(1)
```

Same for rows 2 and 3.

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
  @state() private workingConfig: QuickKeyConfig[] = [];
  @state() private draggedKey: string | null = null;
  @state() private dropTarget: { row: number; order: number } | 'hidden' | null = null;

  private dragGhost: HTMLElement | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
}
```

### Lifecycle & Methods

```typescript
// Note: import PropertyValues from 'lit'

/**
 * React to isOpen changes - initialize working config when opened.
 */
updated(changedProperties: PropertyValues) {
  super.updated(changedProperties);
  if (changedProperties.has('isOpen') && this.isOpen) {
    const manager = QuickKeysPreferencesManager.getInstance();
    this.workingConfig = manager.getEffectiveKeys();
  }
}

close(): void {
  this.dispatchEvent(new CustomEvent('close'));
  this.draggedKey = null;
  this.dropTarget = null;
}

private save(): void {
  // Apply working config to manager
  const manager = QuickKeysPreferencesManager.getInstance();

  // Clear and rebuild preferences
  manager.resetToDefaults();

  for (const config of this.workingConfig) {
    if (!config.enabled) {
      manager.setKeyEnabled(config.key, false);
    } else {
      manager.moveKey(config.key, config.row, config.order);
    }
  }

  this.close();
}

private reset(): void {
  // Reset working config to defaults
  this.workingConfig = QUICK_KEY_DEFINITIONS.map((def, i) => {
    const sameRowBefore = QUICK_KEY_DEFINITIONS
      .slice(0, i)
      .filter(d => d.row === def.row)
      .length;
    return {
      key: def.key,
      enabled: true,
      row: def.row,
      order: sameRowBefore,
    };
  });
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

  const row1 = this.getWorkingKeysForRow(1);
  const row2 = this.getWorkingKeysForRow(2);
  const row3 = this.getWorkingKeysForRow(3);
  const hidden = this.workingConfig.filter(k => !k.enabled);

  return html`
    <div class="editor-overlay" @click=${this.close}>
      <div class="editor-modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="editor-header">
          <h2>Edit Quick Keys</h2>
          <button class="close-btn" @click=${this.close}>✕</button>
        </div>

        <p class="editor-hint">Drag to reorder. Drag out to hide.</p>

        <div class="rows-container">
          ${this.renderRow(1, row1)}
          ${this.renderRow(2, row2)}
          ${this.renderRow(3, row3)}
        </div>

        <div class="hidden-section ${this.dropTarget === 'hidden' ? 'drop-active' : ''}">
          <h3>Hidden</h3>
          <div class="hidden-keys">
            ${hidden.length === 0
              ? html`<span class="empty-hint">Drag keys here to hide</span>`
              : hidden.map(k => this.renderKeyTile(k, true))}
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

private renderRow(row: number, keys: QuickKeyConfig[]) {
  const isDropTarget = this.dropTarget &&
    this.dropTarget !== 'hidden' &&
    this.dropTarget.row === row;

  return html`
    <div class="key-row ${isDropTarget ? 'drop-active' : ''}" data-row=${row}>
      <span class="row-label">Row ${row}</span>
      <div class="key-tiles">
        ${keys.map((k, i) => html`
          ${this.renderDropIndicator(row, i)}
          ${this.renderKeyTile(k, false)}
        `)}
        ${this.renderDropIndicator(row, keys.length)}
      </div>
    </div>
  `;
}

private renderKeyTile(config: QuickKeyConfig, isHidden: boolean) {
  const def = QUICK_KEY_DEFINITIONS.find(d => d.key === config.key);
  const isDragging = this.draggedKey === config.key;

  return html`
    <div
      class="key-tile ${isDragging ? 'dragging' : ''}"
      data-key=${config.key}
      data-row=${config.row}
      data-order=${config.order}
      @touchstart=${(e: TouchEvent) => this.handleDragStart(e, config.key)}
      @touchmove=${this.handleDragMove}
      @touchend=${this.handleDragEnd}
      @touchcancel=${this.handleDragCancel}
      @mousedown=${(e: MouseEvent) => this.handleDragStart(e, config.key)}
    >
      ${def?.label ?? config.key}
    </div>
  `;
}

private renderDropIndicator(row: number, order: number) {
  const isActive = this.dropTarget &&
    this.dropTarget !== 'hidden' &&
    this.dropTarget.row === row &&
    this.dropTarget.order === order;

  return html`<div class="drop-indicator ${isActive ? 'active' : ''}"></div>`;
}

private getWorkingKeysForRow(row: number): QuickKeyConfig[] {
  return this.workingConfig
    .filter(k => k.row === row && k.enabled)
    .sort((a, b) => a.order - b.order);
}
```

### Drag and Drop Handlers

Supports both touch and mouse events as first-class input methods.

```typescript
/**
 * Unified drag start handler for both touch and mouse events.
 */
private handleDragStart(e: TouchEvent | MouseEvent, key: string) {
  e.preventDefault();

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  this.dragStartX = clientX;
  this.dragStartY = clientY;
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

/**
 * Unified drag move handler for both touch and mouse events.
 */
private handleDragMove = (e: TouchEvent | MouseEvent) => {
  if (!this.draggedKey || !this.dragGhost) return;
  e.preventDefault();

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  // Move ghost
  this.dragGhost.style.left = `${clientX - 30}px`;
  this.dragGhost.style.top = `${clientY - 20}px`;

  // Find drop target
  this.dropTarget = this.findDropTarget(clientX, clientY);
};

/**
 * Unified drag end handler for both touch and mouse events.
 */
private handleDragEnd = (e: TouchEvent | MouseEvent) => {
  if (!this.draggedKey) return;
  e.preventDefault();

  if (this.dropTarget === 'hidden') {
    // Hide the key
    const config = this.workingConfig.find(k => k.key === this.draggedKey);
    if (config) config.enabled = false;
  } else if (this.dropTarget) {
    // Move the key
    this.moveKeyInWorking(this.draggedKey, this.dropTarget.row, this.dropTarget.order);
  }

  this.cleanupDrag();
};

private handleDragCancel = () => {
  this.cleanupDrag();
};

private cleanupDrag() {
  // Remove mouse listeners
  document.removeEventListener('mousemove', this.handleDragMove);
  document.removeEventListener('mouseup', this.handleDragEnd);

  if (this.dragGhost) {
    this.dragGhost.remove();
    this.dragGhost = null;
  }
  this.draggedKey = null;
  this.dropTarget = null;
}

private findDropTarget(x: number, y: number): { row: number; order: number } | 'hidden' | null {
  // Check if over hidden section
  const hiddenSection = this.renderRoot.querySelector('.hidden-section');
  if (hiddenSection) {
    const rect = hiddenSection.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return 'hidden';
    }
  }

  // Check each row
  for (const rowEl of this.renderRoot.querySelectorAll('.key-row')) {
    const rect = rowEl.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;

    const row = parseInt(rowEl.getAttribute('data-row') || '1');
    const tiles = rowEl.querySelectorAll('.key-tile');

    // Find insertion point
    for (let i = 0; i < tiles.length; i++) {
      const tileRect = tiles[i].getBoundingClientRect();
      const midX = tileRect.left + tileRect.width / 2;

      if (x < midX) {
        return { row, order: i };
      }
    }

    // After all tiles
    return { row, order: tiles.length };
  }

  return null;
}

private moveKeyInWorking(key: string, toRow: number, toOrder: number) {
  const config = this.workingConfig.find(k => k.key === key);
  if (!config) return;

  const fromRow = config.row;
  const fromOrder = config.order;

  if (fromRow === toRow && fromOrder === toOrder) return;

  // Remove from source
  for (const k of this.workingConfig) {
    if (k.row === fromRow && k.order > fromOrder && k.enabled) {
      k.order--;
    }
  }

  // Adjust target if same row moving forward
  let targetOrder = toOrder;
  if (fromRow === toRow && fromOrder < toOrder) {
    targetOrder--;
  }

  // Make room at target
  for (const k of this.workingConfig) {
    if (k.row === toRow && k.order >= targetOrder && k.enabled && k.key !== key) {
      k.order++;
    }
  }

  // Move
  config.row = toRow;
  config.order = targetOrder;
  config.enabled = true;

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
  QuickKeysPreferencesManager,
  type QuickKeyConfig
} from '../../utils/quick-keys-preferences.js';
```

**2. Add state:**
```typescript
@state() private quickKeysConfig?: QuickKeyConfig[];
private quickKeysUnsubscribe?: () => void;
```

**3. In connectedCallback:**
```typescript
// Subscribe to quick keys preferences
const qkManager = QuickKeysPreferencesManager.getInstance();
this.quickKeysConfig = qkManager.getEffectiveKeys();
this.quickKeysUnsubscribe = qkManager.subscribe(() => {
  this.quickKeysConfig = qkManager.getEffectiveKeys();
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
  .keyConfig=${this.quickKeysConfig}
></terminal-quick-keys>
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| All keys hidden | Allowed. Quick keys bar renders empty. User can reset via settings. |
| Empty row | Allowed. Row still renders but with no keys. |
| New keys in future | Sparse storage means new defaults appear automatically. |
| Corrupted localStorage | Catch parse error, fall back to defaults. |
| Done button | Not in configurable list. Always visible. |

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `web/src/client/utils/quick-keys-preferences.ts` | Create | Preferences manager + types + key definitions |
| `web/src/client/utils/constants.ts` | Modify | Add `QUICK_KEYS_EDITOR: 115` to Z_INDEX |
| `web/src/client/components/quick-keys-editor.ts` | Create | Drag-drop editor modal (touch + mouse) |
| `web/src/client/components/terminal-quick-keys.ts` | Modify | Add keyConfig prop, use for rendering |
| `web/src/client/components/settings.ts` | Modify | Add Quick Keys section (mobile) |
| `web/src/client/components/session-view/overlays-container.ts` | Modify | Subscribe and pass config |

---

## Implementation Order

1. Create `quick-keys-preferences.ts`
   - Export `QUICK_KEY_DEFINITIONS`, `QuickKeyDefinition`, types, manager class
   - Export `quickKeysPreferencesManager` singleton convenience

2. Modify `constants.ts`
   - Add `QUICK_KEYS_EDITOR: 115` to Z_INDEX

3. Modify `terminal-quick-keys.ts`
   - Import from preferences
   - Add keyConfig property
   - Add getVisibleKeysForRow method
   - Update render to use it
   - Test: defaults still work, no visual change

4. Modify `overlays-container.ts`
   - Subscribe to manager
   - Pass keyConfig to terminal-quick-keys
   - Test: still works, no visual change

5. Create `quick-keys-editor.ts`
   - Build modal UI
   - Implement drag-drop with touch AND mouse support
   - Test: can reorder and hide keys (both input methods)

6. Modify `settings.ts`
   - Add Quick Keys section
   - Wire up editor
   - Test: can open editor from settings

7. Run `pnpm run check`

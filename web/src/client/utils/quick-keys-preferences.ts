/**
 * Quick Keys Preferences Manager
 *
 * Manages the layout and visibility of mobile quick keys.
 * Persists to server-side config for cross-browser sync.
 */

// Key definitions - source of truth for all quick keys
export const QUICK_KEY_DEFINITIONS = [
  // Row 1 (12 keys)
  { key: 'Escape', label: 'Esc' },
  { key: 'Control', label: 'Ctrl', modifier: true },
  { key: 'CtrlExpand', label: '\u2303', toggle: true },
  { key: 'F', label: 'F', toggle: true },
  { key: 'Tab', label: 'Tab' },
  { key: 'shift_tab', label: 'S-Tab' },
  { key: 'ArrowUp', label: '\u2191', arrow: true },
  { key: 'ArrowDown', label: '\u2193', arrow: true },
  { key: 'ArrowLeft', label: '\u2190', arrow: true },
  { key: 'ArrowRight', label: '\u2192', arrow: true },
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
  { key: 'Option', label: '\u2325', modifier: true },
  { key: 'Command', label: '\u2318', modifier: true },
  { key: 'Ctrl+C', label: '^C', combo: true },
  { key: 'Ctrl+Z', label: '^Z', combo: true },
  { key: 'Ctrl+W', label: '^W', combo: true },
  { key: 'Ctrl+U', label: '^U', combo: true },
  { key: 'Ctrl+D', label: '^D', combo: true },
  { key: 'Ctrl+L', label: '^L', combo: true },
  { key: "'", label: "'" },
  { key: '"', label: '"' },
  { key: '{', label: '{' },
  { key: '}', label: '}' },
  { key: '[', label: '[' },
  { key: ']', label: ']' },
  { key: '(', label: '(' },
  { key: ')', label: ')' },
] as const;

// Derived type from QUICK_KEY_DEFINITIONS
export type QuickKeyId = (typeof QUICK_KEY_DEFINITIONS)[number]['key'];

// Static definition (from QUICK_KEY_DEFINITIONS)
export interface QuickKeyDefinition {
  key: QuickKeyId;
  label: string;
  modifier?: boolean; // Control, Option, Command - held as chord
  arrow?: boolean; // Arrow keys - support key repeat
  toggle?: boolean; // F, CtrlExpand - toggle expansion views
  combo?: boolean; // Ctrl+C, Ctrl+Z - pre-defined combinations
  func?: boolean; // F1-F12 function keys
  special?: boolean; // Done button, CtrlFull - special handling
  description?: string; // Tooltip text (used by CTRL_SHORTCUTS)
}

// Storage format - array of rows, each row is array of key IDs
export type QuickKeysLayout = QuickKeyId[][];

// In-memory state for rendering
export interface QuickKeysState {
  rows: QuickKeyDefinition[][]; // Full definitions, ready to render
  hidden: QuickKeyDefinition[]; // Keys not in any row
}

// Default layout matching the original terminal-quick-keys.ts
export const DEFAULT_LAYOUT: QuickKeysLayout = [
  [
    'Escape',
    'Control',
    'CtrlExpand',
    'F',
    'Tab',
    'shift_tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
  ],
  ['Home', 'Paste', 'End', 'Delete', '`', '~', '|', '/', '\\', '-'],
  ['Option', 'Command', 'Ctrl+C', 'Ctrl+Z', "'", '"', '{', '}', '[', ']', '(', ')'],
];

// Preset definition for quick layout switching
export interface QuickKeysPreset {
  id: string;
  name: string;
  icon: string;
  layout: QuickKeysLayout;
}

// Available presets
export const PRESETS: QuickKeysPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🤖',
    layout: [
      // Row 1: Vim mode essentials - exit insert, editing shortcuts
      ['Escape', 'Ctrl+C', 'Ctrl+W', 'Ctrl+U', 'shift_tab'],
      // Row 2: Navigation and completion
      ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete'],
      // Row 3: Scrolling and extras
      ['Home', 'End', 'PageUp', 'PageDown', 'Paste', '/'],
    ],
  },
];

// Map from key ID to definition for quick lookups
const KEY_DEFINITION_MAP = new Map<string, QuickKeyDefinition>(
  QUICK_KEY_DEFINITIONS.map((def) => [def.key, def as QuickKeyDefinition])
);

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
    const validKeys = new Set(QUICK_KEY_DEFINITIONS.map((d) => d.key));
    return data.every((row) => Array.isArray(row) && row.every((key) => validKeys.has(key)));
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
    for (const fn of this.listeners) {
      fn();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): QuickKeysState {
    const usedKeys = new Set(this.layout.flat());
    const rows = this.layout.map((row) =>
      row
        .map((key) => KEY_DEFINITION_MAP.get(key))
        .filter((def): def is QuickKeyDefinition => def !== undefined)
    );
    const hidden = QUICK_KEY_DEFINITIONS.filter(
      (d) => !usedKeys.has(d.key)
    ) as QuickKeyDefinition[];
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

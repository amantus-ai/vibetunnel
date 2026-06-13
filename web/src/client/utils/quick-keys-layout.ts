interface QuickKeyAttributes {
  key: string;
  label: string;
  modifier?: boolean;
  toggle?: boolean;
  arrow?: boolean;
  combo?: boolean;
}

export const QUICK_KEY_DEFINITIONS = [
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
] as const satisfies readonly QuickKeyAttributes[];

export type QuickKeyId = (typeof QUICK_KEY_DEFINITIONS)[number]['key'];
export type QuickKeyDefinition = QuickKeyAttributes & { key: QuickKeyId };
export type QuickKeysLayout = QuickKeyId[][];

export const DEFAULT_QUICK_KEYS_LAYOUT: QuickKeysLayout = [
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

export const COMPACT_QUICK_KEYS_LAYOUT: QuickKeysLayout = [
  [
    'Escape',
    'Control',
    'Tab',
    'shift_tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
  ],
  ['Home', 'Paste', 'End', 'Delete', 'Option', 'Command', 'Ctrl+C', 'Ctrl+Z', '/', '-'],
];

export const QUICK_KEYS_PRESETS = [
  { id: 'default', name: 'Default', layout: DEFAULT_QUICK_KEYS_LAYOUT },
  { id: 'compact', name: 'Compact', layout: COMPACT_QUICK_KEYS_LAYOUT },
] as const;

export const QUICK_KEYS_STORAGE_KEY = 'vibetunnel.quickKeys.v1';
export const QUICK_KEYS_LAYOUT_CHANGED_EVENT = 'vibetunnel-quick-keys-layout-changed';

const STORAGE_VERSION = 1;
const MIN_ROWS = 2;
const MAX_ROWS = 3;
const MAX_KEYS_PER_ROW = 12;
const VALID_KEY_IDS = new Set<string>(QUICK_KEY_DEFINITIONS.map(({ key }) => key));
const DEFINITION_BY_ID = new Map<QuickKeyId, QuickKeyDefinition>(
  QUICK_KEY_DEFINITIONS.map((definition) => [definition.key, definition as QuickKeyDefinition])
);

function cloneLayout(layout: QuickKeysLayout): QuickKeysLayout {
  return layout.map((row) => [...row]);
}

export function isValidQuickKeysLayout(value: unknown): value is QuickKeysLayout {
  if (!Array.isArray(value) || value.length < MIN_ROWS || value.length > MAX_ROWS) {
    return false;
  }

  const usedKeys = new Set<string>();
  for (const row of value) {
    if (!Array.isArray(row) || row.length === 0 || row.length > MAX_KEYS_PER_ROW) {
      return false;
    }

    for (const key of row) {
      if (typeof key !== 'string' || !VALID_KEY_IDS.has(key) || usedKeys.has(key)) {
        return false;
      }
      usedKeys.add(key);
    }
  }

  return true;
}

export function loadQuickKeysLayout(): QuickKeysLayout {
  try {
    const stored = localStorage.getItem(QUICK_KEYS_STORAGE_KEY);
    if (!stored) {
      return cloneLayout(DEFAULT_QUICK_KEYS_LAYOUT);
    }

    const parsed = JSON.parse(stored) as { version?: unknown; rows?: unknown };
    if (parsed.version === STORAGE_VERSION && isValidQuickKeysLayout(parsed.rows)) {
      return cloneLayout(parsed.rows);
    }
  } catch {
    // Storage can be unavailable in private browsing or restricted embedded contexts.
  }

  return cloneLayout(DEFAULT_QUICK_KEYS_LAYOUT);
}

export function saveQuickKeysLayout(layout: QuickKeysLayout): boolean {
  if (!isValidQuickKeysLayout(layout)) {
    return false;
  }

  try {
    localStorage.setItem(
      QUICK_KEYS_STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, rows: layout })
    );
    window.dispatchEvent(new CustomEvent(QUICK_KEYS_LAYOUT_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function resetQuickKeysLayout(): boolean {
  try {
    localStorage.removeItem(QUICK_KEYS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(QUICK_KEYS_LAYOUT_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function subscribeToQuickKeysLayout(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === QUICK_KEYS_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(QUICK_KEYS_LAYOUT_CHANGED_EVENT, listener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(QUICK_KEYS_LAYOUT_CHANGED_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getQuickKeyDefinition(key: QuickKeyId): QuickKeyDefinition {
  const definition = DEFINITION_BY_ID.get(key);
  if (!definition) {
    throw new Error(`Unknown quick key: ${key}`);
  }
  return definition;
}

export function getHiddenQuickKeys(layout: QuickKeysLayout): QuickKeyDefinition[] {
  const visible = new Set(layout.flat());
  return QUICK_KEY_DEFINITIONS.filter(({ key }) => !visible.has(key)) as QuickKeyDefinition[];
}

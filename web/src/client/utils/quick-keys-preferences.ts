/**
 * Quick Keys Preferences Manager
 *
 * Manages the layout and visibility of mobile quick keys.
 * Persists to server-side config for cross-browser sync.
 */
import { html, type TemplateResult } from 'lit';

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
  icon: TemplateResult | string;
  layout: QuickKeysLayout;
}

export const PRESETS: QuickKeysPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: html`<svg
      width="16"
      height="16"
      viewBox="0 0 248 248"
      fill="#D97757"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z"
      />
    </svg>`,
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

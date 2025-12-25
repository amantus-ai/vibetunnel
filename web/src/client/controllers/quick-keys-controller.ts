/**
 * Quick Keys Controller
 *
 * Lit Reactive Controller for managing quick keys state in components.
 * Encapsulates subscription logic to minimize integration points in host components.
 *
 * FORK INTEGRATION POINTS:
 * This file is fork-only (zero conflict risk with upstream).
 *
 * Files requiring minimal upstream modifications to use this controller:
 * 1. overlays-container.ts - Add: import, controller instance, pass .rows prop (3 lines)
 * 2. settings.ts - Add: import quick-keys-settings-section.ts, use component tag (2 lines)
 * 3. terminal-quick-keys.ts - Add: optional rows prop with fallback (already done)
 * 4. config-service.ts - Add: quickKeysLayout schema field + getter/setter (4 lines)
 * 5. config.ts - Add: quickKeysLayout?: string[][] field (1 line)
 *
 * All fork-specific logic lives in:
 * - controllers/quick-keys-controller.ts (this file)
 * - components/quick-keys-editor.ts
 * - components/quick-keys-settings-section.ts
 * - utils/quick-keys-preferences.ts
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  type QuickKeyDefinition,
  quickKeysPreferencesManager,
} from '../utils/quick-keys-preferences.js';

export class QuickKeysController implements ReactiveController {
  private host: ReactiveControllerHost;
  private unsubscribe?: () => void;

  /** Current keyboard layout rows, ready for rendering */
  rows?: QuickKeyDefinition[][];

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    // Load initial state from server
    quickKeysPreferencesManager.load().then(() => {
      this.rows = quickKeysPreferencesManager.getState().rows;
      this.host.requestUpdate();
    });

    // Subscribe to changes (e.g., from quick-keys-editor)
    this.unsubscribe = quickKeysPreferencesManager.subscribe(() => {
      this.rows = quickKeysPreferencesManager.getState().rows;
      this.host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
  }
}

import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

// Type definitions for Tauri API
interface TauriAPI {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriShell {
  open(url: string): Promise<void>;
}

interface TauriEvent {
  listen<T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void
  ): Promise<() => void>;
  emit(event: string, payload?: unknown): Promise<void>;
}

interface TauriPath {
  appDataDir(): Promise<string>;
  appLocalDataDir(): Promise<string>;
  appCacheDir(): Promise<string>;
  appConfigDir(): Promise<string>;
  appLogDir(): Promise<string>;
}

interface TauriWindow {
  getCurrent(): TauriWindowInstance;
}

interface TauriWindowInstance {
  setTitle(title: string): Promise<void>;
  close(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
}

declare global {
  interface Window {
    __TAURI__?: {
      tauri: TauriAPI;
      shell: TauriShell;
      event: TauriEvent;
      path: TauriPath;
      window: TauriWindow;
    };
  }
}

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

export abstract class TauriBase extends LitElement {
  @property({ type: Boolean })
  tauriAvailable = false;

  @property({ type: Boolean })
  loading = false;

  @property({ type: String })
  error: string | null = null;

  protected invoke?: TauriAPI['invoke'];
  protected open?: TauriShell['open'];
  protected event?: TauriEvent;
  protected path?: TauriPath;
  protected window?: TauriWindow;

  private _eventListeners: Array<() => void> = [];

  constructor() {
    super();
    this._initializeTauri();
  }

  private _initializeTauri(): void {
    if (window.__TAURI__) {
      this.tauriAvailable = true;
      this.invoke = window.__TAURI__.tauri.invoke;
      this.open = window.__TAURI__.shell.open;
      this.event = window.__TAURI__.event;
      this.path = window.__TAURI__.path;
      this.window = window.__TAURI__.window;
    } else {
      console.warn('Tauri API not available');
    }
  }

  protected async safeInvoke<T = unknown>(
    command: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.tauriAvailable || !this.invoke) {
      throw new Error('Tauri not available');
    }
    
    try {
      this.loading = true;
      this.error = null;
      const result = await this.invoke<T>(command, args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      this.error = message;
      console.error(`Error invoking ${command}:`, error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  protected async listen<T = unknown>(
    eventName: string,
    handler: (event: { payload: T }) => void
  ): Promise<(() => void) | undefined> {
    if (!this.tauriAvailable || !this.event) return undefined;
    
    try {
      const unlisten = await this.event.listen<T>(eventName, handler);
      // Store unlisten function for cleanup
      this._eventListeners.push(unlisten);
      return unlisten;
    } catch (error) {
      console.error(`Error listening to ${eventName}:`, error);
      return undefined;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Clean up event listeners
    this._eventListeners.forEach(unlisten => unlisten());
    this._eventListeners = [];
  }

  // Common Tauri commands with type safety
  async showNotification(
    title: string,
    body: string,
    severity: NotificationSeverity = 'info'
  ): Promise<void> {
    return this.safeInvoke<void>('show_notification', { title, body, severity });
  }

  async openSettings(tab?: string): Promise<void> {
    const args = tab ? { tab } : {};
    return this.safeInvoke<void>('open_settings_window', args);
  }

  async openExternal(url: string): Promise<void> {
    if (this.open) {
      return this.open(url);
    }
    throw new Error('Cannot open external URL');
  }

  // Additional typed helper methods
  async getAppVersion(): Promise<string> {
    return this.safeInvoke<string>('get_app_version');
  }

  async checkForUpdates(): Promise<boolean> {
    return this.safeInvoke<boolean>('check_for_updates');
  }

  async getSessions(): Promise<Array<{ id: string; name: string; active: boolean; createdAt?: string; lastUsed?: string }>> {
    return this.safeInvoke('get_sessions');
  }

  async createSession(name: string): Promise<string> {
    return this.safeInvoke<string>('create_session', { name });
  }

  async deleteSession(id: string): Promise<void> {
    return this.safeInvoke<void>('delete_session', { id });
  }
}
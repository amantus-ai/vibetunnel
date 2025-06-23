import { createContext } from '@lit/context';

// Define the shape of our app state
export interface Session {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastUsed: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  terminalWidth: number;
  enableNotifications: boolean;
  startupBehavior: 'show' | 'hide' | 'minimize';
  autoUpdate: boolean;
  soundEnabled: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  connected: boolean;
  autoReconnect: boolean;
  reconnectInterval: number;
}

export interface AppState {
  // Sessions
  sessions: Session[];
  currentSessionId: string | null;
  
  // User preferences
  preferences: UserPreferences;
  
  // Server configuration
  serverConfig: ServerConfig;
  
  // UI State
  isLoading: boolean;
  error: string | null;
  sidebarOpen: boolean;
  
  // Terminal state
  terminalBuffer: string[];
  terminalCursorPosition: { x: number; y: number };
  
  // Notifications
  notifications: Array<{
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    timestamp: number;
  }>;
}

// Create default state
export const defaultAppState: AppState = {
  sessions: [],
  currentSessionId: null,
  preferences: {
    theme: 'system',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    terminalWidth: 80,
    enableNotifications: true,
    startupBehavior: 'show',
    autoUpdate: true,
    soundEnabled: false
  },
  serverConfig: {
    host: 'localhost',
    port: 5173,
    connected: false,
    autoReconnect: true,
    reconnectInterval: 5000
  },
  isLoading: false,
  error: null,
  sidebarOpen: true,
  terminalBuffer: [],
  terminalCursorPosition: { x: 0, y: 0 },
  notifications: []
};

// Create the context with a symbol for type safety
export const appContext = createContext<AppState>('app-context');

// Action types for state updates
export interface AppActions {
  // Session actions
  setSessions(sessions: Session[]): void;
  addSession(session: Session): void;
  removeSession(sessionId: string): void;
  setCurrentSession(sessionId: string | null): void;
  updateSession(sessionId: string, updates: Partial<Session>): void;
  
  // Preference actions
  updatePreferences(preferences: Partial<UserPreferences>): void;
  
  // Server actions
  updateServerConfig(config: Partial<ServerConfig>): void;
  setConnectionStatus(connected: boolean): void;
  
  // UI actions
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  toggleSidebar(): void;
  
  // Terminal actions
  appendToBuffer(data: string): void;
  clearBuffer(): void;
  setCursorPosition(position: { x: number; y: number }): void;
  
  // Notification actions
  addNotification(notification: Omit<AppState['notifications'][0], 'id' | 'timestamp'>): void;
  removeNotification(id: string): void;
  clearNotifications(): void;
}

// Create context for actions
export const appActionsContext = createContext<AppActions>('app-actions');

// Helper function to generate unique IDs
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
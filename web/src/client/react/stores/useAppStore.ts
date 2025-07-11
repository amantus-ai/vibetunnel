import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Session } from '../../../shared/types';

interface User {
  id: string;
  username: string;
  token: string;
}

interface AppSettings {
  theme: 'dark' | 'light';
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
  bellStyle: 'none' | 'visual' | 'sound' | 'both';
  tabStopWidth: number;
}

interface AppState {
  // Auth state
  user: User | null;
  isAuthenticated: boolean;
  
  // Session state
  sessions: Session[];
  activeSessionId: string | null;
  
  // UI state
  sidebarOpen: boolean;
  settingsOpen: boolean;
  
  // Settings
  settings: AppSettings;
  
  // Actions
  setUser: (user: User | null) => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  setSessions: (sessions: Session[]) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 1000,
  bellStyle: 'visual',
  tabStopWidth: 8,
};

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        user: null,
        isAuthenticated: false,
        sessions: [],
        activeSessionId: null,
        sidebarOpen: false,
        settingsOpen: false,
        settings: defaultSettings,

        // Actions
        setUser: (user) =>
          set((state) => {
            state.user = user;
          }),

        setAuthenticated: (isAuthenticated) =>
          set((state) => {
            state.isAuthenticated = isAuthenticated;
          }),

        setSessions: (sessions) =>
          set((state) => {
            state.sessions = sessions;
          }),

        updateSession: (sessionId, updates) =>
          set((state) => {
            const session = state.sessions.find((s) => s.id === sessionId);
            if (session) {
              Object.assign(session, updates);
            }
          }),

        removeSession: (sessionId) =>
          set((state) => {
            state.sessions = state.sessions.filter((s) => s.id !== sessionId);
            if (state.activeSessionId === sessionId) {
              state.activeSessionId = null;
            }
          }),

        setActiveSession: (sessionId) =>
          set((state) => {
            state.activeSessionId = sessionId;
          }),

        toggleSidebar: () =>
          set((state) => {
            state.sidebarOpen = !state.sidebarOpen;
          }),

        toggleSettings: () =>
          set((state) => {
            state.settingsOpen = !state.settingsOpen;
          }),

        updateSettings: (updates) =>
          set((state) => {
            Object.assign(state.settings, updates);
          }),

        resetSettings: () =>
          set((state) => {
            state.settings = defaultSettings;
          }),
      })),
      {
        name: 'vibetunnel-app-store',
        partialize: (state) => ({
          settings: state.settings,
          sidebarOpen: state.sidebarOpen,
        }),
      }
    ),
    {
      name: 'VibeTunnel Store',
    }
  )
);

// Selectors
export const useUser = () => useAppStore((state) => state.user);
export const useIsAuthenticated = () => useAppStore((state) => state.isAuthenticated);
export const useSessions = () => useAppStore((state) => state.sessions);
export const useActiveSession = () => {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  return sessions.find((s) => s.id === activeSessionId);
};
export const useSettings = () => useAppStore((state) => state.settings);
export const useSidebarOpen = () => useAppStore((state) => state.sidebarOpen);
export const useSettingsOpen = () => useAppStore((state) => state.settingsOpen);
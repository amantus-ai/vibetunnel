import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Session } from '../../../shared/types';

interface SessionContextType {
  sessions: Session[];
  activeSessions: Session[];
  setSessions: (sessions: Session[]) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  addSession: (session: Session) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
};

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const activeSessions = sessions.filter((s) => s.status === 'running');

  const updateSession = useCallback((sessionId: string, updates: Partial<Session>) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === sessionId ? { ...session, ...updates } : session))
    );
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
  }, []);

  const addSession = useCallback((session: Session) => {
    setSessions((prev) => [...prev, session]);
  }, []);

  const value = {
    sessions,
    activeSessions,
    setSessions,
    updateSession,
    removeSession,
    addSession,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

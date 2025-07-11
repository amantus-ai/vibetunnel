import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../../../shared/types';
import { createLogger } from '../../utils/logger';
import { useAsync } from './useAsync';

const logger = createLogger('useSessionApi');

interface CreateSessionOptions {
  name?: string;
  cols?: number;
  rows?: number;
  workingDir?: string;
}

interface UseSessionApiReturn {
  sessions: Session[];
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
  createSession: (options?: CreateSessionOptions) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  isCreating: boolean;
  isDeleting: boolean;
}

export function useSessionApi(): UseSessionApiReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const fetchAsync = useAsync<Session[]>();
  const createAsync = useAsync<Session>();
  const deleteAsync = useAsync<void>();

  const fetchSessions = useCallback(async () => {
    const response = await fetch('/api/sessions');
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.statusText}`);
    }
    return response.json();
  }, []);

  const refetch = useCallback(async () => {
    try {
      const data = await fetchAsync.execute(fetchSessions);
      setSessions(data);
    } catch (error) {
      logger.error('Failed to fetch sessions:', error);
    }
  }, [fetchAsync, fetchSessions]);

  const createSession = useCallback(
    async (options: CreateSessionOptions = {}) => {
      const sessionData = {
        name: options.name || `Session ${sessions.length + 1}`,
        cols: options.cols || 80,
        rows: options.rows || 24,
        workingDir: options.workingDir,
      };

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const newSession = await response.json();
      const result = await createAsync.execute(async () => newSession);
      
      // Optimistically update the list
      setSessions((prev) => [...prev, result]);
      
      return result;
    },
    [sessions.length, createAsync]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await deleteAsync.execute(async () => {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(`Failed to delete session: ${response.statusText}`);
        }
      });

      // Optimistically update the list
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    },
    [deleteAsync]
  );

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Set up polling
  useEffect(() => {
    const interval = setInterval(refetch, 5000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    sessions,
    isLoading: fetchAsync.isLoading,
    error: fetchAsync.error,
    refetch,
    createSession,
    deleteSession,
    isCreating: createAsync.isLoading,
    isDeleting: deleteAsync.isLoading,
  };
}
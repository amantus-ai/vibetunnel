import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../../../shared/types';
import { createLogger } from '../../utils/logger';
import { Header } from '../components/Header';
import { SessionCard } from '../components/SessionCard';
import { Settings } from '../components/Settings';
import { useAppStore, useSettingsOpen } from '../stores/useAppStore';

const logger = createLogger('SessionsPage');

// API functions
const sessionApi = {
  fetchAll: async (): Promise<Session[]> => {
    const response = await fetch('/api/sessions');
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  },

  create: async (data: { name: string; cols: number; rows: number }): Promise<Session> => {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
  },

  delete: async (sessionId: string): Promise<void> => {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete session');
  },
};

// Memoized components
const SessionGrid = memo(
  ({
    sessions,
    onSessionClick,
    onSessionDelete,
  }: {
    sessions: Session[];
    onSessionClick: (id: string) => void;
    onSessionDelete: (id: string) => void;
  }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onClick={onSessionClick}
          onDelete={onSessionDelete}
        />
      ))}
    </div>
  )
);

SessionGrid.displayName = 'SessionGrid';

const EmptyState = memo(({ onCreateSession }: { onCreateSession: () => void }) => (
  <div className="text-center py-20">
    <svg
      className="w-24 h-24 mx-auto text-gray-600 mb-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
    <h2 className="text-2xl font-semibold text-gray-400 mb-2">No terminal sessions</h2>
    <p className="text-gray-500 mb-6">Create your first session to get started</p>
    <button
      type="button"
      onClick={onCreateSession}
      className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
    >
      Create First Session
    </button>
  </div>
));

EmptyState.displayName = 'EmptyState';

export function SessionsPageRefactored() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toggleSettings } = useAppStore();
  const settingsOpen = useSettingsOpen();

  // React Query hooks
  const {
    data: sessions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionApi.fetchAll,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const createMutation = useMutation({
    mutationFn: sessionApi.create,
    onMutate: async (newSession) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const previousSessions = queryClient.getQueryData<Session[]>(['sessions']);

      const optimisticSession: Session = {
        id: `temp-${Date.now()}`,
        name: newSession.name,
        status: 'starting',
        workingDir: '~',
        command: [],
        startedAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      queryClient.setQueryData<Session[]>(['sessions'], (old = []) => [...old, optimisticSession]);

      return { previousSessions };
    },
    onError: (err, _variables, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions'], context.previousSessions);
      }
      logger.error('Failed to create session:', err);
    },
    onSuccess: (newSession) => {
      navigate(`/sessions/${newSession.id}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: sessionApi.delete,
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const previousSessions = queryClient.getQueryData<Session[]>(['sessions']);

      queryClient.setQueryData<Session[]>(['sessions'], (old = []) =>
        old.filter((session) => session.id !== sessionId)
      );

      return { previousSessions };
    },
    onError: (err, _variables, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions'], context.previousSessions);
      }
      logger.error('Failed to delete session:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const handleCreateSession = useCallback(() => {
    createMutation.mutate({
      name: `Session ${sessions.length + 1}`,
      cols: 80,
      rows: 24,
    });
  }, [createMutation, sessions.length]);

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      navigate(`/sessions/${sessionId}`);
    },
    [navigate]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm('Are you sure you want to delete this session?')) return;
      deleteMutation.mutate(sessionId);
    },
    [deleteMutation]
  );

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load sessions</p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['sessions'] })}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title="Terminal Sessions"
        rightContent={
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={toggleSettings}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => navigate('/files')}
              className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span>File Editor</span>
            </button>
            <button
              type="button"
              onClick={handleCreateSession}
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>{createMutation.isPending ? 'Creating...' : 'New Session'}</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="text-center py-20">
              <div className="inline-flex items-center space-x-2 text-gray-400">
                <svg
                  className="animate-spin h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Loading sessions...</span>
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState onCreateSession={handleCreateSession} />
          ) : (
            <SessionGrid
              sessions={sessions}
              onSessionClick={handleSessionClick}
              onSessionDelete={handleDeleteSession}
            />
          )}
        </div>
      </div>

      <Settings isOpen={settingsOpen} onClose={toggleSettings} />
    </div>
  );
}

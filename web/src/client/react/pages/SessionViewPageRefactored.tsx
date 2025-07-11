import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '../../../shared/types';
import { createLogger } from '../../utils/logger';
import { Header } from '../components/Header';
import { Terminal, type TerminalHandle } from '../components/TerminalRefactored';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAppStore } from '../stores/useAppStore';

const logger = createLogger('SessionViewPage');

// Session API
const sessionApi = {
  fetchSession: async (sessionId: string): Promise<Session> => {
    const response = await fetch(`/api/sessions/${sessionId}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Session not found');
      }
      throw new Error('Failed to fetch session');
    }
    return response.json();
  },

  resizeSession: async (sessionId: string, cols: number, rows: number): Promise<void> => {
    const response = await fetch(`/api/sessions/${sessionId}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    });
    if (!response.ok) {
      throw new Error('Failed to resize session');
    }
  },
};

// Session status indicator component
const SessionStatus = memo(({ session }: { session: Session }) => {
  const isRunning = session.status === 'running';

  return (
    <div className="flex items-center space-x-4">
      <div className="text-sm text-gray-400 font-mono">
        {session.initialCols || 80}×{session.initialRows || 24}
      </div>
      <div
        className={`flex items-center space-x-1 text-sm ${
          isRunning ? 'text-green-500' : 'text-gray-500'
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
          }`}
        />
        <span>{session.status}</span>
      </div>
    </div>
  );
});

SessionStatus.displayName = 'SessionStatus';

export function SessionViewPageRefactored() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const terminalRef = useRef<TerminalHandle>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  // Store actions
  const { setActiveSession } = useAppStore();

  // Fetch session data
  const {
    data: session,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionApi.fetchSession(sessionId!),
    enabled: !!sessionId,
    retry: (failureCount, error) => {
      if (error.message === 'Session not found') return false;
      return failureCount < 3;
    },
  });

  // WebSocket for input
  const { sendMessage, readyState } = useWebSocket({
    url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
      window.location.host
    }/ws/input?sessionId=${sessionId}&token=${encodeURIComponent(
      localStorage.getItem('vibetunnel_auth_token') || ''
    )}`,
    shouldConnect: !!sessionId && terminalReady,
    onError: (event) => {
      logger.error('WebSocket error:', event);
    },
  });

  // Set active session
  useEffect(() => {
    if (sessionId) {
      setActiveSession(sessionId);
    }
    return () => {
      setActiveSession(null);
    };
  }, [sessionId, setActiveSession]);

  // Set up SSE for terminal output
  useEffect(() => {
    if (!sessionId || !terminalReady) return;

    logger.log(`Setting up SSE stream for session ${sessionId}`);

    const eventSource = new EventSource(`/api/sessions/${sessionId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      logger.log('SSE connection opened');
    };

    eventSource.onmessage = (event) => {
      if (terminalRef.current && event.data) {
        terminalRef.current.write(event.data);
      }
    };

    eventSource.onerror = (error) => {
      logger.error('SSE connection error:', error);

      // Check if the session still exists
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    };

    return () => {
      logger.log('Closing SSE connection');
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, terminalReady, queryClient]);

  // Handle terminal data input
  const handleTerminalData = useCallback(
    (data: string) => {
      if (readyState === WebSocket.OPEN) {
        sendMessage(JSON.stringify({ text: data }));
      } else {
        logger.warn('WebSocket not ready, input dropped');
      }
    },
    [readyState, sendMessage]
  );

  // Handle terminal resize
  const handleTerminalResize = useCallback(
    async (cols: number, rows: number) => {
      if (!sessionId) return;

      try {
        await sessionApi.resizeSession(sessionId, cols, rows);

        // Update local cache
        queryClient.setQueryData(['session', sessionId], (old: Session | undefined) => {
          if (!old) return old;
          return { ...old, initialCols: cols, initialRows: rows };
        });
      } catch (err) {
        logger.error('Failed to resize terminal:', err);
      }
    },
    [sessionId, queryClient]
  );

  // Handle bell
  const handleBell = useCallback(() => {
    const settings = useAppStore.getState().settings;

    if (settings.bellStyle === 'sound' || settings.bellStyle === 'both') {
      // Play bell sound
      const audio = new Audio(
        'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE'
      );
      audio.play().catch(() => {
        // Ignore audio play errors
      });
    }
  }, []);

  // Handle terminal ready
  const handleTerminalReady = useCallback(() => {
    setTerminalReady(true);
    terminalRef.current?.focus();
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-white">Loading session...</div>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error?.message || 'Session not found'}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Back to Sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title={session.name || `Session ${session.id}`}
        showBackButton
        rightContent={<SessionStatus session={session} />}
      />

      <div className="flex-1 overflow-hidden">
        <Terminal
          ref={terminalRef}
          sessionId={sessionId!}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
          onBell={handleBell}
          onReady={handleTerminalReady}
          initialCols={session.initialCols}
          initialRows={session.initialRows}
          className="h-full"
        />
      </div>
    </div>
  );
}

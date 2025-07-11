import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WebSocketInputClient } from '../../services/websocket-input-client';
import { createLogger } from '../../utils/logger';
import { Header } from '../components/Header';
import { Terminal, type TerminalHandle } from '../components/Terminal';
import { useSession } from '../contexts/SessionContext';

const logger = createLogger('SessionViewPage');

export function SessionViewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessions, updateSession } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const terminalRef = useRef<TerminalHandle>(null);
  const wsInputClientRef = useRef<WebSocketInputClient | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const session = sessions.find((s) => s.id === sessionId);

  // Initialize connections
  useEffect(() => {
    if (!sessionId || !session) return;

    const initializeConnections = async () => {
      try {
        // Initialize WebSocket input client
        const wsInputClient = new WebSocketInputClient();
        wsInputClientRef.current = wsInputClient;
        await wsInputClient.connect(session);

        // Set up SSE stream for terminal output
        const eventSource = new EventSource(`/api/sessions/${sessionId}/stream`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          if (terminalRef.current && event.data) {
            terminalRef.current.write(event.data);
          }
        };

        eventSource.onerror = (error) => {
          logger.error('SSE connection error:', error);
          setError('Connection lost. Please refresh the page.');
          eventSource.close();
        };

        setIsLoading(false);
      } catch (err) {
        logger.error('Failed to initialize connections:', err);
        setError('Failed to connect to session');
        setIsLoading(false);
      }
    };

    initializeConnections();

    // Cleanup
    return () => {
      wsInputClientRef.current?.disconnect();
      eventSourceRef.current?.close();
    };
  }, [sessionId, session]);

  // Handle terminal input
  const handleTerminalData = useCallback(
    (data: string) => {
      if (wsInputClientRef.current && sessionId) {
        const success = wsInputClientRef.current.sendInput({ text: data });
        if (!success) {
          logger.warn('Failed to send input via WebSocket, would fall back to HTTP');
        }
      }
    },
    [sessionId]
  );

  // Handle terminal resize
  const handleTerminalResize = useCallback(
    async (cols: number, rows: number) => {
      if (!sessionId) return;

      try {
        const response = await fetch(`/api/sessions/${sessionId}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols, rows }),
        });

        if (response.ok) {
          updateSession(sessionId, { initialCols: cols, initialRows: rows });
        }
      } catch (err) {
        logger.error('Failed to resize terminal:', err);
      }
    },
    [sessionId, updateSession]
  );

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }
  }, [sessionId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white">Loading session...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white">Session not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title={session.name || `Session ${session.id}`}
        showBackButton
        rightContent={
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-400">
              {session.initialCols || 80}×{session.initialRows || 24}
            </div>
            <div
              className={`flex items-center space-x-1 text-sm ${session.status === 'running' ? 'text-green-500' : 'text-gray-500'}`}
            >
              <div
                className={`w-2 h-2 rounded-full ${session.status === 'running' ? 'bg-green-500' : 'bg-gray-500'}`}
              />
              <span>{session.status}</span>
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden">
        <Terminal
          ref={terminalRef}
          sessionId={sessionId || ''}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
          initialCols={session.initialCols || 80}
          initialRows={session.initialRows || 24}
        />
      </div>
    </div>
  );
}

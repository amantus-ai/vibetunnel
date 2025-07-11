import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { SessionCard } from '../components/SessionCard';
import { useSession } from '../contexts/SessionContext';

export function SessionsPage() {
  const { sessions, setSessions, removeSession } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [setSessions]);

  useEffect(() => {
    fetchSessions();

    // Poll for session updates
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleSessionClick = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
  };

  const handleCreateSession = async () => {
    if (isCreating) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Session ${sessions.length + 1}`,
          cols: 80,
          rows: 24,
        }),
      });

      if (response.ok) {
        const newSession = await response.json();
        navigate(`/sessions/${newSession.id}`);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        removeSession(sessionId);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-white">Loading sessions...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title="Terminal Sessions"
        rightContent={
          <button
            type="button"
            onClick={handleCreateSession}
            disabled={isCreating}
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
            <span>{isCreating ? 'Creating...' : 'New Session'}</span>
          </button>
        }
      />

      <div className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {sessions.length === 0 ? (
            <div className="text-center py-20">
              <svg
                className="w-24 h-24 mx-auto text-gray-600 mb-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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
                onClick={handleCreateSession}
                disabled={isCreating}
                className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create First Session'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={handleSessionClick}
                  onDelete={handleDeleteSession}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

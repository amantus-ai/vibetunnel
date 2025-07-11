import type { Session } from '../../../shared/types';

interface SessionCardProps {
  session: Session;
  onClick: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionCard({ session, onClick, onDelete }: SessionCardProps) {
  const isConnected = session.status === 'running';
  const statusColor = isConnected ? 'text-green-500' : 'text-gray-500';

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <div
      className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 transition-all duration-200 transform hover:scale-[1.02] relative group"
      onClick={() => onClick(session.id)}
    >
      {/* Status indicator */}
      <div
        className={`absolute top-4 right-4 w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`}
      />

      {/* Session info */}
      <h3 className="text-lg font-semibold text-white mb-2">
        {session.name || `Session ${session.id.slice(0, 8)}`}
      </h3>

      <div className="space-y-1 text-sm">
        <div className="flex items-center text-gray-400">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          {session.initialCols || 80}×{session.initialRows || 24}
        </div>

        {session.workingDir && (
          <div className="flex items-center text-gray-400">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <span className="truncate">{session.workingDir}</span>
          </div>
        )}

        <div className="flex items-center text-gray-400">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {formatDate(session.lastModified)}
        </div>

        <div className={`flex items-center ${statusColor}`}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"
            />
          </svg>
          {session.status}
        </div>
      </div>

      {/* Delete button (shown on hover) */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
          className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-red-500 hover:text-red-400"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

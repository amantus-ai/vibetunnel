import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface HeaderProps {
  title?: string;
  showBackButton?: boolean;
  rightContent?: React.ReactNode;
}

export function Header({
  title = 'VibeTunnel',
  showBackButton = false,
  rightContent,
}: HeaderProps) {
  const navigate = useNavigate();
  const { logout, username } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {showBackButton && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          <h1 className="text-xl font-semibold text-white">{title}</h1>
        </div>

        <div className="flex items-center space-x-4">
          {rightContent}
          {username && (
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-400">{username}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

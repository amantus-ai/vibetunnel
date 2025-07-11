import { useCallback, useEffect, useState } from 'react';
import { createLogger } from '../../utils/logger';
import { useAsync } from './useAsync';

const logger = createLogger('useAuth');

interface User {
  id: string;
  username: string;
  token: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | undefined;
}

interface UseAuthReturn extends AuthState {
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const TOKEN_KEY = 'vibetunnel_auth_token';
const USER_KEY = 'vibetunnel_user';

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const loginAsync = useAsync<User>();
  const logoutAsync = useAsync<void>();
  const checkAsync = useAsync<AuthState>();

  // Load saved auth state
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);

    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        setIsAuthenticated(true);
      } catch (error) {
        logger.error('Failed to parse saved user:', error);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
  }, []);

  const checkAuth = useCallback(async () => {
    await checkAsync.execute(async () => {
      const response = await fetch('/api/auth/status');
      if (!response.ok) {
        throw new Error('Failed to check auth status');
      }

      const data = await response.json();
      const authState: AuthState = {
        user: data.user || null,
        isAuthenticated: data.authenticated || false,
        isLoading: false,
        error: undefined,
      };

      setUser(authState.user);
      setIsAuthenticated(authState.isAuthenticated);

      return authState;
    });
  }, [checkAsync]);

  const login = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        const user = await loginAsync.execute(async () => {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });

          if (!response.ok) {
            if (response.status === 401) {
              throw new Error('Invalid password');
            }
            throw new Error(`Login failed: ${response.statusText}`);
          }

          const data = await response.json();
          return data.user as User;
        });

        // Save to state and localStorage
        setUser(user);
        setIsAuthenticated(true);
        localStorage.setItem(TOKEN_KEY, user.token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));

        logger.log('Login successful');
        return true;
      } catch (error) {
        logger.error('Login failed:', error);
        return false;
      }
    },
    [loginAsync]
  );

  const logout = useCallback(async () => {
    await logoutAsync.execute(async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Logout failed');
      }
    });

    // Clear state and localStorage
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);

    logger.log('Logout successful');
  }, [logoutAsync]);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    user,
    isAuthenticated,
    isLoading: loginAsync.isLoading || checkAsync.isLoading,
    error: loginAsync.error || checkAsync.error,
    login,
    logout,
    checkAuth,
  };
}

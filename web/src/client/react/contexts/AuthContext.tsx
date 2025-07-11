import React, { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { AuthClient } from '../../services/auth-client';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  const authClient = React.useMemo(() => new AuthClient(), []);

  const checkAuthStatus = useCallback(async () => {
    try {
      const verified = await authClient.verifyToken();
      setIsAuthenticated(verified);
      if (verified) {
        const user = authClient.getCurrentUser();
        setUsername(user?.userId || null);
      } else {
        setUsername(null);
      }
    } catch (_error) {
      setIsAuthenticated(false);
      setUsername(null);
    }
  }, [authClient]);

  const login = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        const systemUser = await authClient.getCurrentSystemUser();
        const result = await authClient.authenticateWithPassword(systemUser, password);
        if (result.success) {
          setIsAuthenticated(true);
          setUsername(result.userId || null);
          return true;
        }
        return false;
      } catch (_error) {
        return false;
      }
    },
    [authClient]
  );

  const logout = useCallback(async () => {
    await authClient.logout();
    setIsAuthenticated(false);
    setUsername(null);
  }, [authClient.logout]);

  const value = {
    isAuthenticated,
    username,
    login,
    logout,
    checkAuthStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

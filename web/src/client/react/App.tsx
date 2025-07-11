import { useEffect, useState } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SessionProvider } from './contexts/SessionContext';
import { FileEditorPage } from './pages/FileEditorPage';
import { LoginPage } from './pages/LoginPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionViewPage } from './pages/SessionViewPage';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check authentication status
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => setIsAuthenticated(data.authenticated))
      .catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <Router>
      <AuthProvider>
        <SessionProvider>
          <div className="min-h-screen bg-background text-white">
            <Routes>
              <Route
                path="/login"
                element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
              />
              <Route
                path="/"
                element={isAuthenticated ? <SessionsPage /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/sessions/:sessionId"
                element={isAuthenticated ? <SessionViewPage /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/files"
                element={isAuthenticated ? <FileEditorPage /> : <Navigate to="/login" replace />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </SessionProvider>
      </AuthProvider>
    </Router>
  );
}

// Export both original and refactored versions for gradual migration
export { App } from './App';
export { AppRefactored } from './AppRefactored';
export { FileBrowser } from './components/FileBrowser';
// Components
export { Header } from './components/Header';
export { Modal } from './components/Modal';
export { MonacoEditor } from './components/MonacoEditor';
export { SessionCard } from './components/SessionCard';
export { Settings } from './components/Settings';
export { Terminal } from './components/Terminal';
export { Terminal as TerminalRefactored } from './components/TerminalRefactored';
// Contexts (for backward compatibility)
export { AuthProvider, useAuth as useAuthContext } from './contexts/AuthContext';
export { SessionProvider, useSession } from './contexts/SessionContext';
// Hooks
export { useAsync, useAsyncEffect } from './hooks/useAsync';
export { useAuth } from './hooks/useAuth';
export { useSessionApi } from './hooks/useSessionApi';
export { useWebSocket } from './hooks/useWebSocket';
export { FileEditorPage } from './pages/FileEditorPage';
// Pages
export { LoginPage } from './pages/LoginPage';
export { SessionsPage } from './pages/SessionsPage';
export { SessionsPageRefactored } from './pages/SessionsPageRefactored';
export { SessionViewPage } from './pages/SessionViewPage';
export { SessionViewPageRefactored } from './pages/SessionViewPageRefactored';
// Stores
export { useAppStore } from './stores/useAppStore';

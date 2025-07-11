export interface Session {
  id: string;
  name?: string;
  cols: number;
  rows: number;
  status: 'connected' | 'disconnected' | 'connecting';
  created_at?: string;
  last_activity?: string;
  cwd?: string;
  command?: string;
  pid?: number;
  exitCode?: number | null;
}

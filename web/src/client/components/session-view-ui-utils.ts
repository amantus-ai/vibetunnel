/**
 * UI utilities and helpers for SessionView component
 */

export interface LoadingState {
  loading: boolean;
  loadingFrame: number;
  loadingInterval: number | null;
}

export function getLoadingText(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[frame % frames.length];
}

export function startLoadingAnimation(updateCallback: (frame: number) => void): number {
  let frame = 0;
  return window.setInterval(() => {
    frame = (frame + 1) % 10;
    updateCallback(frame);
  }, 200) as unknown as number;
}

export function getStatusText(session: { status: string; active?: boolean } | null): string {
  if (!session) return '';
  if ('active' in session && session.active === false) {
    return 'waiting';
  }
  return session.status;
}

export function getStatusColor(session: { status: string; active?: boolean } | null): string {
  if (!session) return 'text-dark-text-muted';
  if ('active' in session && session.active === false) {
    return 'text-dark-text-muted';
  }
  return session.status === 'running' ? 'text-status-success' : 'text-status-warning';
}

export function getStatusDotColor(session: { status: string; active?: boolean } | null): string {
  if (!session) return 'bg-dark-text-muted';
  if ('active' in session && session.active === false) {
    return 'bg-dark-text-muted';
  }
  return session.status === 'running' ? 'bg-status-success' : 'bg-status-warning';
}

export function getCurrentWidthLabel(terminalMaxCols: number): string {
  if (terminalMaxCols === 0) return '∞';
  const commonWidths = [
    { value: 80, label: '80' },
    { value: 120, label: '120' },
    { value: 160, label: '160' },
  ];
  const commonWidth = commonWidths.find((w) => w.value === terminalMaxCols);
  return commonWidth ? commonWidth.label : terminalMaxCols.toString();
}

/**
 * Formats a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Calculates duration from a start time to now
 */
export function getDurationFromStart(startTime: string): number {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return now - start;
}

/**
 * Formats session duration for display
 */
export function formatSessionDuration(startedAt: string): string {
  const duration = getDurationFromStart(startedAt);
  return formatDuration(duration);
}

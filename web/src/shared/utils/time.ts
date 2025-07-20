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
  if (Number.isNaN(start)) {
    return 0;
  }
  const now = Date.now();
  return Math.max(0, now - start);
}

/**
 * Calculates duration between two times
 */
export function getDurationBetween(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  // Handle invalid dates
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  return Math.max(0, end - start);
}

/**
 * Formats session duration for display
 * For running sessions, calculates from startedAt to now
 * For exited sessions, calculates from startedAt to endedAt
 * If endedAt is invalid or before startedAt, shows "0s"
 */
export function formatSessionDuration(startedAt: string, endedAt?: string): string {
  // If no endedAt provided, it's a running session
  if (!endedAt) {
    return formatDuration(getDurationFromStart(startedAt));
  }

  // For exited sessions, validate the endedAt time
  const startTime = new Date(startedAt).getTime();
  const endTime = new Date(endedAt).getTime();

  // Check if dates are valid and endTime is after startTime
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return formatDuration(0); // Show "0s" for invalid durations
  }

  return formatDuration(endTime - startTime);
}

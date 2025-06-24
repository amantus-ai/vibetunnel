/**
 * Consistent error logging for tests
 */
export const testLogger = {
  error(context: string, ...args: unknown[]): void {
    console.error(`[Test Error - ${context}]`, ...args);
  },

  warn(context: string, ...args: unknown[]): void {
    console.warn(`[Test Warning - ${context}]`, ...args);
  },

  info(context: string, ...args: unknown[]): void {
    console.log(`[Test Info - ${context}]`, ...args);
  },

  /**
   * Log HTTP response errors in a consistent format
   */
  async logHttpError(context: string, response: Response, includeBody = true): Promise<void> {
    const parts: unknown[] = [`Status: ${response.status} ${response.statusText}`];

    if (includeBody) {
      try {
        const body = await response.text();
        if (body) {
          parts.push(`Body: ${body}`);
        }
      } catch (_e) {
        // Ignore errors reading body
      }
    }

    this.error(context, ...parts);
  },
};

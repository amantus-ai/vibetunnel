import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

export interface ErrorHandler {
  handleError(error: Error, context?: Record<string, unknown>): void;
  clearError(): void;
}

/**
 * Mixin that adds error handling capabilities to any LitElement
 */
export const WithErrorHandler = <T extends new (...args: any[]) => LitElement>(
  superClass: T
) => {
  class WithErrorHandlerClass extends superClass implements ErrorHandler {
    @property({ type: Object })
    error: Error | null = null;

    @property({ type: Boolean })
    showErrorDetails = false;

    private _errorHandlers = new Set<(error: Error) => void>();

    handleError(error: Error, context?: Record<string, unknown>): void {
      console.error('Component error:', error, context);
      
      this.error = error;
      
      // Notify error handlers
      this._errorHandlers.forEach(handler => handler(error));
      
      // Dispatch error event
      this.dispatchEvent(new CustomEvent('component-error', {
        detail: { error, context },
        bubbles: true,
        composed: true
      }));
    }

    clearError(): void {
      this.error = null;
    }

    addErrorHandler(handler: (error: Error) => void): void {
      this._errorHandlers.add(handler);
    }

    removeErrorHandler(handler: (error: Error) => void): void {
      this._errorHandlers.delete(handler);
    }

    /**
     * Wrap async operations with error handling
     */
    protected async safeAsync<T>(
      operation: () => Promise<T>,
      context?: Record<string, unknown>
    ): Promise<T | undefined> {
      try {
        return await operation();
      } catch (error) {
        this.handleError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
        return undefined;
      }
    }

    /**
     * Wrap sync operations with error handling
     */
    protected safeSync<T>(
      operation: () => T,
      context?: Record<string, unknown>
    ): T | undefined {
      try {
        return operation();
      } catch (error) {
        this.handleError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
        return undefined;
      }
    }
  }

  return WithErrorHandlerClass as unknown as T & (new (...args: any[]) => WithErrorHandlerClass);
};
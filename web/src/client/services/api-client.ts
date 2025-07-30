import { createLogger } from '../utils/logger.js';
import { authClient } from './auth-client.js';

const logger = createLogger('api-client');

/**
 * Standard error response structure from the API
 *
 * @interface ErrorResponse
 * @property {string} [message] - Human-readable error message describing what went wrong
 * @property {string} [error] - Technical error code or identifier for programmatic handling
 */
interface ErrorResponse {
  message?: string;
  error?: string;
}

/**
 * HTTP client for making authenticated API requests to the VibeTunnel backend.
 * Automatically includes authentication headers and handles error responses.
 */
class ApiClient {
  /**
   * Make a GET request to the API
   * @param path - The API endpoint path (without /api prefix)
   * @returns Promise resolving to the response data
   */
  async get<T = unknown>(path: string): Promise<T> {
    try {
      const response = await fetch(`/api${path}`, {
        headers: {
          ...authClient.getAuthHeader(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw new Error(error.message || `Request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`GET ${path} failed:`, error);
      throw error;
    }
  }

  /**
   * Make a POST request to the API
   * @param path - The API endpoint path (without /api prefix)
   * @param data - Request body data
   * @returns Promise resolving to the response data
   */
  async post<T = unknown>(path: string, data?: unknown): Promise<T> {
    try {
      const response = await fetch(`/api${path}`, {
        method: 'POST',
        headers: {
          ...authClient.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw new Error(error.message || `Request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`POST ${path} failed:`, error);
      throw error;
    }
  }

  /**
   * Make a PUT request to the API
   * @param path - The API endpoint path (without /api prefix)
   * @param data - Request body data
   * @returns Promise resolving to the response data
   */
  async put<T = unknown>(path: string, data: unknown): Promise<T> {
    try {
      const response = await fetch(`/api${path}`, {
        method: 'PUT',
        headers: {
          ...authClient.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw new Error(error.message || `Request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`PUT ${path} failed:`, error);
      throw error;
    }
  }

  /**
   * Make a DELETE request to the API
   * @param path - The API endpoint path (without /api prefix)
   * @returns Promise resolving to the response data
   */
  async delete<T = unknown>(path: string): Promise<T> {
    try {
      const response = await fetch(`/api${path}`, {
        method: 'DELETE',
        headers: {
          ...authClient.getAuthHeader(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw new Error(error.message || `Request failed: ${response.statusText}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : ({} as T);
    } catch (error) {
      logger.error(`DELETE ${path} failed:`, error);
      throw error;
    }
  }

  private async parseError(response: Response): Promise<ErrorResponse> {
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      }
      return { message: await response.text() };
    } catch {
      return { message: response.statusText };
    }
  }
}

export const apiClient = new ApiClient();

import { createLogger } from '../utils/logger.js';
import { authClient } from './auth-client.js';

const logger = createLogger('api-client');

interface ErrorResponse {
  message?: string;
  error?: string;
}

class ApiClient {
  /**
   * Make a GET request
   */
  async get<T = any>(path: string): Promise<T> {
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
   * Make a POST request
   */
  async post<T = any>(path: string, data?: any): Promise<T> {
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
   * Make a PUT request
   */
  async put<T = any>(path: string, data: any): Promise<T> {
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
   * Make a DELETE request
   */
  async delete<T = any>(path: string): Promise<T> {
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

      return await response.json();
    } catch (error) {
      logger.error(`DELETE ${path} failed:`, error);
      throw error;
    }
  }

  /**
   * Parse error response
   * @private
   */
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

// Export singleton instance
export const apiClient = new ApiClient();

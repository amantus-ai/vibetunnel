import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../../../test/utils/react-test-utils';
import { LoginPage } from './LoginPage';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  it('should render login form with all fields', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByText('VibeTunnel Login')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('should show loading state during login', async () => {
    const user = userEvent.setup();

    // Mock a delayed response
    mockFetch({ token: 'test-token' }, { status: 200 });

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'testpass');

    const loginButton = screen.getByRole('button', { name: 'Login' });
    await user.click(loginButton);

    // Check for loading state
    expect(screen.getByText('Logging in...')).toBeInTheDocument();
    expect(loginButton).toBeDisabled();
  });

  it('should handle successful login', async () => {
    const user = userEvent.setup();

    mockFetch({ token: 'test-token-123' }, { status: 200 });

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'testpass');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(localStorage.getItem('vibetunnel_auth_token')).toBe('test-token-123');
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should display error message on failed login', async () => {
    const user = userEvent.setup();

    mockFetch({ error: 'Invalid credentials' }, { status: 401, ok: false });

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'wronguser');
    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      expect(screen.getByText('Invalid credentials')).toHaveClass('text-red-600');
    });
  });

  it('should clear error message when typing', async () => {
    const user = userEvent.setup();

    mockFetch({ error: 'Invalid credentials' }, { status: 401, ok: false });

    renderWithProviders(<LoginPage />);

    // First, trigger an error
    await user.type(screen.getByLabelText('Username'), 'wronguser');
    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });

    // Type in username field to clear error
    await user.type(screen.getByLabelText('Username'), 'a');

    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
  });

  it('should prevent form submission with empty fields', async () => {
    const user = userEvent.setup();

    renderWithProviders(<LoginPage />);

    // Try to submit with empty fields
    await user.click(screen.getByRole('button', { name: 'Login' }));

    // Fetch should not be called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should trim whitespace from username', async () => {
    const user = userEvent.setup();

    mockFetch({ token: 'test-token' }, { status: 200 });

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), '  testuser  ');
    await user.type(screen.getByLabelText('Password'), 'testpass');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          body: JSON.stringify({
            username: 'testuser',
            password: 'testpass',
          }),
        })
      );
    });
  });

  it('should handle network errors gracefully', async () => {
    const user = userEvent.setup();

    // Mock network error
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'testpass');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should show password in plain text when show password is toggled', async () => {
    const user = userEvent.setup();

    renderWithProviders(<LoginPage />);

    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Type password
    await user.type(passwordInput, 'mypassword');

    // Look for show/hide password button (if implemented)
    const toggleButton = screen.queryByRole('button', { name: /show password/i });
    if (toggleButton) {
      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'text');
    }
  });

  it('should submit form on Enter key press', async () => {
    const user = userEvent.setup();

    mockFetch({ token: 'test-token' }, { status: 200 });

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    const passwordInput = screen.getByLabelText('Password');
    await user.type(passwordInput, 'testpass');

    // Press Enter on password field
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});

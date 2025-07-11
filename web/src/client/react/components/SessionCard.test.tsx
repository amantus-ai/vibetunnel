import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickByTestId, renderWithProviders } from '../../../test/utils/react-test-utils';
import { createTestSession } from '../../../test/utils/test-factories';
import { SessionCard } from './SessionCard';

describe('SessionCard', () => {
  const mockOnClick = vi.fn();
  const mockOnDelete = vi.fn();

  const defaultSession = createTestSession({
    id: 'test-123',
    name: 'Test Session',
    status: 'running',
    workingDir: '/home/user/projects',
    initialCols: 120,
    initialRows: 40,
    lastModified: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render session information correctly', () => {
    renderWithProviders(<SessionCard session={defaultSession} onClick={mockOnClick} />);

    expect(screen.getByTestId('session-card')).toBeInTheDocument();
    expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
    expect(screen.getByTestId('session-status')).toHaveTextContent('running');
    expect(screen.getByText('120×40')).toBeInTheDocument();
    expect(screen.getByText('/home/user/projects')).toBeInTheDocument();
  });

  it('should show session ID when name is not provided', () => {
    const sessionWithoutName = { ...defaultSession, name: undefined };

    renderWithProviders(<SessionCard session={sessionWithoutName} onClick={mockOnClick} />);

    expect(screen.getByTestId('session-name')).toHaveTextContent('Session test-123');
  });

  it('should call onClick when card is clicked', async () => {
    renderWithProviders(<SessionCard session={defaultSession} onClick={mockOnClick} />);

    await clickByTestId('session-card');

    expect(mockOnClick).toHaveBeenCalledWith('test-123');
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('should show green status indicator for running sessions', () => {
    renderWithProviders(<SessionCard session={defaultSession} onClick={mockOnClick} />);

    const statusText = screen.getByTestId('session-status');
    expect(statusText.parentElement).toHaveClass('text-green-500');
  });

  it('should show gray status indicator for stopped sessions', () => {
    const stoppedSession = { ...defaultSession, status: 'stopped' as const };

    renderWithProviders(<SessionCard session={stoppedSession} onClick={mockOnClick} />);

    const statusText = screen.getByTestId('session-status');
    expect(statusText.parentElement).toHaveClass('text-gray-500');
  });

  it('should render delete button when onDelete is provided', () => {
    renderWithProviders(
      <SessionCard session={defaultSession} onClick={mockOnClick} onDelete={mockOnDelete} />
    );

    const deleteButton = screen.getByRole('button');
    expect(deleteButton).toBeInTheDocument();
  });

  it('should not render delete button when onDelete is not provided', () => {
    renderWithProviders(<SessionCard session={defaultSession} onClick={mockOnClick} />);

    const deleteButton = screen.queryByRole('button');
    expect(deleteButton).not.toBeInTheDocument();
  });

  it('should call onDelete when delete button is clicked', async () => {
    renderWithProviders(
      <SessionCard session={defaultSession} onClick={mockOnClick} onDelete={mockOnDelete} />
    );

    const deleteButton = screen.getByRole('button');
    await userEvent.click(deleteButton);

    expect(mockOnDelete).toHaveBeenCalledWith('test-123');
    expect(mockOnClick).not.toHaveBeenCalled(); // Should not trigger card click
  });

  it('should format last modified time correctly', () => {
    const testCases = [
      {
        lastModified: new Date().toISOString(),
        expected: 'Just now',
      },
      {
        lastModified: new Date(Date.now() - 30 * 60000).toISOString(),
        expected: '30m ago',
      },
      {
        lastModified: new Date(Date.now() - 2 * 60 * 60000).toISOString(),
        expected: '2h ago',
      },
      {
        lastModified: new Date(Date.now() - 3 * 24 * 60 * 60000).toISOString(),
        expected: '3d ago',
      },
    ];

    testCases.forEach(({ lastModified, expected }) => {
      const { unmount } = renderWithProviders(
        <SessionCard session={{ ...defaultSession, lastModified }} onClick={mockOnClick} />
      );

      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    });
  });

  it('should show "Never" when lastModified is not provided', () => {
    const sessionWithoutDate = { ...defaultSession, lastModified: undefined };

    renderWithProviders(<SessionCard session={sessionWithoutDate} onClick={mockOnClick} />);

    expect(screen.getByText('Never')).toBeInTheDocument();
  });
});

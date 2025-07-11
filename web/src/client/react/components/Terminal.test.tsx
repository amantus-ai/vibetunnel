import { screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/utils/react-test-utils';
import { Terminal, type TerminalHandle } from './Terminal';

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    dispose: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onBell: vi.fn(),
    options: {},
    cols: 80,
    rows: 24,
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

describe('Terminal', () => {
  const mockOnData = vi.fn();
  const mockOnResize = vi.fn();
  const terminalRef = React.createRef<TerminalHandle>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render terminal container with correct attributes', () => {
    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    const container = screen.getByTestId('terminal');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('terminal-container', 'w-full', 'h-full', 'bg-black');
  });

  it('should initialize with default dimensions', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');

    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    await waitFor(() => {
      expect(XTermMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cols: 80,
          rows: 24,
        })
      );
    });
  });

  it('should use custom initial dimensions when provided', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');

    renderWithProviders(
      <Terminal
        ref={terminalRef}
        sessionId="test-session"
        onData={mockOnData}
        initialCols={120}
        initialRows={40}
      />
    );

    await waitFor(() => {
      expect(XTermMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cols: 120,
          rows: 40,
        })
      );
    });
  });

  it('should apply custom theme when provided', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');
    const customTheme = {
      background: '#1e1e1e',
      foreground: '#ffffff',
      cursor: '#00ff00',
    };

    renderWithProviders(
      <Terminal
        ref={terminalRef}
        sessionId="test-session"
        onData={mockOnData}
        theme={customTheme}
      />
    );

    await waitFor(() => {
      expect(XTermMock).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: customTheme,
        })
      );
    });
  });

  it('should expose terminal methods through ref', async () => {
    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    await waitFor(() => {
      expect(terminalRef.current).toBeDefined();
      expect(terminalRef.current?.write).toBeDefined();
      expect(terminalRef.current?.writeln).toBeDefined();
      expect(terminalRef.current?.clear).toBeDefined();
      expect(terminalRef.current?.focus).toBeDefined();
      expect(terminalRef.current?.fit).toBeDefined();
      expect(terminalRef.current?.resize).toBeDefined();
    });
  });

  it('should call onData callback when terminal receives input', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');
    let dataCallback: ((data: string) => void) | null = null;

    (XTermMock as any).mockImplementation(() => ({
      open: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn((cb) => {
        dataCallback = cb;
      }),
      onResize: vi.fn(),
      onBell: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    }));

    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    await waitFor(() => {
      expect(dataCallback).toBeDefined();
    });

    // Simulate terminal input
    dataCallback?.('test input');
    expect(mockOnData).toHaveBeenCalledWith('test input');
  });

  it('should call onResize callback when terminal is resized', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');
    let resizeCallback: ((event: { cols: number; rows: number }) => void) | null = null;

    (XTermMock as any).mockImplementation(() => ({
      open: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn((cb) => {
        resizeCallback = cb;
      }),
      onBell: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    }));

    renderWithProviders(
      <Terminal
        ref={terminalRef}
        sessionId="test-session"
        onData={mockOnData}
        onResize={mockOnResize}
      />
    );

    await waitFor(() => {
      expect(resizeCallback).toBeDefined();
    });

    // Simulate terminal resize
    resizeCallback?.({ cols: 100, rows: 30 });
    expect(mockOnResize).toHaveBeenCalledWith(100, 30);
  });

  it('should clean up terminal on unmount', async () => {
    const { Terminal: XTermMock } = await import('@xterm/xterm');
    const mockDispose = vi.fn();

    (XTermMock as any).mockImplementation(() => ({
      open: vi.fn(),
      dispose: mockDispose,
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onBell: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    }));

    const { unmount } = renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    unmount();

    await waitFor(() => {
      expect(mockDispose).toHaveBeenCalled();
    });
  });

  it('should handle write operations through ref', async () => {
    const mockWrite = vi.fn();
    const { Terminal: XTermMock } = await import('@xterm/xterm');

    (XTermMock as any).mockImplementation(() => ({
      open: vi.fn(),
      dispose: vi.fn(),
      write: mockWrite,
      writeln: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onBell: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    }));

    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    await waitFor(() => {
      expect(terminalRef.current).toBeDefined();
    });

    terminalRef.current?.write('Hello, Terminal!');
    expect(mockWrite).toHaveBeenCalledWith('Hello, Terminal!');
  });

  it('should handle clear operations through ref', async () => {
    const mockClear = vi.fn();
    const { Terminal: XTermMock } = await import('@xterm/xterm');

    (XTermMock as any).mockImplementation(() => ({
      open: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      clear: mockClear,
      focus: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onBell: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    }));

    renderWithProviders(
      <Terminal ref={terminalRef} sessionId="test-session" onData={mockOnData} />
    );

    await waitFor(() => {
      expect(terminalRef.current).toBeDefined();
    });

    terminalRef.current?.clear();
    expect(mockClear).toHaveBeenCalled();
  });
});

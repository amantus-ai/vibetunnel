import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Terminal');

interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  [key: string]: string | undefined;
}

interface TerminalProps {
  sessionId: string;
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
  initialCols?: number;
  initialRows?: number;
  theme?: TerminalTheme;
}

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
}

export const Terminal = React.forwardRef<TerminalHandle, TerminalProps>(
  ({ sessionId, onResize, onData, initialCols = 80, initialRows = 24, theme }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [isReady, setIsReady] = useState(false);

    // Initialize terminal
    useEffect(() => {
      if (!containerRef.current) return;

      const terminal = new XTerm({
        cols: initialCols,
        rows: initialRows,
        theme: theme || {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#aeafad',
          selection: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#e5e5e5',
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        allowTransparency: false,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
      });

      terminalRef.current = terminal;

      // Add addons
      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);

      const webLinksAddon = new WebLinksAddon();
      terminal.loadAddon(webLinksAddon);

      // Try to use WebGL renderer for better performance
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
      } catch (e) {
        logger.warn('WebGL addon failed to load, using canvas renderer', e);
      }

      // Open terminal in container
      terminal.open(containerRef.current);

      // Handle data from terminal
      if (onData) {
        terminal.onData(onData);
      }

      // Handle resize
      terminal.onResize(({ cols, rows }) => {
        if (onResize) {
          onResize(cols, rows);
        }
      });

      // Initial fit
      setTimeout(() => {
        fitAddon.fit(); // biome-ignore lint/suspicious/noFocusedTests: This is not a test, it's the xterm fit method
        setIsReady(true);
      }, 0);

      // Cleanup
      return () => {
        terminal.dispose();
      };
    }, [sessionId]);

    // Handle window resize
    useEffect(() => {
      if (!fitAddonRef.current || !terminalRef.current) return;

      const handleResize = () => {
        try {
          fitAddonRef.current?.fit(); // biome-ignore lint/suspicious/noFocusedTests: This is not a test, it's the xterm fit method
        } catch (e) {
          logger.error('Failed to fit terminal', e);
        }
      };

      window.addEventListener('resize', handleResize);

      // Use ResizeObserver for more accurate resizing
      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      return () => {
        window.removeEventListener('resize', handleResize);
        resizeObserver.disconnect();
      };
    }, [isReady]);

    // Public methods exposed via ref
    const write = useCallback((data: string) => {
      terminalRef.current?.write(data);
    }, []);

    const writeln = useCallback((data: string) => {
      terminalRef.current?.writeln(data);
    }, []);

    const clear = useCallback(() => {
      terminalRef.current?.clear();
    }, []);

    const focus = useCallback(() => {
      terminalRef.current?.focus();
    }, []);

    const fit = useCallback(() => {
      fitAddonRef.current?.fit();
    }, []);

    const resize = useCallback((cols: number, rows: number) => {
      terminalRef.current?.resize(cols, rows);
    }, []);

    // Expose methods via imperative handle
    React.useImperativeHandle(
      ref,
      () => ({
        write,
        writeln,
        clear,
        focus,
        fit,
        resize,
        get terminal() {
          return terminalRef.current;
        },
      }),
      [write, writeln, clear, focus, fit, resize]
    );

    return (
      <div
        ref={containerRef}
        className="terminal-container w-full h-full bg-black"
        style={{ padding: '8px' }}
        data-testid="terminal"
      />
    );
  }
);

Terminal.displayName = 'Terminal';

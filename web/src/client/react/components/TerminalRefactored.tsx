import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import '@xterm/xterm/css/xterm.css';
import { createLogger } from '../../utils/logger';
import { useAppStore } from '../stores/useAppStore';

const logger = createLogger('Terminal');

interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  selection?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

interface TerminalProps {
  sessionId: string;
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
  onBell?: () => void;
  onReady?: () => void;
  initialCols?: number;
  initialRows?: number;
  theme?: TerminalTheme;
  className?: string;
}

export interface TerminalHandle {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  focus: () => void;
  blur: () => void;
  fit: () => void;
  resize: (cols: number, rows: number) => void;
  getSelection: () => string;
  selectAll: () => void;
  clearSelection: () => void;
}

const defaultTheme: TerminalTheme = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  selection: 'rgba(192, 202, 245, 0.3)',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

// Memoized terminal content component
const TerminalContent = memo(
  forwardRef<TerminalHandle, TerminalProps>(
    (
      {
        sessionId,
        onResize,
        onData,
        onBell,
        onReady,
        initialCols = 80,
        initialRows = 24,
        theme = defaultTheme,
        className = '',
      },
      ref
    ) => {
      const containerRef = useRef<HTMLDivElement>(null);
      const terminalRef = useRef<XTerm | null>(null);
      const fitAddonRef = useRef<FitAddon | null>(null);
      const webglAddonRef = useRef<WebglAddon | null>(null);
      const [isReady, setIsReady] = useState(false);

      // Get settings from store
      const settings = useAppStore((state) => state.settings);

      // Create terminal instance
      useEffect(() => {
        if (!containerRef.current || terminalRef.current) return;

        logger.log(`Initializing terminal for session ${sessionId}`);

        const terminal = new XTerm({
          cols: initialCols,
          rows: initialRows,
          theme,
          fontSize: settings.fontSize,
          fontFamily: settings.fontFamily,
          cursorStyle: settings.cursorStyle,
          cursorBlink: settings.cursorBlink,
          scrollback: settings.scrollback,
          tabStopWidth: settings.tabStopWidth,
          allowTransparency: true,
          windowsMode: navigator.platform.includes('Win'),
          macOptionIsMeta: true,
          rightClickSelectsWord: true,
        });

        terminalRef.current = terminal;

        // Load addons
        const fitAddon = new FitAddon();
        fitAddonRef.current = fitAddon;
        terminal.loadAddon(fitAddon);

        const webLinksAddon = new WebLinksAddon();
        terminal.loadAddon(webLinksAddon);

        // Try to load WebGL addon for better performance
        try {
          const webglAddon = new WebglAddon();
          webglAddonRef.current = webglAddon;
          terminal.loadAddon(webglAddon);

          webglAddon.onContextLoss(() => {
            logger.warn('WebGL context lost, falling back to canvas renderer');
            webglAddon.dispose();
          });
        } catch (e) {
          logger.warn('WebGL addon failed to load, using canvas renderer', e);
        }

        // Set up event handlers
        const dataHandler = terminal.onData((data) => {
          onData?.(data);
        });

        const resizeHandler = terminal.onResize(({ cols, rows }) => {
          logger.debug(`Terminal resized to ${cols}x${rows}`);
          onResize?.(cols, rows);
        });

        const bellHandler = terminal.onBell(() => {
          if (settings.bellStyle === 'visual' || settings.bellStyle === 'both') {
            // Visual bell
            containerRef.current?.classList.add('animate-pulse');
            setTimeout(() => {
              containerRef.current?.classList.remove('animate-pulse');
            }, 200);
          }
          onBell?.();
        });

        // Open terminal in container
        terminal.open(containerRef.current);

        // Initial fit
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            setIsReady(true);
            onReady?.();
          } catch (e) {
            logger.error('Initial fit failed', e);
          }
        });

        // Cleanup
        return () => {
          logger.log(`Disposing terminal for session ${sessionId}`);
          dataHandler.dispose();
          resizeHandler.dispose();
          bellHandler.dispose();
          webglAddonRef.current?.dispose();
          terminal.dispose();
          terminalRef.current = null;
          fitAddonRef.current = null;
          webglAddonRef.current = null;
        };
      }, [sessionId, onReady]); // Only re-create on sessionId change

      // Update terminal options when settings change
      useEffect(() => {
        if (!terminalRef.current) return;

        terminalRef.current.options = {
          fontSize: settings.fontSize,
          fontFamily: settings.fontFamily,
          cursorStyle: settings.cursorStyle,
          cursorBlink: settings.cursorBlink,
          scrollback: settings.scrollback,
          tabStopWidth: settings.tabStopWidth,
          theme,
        };
      }, [settings, theme]);

      // Handle resize
      const handleResize = useCallback(() => {
        if (!fitAddonRef.current || !isReady) return;

        try {
          fitAddonRef.current.fit();
        } catch (e) {
          logger.error('Failed to fit terminal', e);
        }
      }, [isReady]);

      // Resize observer
      useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);

        return () => {
          resizeObserver.disconnect();
        };
      }, [handleResize]);

      // Expose imperative handle
      useImperativeHandle(
        ref,
        () => ({
          write: (data: string) => {
            terminalRef.current?.write(data);
          },
          writeln: (data: string) => {
            terminalRef.current?.writeln(data);
          },
          clear: () => {
            terminalRef.current?.clear();
          },
          focus: () => {
            terminalRef.current?.focus();
          },
          blur: () => {
            terminalRef.current?.blur();
          },
          fit: () => {
            fitAddonRef.current?.fit();
          },
          resize: (cols: number, rows: number) => {
            terminalRef.current?.resize(cols, rows);
          },
          getSelection: () => {
            return terminalRef.current?.getSelection() || '';
          },
          selectAll: () => {
            terminalRef.current?.selectAll();
          },
          clearSelection: () => {
            terminalRef.current?.clearSelection();
          },
        }),
        []
      );

      return (
        <div
          ref={containerRef}
          className={`w-full h-full ${className}`}
          style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.2s' }}
        />
      );
    }
  )
);

TerminalContent.displayName = 'TerminalContent';

// Export the memoized component
export const Terminal = memo(TerminalContent);
Terminal.displayName = 'Terminal';

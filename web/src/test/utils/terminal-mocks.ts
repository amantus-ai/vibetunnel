import { vi } from 'vitest';

/**
 * Mock Terminal class for xterm.js
 */
export class MockTerminal {
  element: HTMLDivElement;
  cols: number = 80;
  rows: number = 24;
  buffer = {
    active: {
      cursorY: 0,
      cursorX: 0,
      length: 0,
      viewportY: 0,
      getLine: vi.fn(() => ({
        translateToString: vi.fn(() => 'Line'),
        length: 80,
        getCell: vi.fn(() => null),
      })),
      getNullCell: vi.fn(() => ({
        getChars: () => '',
        getCode: () => 0,
        getWidth: () => 1,
        isCombined: () => 0,
        getFgColorMode: () => 0,
        getBgColorMode: () => 0,
        getFgColor: () => 0,
        getBgColor: () => 0,
        isAttributeDefault: () => true,
        hasExtendedAttrs: () => false,
        getExtendedAttrs: () => 0,
        isUnderline: () => false,
        isItalic: () => false,
        isDim: () => false,
        isBold: () => false,
        isInvisible: () => false,
        isInverse: () => false,
        isStrikethrough: () => false,
        isOverline: () => false,
      })),
    },
    normal: {
      scrollTop: 0,
      scrollBottom: 23,
    },
  };

  onData = vi.fn((callback: (data: string) => void) => {
    this._onDataCallback = callback;
    return { dispose: vi.fn() };
  });

  onResize = vi.fn((callback: (size: { cols: number; rows: number }) => void) => {
    this._onResizeCallback = callback;
    return { dispose: vi.fn() };
  });

  onTitleChange = vi.fn((callback: (title: string) => void) => {
    this._onTitleChangeCallback = callback;
    return { dispose: vi.fn() };
  });

  onKey = vi.fn((callback: (event: { key: string; domEvent: KeyboardEvent }) => void) => {
    this._onKeyCallback = callback;
    return { dispose: vi.fn() };
  });

  private _onDataCallback?: (data: string) => void;
  private _onResizeCallback?: (size: { cols: number; rows: number }) => void;

  constructor() {
    this.element = document.createElement('div');
  }

  open = vi.fn((element: HTMLElement) => {
    element.appendChild(this.element);
  });

  write = vi.fn((_data: string | Uint8Array) => {
    // write() is for terminal output, should not trigger onData callback
    // onData is only for user input
  });

  writeln = vi.fn((data: string) => {
    this.write(`${data}\r\n`);
  });

  clear = vi.fn();

  reset = vi.fn();

  focus = vi.fn();

  blur = vi.fn();

  resize = vi.fn((cols: number, rows: number) => {
    // xterm.js requires integer values
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      throw new Error('This API only accepts integers');
    }
    this.cols = cols;
    this.rows = rows;
    if (this._onResizeCallback) {
      this._onResizeCallback({ cols, rows });
    }
  });

  dispose = vi.fn();

  scrollToBottom = vi.fn();

  scrollToTop = vi.fn();

  select = vi.fn();

  selectAll = vi.fn();

  clearSelection = vi.fn();

  getSelection = vi.fn(() => '');

  hasSelection = vi.fn(() => false);

  paste = vi.fn((data: string) => {
    if (this._onDataCallback) {
      this._onDataCallback(data);
    }
  });

  refresh = vi.fn();

  // Simulate user typing
  simulateTyping(text: string) {
    if (this._onDataCallback) {
      this._onDataCallback(text);
    }
  }

  // Simulate terminal output
  simulateOutput(text: string) {
    // This would normally update the terminal buffer
    // For testing, we just track that write was called
    this.write(text);
  }

  // Simulate resize event
  simulateResize(cols: number, rows: number) {
    this.resize(cols, rows);
  }
}

/**
 * Mock FitAddon for xterm-addon-fit
 */
export class MockFitAddon {
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  fit = vi.fn();
  dispose = vi.fn();
}

/**
 * Mock WebLinksAddon for xterm-addon-web-links
 */
export class MockWebLinksAddon {
  activate = vi.fn();
  dispose = vi.fn();
}

/**
 * Mock Search addon for xterm-addon-search
 */
export class MockSearchAddon {
  findNext = vi.fn();
  findPrevious = vi.fn();
  dispose = vi.fn();
}

/**
 * Creates a mock WebSocket for terminal connections
 */
export function createTerminalWebSocket() {
  return {
    url: '',
    readyState: WebSocket.CONNECTING,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),

    // Helper methods for testing
    mockOpen() {
      this.readyState = WebSocket.OPEN;
      const event = new Event('open');
      this.dispatchEvent(event);
    },

    mockMessage(data: unknown) {
      const event = new MessageEvent('message', { data });
      this.dispatchEvent(event);
    },

    mockClose(code = 1000, reason = 'Normal closure') {
      this.readyState = WebSocket.CLOSED;
      const event = new CloseEvent('close', { code, reason });
      this.dispatchEvent(event);
    },

    mockError(error: Error) {
      const event = new ErrorEvent('error', { error });
      this.dispatchEvent(event);
    },
  };
}

/**
 * Mock ResizeObserver for terminal resize testing
 */
export class MockResizeObserver {
  callback: ResizeObserverCallback;
  observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn((element: Element) => {
    this.observedElements.add(element);
  });

  unobserve = vi.fn((element: Element) => {
    this.observedElements.delete(element);
  });

  disconnect = vi.fn(() => {
    this.observedElements.clear();
  });

  // Simulate resize
  simulateResize(element: Element, contentRect: Partial<DOMRectReadOnly>) {
    if (this.observedElements.has(element)) {
      const entry = {
        target: element,
        contentRect: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          top: 0,
          right: 800,
          bottom: 600,
          left: 0,
          ...contentRect,
        } as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };
      this.callback([entry as ResizeObserverEntry], this as ResizeObserver);
    }
  }
}

/**
 * Creates mock binary data for buffer testing
 */
export function createMockBufferData(cols: number, rows: number): ArrayBuffer {
  // Create a simple buffer with some test data
  const buffer = new ArrayBuffer(cols * rows * 12); // 12 bytes per cell
  const view = new DataView(buffer);

  // Fill with some test pattern
  for (let i = 0; i < cols * rows; i++) {
    const offset = i * 12;
    view.setUint32(offset, 0x41 + (i % 26), true); // Character 'A' + offset
    view.setUint32(offset + 4, 0xffffff, true); // White foreground
    view.setUint32(offset + 8, 0x000000, true); // Black background
  }

  return buffer;
}

/**
 * Mock for terminal binary protocol
 */
export function createMockBinaryMessage(type: string, data: unknown): ArrayBuffer {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  const dataStr = JSON.stringify(data);
  const dataBytes = encoder.encode(dataStr);

  const buffer = new ArrayBuffer(4 + typeBytes.length + dataBytes.length);
  const view = new DataView(buffer);

  // Type length
  view.setUint32(0, typeBytes.length, true);

  // Type string
  new Uint8Array(buffer, 4, typeBytes.length).set(typeBytes);

  // Data
  new Uint8Array(buffer, 4 + typeBytes.length).set(dataBytes);

  return buffer;
}

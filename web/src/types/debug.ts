export interface SessionDebugInfo {
  sessionId: string;
  timestamp: number;

  // Network connections
  connections: {
    websocket: WebSocketDebugInfo;
    httpStreams: HttpStreamDebugInfo[];
    apiCalls: ApiCallDebugInfo[];
  };

  // Session process data
  process: {
    pid?: number;
    cpuUsage?: number;
    memoryUsage?: number;
    uptime?: number;
    command: string[];
    workingDir: string;
    environment?: Record<string, string>;
  };

  // Terminal data
  terminal: {
    currentSize: { cols: number; rows: number };
    resizeHistory: ResizeEvent[];
    bufferStats: {
      totalLines: number;
      totalCharacters: number;
      viewportY: number;
      scrollbackSize: number;
    };
    lastUpdate: number;
  };

  // Output statistics
  output: {
    totalStdoutBytes: number;
    compressedBytes: number;
    transferredBytes: number;
    compressionRatio: number;
    lastCleanup: number;
  };

  // Event logs
  events: DebugEvent[];

  // Performance metrics
  performance: {
    avgRenderTime: number;
    updateFrequency: number;
    latency: {
      input: number;
      output: number;
    };
    lastMeasurement: number;
  };
}

export interface WebSocketDebugInfo {
  state: 'connecting' | 'connected' | 'disconnected' | 'error';
  connectedAt?: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  reconnectCount: number;
  lastError?: string;
  lastMessage?: number;
}

export interface HttpStreamDebugInfo {
  type: 'sse' | 'longpoll' | 'ascii';
  url: string;
  state: 'active' | 'closed' | 'error';
  startedAt: number;
  bytesReceived: number;
  lastActivity: number;
  error?: string;
}

export interface ApiCallDebugInfo {
  method: string;
  url: string;
  timestamp: number;
  duration: number;
  status: number;
  size: number;
}

export interface ResizeEvent {
  timestamp: number;
  from: { cols: number; rows: number };
  to: { cols: number; rows: number };
  source: 'user' | 'window' | 'api';
}

export interface DebugEvent {
  timestamp: number;
  type: 'stream_fetch' | 'resize' | 'input' | 'output' | 'error' | 'cleanup' | 'reconnect';
  message: string;
  data?: any;
  level: 'info' | 'warn' | 'error';
}

export class DebugEventLogger {
  private events: DebugEvent[] = [];
  private maxEvents = 1000;

  log(type: DebugEvent['type'], message: string, data?: any, level: DebugEvent['level'] = 'info') {
    this.events.push({
      timestamp: Date.now(),
      type,
      message,
      data,
      level,
    });

    // Keep only the last maxEvents
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getEvents(type?: DebugEvent['type']): DebugEvent[] {
    if (type) {
      return this.events.filter((e) => e.type === type);
    }
    return [...this.events];
  }

  clear() {
    this.events = [];
  }
}

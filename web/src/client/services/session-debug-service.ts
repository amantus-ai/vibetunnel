import {
  type ApiCallDebugInfo,
  DebugEventLogger,
  type HttpStreamDebugInfo,
  type ResizeEvent,
  type SessionDebugInfo,
  type WebSocketDebugInfo,
} from '../../types/debug.js';
import type { Session } from '../components/session-list.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('session-debug-service');

export class SessionDebugService {
  private static instance: SessionDebugService;

  private debugData: Map<string, SessionDebugInfo> = new Map();
  private eventLoggers: Map<string, DebugEventLogger> = new Map();
  private apiCallTracking: Map<string, ApiCallDebugInfo[]> = new Map();
  private streamConnections: Map<string, HttpStreamDebugInfo[]> = new Map();
  private resizeHistory: Map<string, ResizeEvent[]> = new Map();

  // WebSocket tracking
  private wsConnections: Map<string, WebSocketDebugInfo> = new Map();

  // Performance tracking
  private renderTimes: Map<string, number[]> = new Map();
  private updateCounts: Map<string, { count: number; startTime: number }> = new Map();
  private latencyMeasurements: Map<string, { input: number[]; output: number[] }> = new Map();

  private constructor() {
    this.setupGlobalHooks();
  }

  static getInstance(): SessionDebugService {
    if (!SessionDebugService.instance) {
      SessionDebugService.instance = new SessionDebugService();
    }
    return SessionDebugService.instance;
  }

  private setupGlobalHooks() {
    // Hook into fetch to track API calls
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const startTime = Date.now();
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';

      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;

        // Track session API calls
        const sessionMatch = url.match(/\/api\/sessions\/([^/]+)/);
        if (sessionMatch) {
          const sessionId = sessionMatch[1];
          this.trackApiCall(sessionId, {
            method,
            url,
            timestamp: startTime,
            duration,
            status: response.status,
            size: Number.parseInt(response.headers.get('content-length') || '0'),
          });
        }

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Fetch error:', error);

        // Track failed calls too
        const sessionMatch = url.match(/\/api\/sessions\/([^/]+)/);
        if (sessionMatch) {
          const sessionId = sessionMatch[1];
          this.trackApiCall(sessionId, {
            method,
            url,
            timestamp: startTime,
            duration,
            status: -1,
            size: 0,
          });
        }

        throw error;
      }
    };
  }

  initializeSession(sessionId: string, session: Session) {
    if (!this.eventLoggers.has(sessionId)) {
      this.eventLoggers.set(sessionId, new DebugEventLogger());
    }

    const eventLogger = this.eventLoggers.get(sessionId)!;
    eventLogger.log('session_init', `Session initialized: ${session.name}`, { session });

    this.debugData.set(sessionId, {
      sessionId,
      timestamp: Date.now(),
      connections: {
        websocket: {
          state: 'disconnected',
          messagesReceived: 0,
          bytesSent: 0,
          bytesReceived: 0,
          reconnectCount: 0,
        },
        httpStreams: [],
        apiCalls: [],
      },
      process: {
        pid: session.pid,
        command: session.command,
        workingDir: session.workingDir,
      },
      terminal: {
        currentSize: { cols: session.initialCols || 80, rows: session.initialRows || 24 },
        resizeHistory: [],
        bufferStats: {
          totalLines: 0,
          totalCharacters: 0,
          viewportY: 0,
          scrollbackSize: 0,
        },
        lastUpdate: Date.now(),
      },
      output: {
        totalStdoutBytes: 0,
        compressedBytes: 0,
        transferredBytes: 0,
        compressionRatio: 0,
        lastCleanup: 0,
      },
      events: [],
      performance: {
        avgRenderTime: 0,
        updateFrequency: 0,
        latency: {
          input: 0,
          output: 0,
        },
        lastMeasurement: Date.now(),
      },
    });

    // Initialize tracking maps
    this.apiCallTracking.set(sessionId, []);
    this.streamConnections.set(sessionId, []);
    this.resizeHistory.set(sessionId, []);
    this.renderTimes.set(sessionId, []);
    this.updateCounts.set(sessionId, { count: 0, startTime: Date.now() });
    this.latencyMeasurements.set(sessionId, { input: [], output: [] });
  }

  trackWebSocketConnection(sessionId: string, ws: WebSocket) {
    const wsInfo: WebSocketDebugInfo = {
      state: 'connecting',
      connectedAt: Date.now(),
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      reconnectCount: this.wsConnections.get(sessionId)?.reconnectCount || 0,
    };

    this.wsConnections.set(sessionId, wsInfo);

    const eventLogger = this.eventLoggers.get(sessionId);
    eventLogger?.log('websocket', 'WebSocket connecting', { url: ws.url });

    ws.addEventListener('open', () => {
      wsInfo.state = 'connected';
      wsInfo.connectedAt = Date.now();
      eventLogger?.log('websocket', 'WebSocket connected');
      this.updateDebugInfo(sessionId);
    });

    ws.addEventListener('message', (event) => {
      wsInfo.messagesReceived++;
      wsInfo.lastMessage = Date.now();

      // Estimate bytes received
      if (event.data instanceof ArrayBuffer) {
        wsInfo.bytesReceived += event.data.byteLength;
      } else if (typeof event.data === 'string') {
        wsInfo.bytesReceived += new TextEncoder().encode(event.data).length;
      }

      this.updateDebugInfo(sessionId);
    });

    ws.addEventListener('close', () => {
      wsInfo.state = 'disconnected';
      eventLogger?.log('websocket', 'WebSocket disconnected', {
        duration: Date.now() - (wsInfo.connectedAt || 0),
        messages: wsInfo.messagesReceived,
      });
      this.updateDebugInfo(sessionId);
    });

    ws.addEventListener('error', (error) => {
      wsInfo.state = 'error';
      wsInfo.lastError = error.toString();
      eventLogger?.log('websocket', 'WebSocket error', { error }, 'error');
      this.updateDebugInfo(sessionId);
    });
  }

  trackStreamConnection(sessionId: string, type: 'sse' | 'ascii', url: string) {
    const streamInfo: HttpStreamDebugInfo = {
      type,
      url,
      state: 'active',
      startedAt: Date.now(),
      bytesReceived: 0,
      lastActivity: Date.now(),
    };

    const streams = this.streamConnections.get(sessionId) || [];
    streams.push(streamInfo);
    this.streamConnections.set(sessionId, streams);

    const eventLogger = this.eventLoggers.get(sessionId);
    eventLogger?.log('stream_fetch', `${type.toUpperCase()} stream started`, { url });

    this.updateDebugInfo(sessionId);

    return streamInfo;
  }

  updateStreamBytes(sessionId: string, streamInfo: HttpStreamDebugInfo, bytes: number) {
    streamInfo.bytesReceived += bytes;
    streamInfo.lastActivity = Date.now();
    this.updateDebugInfo(sessionId);
  }

  closeStream(sessionId: string, streamInfo: HttpStreamDebugInfo, error?: string) {
    streamInfo.state = error ? 'error' : 'closed';
    streamInfo.error = error;

    const eventLogger = this.eventLoggers.get(sessionId);
    eventLogger?.log(
      'stream_fetch',
      `${streamInfo.type.toUpperCase()} stream closed`,
      {
        duration: Date.now() - streamInfo.startedAt,
        bytesReceived: streamInfo.bytesReceived,
        error,
      },
      error ? 'error' : 'info'
    );

    this.updateDebugInfo(sessionId);
  }

  trackResize(
    sessionId: string,
    from: { cols: number; rows: number },
    to: { cols: number; rows: number },
    source: 'user' | 'window' | 'api' = 'user'
  ) {
    const resize: ResizeEvent = {
      timestamp: Date.now(),
      from,
      to,
      source,
    };

    const history = this.resizeHistory.get(sessionId) || [];
    history.push(resize);

    // Keep last 100 resize events
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    this.resizeHistory.set(sessionId, history);

    const eventLogger = this.eventLoggers.get(sessionId);
    eventLogger?.log(
      'resize',
      `Terminal resized: ${from.cols}×${from.rows} → ${to.cols}×${to.rows}`,
      { source }
    );

    this.updateDebugInfo(sessionId);
  }

  trackRenderTime(sessionId: string, renderTime: number) {
    const times = this.renderTimes.get(sessionId) || [];
    times.push(renderTime);

    // Keep last 100 render times
    if (times.length > 100) {
      times.splice(0, times.length - 100);
    }

    this.renderTimes.set(sessionId, times);
    this.updateDebugInfo(sessionId);
  }

  trackUpdate(sessionId: string) {
    const updateInfo = this.updateCounts.get(sessionId);
    if (updateInfo) {
      updateInfo.count++;
    }
    this.updateDebugInfo(sessionId);
  }

  trackInputLatency(sessionId: string, latency: number) {
    const measurements = this.latencyMeasurements.get(sessionId);
    if (measurements) {
      measurements.input.push(latency);

      // Keep last 50 measurements
      if (measurements.input.length > 50) {
        measurements.input.splice(0, measurements.input.length - 50);
      }
    }
    this.updateDebugInfo(sessionId);
  }

  trackOutputLatency(sessionId: string, latency: number) {
    const measurements = this.latencyMeasurements.get(sessionId);
    if (measurements) {
      measurements.output.push(latency);

      // Keep last 50 measurements
      if (measurements.output.length > 50) {
        measurements.output.splice(0, measurements.output.length - 50);
      }
    }
    this.updateDebugInfo(sessionId);
  }

  updateTerminalBuffer(
    sessionId: string,
    stats: {
      totalLines: number;
      totalCharacters: number;
      viewportY: number;
      scrollbackSize: number;
    }
  ) {
    const debugInfo = this.debugData.get(sessionId);
    if (debugInfo) {
      debugInfo.terminal.bufferStats = stats;
      debugInfo.terminal.lastUpdate = Date.now();
      this.updateDebugInfo(sessionId);
    }
  }

  updateOutputStats(
    sessionId: string,
    stats: {
      totalStdoutBytes: number;
      compressedBytes: number;
      transferredBytes: number;
    }
  ) {
    const debugInfo = this.debugData.get(sessionId);
    if (debugInfo) {
      debugInfo.output.totalStdoutBytes = stats.totalStdoutBytes;
      debugInfo.output.compressedBytes = stats.compressedBytes;
      debugInfo.output.transferredBytes = stats.transferredBytes;
      debugInfo.output.compressionRatio =
        stats.totalStdoutBytes > 0 ? stats.transferredBytes / stats.totalStdoutBytes : 0;
      this.updateDebugInfo(sessionId);
    }
  }

  trackCleanup(sessionId: string) {
    const debugInfo = this.debugData.get(sessionId);
    if (debugInfo) {
      debugInfo.output.lastCleanup = Date.now();

      const eventLogger = this.eventLoggers.get(sessionId);
      eventLogger?.log('cleanup', 'Output buffer cleaned', {
        beforeBytes: debugInfo.output.totalStdoutBytes,
        afterBytes: debugInfo.output.transferredBytes,
      });

      this.updateDebugInfo(sessionId);
    }
  }

  private trackApiCall(sessionId: string, call: ApiCallDebugInfo) {
    const calls = this.apiCallTracking.get(sessionId) || [];
    calls.push(call);

    // Keep last 100 API calls
    if (calls.length > 100) {
      calls.splice(0, calls.length - 100);
    }

    this.apiCallTracking.set(sessionId, calls);
    this.updateDebugInfo(sessionId);
  }

  private updateDebugInfo(sessionId: string) {
    const debugInfo = this.debugData.get(sessionId);
    if (!debugInfo) return;

    // Update WebSocket info
    const wsInfo = this.wsConnections.get(sessionId);
    if (wsInfo) {
      debugInfo.connections.websocket = wsInfo;
    }

    // Update streams
    debugInfo.connections.httpStreams = this.streamConnections.get(sessionId) || [];

    // Update API calls
    debugInfo.connections.apiCalls = this.apiCallTracking.get(sessionId) || [];

    // Update resize history
    debugInfo.terminal.resizeHistory = this.resizeHistory.get(sessionId) || [];

    // Update events
    const eventLogger = this.eventLoggers.get(sessionId);
    if (eventLogger) {
      debugInfo.events = eventLogger.getEvents();
    }

    // Calculate performance metrics
    const renderTimes = this.renderTimes.get(sessionId) || [];
    if (renderTimes.length > 0) {
      debugInfo.performance.avgRenderTime =
        renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
    }

    const updateInfo = this.updateCounts.get(sessionId);
    if (updateInfo && updateInfo.count > 0) {
      const elapsed = (Date.now() - updateInfo.startTime) / 1000;
      debugInfo.performance.updateFrequency = updateInfo.count / elapsed;
    }

    const latencyMeasurements = this.latencyMeasurements.get(sessionId);
    if (latencyMeasurements) {
      if (latencyMeasurements.input.length > 0) {
        debugInfo.performance.latency.input = Math.round(
          latencyMeasurements.input.reduce((a, b) => a + b, 0) / latencyMeasurements.input.length
        );
      }
      if (latencyMeasurements.output.length > 0) {
        debugInfo.performance.latency.output = Math.round(
          latencyMeasurements.output.reduce((a, b) => a + b, 0) / latencyMeasurements.output.length
        );
      }
    }

    debugInfo.performance.lastMeasurement = Date.now();
    debugInfo.timestamp = Date.now();
  }

  getDebugInfo(sessionId: string): SessionDebugInfo | undefined {
    this.updateDebugInfo(sessionId);
    return this.debugData.get(sessionId);
  }

  async fetchServerDebugInfo(sessionId: string): Promise<void> {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/debug`);
      if (response.ok) {
        const serverDebugInfo = await response.json();

        const debugInfo = this.debugData.get(sessionId);
        if (debugInfo && serverDebugInfo) {
          // Merge server-side debug info
          if (serverDebugInfo.process) {
            debugInfo.process = { ...debugInfo.process, ...serverDebugInfo.process };
          }
          if (serverDebugInfo.output) {
            debugInfo.output = { ...debugInfo.output, ...serverDebugInfo.output };
          }

          this.updateDebugInfo(sessionId);
        }
      }
    } catch (error) {
      logger.error('Failed to fetch server debug info:', error);
    }
  }

  cleanup(sessionId: string) {
    this.debugData.delete(sessionId);
    this.eventLoggers.delete(sessionId);
    this.apiCallTracking.delete(sessionId);
    this.streamConnections.delete(sessionId);
    this.resizeHistory.delete(sessionId);
    this.wsConnections.delete(sessionId);
    this.renderTimes.delete(sessionId);
    this.updateCounts.delete(sessionId);
    this.latencyMeasurements.delete(sessionId);
  }
}

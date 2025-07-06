/**
 * WebRTC configuration for STUN/TURN servers
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

export interface WebRTCConfig {
  iceServers: IceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy?: 'negotiate' | 'require';
  iceCandidatePoolSize?: number;
}

/**
 * Default STUN servers (free public servers)
 */
export const DEFAULT_STUN_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

/**
 * Get WebRTC configuration from environment or use defaults
 */
export function getWebRTCConfig(): WebRTCConfig {
  const config: WebRTCConfig = {
    iceServers: [...DEFAULT_STUN_SERVERS],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 0,
  };

  // Check for environment variables (browser environment)
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    // In browser, we might get config from a meta tag or global variable
    const browserGlobal = globalThis as typeof globalThis & {
      window: { __WEBRTC_CONFIG__?: { iceServers?: IceServer[] } };
    };
    const customConfig = browserGlobal.window.__WEBRTC_CONFIG__;
    if (customConfig?.iceServers) {
      config.iceServers = customConfig.iceServers;
    }
  }

  // Check for environment variables (Node.js environment)
  if (typeof process !== 'undefined' && process.env) {
    // TURN server configuration from environment
    if (process.env.TURN_SERVER_URL) {
      const turnServer: IceServer = {
        urls: process.env.TURN_SERVER_URL,
      };

      if (process.env.TURN_USERNAME) {
        turnServer.username = process.env.TURN_USERNAME;
      }

      if (process.env.TURN_CREDENTIAL) {
        turnServer.credential = process.env.TURN_CREDENTIAL;
      }

      config.iceServers.push(turnServer);
    }

    // Additional STUN servers from environment
    if (process.env.ADDITIONAL_STUN_SERVERS) {
      const additionalStunServers = process.env.ADDITIONAL_STUN_SERVERS.split(',').map((url) => ({
        urls: url.trim(),
      }));
      config.iceServers.push(...additionalStunServers);
    }

    // ICE transport policy
    if (process.env.ICE_TRANSPORT_POLICY === 'relay') {
      config.iceTransportPolicy = 'relay';
    }
  }

  return config;
}

/**
 * Parse WebRTC config from JSON string
 */
export function parseWebRTCConfig(jsonString: string): WebRTCConfig | null {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate the structure
    if (!parsed.iceServers || !Array.isArray(parsed.iceServers)) {
      return null;
    }

    // Validate each ice server
    for (const server of parsed.iceServers) {
      if (!server.urls) {
        return null;
      }
    }

    return parsed as WebRTCConfig;
  } catch (error) {
    console.error('Failed to parse WebRTC config:', error);
    return null;
  }
}

/**
 * Create a configuration string for display/debugging
 */
export function formatWebRTCConfig(config: WebRTCConfig): string {
  const servers = config.iceServers.map((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const serverType = urls[0].startsWith('turn:') ? 'TURN' : 'STUN';
    const hasAuth = server.username && server.credential;
    return `${serverType}: ${urls[0]}${hasAuth ? ' (authenticated)' : ''}`;
  });

  return servers.join('\n');
}

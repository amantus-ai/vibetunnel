import type { Router } from 'express';
import { formatWebRTCConfig, getWebRTCConfig } from '../../shared/webrtc-config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('webrtc-config');

export function createWebRTCConfigRouter(): Router {
  const router: Router = require('express').Router();

  /**
   * GET /api/webrtc-config
   * Returns the WebRTC configuration for the client
   */
  router.get('/webrtc-config', (_req, res) => {
    try {
      const config = getWebRTCConfig();

      // Log the configuration for debugging
      logger.log(`Serving WebRTC configuration:\n${formatWebRTCConfig(config)}`);

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      logger.error('Failed to get WebRTC config:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get WebRTC configuration',
      });
    }
  });

  return router;
}

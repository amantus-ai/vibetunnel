import { createLogger } from '../utils/logger.js';
import type { ControlMessage } from './control-protocol.js';
import { controlUnixHandler } from './control-unix-handler.js';

const logger = createLogger('screencap-api');

class ScreencapAPIHandler {
  async sendRequest(message: ControlMessage): Promise<ControlMessage | null> {
    logger.log(
      `Sending API request to Mac: ${message.action}, payload: ${JSON.stringify(message.payload)}`
    );
    return controlUnixHandler.sendControlMessage(message);
  }
}

export const screencapAPIHandler = new ScreencapAPIHandler();

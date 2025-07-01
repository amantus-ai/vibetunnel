// Version information for VibeTunnel Server
// This file is updated during the build process

import chalk from 'chalk';
import packageJson from '../../package.json';
import { createLogger } from './utils/logger.js';

const logger = createLogger('version');

export const VERSION = packageJson.version;
// BUILD_DATE will be replaced by build script, fallback to current time in dev
export const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString();
export const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || Date.now();

// This will be replaced during build
export const GIT_COMMIT = process.env.GIT_COMMIT || 'development';
export const NODE_VERSION = process.version;
export const PLATFORM = process.platform;
export const ARCH = process.arch;

export function getVersionInfo() {
  logger.debug('gathering version information');

  const info = {
    version: VERSION,
    buildDate: BUILD_DATE,
    buildTimestamp: BUILD_TIMESTAMP,
    gitCommit: GIT_COMMIT,
    nodeVersion: NODE_VERSION,
    platform: PLATFORM,
    arch: ARCH,
    uptime: process.uptime(),
    pid: process.pid,
  };

  logger.debug(`version info: ${JSON.stringify(info)}`);
  return info;
}

export function printVersionBanner() {
  logger.log(chalk.green(`VibeTunnel Server v${VERSION}`));
  logger.log(chalk.gray(`Built: ${BUILD_DATE}`));
  logger.log(chalk.gray(`Platform: ${PLATFORM}/${ARCH} Node ${NODE_VERSION}`));
  logger.log(chalk.gray(`PID: ${process.pid}`));

  if (GIT_COMMIT !== 'development') {
    logger.log(chalk.gray(`Commit: ${GIT_COMMIT}`));
  }

  // Log development mode warning
  if (GIT_COMMIT === 'development' || !process.env.BUILD_DATE) {
    logger.log(chalk.yellow('running in development mode'));
  }
}

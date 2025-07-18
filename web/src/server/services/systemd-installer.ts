#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Colors for output
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m'; // No Color

// Configuration
const SERVICE_NAME = 'vibetunnel';
const SERVICE_FILE = 'vibetunnel.service';
const SYSTEMD_DIR = '/etc/systemd/system';
const USER_NAME = 'vibetunnel';
const GROUP_NAME = 'vibetunnel';
const INSTALL_DIR = '/opt/vibetunnel';

// Print colored output
function printInfo(message: string): void {
  console.log(`${BLUE}[INFO]${NC} ${message}`);
}

function printSuccess(message: string): void {
  console.log(`${GREEN}[SUCCESS]${NC} ${message}`);
}

function _printWarning(message: string): void {
  console.log(`${YELLOW}[WARNING]${NC} ${message}`);
}

function printError(message: string): void {
  console.log(`${RED}[ERROR]${NC} ${message}`);
}

// Check if running as root
function checkRoot(): void {
  if (process.getuid && process.getuid() !== 0) {
    printError('This command must be run as root (use sudo)');
    process.exit(1);
  }
}

// Check if vibetunnel is installed
function checkVibetunnel(): void {
  try {
    execSync('which vibetunnel', { stdio: 'pipe' });
    const version = execSync('vibetunnel version', { encoding: 'utf8', stdio: 'pipe' }).trim();
    printInfo(`Found VibeTunnel: ${version}`);
  } catch (_error) {
    printError('VibeTunnel is not installed globally. Please install it first:');
    console.log('  npm install -g vibetunnel');
    process.exit(1);
  }
}

// Create vibetunnel user and group
function createUser(): void {
  try {
    execSync(`id ${USER_NAME}`, { stdio: 'pipe' });
    printInfo(`User ${USER_NAME} already exists`);
  } catch (_error) {
    printInfo(`Creating user ${USER_NAME}...`);
    try {
      execSync(
        `useradd --system --shell /bin/false --home-dir ${INSTALL_DIR} --create-home ${USER_NAME}`,
        { stdio: 'pipe' }
      );
      printSuccess(`User ${USER_NAME} created`);
    } catch (createError) {
      printError(`Failed to create user ${USER_NAME}: ${createError}`);
      process.exit(1);
    }
  }
}

// Create directories
function createDirectories(): void {
  printInfo('Creating directories...');
  try {
    mkdirSync(INSTALL_DIR, { recursive: true });
    execSync(`chown ${USER_NAME}:${GROUP_NAME} ${INSTALL_DIR}`, { stdio: 'pipe' });
    execSync(`chmod 755 ${INSTALL_DIR}`, { stdio: 'pipe' });
    printSuccess('Directories created');
  } catch (error) {
    printError(`Failed to create directories: ${error}`);
    process.exit(1);
  }
}

// Get the systemd service template
function getServiceTemplate(): string {
  return `[Unit]
Description=VibeTunnel - Terminal sharing server with web interface
Documentation=https://github.com/amantus-ai/vibetunnel
After=network.target
Wants=network.target

[Service]
Type=simple
User=${USER_NAME}
Group=${GROUP_NAME}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/vibetunnel --port 4020 --bind 0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

# Environment
Environment=NODE_ENV=production
Environment=VIBETUNNEL_LOG_LEVEL=info

# Resource limits
LimitNOFILE=65536
MemoryHigh=512M
MemoryMax=1G

[Install]
WantedBy=multi-user.target`;
}

// Install systemd service
function installService(): void {
  printInfo('Installing systemd service...');

  const serviceContent = getServiceTemplate();
  const servicePath = join(SYSTEMD_DIR, SERVICE_FILE);

  try {
    writeFileSync(servicePath, serviceContent);
    execSync(`chmod 644 ${servicePath}`, { stdio: 'pipe' });

    // Reload systemd
    execSync('systemctl daemon-reload', { stdio: 'pipe' });
    printSuccess('Systemd service installed');
  } catch (error) {
    printError(`Failed to install service: ${error}`);
    process.exit(1);
  }
}

// Configure service
function configureService(): void {
  printInfo('Configuring service...');

  try {
    // Enable the service
    execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'pipe' });
    printSuccess('Service enabled for automatic startup');
  } catch (error) {
    printError(`Failed to configure service: ${error}`);
    process.exit(1);
  }
}

// Display usage instructions
function showUsage(): void {
  printSuccess('VibeTunnel systemd service installation completed!');
  console.log('');
  console.log('Usage:');
  console.log(`  sudo systemctl start ${SERVICE_NAME}     # Start the service`);
  console.log(`  sudo systemctl stop ${SERVICE_NAME}      # Stop the service`);
  console.log(`  sudo systemctl restart ${SERVICE_NAME}   # Restart the service`);
  console.log(`  sudo systemctl status ${SERVICE_NAME}    # Check service status`);
  console.log(`  sudo systemctl enable ${SERVICE_NAME}    # Enable auto-start (already done)`);
  console.log(`  sudo systemctl disable ${SERVICE_NAME}   # Disable auto-start`);
  console.log('');
  console.log('Logs:');
  console.log(`  sudo journalctl -u ${SERVICE_NAME} -f    # Follow logs in real-time`);
  console.log(`  sudo journalctl -u ${SERVICE_NAME}       # View all logs`);
  console.log('');
  console.log('Configuration:');
  console.log('  Service runs on port 4020 by default');
  console.log('  Web interface: http://localhost:4020');
  console.log(`  Service runs as user: ${USER_NAME}`);
  console.log(`  Working directory: ${INSTALL_DIR}`);
  console.log('');
  console.log(`To customize the service, edit: ${SYSTEMD_DIR}/${SERVICE_FILE}`);
  console.log(`Then run: sudo systemctl daemon-reload && sudo systemctl restart ${SERVICE_NAME}`);
}

// Uninstall function
function uninstallService(): void {
  printInfo('Uninstalling VibeTunnel systemd service...');

  try {
    // Stop and disable service
    try {
      execSync(`systemctl is-active ${SERVICE_NAME}`, { stdio: 'pipe' });
      execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: 'pipe' });
      printInfo('Service stopped');
    } catch (_error) {
      // Service not running
    }

    try {
      execSync(`systemctl is-enabled ${SERVICE_NAME}`, { stdio: 'pipe' });
      execSync(`systemctl disable ${SERVICE_NAME}`, { stdio: 'pipe' });
      printInfo('Service disabled');
    } catch (_error) {
      // Service not enabled
    }

    // Remove service file
    const servicePath = join(SYSTEMD_DIR, SERVICE_FILE);
    if (existsSync(servicePath)) {
      execSync(`rm ${servicePath}`, { stdio: 'pipe' });
      printInfo('Service file removed');
    }

    // Reload systemd
    execSync('systemctl daemon-reload', { stdio: 'pipe' });

    // Ask about removing user and directories
    console.log('');
    console.log(`To completely remove the ${USER_NAME} user and ${INSTALL_DIR} directory, run:`);
    console.log(`  sudo userdel ${USER_NAME}`);
    console.log(`  sudo rm -rf ${INSTALL_DIR}`);

    printSuccess('VibeTunnel systemd service uninstalled');
  } catch (error) {
    printError(`Failed to uninstall service: ${error}`);
    process.exit(1);
  }
}

// Check service status
function checkServiceStatus(): void {
  try {
    const status = execSync(`systemctl status ${SERVICE_NAME}`, { encoding: 'utf8' });
    console.log(status);
  } catch (error) {
    // systemctl status returns non-zero for inactive services, which is normal
    if (error instanceof Error && 'stdout' in error) {
      console.log(error.stdout);
    } else {
      printError(`Failed to get service status: ${error}`);
    }
  }
}

// Main installation function
export function installSystemdService(action: string = 'install'): void {
  switch (action) {
    case 'install':
      printInfo('Installing VibeTunnel systemd service...');
      checkRoot();
      checkVibetunnel();
      createUser();
      createDirectories();
      installService();
      configureService();
      showUsage();
      break;

    case 'uninstall':
      checkRoot();
      uninstallService();
      break;

    case 'status':
      checkServiceStatus();
      break;

    default:
      console.log('Usage: vibetunnel install-service [install|uninstall|status]');
      console.log('  install   - Install VibeTunnel systemd service (default)');
      console.log('  uninstall - Remove VibeTunnel systemd service');
      console.log('  status    - Check service status');
      process.exit(1);
  }
}

// This module is only meant to be imported by the CLI
// Direct execution is handled by src/cli.ts

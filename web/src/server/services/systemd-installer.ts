#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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

// Get the current user (the one who installed vibetunnel)
function getCurrentUser(): { username: string; home: string } {
  const username = process.env.SUDO_USER || process.env.USER || 'root';
  const home = process.env.SUDO_USER
    ? `/home/${process.env.SUDO_USER}`
    : process.env.HOME || `/home/${username}`;
  return { username, home };
}

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

// Create a stable wrapper script that can find vibetunnel regardless of node version manager
function createVibetunnelWrapper(): string {
  const { username, home } = getCurrentUser();
  const wrapperPath = '/usr/local/bin/vibetunnel-systemd';
  const wrapperContent = `#!/bin/bash
# VibeTunnel Systemd Wrapper Script
# This script finds and executes vibetunnel for user: ${username}

# Function to log messages
log_info() {
    echo "[INFO] $1" >&2
}

log_error() {
    echo "[ERROR] $1" >&2
}

# Set up environment for user ${username}
export HOME="${home}"
export USER="${username}"

# Try to find vibetunnel in various ways
find_vibetunnel() {
    # Method 1: Check if vibetunnel is in PATH
    if command -v vibetunnel >/dev/null 2>&1; then
        log_info "Found vibetunnel in PATH"
        vibetunnel "$@"
        return $?
    fi
    
    # Method 2: Check for nvm installations
    if [ -d "${home}/.nvm" ]; then
        log_info "Checking nvm installation for user ${username}"
        export NVM_DIR="${home}/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        if command -v vibetunnel >/dev/null 2>&1; then
            log_info "Found vibetunnel via nvm"
            vibetunnel "$@"
            return $?
        fi
    fi
    
    # Method 3: Check for fnm installations  
    if [ -d "${home}/.local/share/fnm" ]; then
        log_info "Checking fnm installation for user ${username}"
        export PATH="${home}/.local/share/fnm:$PATH"
        eval "$(fnm env --use-on-cd)" 2>/dev/null || true
        if command -v vibetunnel >/dev/null 2>&1; then
            log_info "Found vibetunnel via fnm"
            vibetunnel "$@"
            return $?
        fi
    fi
    
    # Method 4: Check common global npm locations
    for npm_bin in "/usr/local/bin/npm" "/usr/bin/npm" "/opt/homebrew/bin/npm"; do
        if [ -x "$npm_bin" ]; then
            log_info "Trying npm global with $npm_bin"
            NPM_PREFIX=$("$npm_bin" config get prefix 2>/dev/null)
            if [ -n "$NPM_PREFIX" ] && [ -x "$NPM_PREFIX/bin/vibetunnel" ]; then
                log_info "Found vibetunnel via npm global: $NPM_PREFIX/bin/vibetunnel"
                "$NPM_PREFIX/bin/vibetunnel" "$@"
                return $?
            fi
        fi
    done
    
    # Method 5: Try to run with node directly using global npm package
    for node_bin in "/usr/local/bin/node" "/usr/bin/node" "/opt/homebrew/bin/node"; do
        if [ -x "$node_bin" ]; then
            for script_path in "/usr/local/lib/node_modules/vibetunnel/dist/cli.js" "/usr/lib/node_modules/vibetunnel/dist/cli.js"; do
                if [ -f "$script_path" ]; then
                    log_info "Running vibetunnel via node: $node_bin $script_path"
                    "$node_bin" "$script_path" "$@"
                    return $?
                fi
            done
        fi
    done
    
    log_error "Could not find vibetunnel installation for user ${username}"
    log_error "Please ensure vibetunnel is installed globally: npm install -g vibetunnel"
    return 1
}

# Execute the function with all arguments
find_vibetunnel "$@"
`;

  try {
    // Create the wrapper script
    writeFileSync(wrapperPath, wrapperContent);
    execSync(`chmod +x ${wrapperPath}`, { stdio: 'pipe' });

    printSuccess(`Created wrapper script at ${wrapperPath}`);
    return wrapperPath;
  } catch (error) {
    printError(`Failed to create wrapper script: ${error}`);
    process.exit(1);
  }
}

// Verify that vibetunnel is accessible and return wrapper path
function checkVibetunnelAndCreateWrapper(): string {
  // First, verify that vibetunnel is actually installed somewhere
  try {
    let whichCommand = 'which vibetunnel';

    // If running with sudo, check as the original user
    if (process.env.SUDO_USER) {
      whichCommand = `sudo -u ${process.env.SUDO_USER} -i which vibetunnel`;
    }

    const vibetunnelPath = execSync(whichCommand, { encoding: 'utf8', stdio: 'pipe' }).trim();
    printInfo(`Found VibeTunnel at: ${vibetunnelPath}`);
  } catch (_error) {
    printError('VibeTunnel is not installed or not accessible. Please install it first:');
    console.log('  npm install -g vibetunnel');
    process.exit(1);
  }

  // Create and return the wrapper script path
  return createVibetunnelWrapper();
}

// Remove wrapper script during uninstall
function removeVibetunnelWrapper(): void {
  const wrapperPath = '/usr/local/bin/vibetunnel-systemd';
  try {
    if (existsSync(wrapperPath)) {
      execSync(`rm ${wrapperPath}`, { stdio: 'pipe' });
      printInfo('Removed wrapper script');
    }
  } catch (_error) {
    // Ignore errors when removing wrapper
  }
}

// No need to create users or directories - using current user

// Get the systemd service template
function getServiceTemplate(vibetunnelPath: string): string {
  const { username, home } = getCurrentUser();

  return `[Unit]
Description=VibeTunnel - Terminal sharing server with web interface
Documentation=https://github.com/amantus-ai/vibetunnel
After=network.target
Wants=network.target

[Service]
Type=simple
User=${username}
Group=${username}
WorkingDirectory=${home}
ExecStart=${vibetunnelPath} --port 4020 --bind 0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security settings
NoNewPrivileges=true
PrivateTmp=true

# Environment - preserve user environment for node version managers
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
function installService(vibetunnelPath: string): void {
  printInfo('Installing systemd service...');

  const serviceContent = getServiceTemplate(vibetunnelPath);
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
  const { username, home } = getCurrentUser();

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
  console.log(`  Service runs as user: ${username}`);
  console.log(`  Working directory: ${home}`);
  console.log('  Wrapper script: /usr/local/bin/vibetunnel-systemd');
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

    // Remove wrapper script
    removeVibetunnelWrapper();

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

// Check if we're running on a platform that supports getuid (Unix-like systems)
function isUnixLike(): boolean {
  return typeof process.getuid === 'function';
}

// Check if running as root (only on Unix-like systems)
function isRunningAsRoot(): boolean {
  if (!isUnixLike()) {
    return false; // On Windows, assume no root privileges
  }
  return process.getuid?.() === 0;
}

// Safely re-execute with sudo using proper escaping and the global vibetunnel command
function reExecuteWithSudo(action: string): void {
  if (!isUnixLike()) {
    printError('Systemd services are only supported on Unix-like systems (Linux/macOS)');
    printError('Windows is not supported for systemd service installation');
    process.exit(1);
  }

  printInfo('Root privileges required. Re-running with sudo...');
  try {
    // Validate action to prevent command injection
    const validActions = ['install', 'uninstall', 'status'];
    if (!validActions.includes(action)) {
      printError(`Invalid action: ${action}`);
      process.exit(1);
    }

    // Use the global vibetunnel command instead of internal script paths
    // This avoids path injection issues and works correctly with npm installations
    // Preserve environment variables with -E flag
    const command = `sudo -E vibetunnel systemd ${action}`;
    execSync(command, { stdio: 'inherit' });
    process.exit(0);
  } catch (error) {
    printError(`Failed to run with sudo: ${error}`);
    process.exit(1);
  }
}

// Main installation function
export function installSystemdService(action: string = 'install'): void {
  switch (action) {
    case 'install': {
      printInfo('Installing VibeTunnel systemd service...');

      // Check if we need to re-run with sudo
      if (!isRunningAsRoot()) {
        reExecuteWithSudo(action);
        return; // This line won't be reached due to process.exit in reExecuteWithSudo
      }

      const wrapperPath = checkVibetunnelAndCreateWrapper();
      installService(wrapperPath);
      configureService();
      showUsage();
      break;
    }

    case 'uninstall': {
      // Check if we need to re-run with sudo
      if (!isRunningAsRoot()) {
        reExecuteWithSudo(action);
        return; // This line won't be reached due to process.exit in reExecuteWithSudo
      }

      uninstallService();
      break;
    }

    case 'status':
      checkServiceStatus();
      break;

    default:
      console.log('Usage: vibetunnel systemd [install|uninstall|status]');
      console.log('  install   - Install VibeTunnel systemd service (default)');
      console.log('  uninstall - Remove VibeTunnel systemd service');
      console.log('  status    - Check service status');
      process.exit(1);
  }
}

// This module is only meant to be imported by the CLI
// Direct execution is handled by src/cli.ts

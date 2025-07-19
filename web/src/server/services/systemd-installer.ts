#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Colors for output
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m'; // No Color

// Configuration
const SERVICE_NAME = 'vibetunnel';
const SERVICE_FILE = 'vibetunnel.service';

// Get the current user (regular user only, no sudo/root)
function getCurrentUser(): { username: string; home: string } {
  const username = process.env.USER || 'unknown';
  const home = process.env.HOME || `/home/${username}`;

  return { username, home };
}

// Print colored output
function printInfo(message: string): void {
  console.log(`${BLUE}[INFO]${NC} ${message}`);
}

function printSuccess(message: string): void {
  console.log(`${GREEN}[SUCCESS]${NC} ${message}`);
}

function printError(message: string): void {
  console.log(`${RED}[ERROR]${NC} ${message}`);
}

// Create a stable wrapper script that can find vibetunnel regardless of node version manager
function createVibetunnelWrapper(): string {
  const { username, home } = getCurrentUser();
  const wrapperPath = `${home}/.local/bin/vibetunnel-systemd`;
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
    if [ -d "${home}/.local/share/fnm" ] && [ -x "${home}/.local/share/fnm/fnm" ]; then
        log_info "Checking fnm installation for user ${username}"
        export FNM_DIR="${home}/.local/share/fnm"
        export PATH="${home}/.local/share/fnm:$PATH"
        export SHELL="/bin/bash"  # Force shell for fnm
        # Initialize fnm with explicit shell and use the default node version
        eval "$("${home}/.local/share/fnm/fnm" env --shell bash)" 2>/dev/null || true
        # Try to use the default node version or current version
        "${home}/.local/share/fnm/fnm" use default >/dev/null 2>&1 || "${home}/.local/share/fnm/fnm" use current >/dev/null 2>&1 || true
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
    // Ensure ~/.local/bin directory exists
    const localBinDir = `${home}/.local/bin`;
    if (!existsSync(localBinDir)) {
      mkdirSync(localBinDir, { recursive: true });
      printInfo(`Created directory: ${localBinDir}`);
    }

    // Create the wrapper script
    writeFileSync(wrapperPath, wrapperContent);
    chmodSync(wrapperPath, 0o755);

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
    const vibetunnelPath = execSync('which vibetunnel', { encoding: 'utf8', stdio: 'pipe' }).trim();
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
  const { home } = getCurrentUser();
  const wrapperPath = `${home}/.local/bin/vibetunnel-systemd`;
  try {
    if (existsSync(wrapperPath)) {
      unlinkSync(wrapperPath);
      printInfo('Removed wrapper script');
    }
  } catch (_error) {
    // Ignore errors when removing wrapper
  }
}

// No need to create users or directories - using current user

// Get the systemd service template
function getServiceTemplate(vibetunnelPath: string): string {
  const { home } = getCurrentUser();

  return `[Unit]
Description=VibeTunnel - Terminal sharing server with web interface
Documentation=https://github.com/amantus-ai/vibetunnel
After=network.target
Wants=network.target

[Service]
Type=simple
WorkingDirectory=${home}
ExecStart=${vibetunnelPath} --port 4020 --bind 0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Environment - preserve user environment for node version managers
Environment=NODE_ENV=production
Environment=VIBETUNNEL_LOG_LEVEL=info
Environment=HOME=%h
Environment=USER=%i

# Resource limits
LimitNOFILE=65536
MemoryHigh=512M
MemoryMax=1G

[Install]
WantedBy=default.target`;
}

// Install systemd service
function installService(vibetunnelPath: string): void {
  printInfo('Installing user systemd service...');

  const { home } = getCurrentUser();
  const systemdDir = `${home}/.config/systemd/user`;
  const serviceContent = getServiceTemplate(vibetunnelPath);
  const servicePath = join(systemdDir, SERVICE_FILE);

  try {
    // Create user systemd directory if it doesn't exist
    mkdirSync(systemdDir, { recursive: true });

    writeFileSync(servicePath, serviceContent);
    chmodSync(servicePath, 0o644);

    // Reload user systemd
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    printSuccess('User systemd service installed');
  } catch (error) {
    printError(`Failed to install service: ${error}`);
    process.exit(1);
  }
}

// Configure service
function configureService(): void {
  printInfo('Configuring service...');

  try {
    // Enable the user service
    execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'pipe' });
    printSuccess('User service enabled for automatic startup');

    // Enable lingering so service starts on boot even when user not logged in
    try {
      const { username } = getCurrentUser();
      execSync(`loginctl enable-linger ${username}`, { stdio: 'pipe' });
      printSuccess('User lingering enabled - service will start on boot');
    } catch (error) {
      printError(`Failed to enable lingering: ${error}`);
      printError('Service will only start when user logs in');
    }
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
  console.log(`  systemctl --user start ${SERVICE_NAME}     # Start the service`);
  console.log(`  systemctl --user stop ${SERVICE_NAME}      # Stop the service`);
  console.log(`  systemctl --user restart ${SERVICE_NAME}   # Restart the service`);
  console.log(`  systemctl --user status ${SERVICE_NAME}    # Check service status`);
  console.log(`  systemctl --user enable ${SERVICE_NAME}    # Enable auto-start (already done)`);
  console.log(`  systemctl --user disable ${SERVICE_NAME}   # Disable auto-start`);
  console.log('');
  console.log('Logs:');
  console.log(`  journalctl --user -u ${SERVICE_NAME} -f    # Follow logs in real-time`);
  console.log(`  journalctl --user -u ${SERVICE_NAME}       # View all logs`);
  console.log('');
  console.log('Configuration:');
  console.log('  Service runs on port 4020 by default');
  console.log('  Web interface: http://localhost:4020');
  console.log(`  Service runs as user: ${username}`);
  console.log(`  Working directory: ${home}`);
  console.log(`  Wrapper script: ${home}/.local/bin/vibetunnel-systemd`);
  console.log('');
  console.log(`To customize the service, edit: ${home}/.config/systemd/user/${SERVICE_FILE}`);
  console.log(
    `Then run: systemctl --user daemon-reload && systemctl --user restart ${SERVICE_NAME}`
  );
}

// Uninstall function
function uninstallService(): void {
  printInfo('Uninstalling VibeTunnel user systemd service...');

  try {
    // Stop and disable user service
    try {
      execSync(`systemctl --user is-active ${SERVICE_NAME}`, { stdio: 'pipe' });
      execSync(`systemctl --user stop ${SERVICE_NAME}`, { stdio: 'pipe' });
      printInfo('User service stopped');
    } catch (_error) {
      // Service not running
    }

    try {
      execSync(`systemctl --user is-enabled ${SERVICE_NAME}`, { stdio: 'pipe' });
      execSync(`systemctl --user disable ${SERVICE_NAME}`, { stdio: 'pipe' });
      printInfo('User service disabled');
    } catch (_error) {
      // Service not enabled
    }

    // Remove service file
    const { home } = getCurrentUser();
    const systemdDir = `${home}/.config/systemd/user`;
    const servicePath = join(systemdDir, SERVICE_FILE);
    if (existsSync(servicePath)) {
      unlinkSync(servicePath);
      printInfo('Service file removed');
    }

    // Reload user systemd
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });

    // Remove wrapper script
    removeVibetunnelWrapper();

    // Optionally disable lingering (ask user)
    const { username } = getCurrentUser();
    printInfo('Note: User lingering is still enabled. To disable:');
    console.log(`  loginctl disable-linger ${username}`);

    printSuccess('VibeTunnel user systemd service uninstalled');
  } catch (error) {
    printError(`Failed to uninstall service: ${error}`);
    process.exit(1);
  }
}

// Check service status
function checkServiceStatus(): void {
  try {
    const status = execSync(`systemctl --user status ${SERVICE_NAME}`, { encoding: 'utf8' });
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

// Check if running as root and prevent execution
function checkNotRoot(): void {
  if (process.getuid && process.getuid() === 0) {
    printError('This installer must NOT be run as root!');
    printError('VibeTunnel systemd service should run as a regular user for security.');
    printError('Please run this command as a regular user (without sudo).');
    process.exit(1);
  }
}

// Main installation function
export function installSystemdService(action: string = 'install'): void {
  // Prevent running as root for security
  checkNotRoot();

  switch (action) {
    case 'install': {
      printInfo('Installing VibeTunnel user systemd service...');

      const wrapperPath = checkVibetunnelAndCreateWrapper();
      installService(wrapperPath);
      configureService();
      showUsage();
      break;
    }

    case 'uninstall': {
      uninstallService();
      break;
    }

    case 'status':
      checkServiceStatus();
      break;

    default:
      console.log('Usage: vibetunnel systemd [install|uninstall|status]');
      console.log('  install   - Install VibeTunnel user systemd service (default)');
      console.log('  uninstall - Remove VibeTunnel user systemd service');
      console.log('  status    - Check service status');
      process.exit(1);
  }
}

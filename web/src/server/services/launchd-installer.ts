#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// Colors for output
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const BLUE = '\x1b[0;34m';
const YELLOW = '\x1b[0;33m';
const NC = '\x1b[0m'; // No Color

// Configuration
const SERVICE_LABEL = 'sh.shellops.server';
const PLIST_FILE = `${SERVICE_LABEL}.plist`;

// Get the current user (regular user only, no sudo/root)
function getCurrentUser(): { username: string; home: string } {
  const username = process.env.USER || 'unknown';
  const home = process.env.HOME || `/Users/${username}`;

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

function printWarning(message: string): void {
  console.log(`${YELLOW}[WARNING]${NC} ${message}`);
}

// Create a stable wrapper script that can find shellops regardless of node version manager
function createShellopsWrapper(): string {
  const { username, home } = getCurrentUser();
  const wrapperPath = `${home}/.local/bin/shellops-launchd`;
  const wrapperContent = `#!/bin/bash
# ShellOps LaunchAgent Wrapper Script
# This script finds and executes shellops for user: ${username}

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

# Try to find shellops in various ways
find_shellops() {
    # Method 1: Check if shellops is in PATH
    if command -v shellops >/dev/null 2>&1; then
        log_info "Found shellops in PATH"
        shellops "$@"
        return $?
    fi
    
    # Method 2: Check for nvm installations
    if [ -d "${home}/.nvm" ]; then
        log_info "Checking nvm installation for user ${username}"
        export NVM_DIR="${home}/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        if command -v shellops >/dev/null 2>&1; then
            log_info "Found shellops via nvm"
            shellops "$@"
            return $?
        fi
    fi
    
    # Method 3: Check for fnm installations  
    if [ -d "${home}/.local/share/fnm" ] && [ -x "${home}/.local/share/fnm/fnm" ]; then
        log_info "Checking fnm installation for user ${username}"
        export FNM_DIR="${home}/.local/share/fnm"
        export PATH="${home}/.local/share/fnm:\$PATH"
        export SHELL="/bin/bash"  # Force shell for fnm
        # Initialize fnm with explicit shell and use the default node version
        eval "\$("${home}/.local/share/fnm/fnm" env --shell bash)" 2>/dev/null || true
        # Try to use the default node version or current version
        "${home}/.local/share/fnm/fnm" use default >/dev/null 2>&1 || "${home}/.local/share/fnm/fnm" use current >/dev/null 2>&1 || true
        if command -v shellops >/dev/null 2>&1; then
            log_info "Found shellops via fnm"
            shellops "$@"
            return $?
        fi
    fi
    
    # Method 4: Check for pnpm global installations
    if [ -d "${home}/Library/pnpm" ]; then
        log_info "Checking pnpm installation for user ${username}"
        export PATH="${home}/Library/pnpm:\$PATH"
        if command -v shellops >/dev/null 2>&1; then
            log_info "Found shellops via pnpm"
            shellops "$@"
            return $?
        fi
    fi
    
    # Method 5: Check for Homebrew Node.js installation (common on macOS)
    if [ -d "/opt/homebrew/bin" ]; then
        export PATH="/opt/homebrew/bin:\$PATH"
        if command -v shellops >/dev/null 2>&1; then
            log_info "Found shellops via Homebrew"
            shellops "$@"
            return $?
        fi
    fi
    
    # Method 6: Check Intel Homebrew location
    if [ -d "/usr/local/bin" ]; then
        export PATH="/usr/local/bin:\$PATH"
        if command -v shellops >/dev/null 2>&1; then
            log_info "Found shellops via /usr/local/bin"
            shellops "$@"
            return $?
        fi
    fi
    
    # Method 7: Check common global npm locations
    for npm_bin in "/opt/homebrew/bin/npm" "/usr/local/bin/npm"; do
        if [ -x "\$npm_bin" ]; then
            log_info "Trying npm global with \$npm_bin"
            NPM_PREFIX=\$("\$npm_bin" config get prefix 2>/dev/null)
            if [ -n "\$NPM_PREFIX" ] && [ -x "\$NPM_PREFIX/bin/shellops" ]; then
                log_info "Found shellops via npm global: \$NPM_PREFIX/bin/shellops"
                "\$NPM_PREFIX/bin/shellops" "$@"
                return $?
            fi
        fi
    done
    
    # Method 8: Try to run with node directly using global npm package
    for node_bin in "/opt/homebrew/bin/node" "/usr/local/bin/node"; do
        if [ -x "\$node_bin" ]; then
            for script_path in "/opt/homebrew/lib/node_modules/shellops/dist/cli.js" "/usr/local/lib/node_modules/shellops/dist/cli.js"; do
                if [ -f "\$script_path" ]; then
                    log_info "Running shellops via node: \$node_bin \$script_path"
                    "\$node_bin" "\$script_path" "$@"
                    return $?
                fi
            done
        fi
    done
    
    log_error "Could not find shellops installation for user ${username}"
    log_error "Please ensure shellops is installed globally: npm install -g shellops"
    return 1
}

# Execute the function with all arguments
find_shellops "$@"
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

// Verify that shellops is accessible and return wrapper path
function checkShellopsAndCreateWrapper(): string {
  // First, verify that shellops is actually installed somewhere
  try {
    const shellopsPath = execSync('which shellops', { encoding: 'utf8', stdio: 'pipe' }).trim();
    printInfo(`Found ShellOps at: ${shellopsPath}`);
  } catch (_error) {
    printError('ShellOps is not installed or not accessible. Please install it first:');
    console.log('  npm install -g shellops');
    process.exit(1);
  }

  // Create and return the wrapper script path
  return createShellopsWrapper();
}

// Remove wrapper script during uninstall
function removeShellopsWrapper(): void {
  const { home } = getCurrentUser();
  const wrapperPath = `${home}/.local/bin/shellops-launchd`;
  try {
    if (existsSync(wrapperPath)) {
      unlinkSync(wrapperPath);
      printInfo('Removed wrapper script');
    }
  } catch (_error) {
    // Ignore errors when removing wrapper
  }
}

// Get the LaunchAgent plist template
function getPlistTemplate(shellopsPath: string): string {
  const { home } = getCurrentUser();
  const logDir = `${home}/Library/Logs/ShellOps`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>${shellopsPath}</string>
        <string>--port</string>
        <string>4020</string>
        <string>--bind</string>
        <string>0.0.0.0</string>
    </array>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>WorkingDirectory</key>
    <string>${home}</string>
    
    <key>StandardOutPath</key>
    <string>${logDir}/shellops.log</string>
    
    <key>StandardErrorPath</key>
    <string>${logDir}/shellops.error.log</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>SHELLOPS_LOG_LEVEL</key>
        <string>info</string>
        <key>HOME</key>
        <string>${home}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${home}/.local/bin</string>
    </dict>
    
    <key>ProcessType</key>
    <string>Interactive</string>
    
    <key>LowPriorityIO</key>
    <false/>
    
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>`;
}

// Create log directory
function createLogDirectory(): void {
  const { home } = getCurrentUser();
  const logDir = `${home}/Library/Logs/ShellOps`;

  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
      printInfo(`Created log directory: ${logDir}`);
    }
  } catch (error) {
    printWarning(`Failed to create log directory: ${error}`);
  }
}

// Install LaunchAgent plist
function installLaunchAgent(shellopsPath: string): void {
  printInfo('Installing LaunchAgent plist...');

  const { home } = getCurrentUser();
  const launchAgentsDir = `${home}/Library/LaunchAgents`;
  const plistContent = getPlistTemplate(shellopsPath);
  const plistPath = `${launchAgentsDir}/${PLIST_FILE}`;

  try {
    // Create LaunchAgents directory if it doesn't exist
    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
      printInfo(`Created directory: ${launchAgentsDir}`);
    }

    // Create log directory
    createLogDirectory();

    // Write plist file
    writeFileSync(plistPath, plistContent);
    chmodSync(plistPath, 0o644);

    printSuccess(`LaunchAgent plist installed at ${plistPath}`);
  } catch (error) {
    printError(`Failed to install LaunchAgent: ${error}`);
    process.exit(1);
  }
}

// Load the LaunchAgent
function loadLaunchAgent(): void {
  printInfo('Loading LaunchAgent...');

  const { home } = getCurrentUser();
  const plistPath = `${home}/Library/LaunchAgents/${PLIST_FILE}`;

  try {
    // First, try to unload if already loaded (ignore errors)
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
    } catch (_error) {
      // Ignore - service might not be loaded
    }

    // Load the plist
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    printSuccess('LaunchAgent loaded');

    // Get user UID for launchctl commands
    const uid = execSync('id -u', { encoding: 'utf8', stdio: 'pipe' }).trim();

    // Optionally kickstart the service to ensure it's running
    try {
      execSync(`launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`, { stdio: 'pipe' });
      printSuccess('Service started');
    } catch (_error) {
      // Service might already be running
      printInfo('Service is already running or will start shortly');
    }
  } catch (error) {
    printError(`Failed to load LaunchAgent: ${error}`);
    printInfo('You may need to load it manually:');
    console.log(`  launchctl load "${plistPath}"`);
  }
}

// Display usage instructions
function showUsage(): void {
  const { username, home } = getCurrentUser();
  const uid = execSync('id -u', { encoding: 'utf8', stdio: 'pipe' }).trim();

  printSuccess('ShellOps LaunchAgent installation completed!');
  console.log('');
  console.log('Usage:');
  console.log(`  launchctl start ${SERVICE_LABEL}        # Start the service`);
  console.log(`  launchctl stop ${SERVICE_LABEL}         # Stop the service`);
  console.log(`  launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}  # Restart the service`);
  console.log(`  shellops launchd status                 # Check service status`);
  console.log('');
  console.log('To unload (disable auto-start):');
  console.log(`  launchctl unload ~/Library/LaunchAgents/${PLIST_FILE}`);
  console.log('');
  console.log('To load (enable auto-start):');
  console.log(`  launchctl load ~/Library/LaunchAgents/${PLIST_FILE}`);
  console.log('');
  console.log('Logs:');
  console.log(`  tail -f ~/Library/Logs/ShellOps/shellops.log        # Follow output logs`);
  console.log(`  tail -f ~/Library/Logs/ShellOps/shellops.error.log  # Follow error logs`);
  console.log('');
  console.log('Configuration:');
  console.log('  Service runs on port 4020 by default');
  console.log('  Web interface: http://localhost:4020');
  console.log(`  Service runs as user: ${username}`);
  console.log(`  Working directory: ${home}`);
  console.log(`  Wrapper script: ${home}/.local/bin/shellops-launchd`);
  console.log('');
  console.log(`To customize the service, edit: ~/Library/LaunchAgents/${PLIST_FILE}`);
  console.log('Then run:');
  console.log(`  launchctl unload ~/Library/LaunchAgents/${PLIST_FILE}`);
  console.log(`  launchctl load ~/Library/LaunchAgents/${PLIST_FILE}`);
}

// Uninstall function
function uninstallLaunchAgent(): void {
  printInfo('Uninstalling ShellOps LaunchAgent...');

  const { home } = getCurrentUser();
  const plistPath = `${home}/Library/LaunchAgents/${PLIST_FILE}`;

  try {
    // Stop and unload the service
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
      printInfo('LaunchAgent unloaded');
    } catch (_error) {
      // Service might not be loaded
      printInfo('LaunchAgent was not loaded');
    }

    // Remove plist file
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
      printInfo('Plist file removed');
    }

    // Remove wrapper script
    removeShellopsWrapper();

    // Note about logs
    const logDir = `${home}/Library/Logs/ShellOps`;
    if (existsSync(logDir)) {
      printInfo(`Log directory retained at: ${logDir}`);
      printInfo('To remove logs: rm -rf ~/Library/Logs/ShellOps');
    }

    printSuccess('ShellOps LaunchAgent uninstalled');
  } catch (error) {
    printError(`Failed to uninstall LaunchAgent: ${error}`);
    process.exit(1);
  }
}

// Check service status
function checkServiceStatus(): void {
  const { home } = getCurrentUser();
  const plistPath = `${home}/Library/LaunchAgents/${PLIST_FILE}`;

  console.log('ShellOps LaunchAgent Status');
  console.log('===========================');
  console.log('');

  // Check if plist exists
  if (!existsSync(plistPath)) {
    printWarning('LaunchAgent is not installed');
    console.log(`  Plist file not found at: ${plistPath}`);
    console.log('');
    console.log('To install: shellops launchd install');
    return;
  }

  printInfo(`Plist installed at: ${plistPath}`);

  // Check if service is loaded
  try {
    const listOutput = execSync(`launchctl list | grep ${SERVICE_LABEL}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (listOutput) {
      const parts = listOutput.split(/\s+/);
      const pid = parts[0];
      const exitCode = parts[1];

      if (pid !== '-') {
        printSuccess(`Service is running (PID: ${pid})`);
      } else if (exitCode !== '0') {
        printWarning(`Service is not running (last exit code: ${exitCode})`);
      } else {
        printInfo('Service is loaded but not currently running');
      }

      console.log('');
      console.log('Raw launchctl output:');
      console.log(`  ${listOutput}`);
    }
  } catch (_error) {
    printWarning('Service is not loaded');
    console.log('');
    console.log('To load: launchctl load ~/Library/LaunchAgents/' + PLIST_FILE);
  }

  // Show log file info
  console.log('');
  console.log('Log files:');
  const logDir = `${home}/Library/Logs/ShellOps`;
  const logFile = `${logDir}/shellops.log`;
  const errorLogFile = `${logDir}/shellops.error.log`;

  if (existsSync(logFile)) {
    try {
      const stats = require('fs').statSync(logFile);
      console.log(`  Output: ${logFile} (${formatBytes(stats.size)})`);

      // Show last few lines of log
      try {
        const lastLines = execSync(`tail -n 5 "${logFile}"`, { encoding: 'utf8', stdio: 'pipe' });
        if (lastLines.trim()) {
          console.log('');
          console.log('Recent log entries:');
          console.log(
            lastLines
              .trim()
              .split('\n')
              .map((l) => `  ${l}`)
              .join('\n')
          );
        }
      } catch (_e) {
        // Ignore
      }
    } catch (_e) {
      console.log(`  Output: ${logFile}`);
    }
  } else {
    console.log(`  Output: ${logFile} (not created yet)`);
  }

  if (existsSync(errorLogFile)) {
    try {
      const stats = require('fs').statSync(errorLogFile);
      console.log(`  Errors: ${errorLogFile} (${formatBytes(stats.size)})`);
    } catch (_e) {
      console.log(`  Errors: ${errorLogFile}`);
    }
  } else {
    console.log(`  Errors: ${errorLogFile} (not created yet)`);
  }

  // Show plist contents
  console.log('');
  console.log('Plist configuration:');
  try {
    const plistContent = readFileSync(plistPath, 'utf8');
    // Extract key config values
    const portMatch = plistContent.match(/<string>--port<\/string>\s*<string>(\d+)<\/string>/);
    const bindMatch = plistContent.match(/<string>--bind<\/string>\s*<string>([^<]+)<\/string>/);

    if (portMatch) console.log(`  Port: ${portMatch[1]}`);
    if (bindMatch) console.log(`  Bind: ${bindMatch[1]}`);
    console.log(`  Web interface: http://localhost:${portMatch ? portMatch[1] : '4020'}`);
  } catch (_e) {
    console.log('  Unable to read plist');
  }
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Check if running on macOS
function checkMacOS(): void {
  if (process.platform !== 'darwin') {
    printError('This installer is for macOS only!');
    printError(`Detected platform: ${process.platform}`);
    printError('For Linux, use: shellops systemd');
    process.exit(1);
  }
}

// Check if running as root and prevent execution
function checkNotRoot(): void {
  if (process.getuid && process.getuid() === 0) {
    printError('This installer must NOT be run as root!');
    printError('ShellOps LaunchAgent should run as a regular user for security.');
    printError('Please run this command as a regular user (without sudo).');
    process.exit(1);
  }
}

// Main installation function
export function installLaunchdService(action: string = 'install'): void {
  // Check platform
  checkMacOS();

  // Prevent running as root for security
  checkNotRoot();

  switch (action) {
    case 'install': {
      printInfo('Installing ShellOps LaunchAgent...');

      const wrapperPath = checkShellopsAndCreateWrapper();
      installLaunchAgent(wrapperPath);
      loadLaunchAgent();
      showUsage();
      break;
    }

    case 'uninstall': {
      uninstallLaunchAgent();
      break;
    }

    case 'status':
      checkServiceStatus();
      break;

    default:
      console.log('Usage: shellops launchd [install|uninstall|status]');
      console.log('  install   - Install ShellOps LaunchAgent (default)');
      console.log('  uninstall - Remove ShellOps LaunchAgent');
      console.log('  status    - Check service status');
      process.exit(1);
  }
}

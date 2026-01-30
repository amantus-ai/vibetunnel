import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('claude-patcher');

// Track patched binaries for cleanup
const patchedBinaries = new Map<string, string>(); // originalPath -> backupPath

/**
 * Restore all patched binaries from their backups
 */
function restoreAllBinaries() {
  for (const [originalPath, backupPath] of patchedBinaries.entries()) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, originalPath);
        logger.debug(`Restored binary: ${originalPath}`);

        // Clean up temp backup file
        try {
          fs.unlinkSync(backupPath);
          logger.debug(`Cleaned up backup: ${backupPath}`);
        } catch (cleanupError) {
          // Non-critical error, just log it
          logger.debug(`Failed to clean up backup ${backupPath}:`, cleanupError);
        }
      }
    } catch (error) {
      logger.error(`Failed to restore binary ${originalPath}:`, error);
    }
  }
  patchedBinaries.clear();
}

// Set up cleanup handlers
let cleanupRegistered = false;
function registerCleanupHandlers() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    restoreAllBinaries();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130); // Standard exit code for SIGINT
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143); // Standard exit code for SIGTERM
  });
}

export function patchClaudeBinary(claudePath: string): string {
  // Check if already patched
  if (patchedBinaries.has(claudePath)) {
    logger.debug(`Binary already patched: ${claudePath}`);
    return claudePath;
  }

  // Create a unique temp file for backup
  const claudeFilename = path.basename(claudePath);
  const tempDir = os.tmpdir();
  const backupPath = path.join(tempDir, `vibetunnel-claude-backup-${Date.now()}-${claudeFilename}`);

  // Create backup
  fs.copyFileSync(claudePath, backupPath);
  logger.debug(`Created backup at ${backupPath}`);

  // Read the Claude binary
  const content = fs.readFileSync(claudePath, 'utf8');

  // Multiple patterns to match different variations of anti-debugging checks
  const patterns = [
    // Standard pattern: if(PF5())process.exit(1);
    /if\([A-Za-z0-9_$]+\(\)\)process\.exit\(1\);/g,
    // With spaces: if (PF5()) process.exit(1);
    /if\s*\([A-Za-z0-9_$]+\(\)\)\s*process\.exit\(1\);/g,
    // Different exit codes: if(PF5())process.exit(2);
    /if\([A-Za-z0-9_$]+\(\)\)process\.exit\(\d+\);/g,
  ];

  let patchedContent = content;
  let patched = false;

  for (const pattern of patterns) {
    const newContent = patchedContent.replace(pattern, 'if(false)process.exit(1);');
    if (newContent !== patchedContent) {
      patchedContent = newContent;
      patched = true;
      logger.debug(`Applied patch for pattern: ${pattern}`);
    }
  }

  if (!patched) {
    logger.warn('No anti-debugging pattern found - Claude binary may have changed');
    return claudePath;
  }

  // Write patched version directly over the original
  fs.writeFileSync(claudePath, patchedContent);

  // Track this patched binary for cleanup
  patchedBinaries.set(claudePath, backupPath);
  registerCleanupHandlers();

  logger.log(`Patched Claude binary`);
  return claudePath;
}

/**
 * Checks if a command is the Claude CLI binary and patches it if necessary.
 *
 * @param command - The command array from the forwarder (e.g., ["claude", "--resume"])
 * @returns The potentially patched command array
 */
export function checkAndPatchClaude(command: string[]): string[] {
  if (command.length === 0) {
    return command;
  }

  // Get the base command (first element)
  let baseCommand = command[0];
  logger.debug(`Checking command: ${baseCommand}`);

  // Step 1: Check if it's an alias and resolve it
  try {
    // Get the user's shell from SHELL env var, default to bash
    const userShell = process.env.SHELL || '/bin/bash';
    const shellName = path.basename(userShell);

    // First try to check if it's an alias using the user's shell
    const aliasCommand =
      shellName === 'zsh'
        ? `${userShell} -i -c "alias ${baseCommand} 2>/dev/null"`
        : `${userShell} -i -c "alias ${baseCommand} 2>&1"`;

    const aliasOutput = execSync(aliasCommand, {
      encoding: 'utf8',
    }).trim();

    if (aliasOutput && !aliasOutput.includes('not found')) {
      // Parse alias output (format may vary by shell)
      // zsh: alias name='command' or name=command
      // bash: alias name='command'
      const match = aliasOutput.match(/^(?:alias\s+)?[^=]+=["']?(.+?)["']?$/);
      if (match) {
        const aliasCommand = match[1].split(' ')[0];
        logger.debug(`Resolved alias: ${baseCommand} → ${aliasCommand}`);
        baseCommand = aliasCommand;
      }
    }
  } catch {
    // This is expected when alias doesn't exist
    logger.debug(`No alias found for: ${baseCommand}`);
  }

  // Step 2: Resolve the full path if it's not already absolute
  let resolvedPath = baseCommand;
  if (!path.isAbsolute(baseCommand)) {
    try {
      // Try to find the executable in PATH using which
      const whichOutput = execSync(`which "${baseCommand}" 2>/dev/null`, {
        encoding: 'utf8',
      }).trim();

      if (whichOutput) {
        resolvedPath = whichOutput;
        logger.debug(`Found in PATH: ${resolvedPath}`);
      } else {
        // Try command -v as a fallback
        try {
          const commandOutput = execSync(`command -v "${baseCommand}" 2>/dev/null`, {
            encoding: 'utf8',
            shell: '/bin/sh',
          }).trim();

          if (commandOutput && commandOutput !== baseCommand) {
            resolvedPath = commandOutput;
            logger.debug(`Found via command -v: ${resolvedPath}`);
          }
        } catch {
          // command -v also failed
        }
      }
    } catch {
      // which failed, continue with current path
      logger.debug(`Could not find ${baseCommand} in PATH`);
    }
  }

  // Step 3: Check if it's a symlink and resolve it
  try {
    if (fs.existsSync(resolvedPath) && fs.lstatSync(resolvedPath).isSymbolicLink()) {
      const realPath = fs.realpathSync(resolvedPath);
      logger.debug(`Resolved symlink: ${resolvedPath} → ${realPath}`);
      resolvedPath = realPath;
    }
  } catch (error) {
    logger.debug(`Could not resolve symlink: ${error}`);
  }

  // Step 4: Check if this is the Claude CLI binary
  // We'll check for various indicators that this is Claude
  if (!fs.existsSync(resolvedPath)) {
    logger.debug(`Resolved path does not exist: ${resolvedPath}`);
    return command;
  }

  // Check if this is the Claude CLI by examining file content
  try {
    // Read the first 1KB of the file to check the header
    const fd = fs.openSync(resolvedPath, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);

    const fileHeader = buffer.toString('utf8', 0, bytesRead);

    // Check for Claude CLI indicators:
    // 1. Shebang with node
    // 2. Anthropic copyright
    const isClaudeBinary =
      fileHeader.includes('#!/usr/bin/env') &&
      fileHeader.includes('node') &&
      fileHeader.includes('Anthropic PBC');

    if (!isClaudeBinary) {
      logger.debug(`Not a Claude CLI binary: ${path.basename(resolvedPath)}`);
      return command;
    }

    // Now read the full file to check for anti-debugging patterns
    const fullContent = fs.readFileSync(resolvedPath, 'utf8');
    const hasAntiDebugging =
      fullContent.includes('process.exit(1)') || fullContent.includes('PF5()');

    if (!hasAntiDebugging) {
      logger.debug(`Claude CLI detected but no anti-debugging patterns found`);
      return command;
    }
  } catch (error) {
    logger.debug(`Could not read file to verify Claude binary: ${error}`);
    return command;
  }

  // Step 5: It's Claude! Patch it
  logger.log(`Detected Claude CLI binary at: ${resolvedPath}`);
  const patchedPath = patchClaudeBinary(resolvedPath);

  // Return the command with the patched path
  const patchedCommand = [patchedPath, ...command.slice(1)];
  logger.log(`Using patched command: ${patchedCommand.join(' ')}`);
  return patchedCommand;
}

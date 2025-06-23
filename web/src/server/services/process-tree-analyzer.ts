import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('process-tree-analyzer');

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  sid?: number;
  tty?: string;
  command: string;
  state?: string;
  startTime?: string;
}

export interface ProcessSnapshot {
  sessionPid: number;
  processTree: ProcessInfo[];
  foregroundProcess: ProcessInfo | null;
  suspectedBellSource: ProcessInfo | null;
  capturedAt: string;
}

export class ProcessTreeAnalyzer {
  /**
   * Get the complete process tree for a given root process
   */
  async getProcessTree(rootPid: number): Promise<ProcessInfo[]> {
    try {
      if (process.platform === 'win32') {
        return await this.getWindowsProcessTree(rootPid);
      } else {
        return await this.getUnixProcessTree(rootPid);
      }
    } catch (_error) {
      logger.warn('ProcessTreeAnalyzer', `Failed to get process tree for PID ${rootPid}:`, _error);
      return [];
    }
  }

  /**
   * Get process tree on Unix-like systems (macOS, Linux)
   */
  private async getUnixProcessTree(rootPid: number): Promise<ProcessInfo[]> {
    const isMacOS = process.platform === 'darwin';

    // Always use the recursive approach since process groups aren't working reliably
    logger.log(
      'ProcessTreeAnalyzer',
      `Using recursive child search for ${rootPid} to find all descendants`
    );

    try {
      return await this.getProcessTreeRecursive(rootPid, isMacOS);
    } catch (fallbackError) {
      logger.warn('ProcessTreeAnalyzer', `Recursive process search failed:`, fallbackError);

      // Final fallback: try to get just the root process
      try {
        const psCommand = isMacOS
          ? `ps -o pid,ppid,pgid,tty,state,lstart,command -p ${rootPid}`
          : `ps -o pid,ppid,pgid,sid,tty,state,lstart,command -p ${rootPid}`;

        const { stdout } = await execAsync(psCommand, { timeout: 5000 });
        return this.parseUnixProcessOutput(stdout, isMacOS);
      } catch (finalError) {
        logger.warn('ProcessTreeAnalyzer', `Final fallback also failed:`, finalError);
        return [];
      }
    }
  }

  /**
   * Get process tree on Windows systems
   */
  private async getWindowsProcessTree(rootPid: number): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync(
        `wmic process where "ParentProcessId=${rootPid}" get ProcessId,ParentProcessId,CommandLine /format:csv`,
        { timeout: 5000 }
      );

      return this.parseWindowsProcessOutput(stdout, rootPid);
    } catch (error) {
      logger.warn('ProcessTreeAnalyzer', `Windows process query failed:`, error);
      return [];
    }
  }

  /**
   * Parse Unix/Linux ps command output
   */
  private parseUnixProcessOutput(output: string, isMacOS: boolean = false): ProcessInfo[] {
    const lines = output.trim().split('\n');
    const processes: ProcessInfo[] = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        if (isMacOS) {
          // macOS ps output: PID PPID PGID TTY STATE STARTED COMMAND
          // STARTED format: "Mon Jun 23 23:44:31 2025" (contains spaces)
          // We need to handle the multi-word timestamp properly
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            const pid = parseInt(parts[0]);
            const ppid = parseInt(parts[1]);
            const pgid = parseInt(parts[2]);
            const tty = parts[3] === '?' ? undefined : parts[3];
            const state = parts[4];
            // STARTED timestamp spans multiple parts: parts[5] through parts[9]
            const startTime = parts.slice(5, 10).join(' ');
            // COMMAND is everything from part 10 onwards
            const command = parts.slice(10).join(' ');

            if (!isNaN(pid) && !isNaN(ppid) && !isNaN(pgid) && command) {
              logger.log(
                'ProcessTreeAnalyzer',
                `Parsed macOS process: PID=${pid}, COMMAND="${command.trim()}"`
              );
              processes.push({
                pid,
                ppid,
                pgid,
                tty,
                state,
                startTime,
                command: command.trim(),
              });
            }
          }
        } else {
          // Linux ps output: PID PPID PGID SID TTY STATE STARTED COMMAND
          const match = line.match(
            /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(.+)$/
          );
          if (match) {
            const [, pid, ppid, pgid, sid, tty, state, startTime, command] = match;
            processes.push({
              pid: parseInt(pid),
              ppid: parseInt(ppid),
              pgid: parseInt(pgid),
              sid: parseInt(sid),
              tty: tty === '?' ? undefined : tty,
              state,
              startTime,
              command: command.trim(),
            });
          }
        }
      } catch (_parseError) {
        logger.debug('ProcessTreeAnalyzer', `Failed to parse ps line: ${line}`);
      }
    }

    return processes;
  }

  /**
   * Parse Windows tasklist/wmic output
   */
  private parseWindowsProcessOutput(output: string, rootPid: number): ProcessInfo[] {
    const lines = output.trim().split('\n');
    const processes: ProcessInfo[] = [];

    // Add the root process (we only get children from wmic)
    processes.push({
      pid: rootPid,
      ppid: 0,
      pgid: rootPid,
      command: 'shell', // Placeholder
    });

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length >= 3) {
        const pid = parseInt(parts[1]);
        const ppid = parseInt(parts[2]);
        const command = parts[3] || 'unknown';

        if (!isNaN(pid) && !isNaN(ppid)) {
          processes.push({
            pid,
            ppid,
            pgid: pid, // Windows doesn't have process groups like Unix
            command,
          });
        }
      }
    }

    return processes;
  }

  /**
   * Identify the most likely source of a bell event
   */
  async identifyBellSource(sessionPid: number): Promise<ProcessInfo | null> {
    const tree = await this.getProcessTree(sessionPid);
    logger.log(
      'ProcessTreeAnalyzer',
      `Process tree for session ${sessionPid}: ${JSON.stringify(tree.map((p) => ({ pid: p.pid, ppid: p.ppid, command: p.command })))}`
    );

    if (tree.length === 0) {
      logger.warn('ProcessTreeAnalyzer', `No processes found in tree for session ${sessionPid}`);
      return null;
    }

    // Strategy 1: Look for foreground process (non-shell child)
    const foreground = this.findForegroundProcess(tree, sessionPid);
    if (foreground) {
      logger.debug(
        'ProcessTreeAnalyzer',
        `Identified foreground process: ${foreground.command} (PID: ${foreground.pid})`
      );
      return foreground;
    }

    // Strategy 2: Look for most recently started child process
    const recentChild = this.findMostRecentChild(tree, sessionPid);
    if (recentChild) {
      logger.debug(
        'ProcessTreeAnalyzer',
        `Identified recent child process: ${recentChild.command} (PID: ${recentChild.pid})`
      );
      return recentChild;
    }

    // Strategy 3: Look for any non-shell process in the tree
    const nonShellProcess = tree.find(
      (p) =>
        p.pid !== sessionPid &&
        !this.isShellProcess(p.command) &&
        !this.isBackgroundProcess(p.command)
    );
    if (nonShellProcess) {
      logger.debug(
        'ProcessTreeAnalyzer',
        `Found non-shell process: ${nonShellProcess.command} (PID: ${nonShellProcess.pid})`
      );
      return nonShellProcess;
    }

    // Strategy 4: Return the shell itself
    const shellProcess = tree.find((p) => p.pid === sessionPid);
    if (shellProcess) {
      logger.debug(
        'ProcessTreeAnalyzer',
        `Defaulting to shell process: ${shellProcess.command} (PID: ${shellProcess.pid})`
      );
      return shellProcess;
    }

    return null;
  }

  /**
   * Find the foreground process (likely the active process the user is interacting with)
   */
  private findForegroundProcess(tree: ProcessInfo[], sessionPid: number): ProcessInfo | null {
    // Strategy 1: Direct children that are not shells or background processes
    let candidates = tree.filter(
      (p) =>
        p.pid !== sessionPid &&
        p.ppid === sessionPid &&
        !this.isShellProcess(p.command) &&
        !this.isBackgroundProcess(p.command)
    );

    logger.log(
      'ProcessTreeAnalyzer',
      `Direct child candidates: ${JSON.stringify(candidates.map((p) => ({ pid: p.pid, command: p.command })))}`
    );

    // Strategy 2: If no direct children, look for any descendant processes
    if (candidates.length === 0) {
      candidates = tree.filter(
        (p) =>
          p.pid !== sessionPid &&
          !this.isShellProcess(p.command) &&
          !this.isBackgroundProcess(p.command)
      );

      logger.log(
        'ProcessTreeAnalyzer',
        `Descendant candidates: ${JSON.stringify(candidates.map((p) => ({ pid: p.pid, command: p.command })))}`
      );
    }

    if (candidates.length === 0) {
      logger.log(
        'ProcessTreeAnalyzer',
        'No suitable candidate processes found, bell likely from shell itself'
      );
      return null;
    }

    // Filter out very short-lived processes (likely prompt utilities)
    const now = new Date();
    const recentCandidates = candidates.filter((p) => {
      if (!p.startTime) return true; // Keep if we can't determine age

      const processStart = new Date(p.startTime);
      const ageMs = now.getTime() - processStart.getTime();

      // If process is less than 100ms old, it's likely a prompt utility
      if (ageMs < 100) {
        logger.log(
          'ProcessTreeAnalyzer',
          `Filtering out very recent process: ${p.command} (age: ${ageMs}ms)`
        );
        return false;
      }

      return true;
    });

    if (recentCandidates.length === 0) {
      logger.log(
        'ProcessTreeAnalyzer',
        'All candidates were very recent (likely prompt utilities)'
      );
      return null;
    }

    // Prefer the most recently started process among the remaining candidates
    const sorted = recentCandidates.sort((a, b) => {
      if (a.startTime && b.startTime) {
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      }
      return 0;
    });

    logger.log(
      'ProcessTreeAnalyzer',
      `Selected foreground candidate: ${sorted[0].command} (PID: ${sorted[0].pid})`
    );

    return sorted[0];
  }

  /**
   * Find the most recently started child process
   */
  private findMostRecentChild(tree: ProcessInfo[], sessionPid: number): ProcessInfo | null {
    // Look for any non-shell children first
    let children = tree.filter(
      (p) => p.ppid === sessionPid && p.pid !== sessionPid && !this.isShellProcess(p.command)
    );

    // If no non-shell children, include all children
    if (children.length === 0) {
      children = tree.filter((p) => p.ppid === sessionPid && p.pid !== sessionPid);
    }

    logger.log(
      'ProcessTreeAnalyzer',
      `Recent child candidates: ${JSON.stringify(children.map((p) => ({ pid: p.pid, command: p.command })))}`
    );

    if (children.length === 0) {
      return null;
    }

    // Sort by start time if available, otherwise return the last one found
    const sorted = children.sort((a, b) => {
      if (a.startTime && b.startTime) {
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      }
      return 0;
    });

    return sorted[0];
  }

  /**
   * Check if a process is likely a shell process
   */
  private isShellProcess(command: string): boolean {
    const shellIndicators = ['bash', 'zsh', 'sh', 'fish', 'csh', 'tcsh', 'ksh'];
    const processName = this.extractProcessName(command);
    return shellIndicators.includes(processName.toLowerCase());
  }

  /**
   * Check if a process is likely a background process or shell utility
   */
  private isBackgroundProcess(command: string): boolean {
    const backgroundIndicators = [
      'ssh-agent',
      'gpg-agent',
      'dbus-daemon',
      'systemd',
      'kworker',
      'ksoftirqd',
      'migration',
      'watchdog',
    ];

    // Shell prompt utilities that shouldn't be considered bell sources
    const promptUtilities = [
      'git status',
      'git branch',
      'hg branch',
      'hg status',
      'svn status',
      'pwd',
      'whoami',
      'hostname',
      'date',
      'ps ',
      'ls -la',
      'df -h',
    ];

    const lowerCommand = command.toLowerCase();

    // Check for general background processes
    if (backgroundIndicators.some((indicator) => lowerCommand.includes(indicator))) {
      return true;
    }

    // Check for shell prompt utilities
    if (promptUtilities.some((utility) => lowerCommand.includes(utility))) {
      logger.log('ProcessTreeAnalyzer', `Identified prompt utility: ${command}`);
      return true;
    }

    return false;
  }

  /**
   * Extract process name from command (non-static version)
   */
  private extractProcessName(command: string): string {
    return ProcessTreeAnalyzer.extractProcessName(command);
  }

  /**
   * Get process tree recursively by finding children
   */
  private async getProcessTreeRecursive(rootPid: number, isMacOS: boolean): Promise<ProcessInfo[]> {
    const allProcesses: ProcessInfo[] = [];
    const processedPids = new Set<number>();

    // Get all processes on the system
    const psCommand = isMacOS
      ? 'ps -eo pid,ppid,pgid,tty,state,lstart,command'
      : 'ps -eo pid,ppid,pgid,sid,tty,state,lstart,command';

    logger.log('ProcessTreeAnalyzer', `Getting all system processes with: ${psCommand}`);
    const { stdout } = await execAsync(psCommand, { timeout: 10000 });
    const allSystemProcesses = this.parseUnixProcessOutput(stdout, isMacOS);

    logger.log('ProcessTreeAnalyzer', `Found ${allSystemProcesses.length} total system processes`);

    // Build a map of parent -> children
    const childrenMap = new Map<number, ProcessInfo[]>();
    for (const proc of allSystemProcesses) {
      if (!childrenMap.has(proc.ppid)) {
        childrenMap.set(proc.ppid, []);
      }
      const children = childrenMap.get(proc.ppid);
      if (children) {
        children.push(proc);
      }
    }

    // Check what children exist for our root PID
    const directChildren = childrenMap.get(rootPid) || [];
    logger.log(
      'ProcessTreeAnalyzer',
      `Direct children of ${rootPid}: ${JSON.stringify(directChildren.map((p) => ({ pid: p.pid, command: p.command })))}`
    );

    // Recursively collect the process tree starting from rootPid
    const collectProcessTree = (pid: number) => {
      if (processedPids.has(pid)) return;
      processedPids.add(pid);

      // Find the process itself
      const process = allSystemProcesses.find((p) => p.pid === pid);
      if (process) {
        allProcesses.push(process);
      }

      // Find and collect children
      const children = childrenMap.get(pid) || [];
      for (const child of children) {
        collectProcessTree(child.pid);
      }
    };

    collectProcessTree(rootPid);

    logger.log(
      'ProcessTreeAnalyzer',
      `Final process tree: ${JSON.stringify(allProcesses.map((p) => ({ pid: p.pid, ppid: p.ppid, command: p.command })))}`
    );

    return allProcesses;
  }

  /**
   * Create a complete process snapshot for bell event analysis
   */
  async captureProcessSnapshot(sessionPid: number): Promise<ProcessSnapshot> {
    const processTree = await this.getProcessTree(sessionPid);
    const foregroundProcess = this.findForegroundProcess(processTree, sessionPid);
    const suspectedBellSource = await this.identifyBellSource(sessionPid);

    return {
      sessionPid,
      processTree,
      foregroundProcess,
      suspectedBellSource,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract a human-readable process name from a command string
   */
  static extractProcessName(command: string): string {
    // Remove common shell prefixes and arguments
    const cleaned = command
      .replace(/^.*\//, '') // Remove path
      .replace(/\s+.*$/, '') // Remove arguments
      .replace(/^sudo\s+/, '') // Remove sudo
      .replace(/^exec\s+/, ''); // Remove exec

    return cleaned || 'unknown';
  }

  /**
   * Get a short description of the process for notifications
   */
  static getProcessDescription(processInfo: ProcessInfo | null): string {
    if (!processInfo) {
      return 'unknown process';
    }

    const name = ProcessTreeAnalyzer.extractProcessName(processInfo.command);

    // Return a user-friendly description
    if (name === 'bash' || name === 'zsh' || name === 'sh' || name === 'fish') {
      return 'shell';
    }

    return name;
  }
}

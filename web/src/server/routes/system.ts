import { Router } from 'express';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

interface SystemStats {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  uptime: number;
  loadAverage: number[];
}

// Cache for previous network stats to calculate deltas
let previousNetworkStats: { bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number } | null = null;

/**
 * Get CPU information and usage
 */
async function getCpuStats(): Promise<{ usage: number; cores: number; model: string }> {
  try {
    // Get CPU info from /proc/cpuinfo
    const cpuInfo = await fs.readFile('/proc/cpuinfo', 'utf8');
    const cpuLines = cpuInfo.split('\n');
    
    // Count physical cores
    const coreCount = cpuLines.filter((line: string) => line.startsWith('processor')).length;
    
    // Get CPU model name
    const modelLine = cpuLines.find((line: string) => line.startsWith('model name'));
    const model = modelLine ? modelLine.split(':')[1].trim() : 'Unknown CPU';

    // Get CPU usage from /proc/stat
    const stat1 = await fs.readFile('/proc/stat', 'utf8');
    const cpuLine1 = stat1.split('\n')[0];
    const cpuTimes1 = cpuLine1.split(/\s+/).slice(1).map(Number);
    
    // Wait a short moment to get another reading
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const stat2 = await fs.readFile('/proc/stat', 'utf8');
    const cpuLine2 = stat2.split('\n')[0];
    const cpuTimes2 = cpuLine2.split(/\s+/).slice(1).map(Number);
    
    // Calculate CPU usage
    const idle1 = cpuTimes1[3] + cpuTimes1[4]; // idle + iowait
    const idle2 = cpuTimes2[3] + cpuTimes2[4];
    const total1 = cpuTimes1.reduce((sum, time) => sum + time, 0);
    const total2 = cpuTimes2.reduce((sum, time) => sum + time, 0);
    
    const totalDiff = total2 - total1;
    const idleDiff = idle2 - idle1;
    const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;

    return {
      usage: Math.max(0, Math.min(100, usage)),
      cores: coreCount,
      model
    };
  } catch (error) {
    console.error('Error getting CPU stats:', error);
    return { usage: 0, cores: 1, model: 'Unknown' };
  }
}

/**
 * Get memory information
 */
async function getMemoryStats(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const memInfo = await fs.readFile('/proc/meminfo', 'utf8');
    const lines = memInfo.split('\n');
    
    const getMemValue = (key: string): number => {
      const line = lines.find(l => l.startsWith(key));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) * 1024 : 0; // Convert from KB to bytes
    };
    
    const total = getMemValue('MemTotal');
    const free = getMemValue('MemFree');
    const buffers = getMemValue('Buffers');
    const cached = getMemValue('Cached');
    const sReclaimable = getMemValue('SReclaimable');
    
    // Available memory includes free + buffers + cached + sReclaimable
    const available = free + buffers + cached + sReclaimable;
    const used = total - available;
    const usage = total > 0 ? (used / total) * 100 : 0;
    
    return {
      total,
      used,
      free: available,
      usage: Math.max(0, Math.min(100, usage))
    };
  } catch (error) {
    console.error('Error getting memory stats:', error);
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

/**
 * Get disk usage information for root filesystem
 */
async function getDiskStats(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const { stdout } = await execAsync('df -B1 / | tail -1');
    const parts = stdout.trim().split(/\s+/);
    
    if (parts.length >= 4) {
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const free = parseInt(parts[3]);
      const usage = total > 0 ? (used / total) * 100 : 0;
      
      return {
        total,
        used,
        free,
        usage: Math.max(0, Math.min(100, usage))
      };
    }
    
    throw new Error('Unable to parse df output');
  } catch (error) {
    console.error('Error getting disk stats:', error);
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

/**
 * Get network statistics
 */
async function getNetworkStats(): Promise<{ bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }> {
  try {
    const netDev = await fs.readFile('/proc/net/dev', 'utf8');
    const lines = netDev.split('\n').slice(2); // Skip header lines
    
    let totalBytesIn = 0;
    let totalBytesOut = 0;
    let totalPacketsIn = 0;
    let totalPacketsOut = 0;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.trim().split(/\s+/);
      if (parts.length < 17) continue;
      
      const interface_ = parts[0].replace(':', '');
      
      // Skip loopback interface
      if (interface_ === 'lo') continue;
      
      // Receive stats (bytes, packets, etc.)
      const rxBytes = parseInt(parts[1]) || 0;
      const rxPackets = parseInt(parts[2]) || 0;
      
      // Transmit stats start at index 9
      const txBytes = parseInt(parts[9]) || 0;
      const txPackets = parseInt(parts[10]) || 0;
      
      totalBytesIn += rxBytes;
      totalBytesOut += txBytes;
      totalPacketsIn += rxPackets;
      totalPacketsOut += txPackets;
    }
    
    // Calculate deltas if we have previous stats
    let bytesIn = totalBytesIn;
    let bytesOut = totalBytesOut;
    let packetsIn = totalPacketsIn;
    let packetsOut = totalPacketsOut;
    
    if (previousNetworkStats) {
      bytesIn = Math.max(0, totalBytesIn - previousNetworkStats.bytesIn);
      bytesOut = Math.max(0, totalBytesOut - previousNetworkStats.bytesOut);
      packetsIn = Math.max(0, totalPacketsIn - previousNetworkStats.packetsIn);
      packetsOut = Math.max(0, totalPacketsOut - previousNetworkStats.packetsOut);
    }
    
    // Update previous stats for next time
    previousNetworkStats = {
      bytesIn: totalBytesIn,
      bytesOut: totalBytesOut,
      packetsIn: totalPacketsIn,
      packetsOut: totalPacketsOut
    };
    
    return {
      bytesIn,
      bytesOut,
      packetsIn,
      packetsOut
    };
  } catch (error) {
    console.error('Error getting network stats:', error);
    return { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0 };
  }
}

/**
 * Get system uptime
 */
async function getUptime(): Promise<number> {
  try {
    const uptime = await fs.readFile('/proc/uptime', 'utf8');
    const seconds = parseFloat(uptime.split(' ')[0]);
    return seconds;
  } catch (error) {
    console.error('Error getting uptime:', error);
    return 0;
  }
}

/**
 * Get system load average
 */
async function getLoadAverage(): Promise<number[]> {
  try {
    const loadavg = await fs.readFile('/proc/loadavg', 'utf8');
    const loads = loadavg.trim().split(' ').slice(0, 3).map(parseFloat);
    return loads.length === 3 ? loads : [0, 0, 0];
  } catch (error) {
    console.error('Error getting load average:', error);
    return [0, 0, 0];
  }
}

/**
 * GET /api/system/stats
 * Get comprehensive system statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [cpu, memory, disk, network, uptime, loadAverage] = await Promise.all([
      getCpuStats(),
      getMemoryStats(),
      getDiskStats(),
      getNetworkStats(),
      getUptime(),
      getLoadAverage()
    ]);

    const stats: SystemStats = {
      cpu,
      memory,
      disk,
      network,
      uptime,
      loadAverage
    };

    res.json(stats);
  } catch (error) {
    console.error('Error getting system stats:', error);
    res.status(500).json({ error: 'Failed to get system stats' });
  }
});

export default router;
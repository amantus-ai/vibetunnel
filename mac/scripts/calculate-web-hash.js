#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Try to load xxhash if available
let xxhash;
try {
  xxhash = require('xxhash');
} catch (e) {
  console.log('Note: xxhash module not found, using SHA-256 (slower)');
  console.log('Install for 5-10x speedup: npm install xxhash');
}

// File patterns to include
const INCLUDE_PATTERNS = [
  /\.(ts|tsx|js|jsx|json|css|html|vue|svelte|yaml|yml|toml|d\.ts)$/
];

// Directories and files to exclude
const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'public', '.next', 'coverage',
  '.cache', '.node-builds', 'build', 'native', 'node-build-artifacts'
]);

const EXCLUDE_FILES = new Set(['package-lock.json']);

// Worker code for parallel hashing
if (!isMainThread) {
  const { files } = workerData;
  
  async function hashFile(filePath) {
    try {
      const content = await fs.readFile(filePath);
      const fileData = `FILE:${filePath}\n${content}\n`;
      
      if (xxhash) {
        // Use xxHash64 for speed
        return xxhash.hash64(Buffer.from(fileData), 0xCAFEBABE).toString('hex');
      } else {
        // Fall back to SHA-256
        return crypto.createHash('sha256').update(fileData).digest('hex');
      }
    } catch (error) {
      console.error(`Error hashing ${filePath}:`, error.message);
      return null;
    }
  }
  
  Promise.all(files.map(hashFile))
    .then(hashes => parentPort.postMessage(hashes.filter(h => h !== null)));
  
  return;
}

// Main thread code
async function* walkDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        yield* walkDir(fullPath);
      }
    } else if (entry.isFile()) {
      const relativePath = path.relative(process.cwd(), fullPath);
      if (INCLUDE_PATTERNS.some(p => p.test(entry.name)) && 
          !EXCLUDE_FILES.has(entry.name)) {
        yield relativePath;
      }
    }
  }
}

async function collectFiles(webDir) {
  const files = [];
  for await (const file of walkDir(webDir)) {
    files.push(file);
  }
  return files.sort();
}

async function calculateHashParallel(files) {
  const numWorkers = Math.min(os.cpus().length, Math.ceil(files.length / 10));
  const chunkSize = Math.ceil(files.length / numWorkers);
  const chunks = [];
  
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }
  
  console.log(`Processing ${files.length} files with ${numWorkers} workers...`);
  
  const workers = chunks.map(chunk => 
    new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { files: chunk }
      });
      
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    })
  );
  
  const results = await Promise.all(workers);
  const allHashes = results.flat();
  
  // Combine all hashes into final hash
  const combinedData = allHashes.join('\n');
  
  if (xxhash) {
    return xxhash.hash64(Buffer.from(combinedData), 0xCAFEBABE).toString('hex');
  } else {
    return crypto.createHash('sha256').update(combinedData).digest('hex');
  }
}

async function main() {
  const scriptDir = path.dirname(__filename);
  const projectDir = process.env.SRCROOT || path.dirname(scriptDir);
  const webDir = path.join(projectDir, '..', 'web');
  const hashFile = path.join(
    process.env.BUILT_PRODUCTS_DIR || projectDir,
    '.web-content-hash'
  );
  
  if (!await fs.stat(webDir).catch(() => false)) {
    console.error(`error: Web directory not found at ${webDir}`);
    process.exit(1);
  }
  
  console.log('Calculating web content hash (parallel + xxHash)...');
  process.chdir(webDir);
  
  try {
    const files = await collectFiles('.');
    const hash = await calculateHashParallel(files);
    
    console.log(`Web content hash: ${hash}`);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(hashFile), { recursive: true });
    
    // Write hash to file
    await fs.writeFile(hashFile, hash + '\n');
    
  } catch (error) {
    console.error('Error calculating hash:', error);
    process.exit(1);
  }
}

if (isMainThread) {
  main();
}
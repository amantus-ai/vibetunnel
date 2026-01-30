console.log('Testing VibeTunnel beta 15 package...\n');

// Check what's installed
console.log('Package contents:');
console.log('=================');

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const vibetunnelPath = './node_modules/vibetunnel';

try {
  // List files in the package
  const files = await readdir(vibetunnelPath);
  console.log('Files:', files);
  
  // Check package.json
  const packageJson = JSON.parse(await readFile(join(vibetunnelPath, 'package.json'), 'utf-8'));
  console.log('\nPackage version:', packageJson.version);
  console.log('Package bin:', packageJson.bin);
  
  // Check if binary exists
  if (packageJson.bin && packageJson.bin.vibetunnel) {
    const binPath = join(vibetunnelPath, packageJson.bin.vibetunnel);
    console.log('\nBinary path:', binPath);
    
    try {
      await readFile(binPath);
      console.log('✅ Binary file exists');
    } catch (e) {
      console.log('❌ Binary file missing');
    }
  }
  
  // Try to run the server directly
  console.log('\nTrying to run VibeTunnel server...');
  try {
    const { default: server } = await import('vibetunnel/dist/server/server.js');
    console.log('✅ Server module loaded successfully');
  } catch (e) {
    console.log('❌ Failed to load server module:', e.message);
  }
  
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
import { Plugin } from 'vite';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function nativeBuildPlugin(): Plugin {
  return {
    name: 'vite-plugin-native-build',
    apply: 'build', // Only run during build, not dev
    writeBundle() {
      // Skip native build in development mode or CI
      if (process.env.NODE_ENV === 'development' || process.env.CI === 'true') {
        console.log('⏭️  Skipping native build in development/CI mode');
        return;
      }
      
      console.log('Building native executable...');
      
      // Check if native binaries already exist
      const nativeDir = path.join(__dirname, 'native');
      const vibetunnelPath = path.join(nativeDir, 'vibetunnel');
      const ptyNodePath = path.join(nativeDir, 'pty.node');
      const spawnHelperPath = path.join(nativeDir, 'spawn-helper');

      if (fs.existsSync(vibetunnelPath) && fs.existsSync(ptyNodePath) && fs.existsSync(spawnHelperPath)) {
        console.log('✅ Native binaries already exist, skipping build...');
        console.log('  - vibetunnel executable: ✓');
        console.log('  - pty.node: ✓');
        console.log('  - spawn-helper: ✓');
        return;
      }

      try {
        // Build TypeScript server code first
        console.log('Building server TypeScript...');
        execSync('tsc', { stdio: 'inherit', cwd: __dirname });

        // Check for --custom-node flag
        const useCustomNode = process.argv.includes('--custom-node');

        if (useCustomNode) {
          console.log('Using custom Node.js for smaller binary size...');
          execSync('node build-native.js --custom-node', { stdio: 'inherit', cwd: __dirname });
        } else {
          console.log('Using system Node.js...');
          execSync('node build-native.js', { stdio: 'inherit', cwd: __dirname });
        }
        
        console.log('Native executable built successfully!');
      } catch (error) {
        console.error('Failed to build native executable:', error);
        throw error;
      }
    }
  };
}
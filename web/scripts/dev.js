const { spawn } = require('child_process');
const path = require('path');
const esbuild = require('esbuild');
const { devOptions } = require('./esbuild-config.js');

console.log('Starting development mode...');

// Validate version sync first
require('child_process').execSync('node scripts/validate-version-sync.js', { stdio: 'inherit' });

// Parse command line arguments using Node's built-in parseArgs
const { parseArgs } = require('util');

const { values, positionals } = parseArgs({
  options: {
    'client-only': {
      type: 'boolean',
      default: false,
    },
    port: {
      type: 'string',
    },
    bind: {
      type: 'string',
    },
  },
  allowPositionals: true,
});

const watchServer = !values['client-only'];

// Build server args from parsed values
const serverArgs = [];
if (values.port) {
  serverArgs.push('--port', values.port);
}
if (values.bind) {
  serverArgs.push('--bind', values.bind);
}

// Initial build of assets and CSS
console.log('Initial build...');
require('child_process').execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });
require('child_process').execSync('node scripts/copy-assets.js', { stdio: 'inherit' });
require('child_process').execSync('pnpm exec tailwindcss -i ./src/client/styles.css -o ./public/bundle/styles.css', { stdio: 'inherit' });

// Build the command parts
const commands = [
  // Watch CSS
  ['pnpm', ['exec', 'tailwindcss', '-i', './src/client/styles.css', '-o', './public/bundle/styles.css', '--watch']],
  // Watch assets
  ['pnpm', ['exec', 'chokidar', 'src/client/assets/**/*', '-c', 'node scripts/copy-assets.js']],
];

// Add server watching if not client-only
if (watchServer) {
  const serverCommand = ['pnpm', ['exec', 'tsx', 'watch', 'src/cli.ts', '--no-auth', ...serverArgs]];
  commands.push(serverCommand);
}

// Set up esbuild contexts for watching
async function startBuilding() {
  try {
    // Create esbuild contexts
    const clientContext = await esbuild.context({
      ...devOptions,
      entryPoints: ['src/client/app-entry.ts'],
      outfile: 'public/bundle/client-bundle.js',
    });

    const testContext = await esbuild.context({
      ...devOptions,
      entryPoints: ['src/client/test-entry.ts'],
      outfile: 'public/bundle/test.js',
    });


    const swContext = await esbuild.context({
      ...devOptions,
      entryPoints: ['src/client/sw.ts'],
      outfile: 'public/sw.js',
      format: 'iife', // Service workers need IIFE format
    });

    // Start watching
    await clientContext.watch();
    await testContext.watch();
    await swContext.watch();
    console.log('ESBuild watching client bundles...');

    // Start other processes
    const processes = commands.map(([cmd, args], index) => {
      // Create env without VIBETUNNEL_SEA for development mode
      const env = { ...process.env };
      delete env.VIBETUNNEL_SEA;
      
      const proc = spawn(cmd, args, { 
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: env
      });
      
      proc.on('error', (err) => {
        console.error(`Process ${index} error:`, err);
      });
      
      return proc;
    });

    // Handle exit
    process.on('SIGINT', async () => {
      console.log('\nStopping all processes...');
      await clientContext.dispose();
      await testContext.dispose();
      await swContext.dispose();
      processes.forEach(proc => proc.kill());
      process.exit(0);
    });

    console.log(`Development mode started (${watchServer ? 'full' : 'client only'})`);
  } catch (error) {
    console.error('Failed to start build:', error);
    process.exit(1);
  }
}

startBuilding();
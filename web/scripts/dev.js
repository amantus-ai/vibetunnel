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
  strict: false, // Allow unknown options to be passed through
});

const watchServer = !values['client-only'];

// Build server args from parsed values and pass through all unknown args
const serverArgs = [];
if (values.port) {
  serverArgs.push('--port', values.port);
}
if (values.bind) {
  serverArgs.push('--bind', values.bind);
}

// Pass through all command line args except the ones we handle
const allArgs = process.argv.slice(2);
const handledArgs = new Set(['--client-only']);
if (values.port) {
  handledArgs.add('--port');
  handledArgs.add(values.port);
}
if (values.bind) {
  handledArgs.add('--bind');
  handledArgs.add(values.bind);
}

// Add any args that weren't handled by parseArgs
for (let i = 0; i < allArgs.length; i++) {
  const arg = allArgs[i];
  // Skip the '--' separator that pnpm adds
  if (arg === '--') {
    continue;
  }
  if (!handledArgs.has(arg) && !serverArgs.includes(arg)) {
    serverArgs.push(arg);
    // If this arg has a value (next arg doesn't start with --), include it too
    if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith('--')) {
      serverArgs.push(allArgs[i + 1]);
      i++; // Skip the value in next iteration
    }
  }
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
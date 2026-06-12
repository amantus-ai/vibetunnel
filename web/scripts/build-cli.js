const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { nodePtyPlugin } = require('./node-pty-plugin.js');

async function buildCli() {
  console.log('Bundling CLI...');

  await esbuild.build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'dist/vibetunnel-cli',
    plugins: [nodePtyPlugin],
    external: [
      'authenticate-pam',
      'compression',
      'helmet',
      'express',
      'ghostty-web',
      'ws',
      'jsonwebtoken',
      'web-push',
      'bonjour-service',
      'signal-exit',
      'http-proxy-middleware',
      'multer',
      'mime-types',
    ],
    minify: true,
    sourcemap: false,
    loader: {
      '.ts': 'ts',
      '.js': 'js',
    },
  });

  const cliPath = path.join('dist', 'vibetunnel-cli');
  let content = fs.readFileSync(cliPath, 'utf8');
  content = content.replace(/^#!.*\n/gm, '');
  content = `#!/usr/bin/env node\n${content}`;
  fs.writeFileSync(cliPath, content);
  fs.chmodSync(cliPath, 0o755);
  console.log('CLI bundle created successfully');
}

async function main() {
  await buildCli();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('CLI bundling failed:', error);
    process.exit(1);
  });
}

module.exports = { buildCli };

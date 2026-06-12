const fs = require('fs');
const path = require('path');
const { buildCli } = require('./build-cli.js');

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function ensureTestCli() {
  const webRoot = path.join(__dirname, '..');
  const nativeCliPath = path.join(webRoot, 'native', 'vibetunnel');
  if (fs.existsSync(nativeCliPath)) {
    return;
  }

  const bundledCliPath = path.join(webRoot, 'dist', 'vibetunnel-cli');
  if (!fs.existsSync(bundledCliPath)) {
    await buildCli();
  }

  const testCliPath = path.join(webRoot, 'native', 'vibetunnel-test');
  const launcher = `#!/bin/sh
exec ${shellQuote(process.execPath)} ${shellQuote(bundledCliPath)} "$@"
`;

  fs.mkdirSync(path.dirname(testCliPath), { recursive: true });
  fs.writeFileSync(testCliPath, launcher, 'utf8');
  fs.chmodSync(testCliPath, 0o755);
  console.log(`Created test CLI launcher: ${testCliPath}`);
}

ensureTestCli().catch((error) => {
  console.error('Failed to prepare the test CLI:', error);
  process.exit(1);
});

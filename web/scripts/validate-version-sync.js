/**
 * Validates that the version in package.json matches the MARKETING_VERSION in the macOS xcconfig file
 */
const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');

if (process.env.VT_SKIP_VERSION_SYNC === '1') {
  console.log('⚠️  Skipping version sync validation (VT_SKIP_VERSION_SYNC=1).');
  process.exit(0);
}

// Path to the xcconfig file
const xcconfigPath = path.join(__dirname, '../../mac/VibeTunnel/version.xcconfig');

// Check if xcconfig file exists
if (!fs.existsSync(xcconfigPath)) {
  console.error(`❌ xcconfig file not found at: ${xcconfigPath}`);
  process.exit(1);
}

// Read and parse xcconfig file
const xcconfigContent = fs.readFileSync(xcconfigPath, 'utf8');
const marketingVersionMatch = xcconfigContent.match(/MARKETING_VERSION\s*=\s*(.+)/);

if (!marketingVersionMatch) {
  console.error('❌ MARKETING_VERSION not found in xcconfig file');
  process.exit(1);
}

const xconfigVersion = marketingVersionMatch[1].trim();

// Compare versions
if (version !== xconfigVersion) {
  console.error(`❌ Version mismatch detected!`);
  console.error(`   package.json: ${version}`);
  console.error(`   xcconfig:     ${xconfigVersion}`);
  console.error('');
  console.error('To fix this:');
  console.error('1. Update package.json version field to match xcconfig');
  console.error('2. Or update MARKETING_VERSION in mac/VibeTunnel/version.xcconfig');
  process.exit(1);
}

console.log(`✅ Version sync validated: ${version}`);

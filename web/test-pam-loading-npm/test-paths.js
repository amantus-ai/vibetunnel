const path = require('path');
const fs = require('fs');

// Simulate being in the lib directory
const __dirname = path.join(process.cwd(), 'simulated-npm-global/lib/node_modules/vibetunnel/lib');

console.log('Simulated __dirname:', __dirname);
console.log();

const paths = [
    // Bundled context: dist-npm/lib/../optional-modules
    path.join(__dirname, '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    // Development context: src/server/services/../../../optional-modules
    path.join(__dirname, '..', '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    // Alternative bundled location
    path.join(__dirname, '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
];

console.log('Testing path resolution:');
paths.forEach((p, i) => {
    const exists = fs.existsSync(p);
    const relativePath = '../'.repeat(i + 1) + 'optional-modules/...';
    console.log(`${exists ? '✅' : '❌'} ${relativePath} -> ${exists ? 'FOUND' : 'Not found'}`);
    if (exists) {
        console.log(`   Resolved to: ${p}`);
    }
});

// Check which path would be used (first one that exists)
const workingPath = paths.find(p => fs.existsSync(p));
if (workingPath) {
    console.log('\n✅ PAM module would be loaded from:', workingPath);
} else {
    console.log('\n❌ PAM module would NOT be found!');
}

const fs = require('fs');
const path = require('path');

// Ensure public directory exists
fs.mkdirSync('public', { recursive: true });

// Copy assets
const srcDir = 'src/client/assets';
const destDir = 'public';

/**
 * IMPORTANT: Node.js v24.3.0 Crash Workaround
 * 
 * We use fs.copyFileSync instead of fs.cpSync due to a critical bug in Node.js v24.3.0
 * that causes SIGABRT crashes when fs.cpSync checks path equivalence.
 * 
 * The crash occurs in node::fs::CpSyncCheckPaths when std::__fs::filesystem::__equivalent
 * throws an exception that Node doesn't handle properly, resulting in:
 * - Signal: SIGABRT (Abort trap: 6)
 * - Random session exits when the asset watcher triggers
 * - Complete process termination affecting all VibeTunnel sessions
 * 
 * This implementation manually handles directory recursion to avoid the buggy fs.cpSync.
 * 
 * Related crash signature:
 * - node::fs::CpSyncCheckPaths(v8::FunctionCallbackInfo<v8::Value> const&)
 * - std::__fs::filesystem::__throw_filesystem_error
 * 
 * TODO: Revert to fs.cpSync when Node.js fixes this issue in a future version
 */

if (fs.existsSync(srcDir)) {
  fs.readdirSync(srcDir).forEach(file => {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    
    // Use copyFileSync instead of cpSync to avoid Node v24 bug
    const stats = fs.statSync(srcPath);
    if (stats.isDirectory()) {
      // For directories, create and copy contents recursively
      fs.mkdirSync(destPath, { recursive: true });
      const copyDir = (src, dest) => {
        fs.readdirSync(src).forEach(item => {
          const srcItem = path.join(src, item);
          const destItem = path.join(dest, item);
          if (fs.statSync(srcItem).isDirectory()) {
            fs.mkdirSync(destItem, { recursive: true });
            copyDir(srcItem, destItem);
          } else {
            fs.copyFileSync(srcItem, destItem);
          }
        });
      };
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
  console.log('Assets copied successfully');
} else {
  console.log('No assets directory found, skipping copy');
}
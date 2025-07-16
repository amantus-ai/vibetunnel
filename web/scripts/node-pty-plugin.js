/**
 * ESBuild plugin to handle node-pty resolution for npm packages
 */

const path = require('path');
const fs = require('fs');

const nodePtyPlugin = {
  name: 'node-pty-resolver',
  setup(build) {
    // Resolve node-pty imports to our bundled version
    build.onResolve({ filter: /^node-pty$/ }, args => {
      // In development, use the normal node_modules resolution
      if (process.env.NODE_ENV === 'development') {
        return null;
      }
      
      // For npm builds, resolve to our bundled node-pty
      return {
        path: 'node-pty',
        namespace: 'node-pty-stub'
      };
    });

    // Provide stub that dynamically loads the bundled node-pty
    build.onLoad({ filter: /^node-pty$/, namespace: 'node-pty-stub' }, () => {
      return {
        contents: `
          const path = require('path');
          const fs = require('fs');
          
          // Try multiple possible locations for node-pty
          const possiblePaths = [
            // When installed via npm
            path.join(__dirname, '../node-pty'),
            path.join(__dirname, '../../node-pty'),
            // During development
            path.join(__dirname, '../node_modules/node-pty'),
            // Fallback to regular require
            'node-pty'
          ];
          
          let nodePty;
          let loadError;
          
          for (const tryPath of possiblePaths) {
            try {
              if (tryPath === 'node-pty') {
                // Try regular require as last resort
                nodePty = require(tryPath);
              } else if (fs.existsSync(tryPath)) {
                // Check if the path exists before trying to load
                nodePty = require(tryPath);
              }
              if (nodePty) break;
            } catch (err) {
              loadError = err;
            }
          }
          
          if (!nodePty) {
            throw new Error(\`Failed to load node-pty from any location. Last error: \${loadError?.message}\`);
          }
          
          module.exports = nodePty;
        `,
        loader: 'js'
      };
    });
  }
};

module.exports = { nodePtyPlugin };
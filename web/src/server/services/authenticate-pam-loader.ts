import * as fs from 'fs';
import * as path from 'path';

type AuthenticateFunction = (
  username: string,
  password: string,
  callback: (err: Error | null, authenticated?: boolean) => void
) => void;

// Helper function to load native module using dlopen
function loadNativeModule(modulePath: string): { authenticate?: AuthenticateFunction } {
  const module = { exports: {} };
  process.dlopen(module, modulePath);
  return module.exports;
}

// Try to load authenticate_pam.node
let authenticate: AuthenticateFunction;

// Check if we're in SEA mode by looking for the native module next to the executable
const execDir = path.dirname(process.execPath);
const seaPamPath = path.join(execDir, 'authenticate_pam.node');
const seaNativePamPath = path.join(execDir, 'native', 'authenticate_pam.node');

if (fs.existsSync(seaPamPath) || fs.existsSync(seaNativePamPath)) {
  // We're in SEA mode, use dlopen
  const possiblePaths = [
    seaPamPath,
    seaNativePamPath,
    path.join(__dirname, '..', '..', '..', 'native', 'authenticate_pam.node'),
  ];

  let loaded = false;
  for (const modulePath of possiblePaths) {
    if (fs.existsSync(modulePath)) {
      try {
        const nativeModule = loadNativeModule(modulePath);
        if (nativeModule.authenticate) {
          authenticate = nativeModule.authenticate;
        } else {
          throw new Error('Module does not export authenticate function');
        }
        loaded = true;
        break;
      } catch (_loadError) {
        // Continue to next path
      }
    }
  }

  if (!loaded) {
    console.warn(
      'Warning: authenticate-pam native module not found. PAM authentication will not work.'
    );
    // Provide a stub implementation
    authenticate = (
      _username: string,
      _password: string,
      callback: (err: Error | null, authenticated?: boolean) => void
    ) => {
      callback(new Error('PAM authentication not available'));
    };
  }
} else {
  // Development mode - use regular require
  let loaded = false;

  // First, try the normal require path
  try {
    const pamModule = require('authenticate-pam');
    // Handle both direct export and default export cases
    authenticate = pamModule.authenticate || pamModule.default || pamModule;
    loaded = true;
  } catch (_error) {
    // Module not found via normal require
  }

  // If normal require failed, try the optional-modules location
  if (!loaded) {
    const optionalModulePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'optional-modules',
      'authenticate-pam',
      'build',
      'Release',
      'authenticate_pam.node'
    );
    if (fs.existsSync(optionalModulePath)) {
      try {
        const nativeModule = loadNativeModule(optionalModulePath);
        if (nativeModule.authenticate) {
          authenticate = nativeModule.authenticate;
          loaded = true;
          console.log('Loaded authenticate-pam from optional-modules location');
        }
      } catch (_loadError) {
        // Continue to stub
      }
    }
  }

  if (!loaded) {
    console.warn(
      'Warning: authenticate-pam native module not found. PAM authentication will not work.'
    );
    // Provide a stub implementation
    authenticate = (
      _username: string,
      _password: string,
      callback: (err: Error | null, authenticated?: boolean) => void
    ) => {
      callback(new Error('PAM authentication not available'));
    };
  }
}

export { authenticate };

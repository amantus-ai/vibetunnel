/**
 * ESBuild plugin for Monaco Editor
 *
 * This plugin builds Monaco as a standalone ESM bundle with the lockfile's
 * patched DOMPurify version instead of Monaco's vendored sanitizer snapshot.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

let monacoBuildPromise;
const domPurifyEntry = require.resolve('dompurify');
const domPurifyVersion = JSON.parse(
  fs.readFileSync(path.join(path.dirname(domPurifyEntry), '..', 'package.json'), 'utf8')
).version;

function domPurifyPlugin() {
  return {
    name: 'monaco-dompurify',
    setup(build) {
      build.onResolve({ filter: /^\.\/dompurify\/dompurify\.js$/ }, (args) => {
        const normalizedImporter = args.importer.split(path.sep).join('/');
        if (!normalizedImporter.endsWith('/monaco-editor/esm/vs/base/browser/domSanitize.js')) {
          return undefined;
        }
        return { path: domPurifyEntry };
      });
    },
  };
}

async function buildMonacoBundle() {
  const targetPath = path.join(__dirname, '../public/monaco-editor');
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });

  await esbuild.build({
    stdin: {
      contents: "import * as monaco from 'monaco-editor'; globalThis.monaco = monaco;",
      resolveDir: path.join(__dirname, '..'),
      sourcefile: 'monaco-entry.js',
    },
    bundle: true,
    define: {
      global: 'globalThis',
      'process.env.NODE_ENV': '"production"',
    },
    format: 'esm',
    legalComments: 'inline',
    loader: {
      '.css': 'css',
      '.ttf': 'file',
    },
    minify: true,
    outfile: path.join(targetPath, 'monaco.js'),
    platform: 'browser',
    plugins: [domPurifyPlugin()],
    target: 'es2020',
  });

  const bundle = fs.readFileSync(path.join(targetPath, 'monaco.js'), 'utf8');
  if (!bundle.includes(`DOMPurify ${domPurifyVersion}`) || bundle.includes('DOMPurify 3.2.7')) {
    throw new Error('Monaco bundle does not contain the patched DOMPurify version');
  }
  console.log(`Monaco Editor bundle built with DOMPurify ${domPurifyVersion}`);
}

module.exports = {
  monacoPlugin: {
    name: 'monaco-editor',
    setup(build) {
      build.onStart(() => {
        monacoBuildPromise ??= buildMonacoBundle();
        return monacoBuildPromise;
      });

      // Handle monaco-editor imports - use the full main entry
      build.onResolve({ filter: /^monaco-editor$/ }, (args) => {
        return {
          path: require.resolve('monaco-editor/esm/vs/editor/editor.main.js'),
          external: false,
        };
      });
    },
  },
};

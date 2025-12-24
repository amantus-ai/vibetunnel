# Plan: Add Cache Busting with Content Hashes

## Problem
Web assets use static filenames, so browsers cache old versions.

## Solution
Add content hashes to bundle filenames and update HTML references.

## Changes to `web/scripts/build.js`

### 1. Use esbuild's hash output
```javascript
// Change outfile to outdir with entryNames
await esbuild.build({
  ...prodOptions,
  entryPoints: ['src/client/app-entry.ts'],
  outdir: 'public/bundle',
  entryNames: 'client-bundle-[hash]',
  metafile: true,
});
```

### 2. Hash CSS after PostCSS
```javascript
const crypto = require('crypto');
const cssContent = fs.readFileSync('public/bundle/styles.css');
const hash = crypto.createHash('md5').update(cssContent).digest('hex').slice(0, 8);
fs.renameSync('public/bundle/styles.css', `public/bundle/styles-${hash}.css`);
```

### 3. Update HTML with new filenames
```javascript
// Read output filenames from metafile, then:
let html = fs.readFileSync('public/index.html', 'utf8');
html = html.replace('client-bundle.js', hashedJsName);
html = html.replace('styles.css', hashedCssName);
fs.writeFileSync('public/index.html', html);
// Same for logs.html
```

### 4. Clean old bundles before build
```javascript
// Remove old hashed files before building new ones
for (const file of fs.readdirSync('public/bundle')) {
  if (file.match(/-[a-f0-9]{8}\.(js|css)$/)) fs.unlinkSync(`public/bundle/${file}`);
}
```

## Files to Modify
- `web/scripts/build.js` - All changes go here

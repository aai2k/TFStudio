// tools/build-renderer.mjs
// Production bundler for the TFStudio renderer (PLAN §10.4 / §10.6 rung 1).
//
// Dev (`npm start`) loads raw ES modules from src/ unchanged. This script is ONLY
// run for packaged builds (wired into `npm run build` before electron-builder). It
// esbuild-bundles + minifies the renderer entry and the web workers (see WORKERS) into
// build/app/, vendors the UMD libraries, and emits a production index.html — so the
// shipped app.asar contains a mangled blob instead of authored source, and DevTools
// (disabled in packaged builds, see main.js) can't read it live.
//
// Output layout (must match src/workerUrls.js expectations):
//   build/app/renderer-modular.js      <- esbuild entry
//   build/app/utils/workers/<worker>.js  <- esbuild worker entries (one per worker)
//   build/app/styles.css               <- copied
//   build/app/index.html               <- generated (rebased asset paths)
//   build/app/vendor/                  <- React(prod)/ReactDOM(prod)/Plotly/KaTeX
//   build/icons/                       <- copied; renderer uses ../icons/ from the doc
//
// NOTE: sourcemap is intentionally OFF — a shipped .map would undo the obfuscation.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src');
const outApp = path.join(root, 'build', 'app');
const outVendor = path.join(outApp, 'vendor');
const outIcons = path.join(root, 'build', 'icons');

const WORKERS = [
  'optimizerWorker.js', 'mfEvalWorker.js', 'synthesisWorker.js',
  'bbmRunWorker.js', 'filterDesignWorker.js',
  'plotSurfaceWorker.js', 'benchmarkWorker.js',
];

function clean(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

async function main() {
  console.log('[build-renderer] cleaning build/app …');
  clean(outApp);
  clean(outIcons);

  // 1. Bundle: renderer entry + workers. Common ancestor is src/, so esbuild
  //    emits renderer-modular.js at outdir root and utils/<worker>.js beneath it.
  const entryPoints = [
    path.join(src, 'renderer-modular.js'),
    ...WORKERS.map((w) => path.join(src, 'utils', 'workers', w)),
  ];
  // Stamp the BUILD date (YYYY-MM-DD, local) into the bundle so the About dialog
  // shows when the build was made — not the runtime date. Read in AboutDialog via
  // `typeof __TFS_BUILD_DATE__` so the dev path (raw ES modules, no define) is safe.
  const buildDate = new Date().toLocaleDateString('en-CA');   // 'YYYY-MM-DD'
  console.log(`[build-renderer] esbuild bundling 7 entry points … (build date ${buildDate})`);
  const result = await esbuild.build({
    entryPoints,
    outdir: outApp,
    outbase: src,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: false,        // CRITICAL: never ship a sourcemap (would deobfuscate)
    legalComments: 'none',
    logLevel: 'info',
    define: { __TFS_BUILD_DATE__: JSON.stringify(buildDate) },
    // React/ReactDOM/Plotly/KaTeX are window.* globals (script tags), never imported
    // in src/, so there is nothing to externalize here.
  });
  if (result.errors && result.errors.length) {
    console.error('[build-renderer] esbuild errors:', result.errors);
    process.exit(1);
  }

  // Assert no stray .map slipped out.
  const strayMaps = fs.readdirSync(outApp).filter((f) => f.endsWith('.map'));
  if (strayMaps.length) { console.error('[build-renderer] sourcemaps emitted:', strayMaps); process.exit(1); }

  // 2. Static assets.
  console.log('[build-renderer] copying styles + vendor libs + icons …');
  copyFile(path.join(src, 'styles.css'), path.join(outApp, 'styles.css'));

  const nm = path.join(root, 'node_modules');
  copyFile(path.join(nm, 'react', 'umd', 'react.production.min.js'), path.join(outVendor, 'react.production.min.js'));
  copyFile(path.join(nm, 'react-dom', 'umd', 'react-dom.production.min.js'), path.join(outVendor, 'react-dom.production.min.js'));
  copyFile(path.join(nm, 'plotly.js-dist-min', 'plotly.min.js'), path.join(outVendor, 'plotly.min.js'));
  copyFile(path.join(nm, 'katex', 'dist', 'katex.min.js'), path.join(outVendor, 'katex.min.js'));
  copyFile(path.join(nm, 'katex', 'dist', 'katex.min.css'), path.join(outVendor, 'katex.min.css'));
  // katex.min.css references url(fonts/KaTeX_*.woff2) relative to itself.
  copyTree(path.join(nm, 'katex', 'dist', 'fonts'), path.join(outVendor, 'fonts'));

  // Icons: renderer uses '../icons/…png' resolved against the document
  // (build/app/index.html) → build/icons/. Mirror the repo icons folder there.
  copyTree(path.join(root, 'icons'), outIcons);

  // 3. Production index.html (rebased to bundled/vendored assets).
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob:">
    <title>TFStudio</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="vendor/katex.min.css">
</head>
<body>
    <div id="root"></div>

    <!-- Vendored UMD globals (production builds) -->
    <script src="vendor/react.production.min.js"></script>
    <script src="vendor/react-dom.production.min.js"></script>
    <script src="vendor/plotly.min.js"></script>
    <script src="vendor/katex.min.js"></script>

    <!-- Bundled + minified renderer -->
    <script type="module" src="renderer-modular.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(outApp, 'index.html'), html, 'utf8');

  console.log('[build-renderer] done → build/app/');
}

main().catch((e) => { console.error(e); process.exit(1); });

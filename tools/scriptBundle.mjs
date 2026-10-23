// The Script Console's threads (src/scripts/scriptWorker.js for a JavaScript
// run, src/scripts/pythonWorker.js for a Python one) as an installed app runs
// them: one CommonJS file each with the API inside, bundled as
// tools/nodeBundle.mjs bundles, so a worker thread can load it.
// import.meta.url, which the thread hands a script's require when the script
// has no file yet, becomes the bundle file's own URL.
// tools/build-renderer.mjs writes them to build/app/scripts/;
// tests/script_console_bundle.mjs builds them to a folder of its own.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForNode } from './nodeBundle.mjs';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Bundles the two threads into `outDir`; `minify` for a release build. */
export function buildScriptWorker(outDir, options) {
    const entries = ['scriptWorker.js', 'pythonWorker.js'].map(name => path.join(src, 'scripts', name));
    return buildForNode('Script threads', entries, outDir, options);
}

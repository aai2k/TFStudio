// The Script Console's thread (src/scripts/scriptWorker.js) as an installed app
// runs it: one CommonJS file with the API inside, for the app's Node, Node 16
// on the Windows 7 build, kept outside the asar archive so a worker thread can
// load it. import.meta.url, which the thread hands a script's require when the
// script has no file yet, becomes the bundle file's own URL.
// tools/build-renderer.mjs writes it to build/app/scripts/;
// tests/script_console_bundle.mjs builds it to a folder of its own.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Bundles src/scripts/scriptWorker.js into `outDir`; `minify` for a release build. */
export async function buildScriptWorker(outDir, { minify = true } = {}) {
    const result = await esbuild.build({
        entryPoints: [path.join(src, 'scripts', 'scriptWorker.js')],
        outdir: outDir,
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node16',
        minify,
        sourcemap: false,
        legalComments: 'none',
        logLevel: 'warning',
        define: { 'import.meta.url': 'importMetaUrl' },
        banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
    });
    if (result.errors.length) throw new Error(`Script thread bundle: ${result.errors.map(e => e.text).join('; ')}`);
}

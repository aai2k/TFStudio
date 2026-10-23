// How code an installed app runs on its own Node, outside the renderer, is
// bundled: one CommonJS file per entry for the app's Node, Node 16 on the
// Windows 7 build, kept outside the asar archive so a child process or worker
// thread can load it. import.meta.url, which the sources use to find the files
// beside them, becomes the bundle file's own URL. The bundlers beside this
// file (mcpBundle.mjs, scriptBundle.mjs and the like) build with it.

import esbuild from 'esbuild';

/**
 * Bundles `entryPoints` into `outDir`, one file each under its own name;
 * `minify` for a release build. `name` says what failed in the error.
 */
export async function buildForNode(name, entryPoints, outDir, { minify = true } = {}) {
    const result = await esbuild.build({
        entryPoints,
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
    if (result.errors.length) throw new Error(`${name} bundle: ${result.errors.map(e => e.text).join('; ')}`);
}

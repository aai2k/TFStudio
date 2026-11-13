// The checks and fixups a .tfs load applies (src/main/designLoad.js) as one
// plain browser script that sets window.DemoDesignLoad, for the web demo's file
// import (web/demo-shim.js). Built from the desktop's own module, so the demo
// opens a file as the desktop does.
// tools/build-web-demo.mjs writes it beside the demo scripts;
// tests/web_demo_import.mjs builds it in memory.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'designLoad.js');

/** The script's file name in the demo. */
export const DESIGN_LOAD_SCRIPT = 'demo-design-load.js';

/** The script's text; `minify` for the deployed demo. */
export async function bundleDesignLoad({ minify = true } = {}) {
    const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'DemoDesignLoad',
        platform: 'browser',
        target: 'es2022',
        minify,
        legalComments: 'none',
        logLevel: 'warning',
    });
    return result.outputFiles[0].text;
}

// The MCP server that TFStudio.exe --mcp runs in a plain Node child of the app
// (src/main/mcpEntry.js): the server and its job thread bundled as CommonJS
// for the app's Node, Node 16 on the Windows 7 build. import.meta.url, which
// the sources use to find the job thread, becomes the bundle file's own URL.
// tools/build-renderer.mjs writes it to build/app/mcp/; tests/mcp_exe.mjs
// builds it to a folder of its own.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Bundles src/mcp/server.js and its job thread into `outDir`; `minify` for a release build. */
export async function buildMcpServer(outDir, { minify = true } = {}) {
    const result = await esbuild.build({
        entryPoints: [path.join(src, 'mcp', 'server.js'), path.join(src, 'mcp', 'jobWorker.js')],
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
    if (result.errors.length) throw new Error(`MCP server bundle: ${result.errors.map(e => e.text).join('; ')}`);
}

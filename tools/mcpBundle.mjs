// The MCP server that TFStudio.exe --mcp runs in a plain Node child of the
// app: the server and its job thread, bundled as tools/nodeBundle.mjs bundles
// (import.meta.url, which the sources use to find the job thread, becomes the
// bundle file's own URL). tools/build-renderer.mjs writes it to build/app/mcp/;
// tests/mcp_exe.mjs builds it to a folder of its own.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForNode } from './nodeBundle.mjs';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Bundles src/mcp/server.js and its job thread into `outDir`; `minify` for a release build. */
export function buildMcpServer(outDir, options) {
    return buildForNode('MCP server', [path.join(src, 'mcp', 'server.js'), path.join(src, 'mcp', 'jobWorker.js')], outDir, options);
}

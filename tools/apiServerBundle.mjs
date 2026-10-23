// The API server that TFStudio.exe --api runs in a plain Node child of the
// app, bundled as tools/nodeBundle.mjs bundles. tools/build-renderer.mjs
// writes it to build/app/apiServer/; tests/api_server_exe.mjs builds it to a
// folder of its own.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForNode } from './nodeBundle.mjs';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Bundles src/apiServer/server.js into `outDir`; `minify` for a release build. */
export function buildApiServer(outDir, options) {
    return buildForNode('API server', [path.join(src, 'apiServer', 'server.js')], outDir, options);
}

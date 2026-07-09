// workerUrls.js — central registry of Web Worker URLs.
//
// Lives at the `src/` ROOT (same depth as renderer-modular.js) on purpose: every
// URL is resolved relative to THIS file via import.meta.url, so it works in both
// runtime modes with no dev/prod branching:
//   - dev (unbundled): this file is src/workerUrls.js, so './utils/x.js'
//     resolves to src/utils/x.js.
//   - packaged (esbuild bundle): this module is inlined into the renderer bundle
//     at the output root (build/app/renderer-modular.js), so './utils/x.js'
//     resolves to build/app/utils/x.js — exactly where esbuild emits the worker
//     bundles.
//
// Component code must import these instead of computing
// `new URL('../../utils/xWorker.js', import.meta.url)` from components/windows/,
// which would resolve wrong once inlined into the single renderer bundle.
//
// IMPORTANT — esbuild interop: esbuild statically rewrites the LITERAL pattern
// `new URL("./literal", import.meta.url)` at bundle time, and that rewrite mangled
// the packaged path (dropped the build/app/ prefix → file:///…/app.asar/utils/x.js
// instead of …/build/app/utils/x.js), so `new Worker()` 404'd and every worker pool
// fell back to single-thread. We build the URL through a helper with a NON-literal
// argument so esbuild can't statically recognize it, leaving `new URL` +
// `import.meta.url` intact for correct runtime resolution in BOTH modes.
// Do NOT inline these back to `new URL('./utils/x.js', import.meta.url)` literals.

const u = (rel) => new URL(rel, import.meta.url);

export const OPTIMIZER_WORKER_URL = u('./utils/workers/optimizerWorker.js');
export const MFEVAL_WORKER_URL    = u('./utils/workers/mfEvalWorker.js');
export const SYNTHESIS_WORKER_URL = u('./utils/workers/synthesisWorker.js');
export const BBM_WORKER_URL       = u('./utils/workers/bbmRunWorker.js');
export const FILTER_WORKER_URL    = u('./utils/workers/filterDesignWorker.js');
export const PLOT_SURFACE_WORKER_URL = u('./utils/workers/plotSurfaceWorker.js');
export const BENCHMARK_WORKER_URL = u('./utils/workers/benchmarkWorker.js');

// Re-export of the tmmcore package for renderer code.
//
// Lives at the `src/` ROOT alongside workerUrls.js, and for the same reason:
// the renderer runs in two modes and the specifier has to resolve in both.
//   - dev (unbundled): the browser loads src/ directly and cannot resolve a
//     bare specifier such as `tmmcore`, so the path below is relative, exactly
//     like the vendored <script> tags in index.html.
//   - packaged (esbuild bundle): esbuild resolves the same relative path at
//     build time and inlines the package, which is why node_modules/tmmcore is
//     excluded from the electron-builder `files` list.
//
// Module workers are the reason an import map in index.html is not sufficient:
// a worker created with { type: 'module' } does not inherit the document's
// import map, and five workers under utils/workers/ import from here.
//
// Renderer code must import this module rather than the bare package name.
//
// The path below names a file inside the dependency, which the package's
// `exports` map would otherwise hide; a browser cannot read an exports map, so
// there is no alternative. tests/dev_module_graph.mjs resolves this path and
// fails if a future tmmcore release moves it, which keeps the coupling honest.
export * from '../node_modules/tmmcore/src/index.js';

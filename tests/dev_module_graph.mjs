/**
 * Dev-mode module resolution guard.
 *
 * `npm run dev` loads src/ as raw ES modules, so the BROWSER resolves every
 * import. A bare specifier such as `import … from 'tmmcore'` crashes the app
 * immediately, and neither the test suite (Node's resolver) nor the renderer
 * build (esbuild's resolver) notices, because both resolve bare specifiers.
 *
 * This walks the graph from every dev entry point the way a browser does:
 * relative resolution only, no node_modules fallback. Each worker is its own
 * root, since a worker created with { type: 'module' } does not inherit the
 * document's import map.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The document entry, plus every worker URL exported by src/workerUrls.js.
const ENTRIES = [
    'src/renderer.js',
    'src/utils/workers/optimizerWorker.js',
    'src/utils/workers/mfEvalWorker.js',
    'src/utils/workers/synthesisWorker.js',
    'src/utils/workers/bbmRunWorker.js',
    'src/utils/workers/filterDesignWorker.js',
    'src/utils/workers/plotSurfaceWorker.js',
    'src/utils/workers/benchmarkWorker.js',
    'src/utils/workers/analysisEvaluationWorker.js',
];

const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const seen = new Set();
const bare = [];
const missing = [];

function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);

    let src;
    try { src = readFileSync(file, 'utf8'); } catch { return; }

    // Comments can contain quoted prose that reads like an import statement.
    src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

    const specs = new Set();
    for (const m of src.matchAll(STATIC)) specs.add(m[1]);
    for (const m of src.matchAll(DYNAMIC)) specs.add(m[1]);

    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const spec of specs) {
        if (spec.startsWith('node:') || /^https?:/.test(spec)) continue;
        if (!spec.startsWith('.') && !spec.startsWith('/')) { bare.push({ rel, spec }); continue; }

        const target = path.resolve(path.dirname(file), spec);
        if (!existsSync(target)) { missing.push({ rel, spec }); continue; }
        walk(target);
    }
}

for (const e of ENTRIES) {
    const abs = path.join(ROOT, e);
    assert.ok(existsSync(abs), `dev entry point missing: ${e}`);
    walk(abs);
}

for (const b of bare) console.error(`bare specifier: ${b.spec}  <- ${b.rel}`);
for (const m of missing) console.error(`unresolvable:   ${m.spec}  <- ${m.rel}`);

assert.equal(bare.length, 0,
    'bare import specifiers cannot be resolved by the browser in dev mode; ' +
    'import through a relative path (see src/tmmcore.js)');
assert.equal(missing.length, 0, 'relative import target does not exist');

// A graph this small would mean the walker stopped early and proved nothing.
assert.ok(seen.size > 400, `only ${seen.size} modules reached; the walk terminated early`);

console.log(`PASS dev_module_graph — ${seen.size} modules, 0 bare specifiers, 0 broken paths`);

/**
 * The headless API warns once when a call is about to calculate before init()
 * has loaded the WASM kernel (api/environment.js, warnWithoutKernel): every
 * calculation then runs on the JavaScript path, with the same numbers but many
 * times slower.
 *
 *   1. Each call that calculates warns, once: spectrum, merit,
 *      checkSpecification, refine, synthesize, monteCarlo, estimateYield,
 *      layerSensitivity.
 *   2. A call refused before it calculates, and a call that does not
 *      calculate, say nothing, so the one warning is kept for a calculation.
 *   3. A script that awaits init() hears nothing, also when init() could not
 *      load the kernel: its result says so.
 *   4. The numbers are the same with the kernel and without it.
 *
 * The warning is given once per process, so each case runs in a process of its
 * own.
 *
 * Run: node tests/api_without_init.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = new URL('../src/api/index.js', import.meta.url).href;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Runs `body` in a fresh process with `api`, `qw` (a quarter-wave stack),
// `scored` (the stack with a merit row) and `specified` (the stack with a
// specification check) at hand, and answers how many warnings it heard and
// what `body` returned.
function inFreshProcess(body) {
    const script = `
let heard = 0;
process.on('warning', w => { if (w.name === 'TFStudioWarning') heard++; });
console.log = () => {};
const api = await import(${JSON.stringify(API)});
const qw = api.stackFromFormula(api.newDesign(), { formula: '(HL)^2 H', referenceWavelength: 550 });
const scored = api.setMerit(qw, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }]);
const specified = api.setSpecification(qw, [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.9 }]);
const value = await (async () => { ${body} })();
await new Promise(resolve => setImmediate(resolve));
process.stdout.write(JSON.stringify({ heard, value: value ?? null }));
`;
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module'], { cwd: ROOT, input: script, encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, `the child process failed: ${run.error ?? `exit ${run.status}, signal ${run.signal}`}\n${run.stderr}`);
    return JSON.parse(run.stdout);
}

// ── 1. Each call that calculates warns, once ─────────────────────────────────
const CALCULATING = {
    spectrum: `api.spectrum(qw, { from: 500, to: 600, step: 10 }); api.spectrum(qw, { from: 500, to: 600, step: 10 });`,
    merit: `api.merit(scored);`,
    checkSpecification: `api.checkSpecification(specified);`,
    refine: `await api.refine(scored, { method: 'dls', maxIter: 2 });`,
    synthesize: `await api.synthesize(scored, { method: 'structural', pool: ['TiO2', 'SiO2'], settings: { maxIter: 1, refineIter: 2, threads: 1, seed: 7 } });`,
    monteCarlo: `api.monteCarlo(qw, { from: 500, to: 600, step: 10, runs: 2 });`,
    estimateYield: `await api.estimateYield(specified, { runs: 2 });`,
    layerSensitivity: `api.layerSensitivity(scored, {});`,
};
for (const [call, body] of Object.entries(CALCULATING)) {
    assert.equal(inFreshProcess(body).heard, 1, `${call} without the kernel warns, once`);
}

// ── 2. Calls that do not calculate say nothing ───────────────────────────────
{
    const quiet = inFreshProcess(`
        try { await api.refine(qw, {}); } catch (_) {}
        try { await api.synthesize(scored, { method: 'needle', pool: [] }); } catch (_) {}
        try { api.monteCarlo(api.newDesign(), { from: 500, to: 600 }); } catch (_) {}
        try { api.layerSensitivity(qw, {}); } catch (_) {}
        try { api.checkSpecification(qw); } catch (_) {}
        try { api.estimateYield(qw, { runs: 2 }); } catch (_) {}
        api.setSpecification(qw, [{ kind: 'T_AT' }]);
        api.merit(qw);
        api.findMaterials('TiO2'); api.materialNK('TiO2', [550]);
        await new Promise(resolve => setImmediate(resolve));
        const before = heard;
        api.spectrum(qw, { from: 500, to: 600, step: 10 });
        return before;
    `);
    assert.equal(quiet.value, 0, 'calls refused before they calculate, and calls that do not calculate, say nothing');
    assert.equal(quiet.heard, 1, 'so the warning comes with the first calculation');
}

// ── 3. A script that awaits init() hears nothing ─────────────────────────────
assert.equal(inFreshProcess(`await api.init(); api.spectrum(qw, { from: 500, to: 600, step: 10 });`).heard, 0,
    'a script that awaits init() first hears no warning');
const failed = inFreshProcess(`const started = await api.init({ wasmPath: ${JSON.stringify(fileURLToPath(new URL('./no-such-kernel.wasm', import.meta.url)))} });
    api.spectrum(qw, { from: 500, to: 600, step: 10 }); return started.wasm;`);
assert.equal(failed.value, false, 'init() that cannot load the kernel says so in its result');
assert.equal(failed.heard, 0, 'and nothing more is said');

// ── 4. The same numbers either way ───────────────────────────────────────────
{
    const api = await import(API);
    const qw = api.stackFromFormula(api.newDesign(), { formula: '(HL)^3 H', referenceWavelength: 550 });
    const range = { from: 500, to: 600, step: 10 };
    const withoutKernel = api.spectrum(qw, range).angles[0].R;
    assert.equal((await api.init()).wasm, true, 'init loads the kernel');
    const withKernel = api.spectrum(qw, range).angles[0].R;
    assert.ok(withKernel.every((r, i) => Math.abs(r - withoutKernel[i]) < 1e-12), 'the numbers are the same with the kernel and without it');
}

console.log('PASS: api_without_init');

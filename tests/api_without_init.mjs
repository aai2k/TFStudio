/**
 * The headless API calculates on the WASM kernel alone, which init() loads
 * (api/environment.js, requireKernel). A call that is about to calculate
 * before then throws, and says to await init().
 *
 *   1. Each call that calculates throws before init(): spectrum, merit,
 *      checkSpecification, refine, synthesize, monteCarlo, estimateYield,
 *      layerSensitivity, color, integrals, bandFeature, edgeShift,
 *      measuredDifference, ellipsometry, ellipsometryVsAngle, groupDelay,
 *      pulseAnalysis, processSteps, exportProcess, monitorWorksheet,
 *      inhomogeneities, roughness, needleProfile, and insertNeedle without a
 *      thickness.
 *   2. A call refused before it calculates keeps its own error, and a call
 *      that does not calculate works without the kernel.
 *   3. After init() every calculation runs. An init() that could not load the
 *      kernel says so in its result, and a calculation after it says init()
 *      failed.
 *
 * Run: node tests/api_without_init.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = new URL('../src/api/index.js', import.meta.url).href;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOT_LOADED = /the WASM kernel is not loaded\. Await init\(\)/;
const INIT_FAILED = /init\(\) could not load the WASM kernel/;

const api = await import(API);
const qw = api.stackFromFormula(api.newDesign(), { formula: '(HL)^2 H', referenceWavelength: 550 });
const scored = api.setMerit(qw, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }]);
const specified = api.setSpecification(qw, [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.9 }]);
const measured = { quantity: 'R', wavelength: [450, 500, 550, 600, 650], values: [0.5, 0.6, 0.7, 0.6, 0.5] };
const folder = mkdtempSync(join(tmpdir(), 'api-without-init-'));

// The message a call fails with, or null when it does not fail.
async function failure(call) {
    try {
        await call();
    } catch (e) {
        return e.message;
    }
    return null;
}

// ── 1. Each call that calculates throws before init() ────────────────────────
const CALCULATING = {
    spectrum: () => api.spectrum(qw, { from: 500, to: 600, step: 10 }),
    merit: () => api.merit(scored),
    checkSpecification: () => api.checkSpecification(specified),
    refine: () => api.refine(scored, { method: 'dls', maxIter: 2 }),
    synthesize: () => api.synthesize(scored, { method: 'structural', pool: ['TiO2', 'SiO2'], settings: { maxIter: 1, refineIter: 2, threads: 1, seed: 7 } }),
    monteCarlo: () => api.monteCarlo(qw, { from: 500, to: 600, step: 10, runs: 2 }),
    estimateYield: () => api.estimateYield(specified, { runs: 2 }),
    layerSensitivity: () => api.layerSensitivity(scored, {}),
    color: () => api.color(qw),
    integrals: () => api.integrals(qw),
    bandFeature: () => api.bandFeature(qw, { feature: 'edge', from: 400, to: 700 }),
    edgeShift: () => api.edgeShift(qw, { from: 400, to: 700, angles: [0, 30] }),
    measuredDifference: () => api.measuredDifference(qw, measured),
    ellipsometry: () => api.ellipsometry(qw, { from: 500, to: 600, step: 50 }),
    ellipsometryVsAngle: () => api.ellipsometryVsAngle(qw, {}),
    groupDelay: () => api.groupDelay(qw, { from: 500, to: 600, step: 50 }),
    pulseAnalysis: () => api.pulseAnalysis(qw, {}),
    processSteps: () => api.processSteps(qw, { step: 10 }),
    exportProcess: () => api.exportProcess(qw, folder, { step: 10 }),
    monitorWorksheet: () => api.monitorWorksheet(qw, {}),
    inhomogeneities: () => api.inhomogeneities(qw, {}),
    roughness: () => api.roughness(qw, {}),
    needleProfile: () => api.needleProfile(scored, { pool: ['TiO2', 'SiO2'] }),
    insertNeedle: () => api.insertNeedle(scored, { material: 'TiO2', kind: 'gap', position: 0 }),
};
for (const [name, call] of Object.entries(CALCULATING)) {
    assert.match(await failure(call) ?? 'no error', NOT_LOADED, `${name} before init() throws and says to await init()`);
}

// ── 2. Refused calls keep their own error; the rest work without the kernel ──
const REFUSED = {
    'refine without a merit': () => api.refine(qw, {}),
    'synthesize with an empty pool': () => api.synthesize(scored, { method: 'needle', pool: [] }),
    'monteCarlo on an empty design': () => api.monteCarlo(api.newDesign(), { from: 500, to: 600 }),
    'layerSensitivity without a merit': () => api.layerSensitivity(qw, {}),
    'checkSpecification without a specification': () => api.checkSpecification(qw),
    'estimateYield without a specification': () => api.estimateYield(qw, { runs: 2 }),
};
for (const [name, call] of Object.entries(REFUSED)) {
    const message = await failure(call);
    assert.ok(message && !NOT_LOADED.test(message), `${name} is refused for its own reason (${message})`);
}
api.setSpecification(qw, [{ kind: 'T_AT' }]);
api.merit(qw);
api.findMaterials('TiO2');
api.materialNK('TiO2', [550]);

// ── 3. After init() every calculation runs ───────────────────────────────────
assert.equal((await api.init()).wasm, true, 'init loads the kernel');
for (const [name, call] of Object.entries(CALCULATING)) {
    assert.equal(await failure(call), null, `${name} runs after init()`);
}
rmSync(folder, { recursive: true, force: true, maxRetries: 3 });

// An init() that cannot load the kernel, in a process of its own.
const missing = fileURLToPath(new URL('./no-such-kernel.wasm', import.meta.url));
const script = `
console.warn = () => {};
const api = await import(${JSON.stringify(API)});
const qw = api.stackFromFormula(api.newDesign(), { formula: '(HL)^2 H', referenceWavelength: 550 });
const started = await api.init({ wasmPath: ${JSON.stringify(missing)} });
let message = null;
try { api.spectrum(qw, { from: 500, to: 600, step: 10 }); } catch (e) { message = e.message; }
process.stdout.write(JSON.stringify({ wasm: started.wasm, message }));
`;
const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module'], { cwd: ROOT, input: script, encoding: 'utf8', timeout: 120000 });
assert.equal(run.status, 0, `the child process failed: ${run.error ?? `exit ${run.status}, signal ${run.signal}`}\n${run.stderr}`);
const failed = JSON.parse(run.stdout);
assert.equal(failed.wasm, false, 'init() that cannot load the kernel says so in its result');
assert.match(failed.message ?? 'no error', INIT_FAILED, 'and a calculation after it says init() failed');

console.log('PASS: api_without_init');
process.exitCode = 0;

/**
 * The status-bar monitors search a band at 0.1 nm, off the interface's thread.
 *
 *   1. A band-maximum or MXWT monitor reads the merit row at MONITOR_FLAG: on
 *      two coupled-cavity peaks 1.9 nm apart it finds the higher one, which the
 *      row reads as the lower at the default 1 nm step.
 *   2. A FWHM or edge monitor is the FWHM or Edge λ check with a Step of
 *      MONITOR_FLAG, whose scan has a sample every 0.1 nm; a check without a
 *      Step scans every 1 nm, and never fewer than 301 samples.
 *   3. The status bar follows a run through useLiveDesign and works its
 *      monitors out on the analysis worker, saying so only for a cone design.
 *
 * Run: node tests/status_monitor_step.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme } from './_uiShim.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { computeMonitor, MONITOR_FLAG } = await import('../src/utils/physics/statusMonitorEvaluation.js');
const { scanCount } = await import('../src/utils/synthesis/qualifiers/bandScan.js');
const { fabryPerot, coupled, COUPLED_BAND, row, check } = await import('./_peakDesigns.mjs');

// ── 1. Peak monitors search at MONITOR_FLAG ──────────────────────────────────
{
    const { lambdaStart: a, lambdaEnd: b } = COUPLED_BAND;
    const band = { ...COUPLED_BAND, aoi: 0, pol: 'avg' };
    const resolve = designMaterialLookup(coupled);
    const atDefault = row(coupled, 'TMX', a, b);
    const atMonitorStep = row(coupled, 'TMX', a, b, MONITOR_FLAG);
    assert.ok(atDefault < 0.8, `at the default step the row reads the lower peak: ${atDefault}`);
    assert.ok(atMonitorStep > 0.97, `at 0.1 nm the higher one: ${atMonitorStep}`);
    assert.equal(computeMonitor({ type: 'max', qty: 'T', ...band }, coupled, resolve), 100 * atMonitorStep,
        'a band-maximum monitor is the TMX row at the monitor step');
    const peakAt = row(coupled, 'MXWT', a, b, MONITOR_FLAG);
    assert.ok(Math.abs(peakAt - 556.9) < 0.01, `MXWT at the monitor step is the higher peak's wavelength: ${peakAt}`);
    assert.equal(computeMonitor({ type: 'MXWT', ...band }, coupled, resolve), peakAt,
        'an MXWT monitor is the MXWT row at the monitor step');
}

// ── 2. FWHM and edge monitors scan at MONITOR_FLAG ───────────────────────────
{
    const resolve = designMaterialLookup(fabryPerot);
    const band = { lambdaStart: 540, lambdaEnd: 580 };
    const fwhm = { kind: 'FWHM', channel: 'T', direction: 'max', cmp: 'ge', target: 0, ...band };
    const atMonitorStep = check(fabryPerot, { ...fwhm, flag: MONITOR_FLAG }).value;
    assert.equal(computeMonitor({ type: 'fwhm', qty: 'T', ...band }, fabryPerot, resolve), atMonitorStep,
        'a FWHM monitor is the FWHM check at the monitor step');
    const edge = { kind: 'EDGE_LAMBDA', channel: 'T', direction: 'max', cmp: 'ge', target: 0, edgeSide: 'right', ...band };
    assert.equal(computeMonitor({ type: 'edgeRight', qty: 'T', ...band }, fabryPerot, resolve),
        check(fabryPerot, { ...edge, flag: MONITOR_FLAG }).value, 'an edge monitor is the Edge λ check at the monitor step');
    // The scan has a sample every step of the check's Step, 1 nm without one,
    // never fewer than 301, and a qualifier's own count wins.
    // On the coupled cavities the step decides which peak an edge is taken
    // from, so the monitor's own step shows there.
    const coupledEdge = { kind: 'EDGE_LAMBDA', channel: 'T', direction: 'max', cmp: 'ge', target: 0, edgeSide: 'right', ...COUPLED_BAND };
    const monitorEdge = computeMonitor({ type: 'edgeRight', qty: 'T', ...COUPLED_BAND }, coupled, designMaterialLookup(coupled));
    assert.equal(monitorEdge, check(coupled, { ...coupledEdge, flag: MONITOR_FLAG }).value, 'a coupled-cavity edge monitor is the check at the monitor step');
    assert.notEqual(monitorEdge, check(coupled, coupledEdge).value, 'which the default step reads at the other peak');
    const wide = { lambdaStart: 400, lambdaEnd: 1600 };
    assert.equal(scanCount(wide), 1201, 'a check without a Step scans every 1 nm');
    assert.equal(scanCount({ ...wide, flag: MONITOR_FLAG }), 12001, 'at the monitor step, one every 0.1 nm');
    assert.equal(scanCount({ ...wide, flag: MONITOR_FLAG }, { coarse: true }), 1201, 'a first pass scans at the default');
    assert.equal(scanCount({ lambdaStart: 540, lambdaEnd: 560, flag: MONITOR_FLAG }), 301, 'and never fewer than 301');
    assert.equal(scanCount({ ...wide, bandPoints: 501, flag: MONITOR_FLAG }), 501, 'a qualifier\'s own count wins');
}

// ── 3. The status bar follows a run and works on the worker ──────────────────
{
    // Drawn while its worker is still working: a cone design says so, a
    // collimated one, done in milliseconds, keeps its values without a word.
    localStorage.setItem('tfstudio-monitors-v1', JSON.stringify([
        { id: 'r', type: 'avg', qty: 'R', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg' },
    ]));
    const { SpectralMonitor } = await import('../src/components/SpectralMonitor.js');
    const c = makeTheme(), t = makeLocale(), h = React.createElement;
    const draw = design => renderToStaticMarkup(h(DesignContext.Provider,
        { value: { ...makeDesignCtx(design), hasActiveDesign: true } }, h(SpectralMonitor, { c, t })));
    const sample = makeSampleDesign();
    const coned = { ...sample, cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 } };
    assert.ok(draw(coned).includes(t.analysisEvaluation.computing), 'a cone design says it is being worked out');
    assert.ok(!draw(sample).includes(t.analysisEvaluation.computing), 'a collimated one does not');
    localStorage.removeItem('tfstudio-monitors-v1');
}
{
    const source = readFileSync(new URL('../src/components/SpectralMonitor.js', import.meta.url), 'utf8');
    assert.match(source, /const \{ design \} = useLiveDesign\(\);/, 'the status bar follows the sampled design');
    assert.match(source, /useAnalysisEvaluation\(evaluable, 'statusMonitors', monitorPayload\)/,
        'and works its monitors out on the analysis worker');
    assert.doesNotMatch(source, /useDesign\(\)\.design|const \{ design[^}]*\} = useDesign\(\)/,
        'nothing in it evaluates the design as each run update arrives');
}

console.log('PASS: status_monitor_step');

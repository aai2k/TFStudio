/**
 * Filter Design on the WASM kernel.
 *
 * The integer search evaluates the merit tens of millions of times, so the
 * filter engine dispatches to the WASM TMM whenever it is active. This checks
 * that switching kernels does not move a design: the merit, the coat and the
 * search all have to agree with the JS reference, and the search has to return
 * the same structure.
 *
 * Agreement is not bit-identical by design. The kernels differ only in libm
 * (Emscripten musl against V8 fdlibm) at about 1 ULP, which is far below any
 * tolerance the merit can resolve.
 *
 * Run: node tests/filter_design_wasm.mjs
 */
import { initWasmForTest } from './_wasmInit.mjs';
import { setTmmWasmEnabled, tmmWasmActive } from 'tmmcore';
import {
    constIndex, buildPrototypeLayers, coupledMirrors, buildFilterTarget,
    meritFunctionEmbedded, globalIntegerSearch, adjustToIncidentMedium, spectrumT,
} from '../src/utils/filter/filterDesign.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

const ready = await initWasmForTest();
if (!ready) {
    console.log('WASM kernel not available; nothing to compare. Skipping.');
    process.exit(0);
}

const LAM0 = 1530;
const nH = constIndex(2.20), nL = constIndex(1.45), nSub = constIndex(1.52), nAir = constIndex(1.0);
const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 7.5, halfStop: 10 });
const layersOf = (m, s) => buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: m, spacers: s });

/** Run fn with the kernel forced on or off, restoring the flag afterwards. */
function onKernel(useWasm, fn) {
    setTmmWasmEnabled(useWasm);
    try { return fn(); } finally { setTmmWasmEnabled(true); }
}

// ── the merit agrees on both kernels ─────────────────────────────────────────
console.log('— merit —');
{
    const cases = [
        ['seed m=8 k=1', coupledMirrors(8, 8, 1), new Array(8).fill(1)],
        ['searched', [5, 12, 15, 16, 14, 13, 13, 13, 7], [3, 3, 1, 2, 5, 4, 4, 1]],
    ];
    for (const [label, m, s] of cases) {
        const layers = layersOf(m, s);
        const js = onKernel(false, () => meritFunctionEmbedded(layers, target, nSub));
        const wa = onKernel(true, () => meritFunctionEmbedded(layers, target, nSub));
        const rel = Math.abs(wa - js) / Math.max(js, 1e-12);
        console.log(`    ${label.padEnd(14)} JS ${js.toFixed(9)}   WASM ${wa.toFixed(9)}   rel ${rel.toExponential(2)}`);
        ok(rel < 1e-9, `${label}: merit agrees across kernels (rel ${rel.toExponential(2)})`);
    }
}

// ── the tilted merit agrees too, since it centres on a scan ──────────────────
console.log('— tilted merit —');
{
    const tilt = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 7.5, halfStop: 10, tiltDeg: 15 });
    const layers = layersOf([5, 12, 15, 16, 14, 13, 13, 13, 7], [3, 3, 1, 2, 5, 4, 4, 1]);
    const js = onKernel(false, () => meritFunctionEmbedded(layers, tilt, nSub));
    const wa = onKernel(true, () => meritFunctionEmbedded(layers, tilt, nSub));
    const rel = Math.abs(wa - js) / Math.max(js, 1e-12);
    console.log(`    JS ${js.toFixed(9)}   WASM ${wa.toFixed(9)}   rel ${rel.toExponential(2)}`);
    ok(rel < 1e-6, `tilted merit agrees across kernels (rel ${rel.toExponential(2)})`);
}

// ── the step-6 coat agrees ───────────────────────────────────────────────────
console.log('— V coat —');
{
    const filterLayers = layersOf([9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3]);
    const coat = (w) => onKernel(w, () => adjustToIncidentMedium({
        filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, mode: 'vcoat',
    }));
    const js = coat(false), wa = coat(true);
    ok(js.layers.length === wa.layers.length, 'same layer count');
    const dThick = Math.max(...js.layers.map((l, i) => Math.abs(l.d - wa.layers[i].d)));
    console.log(`    worst layer difference ${dThick.toExponential(2)} nm`);
    ok(dThick < 1e-9, `coat thicknesses agree (worst ${dThick.toExponential(2)} nm)`);
    const tJs = onKernel(false, () => spectrumT(js.layers, LAM0, nAir, nSub));
    const tWa = onKernel(true, () => spectrumT(wa.layers, LAM0, nAir, nSub));
    ok(Math.abs(tJs - tWa) < 1e-9, `peak T agrees (${tJs.toFixed(9)} vs ${tWa.toFixed(9)})`);
}

// ── a whole search returns the same design, and faster ───────────────────────
console.log('— search —');
{
    const run = (useWasm) => onKernel(useWasm, () => {
        const t0 = Date.now();
        const { best } = globalIntegerSearch({
            nH, nL, nSub, lambda0_nm: LAM0, target,
            cavities: 8, seedMirrors: coupledMirrors(8, 8, 1), seedMirror: 8, seedSpacer: 1,
            restarts: 3, rngSeed: 4242,
        });
        return { best, ms: Date.now() - t0 };
    });
    const js = run(false), wa = run(true);
    console.log(`    JS   MF ${js.best.mf.toFixed(6)}  [${js.best.mirrors.join(' ')}] / [${js.best.spacers.join(' ')}]  ${js.ms} ms`);
    console.log(`    WASM MF ${wa.best.mf.toFixed(6)}  [${wa.best.mirrors.join(' ')}] / [${wa.best.spacers.join(' ')}]  ${wa.ms} ms`);
    console.log(`    speedup ${(js.ms / Math.max(wa.ms, 1)).toFixed(1)}x`);
    ok(js.best.mirrors.join() === wa.best.mirrors.join(), 'same mirror vector');
    ok(js.best.spacers.join() === wa.best.spacers.join(), 'same spacer vector');
    ok(Math.abs(js.best.mf - wa.best.mf) / js.best.mf < 1e-9, 'same merit');
    ok(wa.ms < js.ms, `the WASM kernel is the faster one (${wa.ms} ms against ${js.ms} ms)`);
}

ok(tmmWasmActive(), 'the kernel flag is left enabled');
if (fails === 0) console.log('\nAll filter-design WASM tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }

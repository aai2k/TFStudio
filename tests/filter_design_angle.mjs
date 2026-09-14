/**
 * Filter Design: holding the passband to an angle.
 *
 * The step-5 merit scores every design a second time tilted to the angle the
 * user asks for, in Macleod's first-order tilt model, centred on the design's
 * own band. Fixtures are the 600 nm run-3 specification (3.00 nm at 0.5 dB,
 * 6.00 nm at 30 dB) with the constant indices of that run, and the wizard's
 * default builtin materials Nb2O5, SiO2 and BK7 for the dispersive checks.
 * Reference figures are the ones in the angle-aware merit proposal; every
 * "real" figure is the full TMM in air at the angle, with the step-6 coat.
 *
 * Run: node tests/filter_design_angle.mjs
 */
import {
    constIndex, buildPrototypeLayers, coupledMirrors, embeddedT, measureWidth, toNDLayers,
    buildPrototypeFamily, buildFilterTarget, meritFunctionEmbedded, meritFunctionParts,
    tiltedLayers, tiltedBandCentre, tiltWindowLow, globalIntegerSearch, adjustToIncidentMedium,
} from '../src/utils/filter/filterDesign.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };
const within = (got, ref, frac) => Math.abs(got - ref) <= frac * ref;

const nAir = constIndex(1);
const RUN23 = { nH: constIndex(1.952), nL: constIndex(1.452), nSub: constIndex(1.51593), lam: 600 };
const REAL = { nH: getMaterial('Nb2O5').getNK, nL: getMaterial('SiO2').getNK, nSub: getMaterial('BK7').getNK, lam: 600 };
const SPEC = { lambda0_nm: 600, halfPass: 1.5, halfStop: 3.0 };
const layersOf = (M, mirrors, spacers) => buildPrototypeLayers({ nH: M.nH, nL: M.nL, lambda0_nm: M.lam, mirrors, spacers });
const coated = (M, mirrors, spacers) => adjustToIncidentMedium({
    filterLayers: layersOf(M, mirrors, spacers), nH: M.nH, nL: M.nL, nInc: nAir, nSub: M.nSub, lambda0_nm: M.lam, mode: 'vcoat',
}).layers;

/** T of the coated design in air at an angle. */
function airT(layers, lam, M, aoi, pol) {
    const v = M.nSub(lam);
    return tmm(lam, aoi, pol, [1, 0], Array.isArray(v) ? v : [v, 0], toNDLayers(layers, lam)).T;
}

/**
 * The band in air at an angle: centre and width between the half-maximum
 * crossings, and the peak and minimum of T over the central 80 % of it.
 */
function airBand(layers, M, aoi, pol) {
    const xs = [], ts = [];
    for (let lam = M.lam - 25; lam <= M.lam + 8; lam += 0.005) { xs.push(lam); ts.push(airT(layers, lam, M, aoi, pol)); }
    let ip = 0;
    for (let i = 1; i < xs.length; i++) if (ts[i] > ts[ip]) ip = i;
    const half = ts[ip] / 2;
    let l = ip, r = ip;
    while (l > 0 && ts[l] >= half) l--;
    while (r < xs.length - 1 && ts[r] >= half) r++;
    const centre = (xs[l] + xs[r]) / 2, width = xs[r] - xs[l];
    let peak = 0, min = 1;
    for (let i = l; i <= r; i++) {
        if (Math.abs(xs[i] - centre) > 0.4 * width) continue;
        peak = Math.max(peak, ts[i]); min = Math.min(min, ts[i]);
    }
    return { centre, width, peak, min };
}

/** Widths of the coated design in air at normal incidence, at 0.5 dB and 30 dB. */
function airWidths(layers, M) {
    const opts = { span: 12, step: 0.002, nInc: nAir };
    return { pass: measureWidth(layers, M.lam, 0.8913, M.nSub, opts), stop: measureWidth(layers, M.lam, 0.001, M.nSub, opts) };
}

/** Does a candidate hold the passband at `deg` in both polarizations, and meet the spec at normal? */
function holds(M, cd, deg) {
    const layers = coated(M, cd.mirrors, cd.spacers);
    const w = airWidths(layers, M);
    const s = airBand(layers, M, deg, 's'), p = airBand(layers, M, deg, 'p');
    const spec = Math.abs(w.pass - 3.0) <= 0.1 && w.stop <= 6.0;
    const tilt = Math.min(s.peak, p.peak) >= 0.99 && Math.min(s.min, p.min) >= 0.95;
    return { spec, tilt, w, s, p };
}

// ── 1. The tilt off leaves the merit bit-identical ─────────────────────
// The function below is the merit as it stood before the tilt was added. With
// the field at 0 the engine has to return exactly its number, not a value
// within tolerance of it, so the default path is provably unchanged.
console.log('-- tilt off: merit unchanged --');
{
    const before = (layers, target, nSub) => {
        const pts = target.points;
        let ss = 0;
        for (const pt of pts) {
            const T = 100 * embeddedT(layers, pt.lambda, nSub, pt.aoi, pt.pol);
            const d = pt.band === 'pass' ? Math.min(0, T - pt.target) : Math.max(0, T - pt.target);
            ss += (d / pt.sigma) ** 2;
        }
        return pts.length ? Math.sqrt(ss / pts.length) : 0;
    };
    const cases = [
        [RUN23, SPEC, [9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3]],
        [RUN23, SPEC, [7, 15, 15, 15, 15, 7], new Array(5).fill(21)],
        [REAL, SPEC, [5, 11, 11, 11, 10, 5], [4, 9, 11, 10, 8]],
        [{ nH: constIndex(2.20), nL: constIndex(1.45), nSub: constIndex(1.52), lam: 1530 }, { lambda0_nm: 1530, halfPass: 7.5, halfStop: 10 },
            [5, 12, 15, 16, 14, 13, 13, 13, 7], [3, 3, 1, 2, 5, 4, 4, 1]],
    ];
    for (const [M, spec, mirrors, spacers] of cases) {
        const t = buildFilterTarget(spec);
        const ls = layersOf(M, mirrors, spacers);
        ok(Object.is(meritFunctionEmbedded(ls, t, M.nSub), before(ls, t, M.nSub)), `[${mirrors.join(' ')}]/[${spacers.join(' ')}]: bit-identical merit`);
        const parts = meritFunctionParts(ls, t, M.nSub);
        ok(Object.is(parts.mf, parts.mf0) && parts.mfTilt === null, 'with the tilt off the merit is its normal part and the tilted part is null');
    }
    ok(buildFilterTarget(SPEC).tiltDeg === 0, 'the target carries tiltDeg 0 by default');
}

// ── 2. The tilted merit scores the reference designs as the proposal did ──
// OptiLayer's run-3 design, the wizard's all-odd design, a uniform order-5
// design on OptiLayer's mirrors, and the two designs the tolerance search
// returned in the proposal. The mixed-material design of the proposal's table
// is not on record as a vector and is stood in for by the normal-only winner
// it names, whose band at 15° it measured as torn.
console.log('-- reference designs at 15° --');
{
    const t15 = buildFilterTarget({ ...SPEC, tiltDeg: 15 });
    const refs = [
        ['OptiLayer run 3', [9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3], 3.25, 0.263],
        ['all-odd',         [11, 21, 21, 21, 19, 9], [1, 6, 4, 6, 3], 8.18, 0.339],
        ['uniform L5',      [9, 19, 21, 21, 19, 9], [5, 5, 5, 5, 5], 1.68, 1.675],
        ['search, H',       [8, 19, 21, 21, 19, 9], [5, 5, 5, 5, 4], 0.710, 0.674],
        ['search, L',       [7, 17, 19, 19, 17, 8], [7, 7, 8, 7, 6], 0.379, 0.284],
    ];
    const J = {};
    for (const [label, mirrors, spacers, refJ, refMf0] of refs) {
        const p = meritFunctionParts(layersOf(RUN23, mirrors, spacers), t15, RUN23.nSub);
        J[label] = p.mf;
        console.log(`    ${label.padEnd(16)} J ${p.mf.toFixed(3).padStart(6)} (${refJ})   MF0 ${p.mf0.toFixed(3)} (${refMf0})   MF15 ${p.mfTilt.toFixed(3)}`);
        ok(within(p.mf, refJ, 0.05), `${label}: J within 5 % of ${refJ} (got ${p.mf.toFixed(3)})`);
        ok(within(p.mf0, refMf0, 0.02), `${label}: MF0 within 2 % of ${refMf0} (got ${p.mf0.toFixed(4)})`);
    }
    const torn = meritFunctionParts(layersOf(RUN23, [9, 18, 20, 22, 21, 10], [3, 10, 4, 4, 2]), t15, RUN23.nSub);
    console.log(`    normal winner    J ${torn.mf.toFixed(1)}   MF0 ${torn.mf0.toFixed(3)} (0.233)`);
    ok(within(torn.mf0, 0.233, 0.02), `the normal-only winner scores 0.233 at normal (got ${torn.mf0.toFixed(4)})`);
    ok(torn.mf > 10 * J['OptiLayer run 3'], `and more than ten times OptiLayer's J once tilted (got ${torn.mf.toFixed(1)})`);
    // The tolerance angle is a dial: the same design costs less at 10°.
    const t10 = buildFilterTarget({ ...SPEC, tiltDeg: 10 });
    const ol10 = meritFunctionParts(layersOf(RUN23, [9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3]), t10, RUN23.nSub).mf;
    ok(ol10 < J['OptiLayer run 3'] / 2, `OptiLayer's run 3 scores under half its 15° J at 10° (got ${ol10.toFixed(3)})`);
}

// ── 3. The centring follows the design, and the model follows the real filter ──
console.log('-- centring --');
{
    const t15 = buildFilterTarget({ ...SPEC, tiltDeg: 15 });
    for (const [label, mirrors, spacers] of [['OptiLayer run 3', [9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3]], ['search, H', [8, 19, 21, 21, 19, 9], [5, 5, 5, 5, 4]]]) {
        const tilted = tiltedLayers(layersOf(RUN23, mirrors, spacers), 15);
        const { centre, peak } = tiltedBandCentre(tilted, t15, RUN23.nSub);
        const s = airBand(coated(RUN23, mirrors, spacers), RUN23, 15, 's');
        console.log(`    ${label.padEnd(16)} model centre ${centre.toFixed(2)} nm, peak ${(100 * peak).toFixed(1)} %; real 15° s centre ${s.centre.toFixed(2)} nm`);
        ok(Math.abs(centre - s.centre) < 0.1, `${label}: model centre within 0.1 nm of the real 15° band (${centre.toFixed(2)} vs ${s.centre.toFixed(2)})`);
        ok(peak > 0.99, `${label}: the model sees the band survive (peak ${(100 * peak).toFixed(1)} %)`);
    }
    // Every wavelength the tilted evaluation asks the materials for lies above
    // tiltWindowLow, which is what the worker samples its material grid down to.
    let lowest = Infinity;
    const spy = (fn) => (lam) => { lowest = Math.min(lowest, lam); return fn(lam); };
    const M = { nH: spy(RUN23.nH), nL: spy(RUN23.nL), nSub: spy(RUN23.nSub), lam: 600 };
    for (const [mirrors, spacers] of [[[9, 19, 21, 21, 19, 9], [3, 6, 4, 6, 3]], [[9, 18, 20, 22, 21, 10], [3, 10, 4, 4, 2]]]) {
        meritFunctionParts(layersOf(M, mirrors, spacers), t15, M.nSub);
    }
    const low = tiltWindowLow({ lambda0_nm: 600, tiltDeg: 15, nLow: 1.452, halfPass: 1.5, halfStop: 3.0 });
    ok(lowest >= low, `the evaluation never goes below tiltWindowLow (${lowest.toFixed(2)} vs ${low.toFixed(2)})`);
}

// ── 4. Real materials: the ranking survives dispersion ─────────────
// The wizard's default pair. At normal incidence the mixed-spacer design the
// normal-only search returns scores better than the one the 15° search
// returns; tilted, the order reverses, and the real TMM at 15° agrees: the
// first has lost its band, the second keeps it in both polarizations.
console.log('-- dispersive materials (Nb2O5 / SiO2 / BK7) --');
{
    const t15 = buildFilterTarget({ ...SPEC, tiltDeg: 15 });
    const mixed = { mirrors: [5, 11, 11, 11, 10, 5], spacers: [4, 9, 11, 10, 8] };
    const held = { mirrors: [3, 9, 11, 11, 9, 4], spacers: [12, 9, 10, 9, 11] };
    const pm = meritFunctionParts(layersOf(REAL, mixed.mirrors, mixed.spacers), t15, REAL.nSub);
    const ph = meritFunctionParts(layersOf(REAL, held.mirrors, held.spacers), t15, REAL.nSub);
    const hm = holds(REAL, mixed, 15), hh = holds(REAL, held, 15);
    console.log(`    normal-only winner  MF0 ${pm.mf0.toFixed(3)}  J ${pm.mf.toFixed(1)}   real 15° s ${(100 * hm.s.peak).toFixed(1)}/${(100 * hm.s.min).toFixed(1)}  p ${(100 * hm.p.peak).toFixed(1)}/${(100 * hm.p.min).toFixed(1)}`);
    console.log(`    15° search winner   MF0 ${ph.mf0.toFixed(3)}  J ${ph.mf.toFixed(3)}   real 15° s ${(100 * hh.s.peak).toFixed(1)}/${(100 * hh.s.min).toFixed(1)}  p ${(100 * hh.p.peak).toFixed(1)}/${(100 * hh.p.min).toFixed(1)}`);
    ok(pm.mf0 < ph.mf0, 'at normal incidence the mixed-spacer design scores better');
    ok(ph.mf < pm.mf / 10, 'tilted, the held design scores at least ten times better');
    ok(hh.tilt, 'the held design keeps peak ≥ 99 % and min ≥ 95 % at 15° in s and p');
    ok(Math.min(hm.s.min, hm.p.min) < 0.5, 'the mixed-spacer design has lost its band at 15°');
    // The (m, k) table and its quarter-wave stacks behave with dispersive data.
    const fam = buildPrototypeFamily({ nH: REAL.nH, nL: REAL.nL, nSub: REAL.nSub, lambda0_nm: 600, cavities: 5, targetFWHM: 3 });
    let worst = 1;
    for (const r of fam) worst = Math.min(worst, embeddedT(layersOf(REAL, coupledMirrors(5, r.notationM, 1), new Array(5).fill(r.spacerOrder)), 600, REAL.nSub));
    console.log(`    table: ${fam.map(r => `${r.notationM}:${r.spacerOrder}`).join(' ')}   worst embedded T(λ₀) ${worst.toFixed(4)}`);
    ok(fam.length >= 5 && fam[0].spacerOrder === 1, 'the table runs from k = 1 at the strongest mirror');
    ok(worst > 0.99, `every row resonant at λ₀ with dispersive data (worst ${worst.toFixed(4)}; Nb2O5 carries k = 1e-6)`);
    // The bracket read off the layers keeps the found centre inside the scan.
    const tilted = tiltedLayers(layersOf(REAL, held.mirrors, held.spacers), 15);
    const { centre } = tiltedBandCentre(tilted, t15, REAL.nSub);
    ok(Math.abs(centre - hh.s.centre) < 0.1, `model centre within 0.1 nm of the real 15° band (${centre.toFixed(2)} vs ${hh.s.centre.toFixed(2)})`);
}

// ── 5. The 15° search returns a design that meets the spec and holds ──
// Seeded from the m = 11, k = 5 row like the normal-incidence search test.
// The descent from the seed alone reaches [8 19 21 21 19 9]/[5 5 5 5 4], which
// meets both half-widths and holds; the top three is the same with 2, 4 or 6
// restarts (33 s against 46 s single-threaded), so 2 is what runs here. With
// the single-variable sweeps alone the same search stalls at J 1.9, and from
// the m = 9 or 10 rows it reaches J 0.379 with a design that trades 0.2 nm of
// 30 dB width for a flatter tilted band, which is why the seed row is pinned.
console.log('-- 15° search at 600 nm --');
{
    const t15 = buildFilterTarget({ ...SPEC, tiltDeg: 15 });
    const t0 = Date.now();
    const { candidates } = globalIntegerSearch({
        nH: RUN23.nH, nL: RUN23.nL, nSub: RUN23.nSub, lambda0_nm: 600, target: t15,
        cavities: 5, seedMirrors: coupledMirrors(5, 11, 1), seedMirror: 11, seedSpacer: 5,
        restarts: 2, rngSeed: 2026,
    });
    console.log(`    ${candidates.length} candidates in ${Date.now() - t0} ms`);
    const passing = [];
    candidates.slice(0, 3).forEach((cd, i) => {
        const r = holds(RUN23, cd, 15);
        if (r.spec && r.tilt) passing.push(i + 1);
        console.log(`    #${i + 1} J=${cd.mf.toFixed(3)} MF0=${cd.mf0.toFixed(3)} MF15=${cd.mfTilt.toFixed(3)} [${cd.mirrors.join(' ')}]/[${cd.spacers.join(' ')}]  0° ${r.w.pass.toFixed(2)}/${r.w.stop.toFixed(2)}  15° s ${(100 * r.s.min).toFixed(1)} p ${(100 * r.p.min).toFixed(1)}${r.spec && r.tilt ? '   meets spec and holds' : ''}`);
    });
    ok(candidates.every(c => c.mfTilt != null && c.mf >= c.mf0 / 2), 'every candidate carries both parts of its merit');
    ok(passing.length > 0, `a design in the top three meets both half-widths at normal and holds at 15° (met: ${passing.join(',') || 'none'})`);
    ok(candidates.slice(1).every((c, i) => c.mf >= candidates[i].mf), 'the list is sorted on the pooled merit');
}

// ── 6. The compound move reaches OptiLayer's class of design at 1530 nm ──
// From the m = 8, k = 1 seed the single-variable sweeps stall at MF 2 to 6
// (the seed's cavities are first order and every spacer step alone is uphill).
// With the spacer-against-mirror move the search reaches MF 0.43 to 0.57 with
// seven restarts, against OptiLayer's own 0.407 for this specification.
// Measured single-threaded it takes 17 to 20 s; the bound here allows twice
// that for a loaded runner.
console.log('-- 1530 nm search from m = 8, k = 1 --');
{
    const M = { nH: constIndex(2.20), nL: constIndex(1.45), nSub: constIndex(1.52) };
    const target = buildFilterTarget({ lambda0_nm: 1530, halfPass: 7.5, halfStop: 10 });
    const t0 = Date.now();
    const { best } = globalIntegerSearch({
        nH: M.nH, nL: M.nL, nSub: M.nSub, lambda0_nm: 1530, target, cavities: 8,
        seedMirrors: coupledMirrors(8, 8, 1), seedMirror: 8, seedSpacer: 1, restarts: 7, rngSeed: 99,
    });
    const dt = Date.now() - t0;
    console.log(`    best MF ${best.mf.toFixed(4)} [${best.mirrors.join(' ')}]/[${best.spacers.join(' ')}] N=${best.layers} in ${dt} ms`);
    ok(best.mf <= 0.5, `MF ≤ 0.5 from the k = 1 seed (got ${best.mf.toFixed(4)})`);
    ok(Math.max(...best.spacers) >= 3, `the search left first order (spacers ${best.spacers.join(' ')})`);
    ok(dt < 60000, `under 60 s on a loaded runner, 30 s alone (got ${dt} ms)`);
}

if (fails === 0) console.log('\nAll filter-design angle tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }

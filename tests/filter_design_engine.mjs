/**
 * Filter Design engine tests — validated against the LEC25D9-1 reference design.
 *
 *   substrate Glass n=1.52, H n=2.35, L n=1.46, λ₀=600 nm
 *   Δλ@89.13% half = 1.5 nm, Δλ@0.1% half = 4.5 nm, SF=3
 *   recommended cavities ">3" → 4
 *   (m,k) family: 8,1 / 7,3 / 6,5 / 5,9 / 4,16 / 3,27 / 2,44 / 1,72
 *
 * Run: node tests/filter_design_engine.mjs
 */
import {
    constIndex, qwThickness, buildPrototypeLayers, toNDLayers,
    embeddedT, spectrumT, measureWidth, recommendCavities,
    buildPrototypeFamily, buildFilterTarget, meritFunctionEmbedded,
    globalIntegerSearch, adjustToIncidentMedium,
} from '../src/utils/filter/filterDesign.js';

// deterministic RNG for reproducible multistart
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const LAM0 = 600;
const nH = constIndex(2.35), nL = constIndex(1.46), nSub = constIndex(1.52), nAir = constIndex(1.0);

// ── 1. QW thickness ───────────────────────────────────────────────────────────
console.log('— QW thickness —');
ok(near(qwThickness(nH, LAM0), 600 / (4 * 2.35)), 'dH = λ/(4·2.35)');
ok(near(qwThickness(nL, LAM0), 600 / (4 * 1.46)), 'dL = λ/(4·1.46)');

// ── 2. Embedded vs air: the core fix ──────────────────────────────────────────
console.log('— embedded vs air —');
{
    const layers = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: [9, 9, 9, 9, 9], spacers: [1, 1, 1, 1] });
    // scan ±5nm find peak
    let pE = 0, pA = 0;
    for (let lam = LAM0 - 5; lam <= LAM0 + 5; lam += 0.01) {
        pE = Math.max(pE, embeddedT(layers, lam, nSub));
        pA = Math.max(pA, spectrumT(layers, lam, nAir, nSub));
    }
    ok(pE > 0.999, `embedded peak T ≈ 1.0 (got ${pE.toFixed(4)})`);
    ok(pA < 0.98, `air peak T notably lower (got ${pA.toFixed(4)})`);
    console.log(`    embedded peak=${pE.toFixed(4)}  air peak=${pA.toFixed(4)}`);
}

// ── 3. Structure / layer count ────────────────────────────────────────────────
console.log('— structure —');
{
    const layers = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: [7, 7, 7], spacers: [1, 1] });
    // 2 cavities: 3 mirrors (7 each) + 2 spacers = 23 layers
    ok(layers.length === 7 * 3 + 2, `2-cavity 7-layer mirrors → ${7 * 3 + 2} layers (got ${layers.length})`);
    ok(layers[0].tag === 'H', 'first layer is H (spacer-facing material, L-spacer)');
    ok(layers[6].tag === 'H', 'mirror ends in H (both-ends-H)');
    ok(layers[7].tag === 'spacer', 'spacer follows mirror');
    ok(near(layers[7].d, 2 * 1 * qwThickness(nL, LAM0)), 'order-1 L spacer = 2·dL');
}

// ── 4. Cavity recommendation (LEC25D9: SF=3 → 4) ─────────────────────────────
console.log('— cavity recommendation —');
{
    const r = recommendCavities({ shapeFactor: 3 });
    console.log(`    SF=3 → q=${r.q.toFixed(3)}  recommended=${r.recommended}`);
    ok(r.recommended === 4, `SF=3 recommends 4 cavities (got ${r.recommended})`);
    ok(r.q > 2.5 && r.q < 3.5, `raw q≈2.95 (got ${r.q.toFixed(3)})`);
}

// ── 5. (m,k) equivalent family — adapts to target width, all rows resonant ───
console.log('— (m,k) family —');
{
    // LEC25D9: target passband ≈ 2·1.5 = 3 nm → reproduces the reference (m,k) table.
    const fam = buildPrototypeFamily({ nH, nL, nSub, lambda0_nm: LAM0, cavities: 4, targetFWHM: 3 });
    const byM = Object.fromEntries(fam.map(r => [r.notationM, r.spacerOrder]));
    console.log('    narrow rows:', fam.map(r => `M${r.notationM}/k${r.spacerOrder}(${r.width.toFixed(1)})`).join('  '));
    ok(fam.length >= 6, `narrow target yields several rows (got ${fam.length})`);
    ok(byM[8] === 1, `M=8 → Thelen k=1 (got ${byM[8]})`);
    ok(Math.abs((byM[7] ?? 0) - 3) <= 1, `M=7 → k≈3 (reference 3) (got ${byM[7]})`);
    // every row's coupled prototype is at the target width
    for (const r of fam) {
        ok(Math.abs(r.width - 3) <= 1.5, `M=${r.notationM} width ≈ 3 nm (got ${r.width.toFixed(2)})`);
    }
    // rows are distinct (no duplicate m or k)
    const ks = fam.map(r => r.spacerOrder);
    ok(new Set(ks).size === ks.length, `spacer orders are distinct across rows`);

    // ADAPTS: a WIDE target gives a much wider prototype than a narrow one.
    const wide = buildPrototypeFamily({ nH, nL, nSub, lambda0_nm: LAM0, cavities: 5, targetFWHM: 100 });
    console.log('    wide rows:', wide.map(r => `M${r.notationM}/k${r.spacerOrder}(${r.width.toFixed(0)})`).join('  '));
    ok(wide.length >= 1 && wide[0].width > 40, `wide target → wide prototype (got ${wide[0]?.width?.toFixed(0)} nm)`);
}

// ── 6. Filter target + MF sanity ──────────────────────────────────────────────
console.log('— filter target + MF —');
{
    const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 1.5, halfStop: 4.5 });
    ok(target.lambda.length > 10, 'target has samples');
    ok(target.target.some(t => t === 1) && target.target.some(t => t === 0), 'target has pass(1) and stop(0)');
    // The proper COUPLED Thelen prototype (inner mirrors ~2× outer: [9,17,17,17,9],
    // couplingOrder d=1) must score well below a degenerate single-cavity bump.
    // NB: with band-balanced weights the passband counts equally to the stopband,
    // so this assertion exercises a real flat-top vs a broad miss.
    const good = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: [9, 17, 17, 17, 9], spacers: [1, 1, 1, 1] });
    const bad = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: [3, 3], spacers: [1] });
    const mfGood = meritFunctionEmbedded(good, target, nSub);
    const mfBad = meritFunctionEmbedded(bad, target, nSub);
    console.log(`    MF good(coupled[9,17,17,17,9])=${mfGood.toFixed(4)}  MF bad(N=1,g3)=${mfBad.toFixed(4)}`);
    ok(mfGood < mfBad, 'coupled Thelen prototype has lower MF than a degenerate single cavity');
}

// ── 7. Global Integer Search reproduces a near-final LEC25D9 design ──────────
console.log('— global integer search (LEC25D9) —');
{
    const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 1.5, halfStop: 4.5 });
    const t0 = Date.now();
    const { candidates, best } = globalIntegerSearch({
        nH, nL, nSub, lambda0_nm: LAM0, target,
        cavities: 4, seedMirror: 9, seedSpacer: 1,
        restarts: 12, rng: mulberry32(12345),
    });
    const dt = Date.now() - t0;
    console.log(`    ${candidates.length} candidates in ${dt} ms. best MF=${best.mf.toFixed(4)} N=${best.layers} Th=${best.thicknessNm.toFixed(1)}`);
    console.log(`    best mirrors=[${best.mirrors.join(',')}] spacers=[${best.spacers.join(',')}]`);
    console.log('    top 5:', candidates.slice(0, 5).map(c => `MF${c.mf.toFixed(3)}/N${c.layers}`).join('  '));

    // embedded peak T of the best design
    const lay = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: best.mirrors, spacers: best.spacers });
    let pk = 0; for (let lam = LAM0 - 3; lam <= LAM0 + 3; lam += 0.01) pk = Math.max(pk, embeddedT(lay, lam, nSub));
    // rejection at the 0.1% spec edge (±4.5 nm) and deep stop
    const tEdge = embeddedT(lay, LAM0 + 4.5, nSub);
    const tDeep = embeddedT(lay, LAM0 + 9, nSub);
    console.log(`    embedded: peakT=${pk.toFixed(4)}  T(±4.5)=${(tEdge*100).toFixed(2)}%  T(±9)=${(tDeep*100).toFixed(3)}%`);

    ok(best.mf < 0.2, `integer search drives MF below 0.2 (got ${best.mf.toFixed(4)})`);
    ok(pk > 0.99, `best design embedded peak T > 0.99 (got ${pk.toFixed(4)})`);
    ok(tDeep < 0.02, `deep rejection < 2% at ±9 nm (got ${(tDeep*100).toFixed(3)}%)`);
    ok(best.layers >= 35 && best.layers <= 75, `N in reference ballpark 35–75 (got ${best.layers})`);
    // outer mirrors should be weaker (tapered) than inner — Chebyshev shape
    const inner = Math.max(...best.mirrors.slice(1, -1));
    ok(best.mirrors[0] <= inner && best.mirrors[best.mirrors.length - 1] <= inner,
        `outer mirrors ≤ inner (taper): [${best.mirrors.join(',')}]`);
}

// ── 8. Adjust to incident medium (step 6) restores passband T in air ─────────
console.log('— adjust to incident medium (AR / V-coat) —');
{
    const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 1.5, halfStop: 4.5 });
    const { best } = globalIntegerSearch({
        nH, nL, nSub, lambda0_nm: LAM0, target, cavities: 4, seedMirror: 9, seedSpacer: 1,
        restarts: 8, rng: mulberry32(777),
    });
    const filterLayers = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: best.mirrors, spacers: best.spacers });

    const none = adjustToIncidentMedium({ filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, target, mode: 'none' });
    const one = adjustToIncidentMedium({ filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, target, mode: '1layer' });
    const vco = adjustToIncidentMedium({ filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, target, mode: 'vcoat' });
    console.log(`    no-AR peakT=${none.peakT.toFixed(4)}  1-layer peakT=${one.peakT.toFixed(4)}  V-coat peakT=${vco.peakT.toFixed(4)}`);
    console.log(`    V-coat AR layers: ${vco.arLayers.map(l => `${l.arMat}${l.d.toFixed(1)}nm`).join(' + ')}  → N=${vco.layers.length}`);

    ok(none.peakT < 0.99, `no-AR leaves a depressed passband in air (got ${none.peakT.toFixed(4)})`);
    ok(one.peakT >= none.peakT - 1e-6, `1-layer AR ≥ no-AR (got ${one.peakT.toFixed(4)} vs ${none.peakT.toFixed(4)})`);
    ok(vco.peakT > 0.995, `V-coat restores air peak T > 0.995 (got ${vco.peakT.toFixed(4)})`);
    ok(vco.peakT >= one.peakT - 1e-6, `V-coat ≥ 1-layer (got ${vco.peakT.toFixed(4)})`);
    ok(vco.layers.length === filterLayers.length + 2, `V-coat adds 2 layers`);
}

if (fails === 0) console.log('\nAll filter-design engine tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }

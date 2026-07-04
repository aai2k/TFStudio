/**
 * LEC25D9-1 full pipeline demo — narrow band-pass reference design.
 *
 *   Glass n=1.52 | H n=2.35, L n=1.46 | λ₀=600 nm
 *   Δλ@89.13% half = 1.5 nm, Δλ@0.1% half = 4.5 nm, SF=3, 4 cavities
 *
 * Run: node tests/filter_design_lec25d9.mjs
 */
import {
    constIndex, buildPrototypeLayers, embeddedT, spectrumT,
    recommendCavities, buildPrototypeFamily, buildFilterTarget,
    globalIntegerSearch, adjustToIncidentMedium, qwThickness,
} from '../src/utils/filter/filterDesign.js';

const LAM0 = 600;
const nH = constIndex(2.35), nL = constIndex(1.46), nSub = constIndex(1.52), nAir = constIndex(1.0);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

const PASS_HALF = 1.5, STOP_HALF = 4.5;

console.log('============================================================');
console.log(' reference LEC25D9-1  —  TFStudio Filter Design engine');
console.log('============================================================');
console.log(` λ₀=${LAM0} nm   H n=2.35   L n=1.46   substrate n=1.52`);
console.log(` Δλ@89.13% half = ${PASS_HALF} nm   Δλ@0.1% half = ${STOP_HALF} nm   SF=${STOP_HALF/PASS_HALF}`);

// ── Step 3: cavity recommendation ────────────────────────────────────────────
const rec = recommendCavities({ shapeFactor: STOP_HALF / PASS_HALF });
console.log(`\n[Step 3] Recommended cavities: q=${rec.q.toFixed(2)} → ${rec.recommended}   (reference: ">3" → 4)`);
const N = 4;

// ── Step 4: (m,k) prototype family ───────────────────────────────────────────
const fam = buildPrototypeFamily({ nH, nL, nSub, lambda0_nm: LAM0, refMirrorLayers: 9 });
console.log('\n[Step 4] Equivalent (m,k) prototype family   (reference table on the right)');
console.log('   M  | k(ours) | k(reference)');
const optiK = { 8:1, 6:5, 4:16, 2:44 };
for (const r of fam) {
    const o = optiK[r.notationM];
    console.log(`   ${String(r.notationM).padStart(2)} |   ${String(r.spacerOrder).padStart(3)}   |   ${o ?? '·'}`);
}

// ── Step 5: Global Integer Search ────────────────────────────────────────────
const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: PASS_HALF, halfStop: STOP_HALF });
const t0 = Date.now();
const { candidates, best } = globalIntegerSearch({
    nH, nL, nSub, lambda0_nm: LAM0, target, cavities: N,
    seedMirror: 9, seedSpacer: 1, restarts: 16, rng: mulberry32(2025),
});
console.log(`\n[Step 5] Global Integer Search — ${candidates.length} candidates in ${Date.now()-t0} ms`);
console.log('   #  |   MF     |  N  |  Th(nm)  | structure (mirrors / spacers)');
candidates.slice(0, 11).forEach((c, i) => {
    console.log(`  ${String(i+1).padStart(2)}  | ${c.mf.toFixed(5)} | ${String(c.layers).padStart(3)} | ${c.thicknessNm.toFixed(1).padStart(8)} | [${c.mirrors.join(' ')}] / [${c.spacers.join(' ')}]`);
});
console.log(`\n   (reference step-5 list: MF 0.0996 / N 56 best … similar tapered designs)`);

// ── Step 6: Adjust to incident medium (V-coat) ───────────────────────────────
const filterLayers = buildPrototypeLayers({ nH, nL, lambda0_nm: LAM0, mirrors: best.mirrors, spacers: best.spacers });
const none = adjustToIncidentMedium({ filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, target, mode: 'none' });
const vco  = adjustToIncidentMedium({ filterLayers, nH, nL, nInc: nAir, nSub, lambda0_nm: LAM0, target, mode: 'vcoat' });
console.log('\n[Step 6] Adjust to incident medium (air)');
console.log(`   No AR   : air peak T = ${(none.peakT*100).toFixed(2)} %`);
console.log(`   V-coat  : air peak T = ${(vco.peakT*100).toFixed(2)} %   (+ ${vco.arLayers.map(l=>`${l.arMat} ${l.d.toFixed(1)}nm`).join(' / ')})`);
console.log(`   Final design: N = ${vco.layers.length} layers,  Th = ${vco.layers.reduce((s,l)=>s+l.d,0).toFixed(1)} nm   (reference final: N=58, Th=6894.7)`);

// ── Spectrum (ASCII) of the FINAL air design with V-coat ─────────────────────
console.log('\n[Final spectrum]  T(%) of the V-coated design in AIR, 588–612 nm');
const rows = 21;
for (let r = rows; r >= 0; r--) {
    const level = (r / rows) * 100;
    let line = String(Math.round(level)).padStart(3) + ' |';
    for (let lam = 588; lam <= 612; lam += 0.5) {
        const T = spectrumT(vco.layers, lam, nAir, nSub) * 100;
        line += (T >= level - 2.5) ? '#' : ' ';
    }
    console.log(line);
}
let axis = '     ';
for (let lam = 588; lam <= 612; lam += 0.5) axis += (lam % 4 === 0 ? '|' : ' ');
console.log(axis);
console.log('     588      592      596      600      604      608      612  (nm)');

// numeric check points
console.log('\n[Check points] final air design:');
for (const lam of [600, 601.5, 598.5, 604.5, 595.5, 609, 591]) {
    console.log(`   T(${lam.toFixed(1)} nm) = ${(spectrumT(vco.layers, lam, nAir, nSub)*100).toFixed(3)} %`);
}

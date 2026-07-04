/**
 * Filter Design build-bridge tests.
 *   - buildFilterDesignObject → valid Design with continuous TGT operands
 *   - presampleForSearch + interpolating index fn reproduces the direct search
 *     (validates the Web Worker material-crossing path)
 *
 * Run: node tests/filter_design_build.mjs
 */
import { buildFilterDesignObject, buildFilterOperands, presampleForSearch } from '../src/utils/filter/filterDesignBuild.js';
import { globalIntegerSearch, buildFilterTarget, constIndex } from '../src/utils/filter/filterDesign.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const LAM0 = 600;
const fakeMat = (n) => ({ getNK: () => [n, 0] });
const MATS = { H: fakeMat(2.35), L: fakeMat(1.46), Sub: fakeMat(1.52), Air: fakeMat(1.0) };
const resolve = (id) => MATS[id] || MATS.Air;

// ── 1. Continuous TGT operands ────────────────────────────────────────────────
console.log('— continuous operands —');
{
    const ops = buildFilterOperands({ lambda0_nm: LAM0, halfPass: 1.5, halfStop: 4.5 });
    const tgt = ops.filter(o => o.type === 'TGT');
    ok(ops.some(o => o.type === 'DMFS'), 'has DMFS header');
    ok(tgt.length === 3, `3 TGT operands (1 pass + 2 stop), got ${tgt.length}`);
    const pass = tgt.find(o => o.target === 1.0);
    ok(pass && near(pass.lambdaStart, LAM0 - 1.5) && near(pass.lambdaEnd, LAM0 + 1.5), 'passband TGT over [λ₀±1.5], target 1');
    ok(pass.targetEnd === 1.0, 'passband TGT is flat (targetEnd==target)');
    const stops = tgt.filter(o => o.target === 0.0);
    ok(stops.length === 2, '2 stopband TGT target 0');
    ok(ops.some(o => o.type === 'MNT') && ops.some(o => o.type === 'MXT'), 'MNT/MXT constraints present');
}

// ── 2. buildFilterDesignObject shape ──────────────────────────────────────────
console.log('— design object —');
{
    const candidate = { mirrors: [7, 13, 11, 11, 5], spacers: [1, 7, 7, 1] };
    const design = buildFilterDesignObject({
        name: 'LEC25D9', matH: 'H', matL: 'L', substrateMaterial: 'Sub',
        incidentMedium: 'Air', exitMedium: 'Air', lambda0_nm: LAM0,
        candidate, spacerKind: 'L', arMode: 'vcoat', halfPass: 1.5, halfStop: 4.5,
        resolve,
    });
    const mirrorSum = 7 + 13 + 11 + 11 + 5;
    const expected = mirrorSum + candidate.spacers.length + 2; // + V-coat 2 layers
    ok(design.frontLayers.length === expected, `frontLayers = ${expected} (got ${design.frontLayers.length})`);
    ok(design.referenceWavelength === LAM0, 'referenceWavelength = λ₀');
    ok(design.substrate.material === 'Sub', 'substrate carried');
    ok(design.surfaceMode === 'front_only', 'front_only');
    ok(design.frontLayers.every(l => l.material === 'H' || l.material === 'L'), 'all layers map to H or L material');
    ok(design.frontLayers.every(l => l.thickness > 0), 'all thicknesses positive');
    ok(design.meritOperands.some(o => o.type === 'TGT' && o.target === 1.0), 'has passband TGT');
    ok(design.filterRecipe && design.filterRecipe.mirrors.length === 5, 'filterRecipe persisted');
    // first layer is air-adjacent (V-coat outer); last touches substrate
    ok(design.frontLayers.length > 0, 'has layers');
}

// ── 3. Pre-sample + interp reproduces direct search (worker path) ─────────────
console.log('— presample/interp equivalence —');
{
    const nH = constIndex(2.35), nL = constIndex(1.46), nSub = constIndex(1.52);
    const target = buildFilterTarget({ lambda0_nm: LAM0, halfPass: 1.5, halfStop: 4.5 });
    const searchArgs = {
        cavities: 4, seedMirror: 9, seedSpacer: 1, restarts: 4,
        rng: (() => { let a = 99; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(),
    };
    // direct
    const direct = globalIntegerSearch({ ...searchArgs, nH, nL, nSub, lambda0_nm: LAM0, target,
        rng: mk(99) });
    // interp from presample
    const tables = presampleForSearch({ matH: 'H', matL: 'L', substrateMaterial: 'Sub', lamLo: 560, lamHi: 640, step: 0.05, resolve });
    const interp = (grid) => { const Lx = grid.lambdas, arr = grid.nk, n = Lx.length; return (lam) => { if (lam <= Lx[0]) return arr[0]; if (lam >= Lx[n-1]) return arr[n-1]; let lo=0,hi=n-1; while(hi-lo>1){const m=(lo+hi)>>1; if(Lx[m]<=lam)lo=m;else hi=m;} const t=(lam-Lx[lo])/(Lx[hi]-Lx[lo]||1); const a=arr[lo],b=arr[hi]; return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]; }; };
    const iH = interp({ lambdas: tables.lambdas, nk: tables.H });
    const iL = interp({ lambdas: tables.lambdas, nk: tables.L });
    const iS = interp({ lambdas: tables.lambdas, nk: tables.Sub });
    const viaInterp = globalIntegerSearch({ ...searchArgs, nH: iH, nL: iL, nSub: iS, lambda0_nm: LAM0, target,
        rng: mk(99) });
    console.log(`    direct best MF=${direct.best.mf.toFixed(6)}  interp best MF=${viaInterp.best.mf.toFixed(6)}`);
    ok(near(direct.best.mf, viaInterp.best.mf, 1e-9), 'interp search MF matches direct (const materials → exact)');
    ok(direct.best.mirrors.join() === viaInterp.best.mirrors.join(), 'interp search finds same structure');
}

function mk(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

if (fails === 0) console.log('\nAll filter-design build tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }

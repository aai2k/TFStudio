/**
 * Where does needle/GE synthesis spend time as N grows?
 *
 * Hypothesis: TGT (range-target) operands disable the analytic P-function
 * (scanNeedlesAnalytic returns null on isRamp → scanNeedlesFD), so TGT synthesis
 * runs the SLOW finite-difference needle scan (~10–100× the analytic one per
 * CLAUDE.md). This times, on a ~40-layer stack:
 *   (a) needle scan with TGT operands  → FD path
 *   (b) needle scan with TAV operands  → analytic path (same bands)
 *   (c) one CG candidate refine
 * to see whether the FD scan is the dominant per-generation cost.
 *
 * Run: node tests/synthesis_scan_profile.mjs
 */
import {
  makeOperand, scanNeedlesPFunction, scanNeedlesAnalytic, calcMF,
  buildEvalContext, evaluateOperands,
} from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

const POOL = [
  { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
  { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];

function stack(N) {
  const fr = Array.from({ length: N }, (_, i) => {
    const hi = i % 2 === 0;
    const q = 550 / (4 * (hi ? 2.35 : 1.46));
    return { id: 'L' + i, material: hi ? 'TiO2' : 'SiO2', thickness: q * (1 + 0.1 * Math.sin(i)), locked: false };
  });
  return { incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
           frontLayers: fr, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side' };
}

const bands = [[445,455,1],[505,515,1],[635,645,1],[400,440,0],[460,500,0],[520,630,0],[650,700,0]];
const opsOf = (type) => bands.map(([a,b,t]) => makeOperand({ type, lambdaStart:a, lambdaEnd:b, aoi:0, pol:'avg', target:t, targetEnd: type==='TGT'?t:null, weight:1 }));
const TGT = opsOf('TGT');
const TAV = opsOf('TAV');

const time = (fn, reps=5) => { const t=now(); for(let i=0;i<reps;i++) fn(); return (now()-t)/reps; };

console.log('=== Synthesis per-generation cost vs N (pure-JS TMM) ===');
for (const N of [20, 40, 60]) {
  const design = stack(N);
  // (a) FD scan (TGT)
  const tgtAnalytic = scanNeedlesAnalytic({ operands: TGT, design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
  const tFD = time(() => scanNeedlesPFunction({ operands: TGT, design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' }));
  // (b) analytic scan (TAV)
  const tAN = time(() => scanNeedlesPFunction({ operands: TAV, design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' }));
  // (c) one CG refine (40 iters) on the TGT MF
  const tRef = time(() => { const o = makeEngine('cg', TGT, design, resolveMat, { dMin: 5 }); let it=0; while(it<40 && !o.isConverged()){o.step();it++;} }, 3);
  console.log(`N=${String(N).padStart(3)}  TGT-scan(FD)=${tFD.toFixed(1).padStart(7)}ms  TAV-scan(analytic)=${tAN.toFixed(1).padStart(6)}ms  CGrefine(40it)=${tRef.toFixed(1).padStart(7)}ms  | TGT analytic available? ${tgtAnalytic ? 'YES' : 'NO (→FD)'}  FD/analytic≈${(tFD/Math.max(tAN,0.01)).toFixed(0)}×`);
}

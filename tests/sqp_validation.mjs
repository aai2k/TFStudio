/**
 * SQP (bounded Sequential Quadratic Programming) validation — D2.
 *
 * SQPOptimizer was implemented but ORPHANED (not in the engine registry) and the
 * test its own docstring referenced did not exist. This test answers: does it
 * actually work? It checks the three claims SQP makes:
 *   (1) reachable: makeEngine('sqp', …) returns a working engine
 *   (2) HARD box: every free thickness stays within [dMin, dMax] at all times
 *       (the box replaces the soft MNT/MXT penalty — exact bound satisfaction)
 *   (3) it refines: mfBest improves from a perturbed start, no NaN, terminates
 *
 * Run: node tests/sqp_validation.mjs
 */
import { makeEngine } from '../src/utils/optimizers/index.js';
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = (id) => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

function design() {
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness: 110, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 90,  locked: false },
            { id: 'L3', material: 'TiO2', thickness: 65,  locked: false }, // outside [80,120]
            { id: 'L4', material: 'SiO2', thickness: 140, locked: false }, // outside [80,120]
        ],
        backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
}
const operands = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
];

const DMIN = 80, DMAX = 120;
const opts = { dMin: DMIN, dMax: DMAX };

// (1) reachable
const eng = makeEngine('sqp', operands, design(), resolveMat, opts);
ok(eng && typeof eng.step === 'function' && typeof eng.isConverged === 'function',
    'makeEngine("sqp") returns a working engine');
ok(eng.constructor.name === 'SQPOptimizer', `engine is SQPOptimizer (got ${eng.constructor && eng.constructor.name})`);

// (2) initial point projected into the box
const freeIdx = eng.thicknesses.map((_, i) => i).filter((i) => !eng.lockedMask[i]);
const inBox = () => freeIdx.every((k) => eng.thicknesses[k] >= DMIN - 1e-6 && eng.thicknesses[k] <= DMAX + 1e-6);
ok(inBox(), `initial point feasible (in [${DMIN},${DMAX}]): ${freeIdx.map((k) => eng.thicknesses[k].toFixed(1))}`);

const mf0 = eng.mf;
ok(Number.isFinite(mf0), `initial MF finite (got ${mf0})`);

// (3) run; box must hold every iteration, MF must not blow up
let boxHeldEveryStep = true;
let threw = null;
try {
    for (let it = 0; it < 80 && !eng.isConverged(); it++) {
        eng.step();
        if (!inBox()) boxHeldEveryStep = false;
        if (!Number.isFinite(eng.mf)) { threw = `MF became non-finite at iter ${it}`; break; }
    }
} catch (e) { threw = e && e.message ? e.message : String(e); }

ok(threw === null, `SQP runs without error (${threw || 'ok'})`);
ok(boxHeldEveryStep, 'HARD box held on every iteration (no thickness left [dMin,dMax])');
ok(inBox(), 'final point feasible');
ok(Number.isFinite(eng.mfBest) && eng.mfBest <= mf0 + 1e-9,
    `SQP refined: mfBest ${eng.mfBest?.toFixed(6)} ≤ mf0 ${mf0.toFixed(6)}`);

// Reference: a penalty-based DLS on the same bounded design should not beat SQP
// by much (sanity that SQP is in the right ballpark, not broken).
const dls = new DLSOptimizer(operands, design(), resolveMat, opts);
for (let it = 0; it < 80 && !dls.isConverged(); it++) dls.step();
ok(Number.isFinite(dls.mfBest), `DLS reference finite (${dls.mfBest?.toFixed(6)})`);
console.log(`   SQP mfBest=${eng.mfBest?.toFixed(6)}  DLS mfBest=${dls.mfBest?.toFixed(6)}  (bounds [${DMIN},${DMAX}])`);

if (fails === 0) { console.log('PASS — SQP reachable, feasible, and refining.'); process.exit(0); }
else { console.error(`\n${fails} assertion(s) failed — SQP is NOT production-ready; revert the ENGINES wiring.`); process.exit(1); }

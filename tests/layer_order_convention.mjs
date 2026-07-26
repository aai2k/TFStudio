/**
 * Layer-order convention guard.
 *
 * TFStudio stores a front coating air→substrate: `frontLayers[0]` touches the
 * incident medium and the last entry touches the substrate. The Design Editor
 * displays that list reversed, so the row it labels "1" is the substrate-adjacent
 * layer — the one a chamber deposits first.
 *
 * Modules that reason in build/deposition order (the monitoring simulators, the
 * WDM stack builder) have to convert when they hand an array to the TMM. This
 * test pins the invariants that make those conversions checkable, including the
 * one that holds regardless of which end of the array you call "first":
 *
 *   while a layer is growing it is the OUTERMOST layer — everything already
 *   deposited lies between it and the substrate.
 *
 * Run: node tests/layer_order_convention.mjs
 */

import { tmm, createMonitorTmmEvaluator } from '../src/utils/physics/thinFilmMath.js';
import { partialThicknesses } from '../src/utils/monitoring/depositionSpectrum.js';
import { buildWDMStack } from '../src/utils/filter/wdmDesigner/stack.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const LAM = 550;
const METAL = [1, 10];      // strongly absorbing; air|metal R = 100/104 analytically
const DIEL = [2.3, 0];
const AIR_METAL_R = 100 / 104;
const TOL = 1e-9;

let fails = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
    if (!ok) fails++;
};

// ── 1. Array index 0 is the incident-adjacent layer ──────────────────────────
// Anchors every other claim here. An opaque metal at index 0 must reproduce the
// analytic air/metal interface reflectance; behind a dielectric it cannot.
{
    const metalFirst = tmm(LAM, 0, 's', [1, 0], [1.52, 0], [{ n: METAL, d: 200 }, { n: DIEL, d: 100 }]);
    const dielFirst  = tmm(LAM, 0, 's', [1, 0], [1.52, 0], [{ n: DIEL, d: 100 }, { n: METAL, d: 200 }]);
    check('tmm: layers[0] faces the incident medium',
        Math.abs(metalFirst.R - AIR_METAL_R) < 1e-6 && Math.abs(dielFirst.R - AIR_METAL_R) > 1e-4,
        `R=${metalFirst.R.toFixed(6)} vs analytic ${AIR_METAL_R.toFixed(6)}`);
}

// ── 2. The growing layer is the outermost one ────────────────────────────────
// Convention-free: a layer cannot be deposited underneath one that already
// exists, so the completed stack must sit between it and the substrate.
{
    const mk = (nk) => ({ getNK: () => nk });
    const ev = createMonitorTmmEvaluator(0, mk([1, 0]), mk([1.52, 0]), [mk(DIEL)], [100], [LAM]);
    const monitor = ev.sample('R', 's', mk(METAL), 200)[0];

    const growingOutermost = tmm(LAM, 0, 's', [1, 0], [1.52, 0], [{ n: METAL, d: 200 }, { n: DIEL, d: 100 }]);
    const growingBuried    = tmm(LAM, 0, 's', [1, 0], [1.52, 0], [{ n: DIEL, d: 100 }, { n: METAL, d: 200 }]);

    check('monitor evaluator: growing layer sits above the completed stack',
        Math.abs(monitor - growingOutermost.R) < TOL,
        `monitor R=${monitor.toFixed(9)}, outermost=${growingOutermost.R.toFixed(9)}, buried=${growingBuried.R.toFixed(9)}`);
}

// ── 3. Deposition layer 1 is the substrate-adjacent entry ────────────────────
{
    const thk = partialThicknesses([11, 99], 1, 1);           // storage: [air-side, substrate-side]
    check('partialThicknesses: layer 1 = substrate-adjacent',
        thk.length === 2 && thk[0] === 0 && thk[1] === 99,
        `got ${JSON.stringify(thk)}, expected [0,99]`);

    const half = partialThicknesses([11, 99], 2, 0.5);        // layer 2 half-grown, layer 1 complete
    check('partialThicknesses: layer 2 grows on top of a complete layer 1',
        half[0] === 5.5 && half[1] === 99,
        `got ${JSON.stringify(half)}, expected [5.5,99]`);
}

// ── 4. WDM builder emits storage order ───────────────────────────────────────
// The builder assembles substrate-side first and adds the AR layer facing air,
// so after conversion the AR quarter-wave must be at index 0.
{
    const stack = buildWDMStack({
        matH: 'Ta2O5', matL: 'SiO2', lambda0_nm: 1550,
        cavities: 2, mirrorPairs: 4, spacerOrder: 1, spacerKind: 'H', includeAR: true,
    });
    const first = stack.layers[0].material;
    const last = stack.layers[stack.layers.length - 1].material;
    // H spacer ⇒ M_1 = (HL)^k starts H against the substrate; AR is a QW of L on air.
    check('WDM: AR layer faces the incident medium', first === 'SiO2', `frontLayers[0]=${first}`);
    check('WDM: mirror M_1 faces the substrate', last === 'Ta2O5', `last layer=${last}`);

    // Orientation must actually matter for this design, or the check above is vacuous.
    const inc = getMaterial('Air'), sub = getMaterial('BK7');
    const toL = (arr) => arr.map(l => ({ n: getMaterial(l.material).getNK(1550), d: l.thickness }));
    const fwd = tmm(1550, 0, 's', inc.getNK(1550), sub.getNK(1550), toL(stack.layers));
    const rev = tmm(1550, 0, 's', inc.getNK(1550), sub.getNK(1550), toL([...stack.layers].reverse()));
    check('WDM: the two orientations are optically distinct',
        Math.abs(fwd.T - rev.T) > 1e-6, `ΔT=${Math.abs(fwd.T - rev.T).toExponential(2)}`);
}

if (fails === 0) { console.log('\nPASS ✅  layer-order conventions hold'); process.exit(0); }
console.log(`\nFAIL ❌  ${fails} invariant${fails === 1 ? '' : 's'} violated`);
process.exit(1);

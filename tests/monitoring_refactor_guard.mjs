/**
 * Monitoring refactor guard — a SWIFT before/after identity check for the
 * deposition-simulation engines (monoSim, monitoringSim).
 *
 * These engines are large seeded state machines (turning/level cut detection,
 * OU-correlated rate noise, drift, shutter delay). Their dedicated tests are
 * sanity/tolerance gates, NOT bit-identical — so when refactoring the monster
 * `simulateRun*` functions we need to confirm the exact numeric trajectory did
 * not move. Every run here uses a FIXED seeded RNG (mulberry32), so the output
 * is fully reproducible: `asBuiltFront`, `cutTimes`, and realized `rates` are
 * snapshotted to a golden JSON and compared at 1e-9.
 *
 * Update the baseline INTENTIONALLY (after a verified, deliberate change):
 *   node tests/monitoring_refactor_guard.mjs --update
 * Run the guard:
 *   node tests/monitoring_refactor_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulateRunMono as simMono, defaultMonoTable } from '../src/utils/monitoring/monoSim.js';
import { simulateRun as simBBM, mulberry32 } from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'monitoring_refactor_guard.golden.json');
const UPDATE = process.argv.includes('--update');
const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

const bbarDesign = () => ({
    id: 'bbar1', name: 'BBAR', referenceWavelength: 550,
    substrate: { material: 'BK7', thickness: 1.0 },
    incidentMedium: 'Air', exitMedium: 'Air',
    frontLayers: [{ id: 'L1', material: 'MgF2', thickness: 99.78, locked: false }],
    backLayers: [], surfaceMode: 'front_only',
    meritOperands: [{ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1, enabled: true }],
});

const fourLayerDesign = () => ({
    id: '4L', name: '4-layer', referenceWavelength: 550,
    substrate: { material: 'BK7', thickness: 1.0 },
    incidentMedium: 'Air', exitMedium: 'Air',
    frontLayers: [
        { id: 'L1', material: 'TiO2', thickness:  60, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 100, locked: false },
        { id: 'L3', material: 'TiO2', thickness:  80, locked: false },
        { id: 'L4', material: 'SiO2', thickness: 110, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only',
    meritOperands: [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1, enabled: true }],
});

const RATES = () => new Map([
    ['MgF2', { mean: 0.5, sigma: 0.02, corrTime: 5 }],
    ['TiO2', { mean: 0.4, sigma: 0.02, corrTime: 5 }],
    ['SiO2', { mean: 0.5, sigma: 0.02, corrTime: 5 }],
]);

// Snapshot the numeric trajectory of one run (rounded fields only).
function snap(res) {
    return {
        asBuilt: Array.from(res.asBuiltFront || []),
        cut:     Array.from(res.cutTimes || []),
        rates:   res.rates ? Array.from(res.rates) : null,
    };
}

function runMono(design, randomPct, seed) {
    return snap(simMono(design, resolveMat, {
        rates: RATES(), perMaterial: true,
        monTable: defaultMonoTable(design, resolveMat, { autoPickLambda: false }),
        mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 0.25, confirmScans: 2 },
        sig: { randomPct, driftPctPer1000s: 0 },
        recordTrajectory: true, rng: mulberry32(seed),
    }));
}

function runBBM(design, randomPct, seed) {
    return snap(simBBM(design, resolveMat, {
        rates: RATES(), sigmaReN: 0, sigmaImN: 0, sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: { char: 'T', theta: 0, polarization: 'avg',
               lambdaStart: 400, lambdaEnd: 800, nPoints: 21, scanIntervalSec: 0.4 },
        sig: { randomPct, driftPctPer1000s: 0 },
        rng: mulberry32(seed),
    }));
}

const ENGINES = { mono: runMono, bbm: runBBM };
const DESIGNS = { bbar: bbarDesign, '4L': fourLayerDesign };

const results = {};
for (const [ename, run] of Object.entries(ENGINES)) {
    for (const [dname, mkDesign] of Object.entries(DESIGNS)) {
        for (const noise of [0, 0.5]) {
            results[`${ename} | ${dname} | noise=${noise}`] = run(mkDesign(), noise, 20260709);
        }
    }
}

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} monitoring golden: ${GOLDEN}`);
    console.log(`  ${Object.keys(results).length} (engine × design × noise) entries.`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const REL = 1e-9;
const relDiff = (a, b) => Math.abs(a - b) / (Math.max(Math.abs(a), Math.abs(b)) + 1e-30);
let maxDelta = 0, fails = 0, checked = 0;

const cmpArr = (g, c) => {
    if (!g && !c) return 0;
    if (!g || !c || g.length !== c.length) return Infinity;
    let d = 0; for (let i = 0; i < g.length; i++) d = Math.max(d, relDiff(g[i], c[i]));
    return d;
};

for (const key of Object.keys(golden)) {
    const g = golden[key], c = results[key];
    checked++;
    if (!c) { console.log(`MISSING ❌  ${key}`); fails++; continue; }
    const d = Math.max(cmpArr(g.asBuilt, c.asBuilt), cmpArr(g.cut, c.cut), cmpArr(g.rates, c.rates));
    maxDelta = Math.max(maxDelta, d);
    if (d > REL) {
        fails++;
        console.log(`DRIFT ❌  ${key}: max relΔ=${d.toExponential(2)}`);
        console.log(`          golden asBuilt=${JSON.stringify(g.asBuilt)}`);
        console.log(`          current asBuilt=${JSON.stringify(c.asBuilt)}`);
    }
}
for (const key of Object.keys(results)) {
    if (!(key in golden)) { console.log(`NEW (not in golden) ⚠  ${key} — run with --update`); fails++; }
}

console.log(`\nChecked ${checked} entries · max relΔ = ${maxDelta.toExponential(2)} · tolerance ${REL.toExponential(0)}`);
if (fails === 0) { console.log('PASS ✅  monitoring sim trajectories identical to golden'); process.exit(0); }
console.log(`FAIL ❌  ${fails} entr${fails === 1 ? 'y' : 'ies'} drifted — investigate or --update if intentional`);
process.exit(1);

/**
 * The wizard's signal-vs-thickness preview grid: the exact target thickness
 * must be one of the samples. The axis tooltip snaps to samples, and the
 * target falls between two samples of the even grid, so without its own
 * sample the readout could never land on the marked cut line.
 *
 * Run: node tests/mono_wizard_preview.mjs
 */
import { monoSignalVsThickness } from '../src/components/windows/simulation/monoWizard/monoSignalModel.js';

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.30), L: mk(1.46) };
const resolveMat = (id) => MATS[id] || MATS.Air;

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const layers = [
    { material: 'H', thickness: 59.78 },
    { material: 'L', thickness: 93.3 },
    { material: 'H', thickness: 59.78 },
];
const ctx = { resolveMat, incidentMatActive: MATS.Air, subMat: MATS.BK7, subThk: 1 };
const common = { char: 'T', aoi: 0, pol: 'avg' };

for (const noisePct of [0, 0.5]) {
    const label = noisePct ? 'noisy preview' : 'ideal preview';
    // Deposition layer 2 is storage index 1: thickness 93.3, off the even grid.
    const preview = monoSignalVsThickness({ layers, k: 2, monRow: { lambda: 550 }, common, ctx, noisePct, nonce: 1 });
    ok(preview.dTarget === 93.3, `${label}: target thickness carried through`);
    ok(preview.d.includes(93.3), `${label}: the exact target thickness is a sample`);
    ok(preview.d.every((d, i) => i === 0 || d > preview.d[i - 1]), `${label}: samples strictly increasing`);
    ok(preview.d.length === preview.signal.length && preview.signal.every(Number.isFinite),
       `${label}: one finite signal value per sample`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

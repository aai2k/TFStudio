/**
 * Process Exporter: the .res files of a run are computed in one pass over the
 * growing stack and equal the per-step evaluation they replaced.
 *
 *   - front side with the opposite side coated: one growing stack over the
 *     fixed back coating;
 *   - witness chips: one pass per chip, on the chip glass at the witness
 *     thickness;
 *   - back side: evaluated step by step, and still right;
 *   - the same with the WASM growing kernels on, at the kernel's rounding;
 *   - the files come in order with a running count, which is what lets the
 *     window hand the UI a turn between them.
 *
 * Run: node tests/process_export_one_pass.mjs
 */
import {
    buildAllProcessFiles, buildResFileContent, processFileSteps,
} from '../src/utils/io/processFileExport.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { getTmmWasm, initWasmForTest } from './_wasmInit.mjs';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const H = 'builtin:TiO2';
const L = 'builtin:SiO2';
const N = 12;

// Storage order: front layers air first, back layers substrate first. The
// design is embedded in glass; the export reads it in air regardless.
function design() {
    const front = [];
    for (let i = 0; i < N; i++) {
        front.push({ id: `f${i}`, material: i % 2 ? L : H, thickness: i % 2 ? 95 : 60 });
    }
    return {
        id: 'one-pass', name: 'One pass', referenceWavelength: 550,
        incidentMedium: 'builtin:BK7', exitMedium: 'builtin:BK7',
        substrate: { material: 'builtin:BK7', thickness: 1 },
        frontLayers: front,
        backLayers: [
            { id: 'b0', material: 'builtin:MgF2', thickness: 95 },
            { id: 'b1', material: H, thickness: 60 },
        ],
    };
}
const OPTS = {
    activeSide: 'front', secondSurface: 'coated', quantity: 'T', aoi: 12, polarization: 'avg',
    lambdaStart: 450, lambdaEnd: 650, lambdaStep: 5,
    outputDir: 'X:/out', appVersion: 'test', projectLabel: 'One pass',
};

// The per-step evaluation the one pass replaced: every file's spectrum from
// its own partial stack, through the same formatter. `layers` is the run in
// deposition order, `other` the opposite side's layers in their own
// deposition order.
function perStepFiles(d, opts, layers, other, substrateMaterial) {
    const resolve = designMaterialLookup(d);
    const asLayer = l => ({ materialId: l.material, thickness: l.thickness, matObj: resolve(l.material) });
    const cfg = {
        designName: d.name, controlLambda: d.referenceWavelength,
        aoi: opts.aoi, polarization: opts.polarization, quantity: opts.quantity,
        lambdaStart: opts.lambdaStart, lambdaEnd: opts.lambdaEnd, lambdaStep: opts.lambdaStep,
        allLayers: layers.map(asLayer), otherSideLayers: other.map(asLayer), activeSide: opts.activeSide,
        substrateMat: resolve(substrateMaterial), substrateThk: d.substrate.thickness,
        incidentMat: resolve('Air'), exitMat: resolve('Air'),
        outputDir: opts.outputDir, appVersion: opts.appVersion, projectLabel: opts.projectLabel,
    };
    return layers.map((_, i) => buildResFileContent({ ...cfg, stepK: i + 1 }));
}

// Everything in a file but its timestamp, its comment line and its folder,
// split into the text and the spectrum rows.
function parts(content) {
    const text = [];
    const rows = [];
    content.split('\r\n').forEach((line, i) => {
        const row = /^\s*(\d+\.\d{4})\s+(\d+\.\d{5})$/.exec(line);
        if (row) rows.push([Number(row[1]), Number(row[2])]);
        else if (i !== 1 && !line.startsWith('Comment: ') && !line.startsWith('Output directory:')) {
            text.push(line);
        }
    });
    return { text: text.join('\n'), rows };
}

// One unit in the fifth decimal of a percentage: the kernels agree to 1e-13,
// but a value sitting on a rounding boundary may print one digit apart.
const TOL = 1.5e-5;

function sameFiles(a, b) {
    if (a.length !== b.length || a.length === 0) return false;
    return a.every((content, k) => {
        const pa = parts(content);
        const pb = parts(b[k]);
        return pa.text === pb.text && pa.rows.length === pb.rows.length && pa.rows.length > 0
            && pa.rows.every((r, i) => r[0] === pb.rows[i][0] && Math.abs(r[1] - pb.rows[i][1]) <= TOL);
    });
}

function check(label) {
    const d = design();
    const frontDep = [...d.frontLayers].reverse();
    const backDep = d.backLayers.slice();
    const contents = (opts) => buildAllProcessFiles(d, opts).map(f => f.content);

    ok(sameFiles(contents(OPTS), perStepFiles(d, OPTS, frontDep, backDep, d.substrate.material)),
       `${label}: front side over a coated back, one pass equals per step`);

    const reflect = { ...OPTS, quantity: 'R', secondSurface: 'bare' };
    ok(sameFiles(contents(reflect), perStepFiles(d, reflect, frontDep, [], d.substrate.material)),
       `${label}: reflectance on a bare back too`);

    const back = { ...OPTS, activeSide: 'back' };
    ok(sameFiles(contents(back), perStepFiles(d, back, backDep, frontDep, d.substrate.material)),
       `${label}: back side, evaluated step by step`);

    const chips = {
        chipByStep: frontDep.map((_, i) => (i % 3 === 2 ? 2 : 1)),
        chipMaterial: 'builtin:Al2O3', witnessRatio: 1.3,
    };
    const files = buildAllProcessFiles(d, { ...OPTS, chips });
    for (const chip of [1, 2]) {
        const steps = chips.chipByStep.map((c, i) => (c === chip ? i : -1)).filter(i => i >= 0);
        const chipLayers = steps.map(i => ({ ...frontDep[i], thickness: frontDep[i].thickness * 1.3 }));
        const got = files.filter(f => f.subdir === `chip-${chip}`).map(f => f.content);
        ok(sameFiles(got, perStepFiles(d, OPTS, chipLayers, [], 'builtin:Al2O3')),
           `${label}: chip ${chip} on its glass at the witness thickness, one pass equals per step`);
    }
}

// ── The order the files come in ──────────────────────────────────────────────
{
    const d = design();
    const steps = [...processFileSteps(d, OPTS)];
    ok(steps.map(s => s.index).join() === steps.map((_, i) => i + 1).join()
        && steps.every(s => s.total === N),
       'the files come in order with a running count out of the run');
    ok(steps.map(s => s.file.filename).join(' ') === buildAllProcessFiles(d, OPTS).map(f => f.filename).join(' '),
       'and are the files the save writes');
    const chips = { chipByStep: [...Array(N)].map((_, i) => (i < 5 ? 1 : 2)), chipMaterial: null, witnessRatio: 1 };
    const onChips = [...processFileSteps(d, { ...OPTS, chips })];
    ok(onChips.map(s => s.index).join() === steps.map(s => s.index).join() && onChips.every(s => s.total === N),
       'on witness chips the count runs over the whole run, not per chip');
}

// ── One pass equals per step, in JS and on the WASM kernels ─────────────────
check('JS');
const active = await initWasmForTest();
if (active && getTmmWasm().hasGrowingKernels?.()) check('WASM');
else console.log('SKIP  WASM growing kernels not available; JS path checked only');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

/**
 * Process Exporter: the piece in the chamber is read in air, and a witness-chip
 * run writes each chip as its own short coating.
 *
 *   - a design embedded in glass exports the spectra of the same run in air;
 *   - on witness chips every layer still gets a file, each chip gets a folder,
 *     a chip's file is the chip's own stack on bare glass and nothing else, and
 *     the comment line maps it back to the design layer;
 *   - the chip receives the witness thickness on the chip glass;
 *   - the window model's step spectra agree with its live spectrum on every
 *     chip.
 *
 * Run: node tests/process_export_chips.mjs
 */
import { buildAllProcessFiles } from '../src/utils/io/processFileExport.js';
import {
    buildDepositionModel, computeSpectrum, computeStepSpectra, evaluatedMaterials,
} from '../src/components/windows/dataExchange/processSimulator/model.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const H = 'builtin:TiO2';
const L = 'builtin:SiO2';

// `layers` in deposition order; storage is air -> substrate, so the first
// deposited layer is last.
function design(incident, layers) {
    return {
        id: 'p', name: 'Process test', referenceWavelength: 550,
        incidentMedium: incident, exitMedium: incident,
        substrate: { material: 'builtin:BK7', thickness: 1 },
        frontLayers: layers.slice().reverse().map((l, i) => ({ id: `l${i}`, ...l })),
        backLayers: [{ id: 'b0', material: H, thickness: 80 }],
    };
}
const DEP = [
    { material: H, thickness: 60 }, { material: L, thickness: 100 }, { material: H, thickness: 70 },
    { material: L, thickness: 110 }, { material: H, thickness: 65 },
];
const OPTS = {
    activeSide: 'front', secondSurface: 'bare', quantity: 'T', aoi: 0, polarization: 'avg',
    lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20,
};

// The header carries a timestamp; the spectrum block is what the monitor reads.
const spectrumOf = content => content.slice(content.indexOf('Spectral characteristics'));
const headerOf = content => content.slice(0, content.indexOf('Spectral characteristics'));

// ── 1. The piece sits in the chamber, in air ─────────────────────────────────
{
    const inAir = buildAllProcessFiles(design('Air', DEP), OPTS);
    const embedded = buildAllProcessFiles(design('builtin:BK7', DEP), OPTS);
    ok(inAir.length === 5 && embedded.length === 5, 'one file per deposited layer');
    ok(inAir.every((f, i) => spectrumOf(f.content) === spectrumOf(embedded[i].content)),
       'a design embedded in glass exports the spectra of the same run in air');
    ok(inAir.every(f => f.subdir === undefined), 'the part goes in the chosen folder itself');
}

// ── 2. Witness chips ──────────────────────────────────────────────────────────
{
    const chips = { chipByStep: [1, 1, 2, 2, 1], chipMaterial: null, witnessRatio: 1 };
    const files = buildAllProcessFiles(design('builtin:BK7', DEP), { ...OPTS, chips });
    ok(files.length === 5, 'every layer still gets a file');
    ok(files.map(f => `${f.subdir}/${f.filename}`).join(' ')
        === 'chip-1/01.res chip-1/02.res chip-1/03.res chip-2/01.res chip-2/02.res',
       'chips are folders, numbered from 01 on each chip');
    // Chip 1 carries deposition layers 1, 2 and 5: its third file is that stack
    // alone, on bare glass in air.
    const alone = buildAllProcessFiles(design('Air', [DEP[0], DEP[1], DEP[4]]), OPTS);
    ok(spectrumOf(files[2].content) === spectrumOf(alone[2].content),
       "a chip's file is the chip's own stack and nothing else");
    ok(headerOf(files[2].content).includes(
        'Comment: Witness chip 1, layer 3 of 3 on the chip: design layer 5 of 5'),
       'the comment line maps the file back to the design layer');
    ok(headerOf(files[2].content).includes('The number of layers = 3'),
       'the header counts the layers on the chip');
    const coated = buildAllProcessFiles(design('builtin:BK7', DEP), { ...OPTS, secondSurface: 'coated', chips });
    ok(coated.every((f, i) => spectrumOf(f.content) === spectrumOf(files[i].content)),
       "a chip's back face is bare whatever the part's is");
}

// ── 3. Witness ratio and chip glass ───────────────────────────────────────────
{
    const chips = { chipByStep: [1, 1, 1, 1, 1], chipMaterial: 'builtin:SiO2', witnessRatio: 1.2 };
    const files = buildAllProcessFiles(design('Air', DEP), { ...OPTS, chips });
    const thicker = design('Air', DEP.map(l => ({ ...l, thickness: l.thickness * 1.2 })));
    const onGlass = buildAllProcessFiles(
        { ...thicker, substrate: { material: 'builtin:SiO2', thickness: 1 } }, OPTS);
    ok(files.every((f, i) => spectrumOf(f.content) === spectrumOf(onGlass[i].content)),
       'the chip receives the witness thickness on the chip glass');
    ok(headerOf(files[0].content).includes('72.000'), 'the layer table lists the witness thickness');
}

// ── 4. The window model agrees with the export ────────────────────────────────
{
    const chips = { chipByStep: [1, 1, 2, 2, 1], chipMaterial: null, witnessRatio: 1 };
    const model = buildDepositionModel(design('builtin:BK7', DEP), 'front', chips);
    ok(model.chips.map(g => `${g.chip}:${g.steps.join('')}`).join(' ') === '1:014 2:23',
       'the model groups the run by chip in run order');
    ok(Math.abs(model.incidentMat.getNK(550)[0] - 1) < 1e-3
        && Math.abs(model.exitMat.getNK(550)[0] - 1) < 1e-3,
       'the model reads the chip in air');
    const options = {
        ...OPTS, activeDep: model.activeDep, otherDep: model.otherDep, chips: model.chips,
        incidentMat: model.incidentMat, substrateMat: model.substrateMat,
        exitMat: model.exitMat, substrateThk: model.substrateThk,
    };
    const steps = computeStepSpectra(options);
    let worst = 0;
    for (let k = 1; k <= DEP.length; k++) {
        const one = computeSpectrum({ ...options, layerIdx: k, frac: 1 });
        for (let i = 0; i < one.values.length; i++) {
            worst = Math.max(worst, Math.abs(one.values[i] - steps[k - 1].values[i]));
        }
    }
    ok(worst < 1e-12,
       `the step spectra and the live spectrum agree on every chip (worst ${worst.toExponential(1)})`);
    const bare = computeSpectrum({ ...options, layerIdx: 0, frac: 0 });
    const bareGlass = computeSpectrum({ ...options, activeDep: [], chips: [], layerIdx: 0, frac: 0 });
    ok(bare.values.every((v, i) => v === bareGlass.values[i]),
       'before the first layer the chip is bare glass');
}

// ── 5. What the data-range warning checks ────────────────────────────────────
//
// The piece is read in air, so the design's media are not among the materials
// checked; the chip glass is, though the design does not list it.
{
    const embedded = {
        ...design('builtin:ZnSe', DEP),
        backLayers: [{ id: 'b0', material: 'builtin:MgF2', thickness: 80 }],
    };
    const ids = (model, secondSurface) =>
        [...new Set(evaluatedMaterials(model, secondSurface).map(entry => entry.id))].sort().join(' ');
    const part = buildDepositionModel(embedded, 'front');
    ok(ids(part, 'bare') === ['Air', 'builtin:BK7', H, L].sort().join(' '),
       'on the bare part: air, the substrate and the layers deposited, not the design media');
    ok(ids(part, 'coated') === ['Air', 'builtin:BK7', 'builtin:MgF2', H, L].sort().join(' '),
       'with the opposite side coated its layers are checked too');
    const chips = { chipByStep: [1, 1, 2, 2, 1], chipMaterial: 'builtin:Al2O3', witnessRatio: 1 };
    const onChips = buildDepositionModel(embedded, 'front', chips);
    ok(ids(onChips, 'coated') === ['Air', 'builtin:Al2O3', H, L].sort().join(' '),
       'on witness chips: the chip glass in place of the substrate, and no other side');
    ok(evaluatedMaterials(onChips, 'bare').every(entry => typeof entry.material?.getNK === 'function'),
       'every entry carries the resolved material');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

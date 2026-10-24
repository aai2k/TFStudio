/**
 * The headless API's deposition run (src/api/process.js) against the Process
 * Exporter window's own code.
 *
 *   1. processSteps gives the window's finished-layer spectra and its bare
 *      spectrum, computeStepSpectra and computeSpectrum on
 *      buildDepositionModel as useSpectra calls them, on the corpus designs:
 *      the front and the back, the other side bare and coated, T, R and A,
 *      0 and 45 degrees, s and avg; and on witness chips, by chip size and by
 *      a plan of the window's, on another chip glass and a witness ratio,
 *      from the front and the back; the side taken without one, and the
 *      refusals.
 *   2. exportProcess writes, byte for byte but for the time a .res header
 *      names, the files the window's Save builds (buildAllProcessFiles with
 *      the save's options) where the save IPC writes them: .res on the part,
 *      a CSV table a chip, text files under the conditions header with a
 *      decimal comma; a file there is replaced; a relative folder is named in
 *      full; and the refusals.
 *   3. Cross-check: the last step of a run on the part with the other side
 *      coated is the spectrum of the whole part in air, as spectrum computes
 *      it.
 *
 * Run: node tests/api_process_steps.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { buildDepositionModel, computeSpectrum, computeStepSpectra } = await import('../src/components/windows/dataExchange/processSimulator/model.js');
const { buildAllProcessFiles } = await import('../src/utils/io/processFileExport.js');
const { assignChips } = await import('../src/utils/monitoring/monoSim.js');
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { requireResolved } = await import('../src/api/materials.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };

await api.init();

const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const DESIGNS = CORPUS.map(name => ({ name, design: api.openDesign(fixtureFile(name)) })).filter(({ design }) => !thrown(() => requireResolved(design)));

// What the window shows for `settings`, in the API's shape, as useSpectra computes it.
function windowRun(design, { side, otherSide = 'bare', quantity = 'T', angle = 0, pol = 'avg', from = 400, to = 1100, step = 0.5, plan = null }) {
    const shown = withHerpinRecords(design);
    const deposition = buildDepositionModel(shown, side, plan);
    const common = {
        activeDep: deposition.activeDep, otherDep: deposition.otherDep, chips: deposition.chips,
        activeSide: side, secondSurface: otherSide, quantity, aoi: angle, polarization: pol,
        lambdaStart: from, lambdaEnd: to, lambdaStep: step,
        incidentMat: deposition.incidentMat, substrateMat: deposition.substrateMat, exitMat: deposition.exitMat, substrateThk: deposition.substrateThk,
    };
    const bare = computeSpectrum({ ...common, layerIdx: 0, frac: 0 });
    const spectra = computeStepSpectra(common);
    return {
        mode: side, quantity, wavelength: Array.from(bare.lambda), bare: Array.from(bare.values),
        steps: deposition.activeDep.map((layer, i) => ({
            step: i + 1, layer: layer.step + 1, material: layer.materialId, thickness: layer.thickness, chip: layer.chip, values: Array.from(spectra[i].values),
        })),
    };
}

// ── 1. The window's spectra ─────────────────────────────────────────────────
const SETTINGS = [
    { step: 5 }, { otherSide: 'coated', quantity: 'R', angle: 45, pol: 's', from: 450, to: 900, step: 3 },
    { otherSide: 'coated', quantity: 'A', step: 7 }, { quantity: 'T', angle: 30, step: 10 },
];
let compared = 0;
DESIGNS.forEach(({ name, design }, i) => {
    for (const side of ['front', 'back']) {
        const layers = side === 'front' ? design.frontLayers : design.backLayers;
        if (!layers.length) continue;
        for (const settings of SETTINGS.filter((_, k) => k === 0 || (i + k) % 3 === 0)) {
            const { from, to, step, ...rest } = settings;
            const got = api.processSteps(design, { side, ...settings });
            compared++;
            ok(`${name} ${side} ${JSON.stringify(settings)}: the window's spectra`, isDeepStrictEqual(got, windowRun(design, { side, from, to, step, ...rest })));
        }
    }
});
ok('the corpus gives runs on the front and the back', compared > DESIGNS.length, `${compared}`);

const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2 H L' });
ok('at the window\'s opening settings, 400 to 1100 nm at 0.5 nm', isDeepStrictEqual(api.processSteps(ar), windowRun(ar, { side: 'front' }))
    && api.processSteps(ar).wavelength.length === 1401);
const backOnly = api.copySide(api.setDesignSetup(ar, { surfaceMode: 'both_independent' }), { from: 'front' });
const onlyBack = api.setDesignSetup(api.setDesignSetup(backOnly, { surfaceMode: 'back_only' }), {});
ok('without a side, the back of a design coated on the back alone', api.processSteps(onlyBack, { step: 10 }).mode === 'back'
    && isDeepStrictEqual(api.processSteps(onlyBack, { step: 10 }), windowRun(onlyBack, { side: 'back', step: 10 })));

// Witness chips, as useChipPlan builds the plan.
const sixLayers = api.insertLayer(ar, { material: 'TiO2', thickness: 0.000001, index: 2 });
const zero = { ...sixLayers, frontLayers: sixLayers.frontLayers.map((l, i) => (i === 2 ? { ...l, thickness: 0 } : l)) };
const CHIPS = [
    [{}, { chipByStep: assignChips(7, 3), chipMaterial: null, witnessRatio: 1 }],
    [{ layersPerChip: 2, witnessRatio: 1.5, glass: 'builtin:SiO2' }, { chipByStep: assignChips(7, 2), chipMaterial: 'builtin:SiO2', witnessRatio: 1.5 }],
    [{ plan: [1, 2, 1, 3, 2, 3, 1] }, { chipByStep: [1, 2, 1, 3, 2, 3, 1], chipMaterial: null, witnessRatio: 1 }],
];
const zeroBoth = api.copySide(api.setDesignSetup(zero, { surfaceMode: 'both_independent' }), { from: 'front' });
for (const [chips, plan] of CHIPS) {
    for (const side of ['front', 'back']) {
        const got = api.processSteps(zeroBoth, { side, chips, quantity: 'R', step: 5 });
        ok(`chips ${JSON.stringify(chips)} ${side}: the window's chip spectra`, isDeepStrictEqual(got, windowRun(zeroBoth, { side, plan, quantity: 'R', step: 5 }))
            && got.steps.length === 6 && got.steps.every(s => s.chip >= 1), JSON.stringify(got.steps.map(s => [s.layer, s.chip])));
    }
}
ok('on chips the empty layer is counted in the plan and left out of the run', isDeepStrictEqual(api.processSteps(zero, { chips: { plan: [1, 2, 1, 3, 2, 3, 1] }, step: 50 }).steps.map(s => [s.layer, s.chip]),
    [[1, 1], [2, 2], [3, 1], [4, 3], [6, 3], [7, 1]]));
const refusals = [
    [{ chips: { plan: [1, 2] } }, 'badValue'], [{ chips: { plan: [1, 2, 1, 3, 2, 3, 0] } }, 'badValue'], [{ chips: { layersPerChip: 0 } }, 'badValue'],
    [{ chips: { witnessRatio: 20 } }, 'badValue'], [{ chips: { layer: 2 } }, 'unknownOption'], [{ chips: [1] }, 'badValue'],
    [{ side: 'total' }, 'badValue'], [{ otherSide: 'half' }, 'badValue'], [{ quantity: 'Rs' }, 'badValue'], [{ angle: 90 }, 'badValue'],
    [{ pol: 'x' }, 'badValue'], [{ from: 900, to: 400 }, 'wavelengthRange'], [{ speed: 2 }, 'unknownOption'],
];
ok('a value an option cannot take, or an option it does not take, is refused with its code',
    refusals.every(([options, code]) => thrown(() => api.processSteps(zero, options))?.code === code),
    refusals.map(([options]) => thrown(() => api.processSteps(zero, options))?.code).join(','));
ok('a chip glass that resolves to nothing is refused', /chips.glass: Unknown material/.test(thrown(() => api.processSteps(zero, { chips: { glass: 'Unobtainium' } }))?.message ?? ''));

// ── 2. The files Save writes ────────────────────────────────────────────────
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'api-process-'));
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// A .res header names the time it was written; the rest is compared as it is.
const timeless = text => text.replace(/^\d\d\.\d\d\.\d{4} \d+:\d\d:\d\d\r$/m, 'TIME\r');
// The first line where two files differ, for a failure's message.
function firstDifference(a = '', b = '') {
    const [x, y] = [timeless(a).split('\n'), timeless(b).split('\n')];
    const at = x.findIndex((line, i) => line !== y[i]);
    return at < 0 ? 'the same' : `line ${at + 1}: ${JSON.stringify(x[at])} against ${JSON.stringify(y[at])}`;
}
const OUTPUTS = [
    [{}, null],
    [{ chips: { layersPerChip: 2 }, format: 'csv', files: 'table', scale: 'fraction', decimals: 8 }, { chipByStep: assignChips(7, 2), chipMaterial: null, witnessRatio: 1 }],
    [{ format: 'txt', header: 'conditions', delimiter: ';', decimalMark: ',', side: 'front', otherSide: 'coated', quantity: 'A', angle: 20, pol: 'p' }, null],
];
for (const [k, [options, plan]] of OUTPUTS.entries()) {
    const folder = path.join(TEMP, `run-${k}`);
    fs.mkdirSync(folder);
    const written = api.exportProcess(zero, folder, { from: 420, to: 760, step: 2, ...options });
    const { from: _f, to: _t, step: _s, chips: _c, side = 'front', otherSide = 'bare', quantity = 'T', angle = 0, pol = 'avg', ...output } = options;
    const expected = buildAllProcessFiles(withHerpinRecords(zero), {
        activeSide: side, secondSurface: otherSide, quantity, aoi: angle, polarization: pol, lambdaStart: 420, lambdaEnd: 760, lambdaStep: 2,
        outputDir: folder, appVersion: VERSION, projectLabel: zero.name, chips: plan, output,
    });
    const paths = expected.map(f => path.join(folder, ...(f.subdir ? [f.subdir] : []), f.filename));
    ok(`${JSON.stringify(options)}: the files Save writes, where it writes them`, isDeepStrictEqual(written, paths) && written.length > 0
        && expected.every((f, i) => timeless(fs.readFileSync(paths[i], 'utf8')) === timeless(f.content)),
        firstDifference(written[0] && fs.readFileSync(written[0], 'utf8'), expected[0]?.content));
}
const again = api.exportProcess(zero, path.join(TEMP, 'run-0'), { from: 420, to: 760, step: 4 });
ok('a file already there is replaced, as Save replaces it', fs.readFileSync(again[0], 'utf8').includes('Spectral characteristics: 86 points'));
ok('the .res header names the app\'s version and the folder', fs.readFileSync(again[0], 'utf8').startsWith(`TFStudio Process Deposition Report, version: ${VERSION}\r\n`)
    && fs.readFileSync(again[0], 'utf8').includes(`Output directory:  ${path.join(TEMP, 'run-0')}\\`));
const outputRefusals = [
    [{ format: 'xls' }, 'badValue'], [{ decimals: 13 }, 'badValue'], [{ files: 'chip' }, 'badValue'], [{ header: 'full' }, 'badValue'],
    [{ delimiter: '|' }, 'badValue'], [{ scale: 'dB' }, 'badValue'], [{ decimalMark: ';' }, 'badValue'], [{ playSpeed: 2 }, 'unknownOption'],
];
ok('an output option or value it does not take is refused with its code', outputRefusals.every(([options, code]) => thrown(() => api.exportProcess(zero, TEMP, options))?.code === code));
ok('a decimal comma beside a comma delimiter is refused, as the window does not offer it', /decimal comma/.test(thrown(() => api.exportProcess(zero, TEMP, { format: 'csv', decimalMark: ',' }))?.message ?? ''));
const relative = api.exportProcess(zero, path.relative(process.cwd(), path.join(TEMP, 'run-0')), { step: 10 });
ok('a relative folder is taken from the working folder, and the header and the paths name it in full', relative[0] === path.join(TEMP, 'run-0', '01.res')
    && fs.readFileSync(relative[0], 'utf8').includes(`Output directory:  ${path.join(TEMP, 'run-0')}\\`), relative[0]);
ok('a folder that is not there is refused', /not a folder/.test(thrown(() => api.exportProcess(zero, path.join(TEMP, 'none')))?.message ?? ''));
ok('a side with no layers is refused with its code', thrown(() => api.exportProcess(zero, TEMP, { side: 'back' }))?.code === 'emptySide');
fs.rmSync(TEMP, { recursive: true, force: true });

// ── 3. Cross-check against spectrum ─────────────────────────────────────────
const twoSided = api.setDesignSetup(api.insertLayer(api.setDesignSetup(ar, { surfaceMode: 'both_independent', incidentMedium: 'SiO2', exitMedium: 'SiO2' }),
    { side: 'back', material: 'MgF2', thickness: 95 }), {});
const inAir = api.setDesignSetup(twoSided, { incidentMedium: 'Air', exitMedium: 'Air' });
for (const [quantity, angle, pol] of [['T', 0, 'avg'], ['R', 40, 's']]) {
    const run = api.processSteps(twoSided, { otherSide: 'coated', quantity, angle, pol, from: 400, to: 800, step: 2 });
    const whole = api.spectrum(inAir, { from: 400, to: 800, step: 2, angles: [angle] });
    const expected = whole.angles[angle][pol === 's' ? `${quantity}s` : quantity];
    const worst = Math.max(...run.steps.at(-1).values.map((v, i) => Math.abs(v - expected[i])));
    ok(`${quantity} ${angle} ${pol}: the last step with the other side coated is the whole part in air`, whole.evalMode === 'total' && worst < 1e-12, `${worst}`);
}
// A back-side run reads the part from the front too, so its last step is the same part.
const front = api.processSteps(twoSided, { side: 'front', otherSide: 'coated', step: 4 }).steps.at(-1).values;
const back = api.processSteps(twoSided, { side: 'back', otherSide: 'coated', step: 4 }).steps.at(-1).values;
ok('the last step of a back run with the front coated is the last step of a front run with the back coated', Math.max(...front.map((v, i) => Math.abs(v - back[i]))) < 1e-12);

console.log(`api_process_steps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

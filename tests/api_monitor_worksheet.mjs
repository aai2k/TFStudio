/**
 * The headless API's monitoring worksheet (src/api/monitorWorksheet.js)
 * against the Monitor Worksheet window's own code.
 *
 *   1. monitorWorksheet gives the window's rows, chips and run length,
 *      buildMonitorWorksheet with the options useMonitorWorksheet builds from
 *      its session, on the corpus designs: at the window's opening settings,
 *      with R at 45 degrees and other chip sizes, witness ratios and monitor
 *      errors, a hand plan on another chip glass, the Auto button, Set all
 *      and a wavelength for each step; and the Report's worksheet, which
 *      reads the window's values the same way, prints the same rows.
 *   2. The back of a design (choice 8): Back face AR, coated on the back
 *      alone, gives the sample the choice was decided on; the back is
 *      deposited substrate side first; a side with no layers gives no rows;
 *      an empty layer is a row cut on time; and the refusals.
 *   3. Cross-check: on the same chip plan, from the front and the back, each
 *      row's signal is the Process Exporter's chip spectrum (processSteps) at
 *      that chip's wavelength when the layer is finished, and each chip's
 *      first reading is the bare chip's.
 *
 * Run: node tests/api_monitor_worksheet.mjs
 */
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { assignChips, autoChipLambdas, buildMonitorWorksheet } = await import('../src/utils/monitoring/monoSim.js');
const { designMaterialLookup, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { usableChipGlass } = await import('../src/components/windows/simulation/monitorWorksheet/chipGlass.js');
const { computeWorksheet } = await import('../src/utils/report/reportData/worksheet.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
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
const OPENING = { ...sessionDefaults('monitorWorksheet'), chipByStep: null, lambdaByStep: null, chipMaterial: null };

// A plan entered by hand holds while it has one entry per layer, as the window's planForSteps keeps it.
const planForSteps = (plan, stepCount) => (Array.isArray(plan) && plan.length === stepCount ? plan : null);

// The worksheet the window shows for the session values `given`, as
// useMonitorWorksheet computes it, `auto` its Auto button pressed first.
function windowSheet(design, given = {}) {
    const s = { ...OPENING, ...given };
    const shown = withHerpinRecords(design);
    const stepCount = shown.frontLayers.length;
    const resolveMat = designMaterialLookup(shown);
    const options = {
        char: s.char, theta: s.theta, pol: s.polarization, chipMaterial: usableChipGlass(shown, s.chipMaterial).chipMaterial,
        witnessRatio: s.witnessRatio, signalErrorPct: s.signalErrorPct, absSignalErrorPct: s.absSignalErrorPct,
        maxTerminationErrPct: s.maxTerminationErrPct,
        chipByStep: planForSteps(s.chipByStep, stepCount) || assignChips(stepCount, s.layersPerChip),
        lambdaByStep: planForSteps(s.lambdaByStep, stepCount),
    };
    if (s.auto) options.lambdaByStep = autoChipLambdas(shown, resolveMat, options);
    return { stepCount, sheet: buildMonitorWorksheet(shown, resolveMat, options) };
}

// A row of the window's worksheet in the API's names and units, as the docs give them, but its curve.
const rowFields = (r, stepCount) => ({
    step: r.step, layer: stepCount - r.layerIndex, chip: r.chip, onChip: r.onChip, material: r.material, wavelength: r.lambda,
    thickness: r.thickness, signal: r.signal, turningPoints: r.turningPoints, amplitude: r.amplitude, swingIn: r.swingIn,
    swingOut: r.swingOut, cutoffRatio: r.cutoffRatio, terminationError: r.terminationErrNm, crystal: r.crystalNm,
    initialLevel: r.initialLevel, poor: r.poor, strategy: r.strategy,
});
const withoutCurve = ({ curve: _curve, ...row }) => row;

// The window's worksheet in the API's shape.
function inApiShape(mode, { stepCount, sheet }) {
    return {
        mode,
        rows: sheet.rows.map(r => ({ ...rowFields(r, stepCount), curve: { thickness: r.curve.thickness, signal: r.curve.y } })),
        chips: sheet.chips.map(c => ({ chip: c.chip, wavelength: c.lambda, initialLevel: c.initialLevel, steps: c.steps })),
        runLength: sheet.xEnd,
    };
}

// ── 1. The window's worksheet ──────────────────────────────────────────────
// Each setting in the window's session names and in the API's options.
const cycle = n => Array.from({ length: n }, (_, k) => (k % 3) + 1);
const SETTINGS = [
    ['opening settings', () => [{}, {}]],
    ['R at 45 degrees, s, two to a chip, ratio 1.3, other errors', () => [
        { char: 'R', theta: 45, polarization: 's', layersPerChip: 2, witnessRatio: 1.3, signalErrorPct: 0.5, absSignalErrorPct: 0.05, maxTerminationErrPct: 2 },
        { quantity: 'R', angle: 45, pol: 's', chips: { layersPerChip: 2, witnessRatio: 1.3 }, signalErrorPct: 0.5, noiseFloorPct: 0.05, maxTerminationErrPct: 2 }]],
    ['a hand plan on fused silica chips', n => [{ chipByStep: cycle(n), chipMaterial: 'builtin:SiO2' }, { chips: { plan: cycle(n), glass: 'builtin:SiO2' } }]],
    ['Auto, four to a chip, p', () => [{ auto: true, layersPerChip: 4, polarization: 'p' }, { wavelengths: 'auto', chips: { layersPerChip: 4 }, pol: 'p' }]],
    ['Set all at 600 nm, one to a chip', n => [{ lambdaByStep: new Array(n).fill(600), layersPerChip: 1 }, { wavelengths: 600, chips: { layersPerChip: 1 } }]],
    ['a wavelength for each step', n => {
        const each = Array.from({ length: n }, (_, k) => 500 + 7 * k);
        return [{ lambdaByStep: each, theta: 20 }, { wavelengths: each, angle: 20 }];
    }],
];
const seen = new Set();
DESIGNS.forEach(({ name, design }, i) => {
    const n = design.frontLayers.length;
    if (!n) return;
    for (const [k, [label, make]] of SETTINGS.entries()) {
        if (!(k === 0 || n <= 12 || (i + k) % 3 === 0)) continue;
        const [session, options] = make(n);
        const got = api.monitorWorksheet(design, options);
        seen.add(label);
        ok(`${name}, ${label}: the window's worksheet`, isDeepStrictEqual(got, inApiShape('front', windowSheet(design, session))) && got.rows.length === n,
            JSON.stringify(got.rows[0]).slice(0, 200));
    }
    const report = computeWorksheet(withHerpinRecords(design), { chipByStep: cycle(n), layersPerChip: 2, char: 'R' }).rows;
    const printed = api.monitorWorksheet(design, { chips: { plan: cycle(n) }, quantity: 'R' }).rows;
    ok(`${name}: the Report prints these rows`, isDeepStrictEqual(printed.map(withoutCurve), report.map(r => rowFields(r, n))));
});
ok('every setting is compared on the corpus', seen.size === SETTINGS.length, [...seen].join('; '));

// ── 2. The back, and the refusals ──────────────────────────────────────────
const backAr = api.openDesign(fixtureFile('back-only-side'));
const sample = api.monitorWorksheet(backAr);
const summary = sample.rows.map(r => [r.step, r.material, r.wavelength, r.signal.toFixed(4), r.turningPoints, r.terminationError.toFixed(2), r.poor]);
ok('Back face AR gives choice 8\'s sample: Al2O3 then MgF2 at 550 nm, both flagged', sample.mode === 'back' && isDeepStrictEqual(summary, [
    [1, 'builtin:Al2O3', 550, '0.9185', 2, '10.83', true], [2, 'builtin:MgF2', 550, '0.9460', 1, '23.38', true],
]), JSON.stringify(summary));
ok('its curves hold the samples the plan counted', isDeepStrictEqual(sample.rows.map(r => r.curve.signal.length), [169, 119])
    && sample.rows.every(r => r.curve.thickness[0] === 0 && r.curve.thickness.at(-1) > r.thickness));
// The back's layers, stored from the substrate out, as a front deposited in the same order.
const backAsFront = design => ({ ...design, frontLayers: [...design.backLayers].reverse(), backLayers: [], surfaceMode: 'front_only' });
for (const { name, design } of [{ name: 'Back face AR', design: backAr }, ...DESIGNS.filter(({ design }) => design.backLayers.length)]) {
    const settings = SETTINGS[(name.length % (SETTINGS.length - 1)) + 1];
    const [session, options] = settings[1](design.backLayers.length);
    ok(`${name}, ${settings[0]}: the back is deposited substrate side first, the window's worksheet of its layers on a front`,
        isDeepStrictEqual(api.monitorWorksheet(design, { ...options, side: 'back' }), inApiShape('back', windowSheet(backAsFront(design), session))));
}
ok('the front of a design coated on the back alone has no rows, as the window shows', isDeepStrictEqual(api.monitorWorksheet(backAr, { side: 'front' }), { mode: 'front', rows: [], chips: [], runLength: 0 }));

const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2 H L' });
const withEmpty = { ...ar, frontLayers: ar.frontLayers.map((l, i) => (i === 2 ? { ...l, thickness: 0 } : l)) };
const emptyRow = api.monitorWorksheet(withEmpty).rows.find(r => r.thickness === 0);
ok('an empty layer is a row of its own, cut on time', emptyRow?.layer === 4 && emptyRow.strategy === 'time' && emptyRow.terminationError === null, JSON.stringify(emptyRow ?? {}).slice(0, 200));
const refusals = [
    [{ quantity: 'A' }, 'badValue'], [{ angle: 90 }, 'badValue'], [{ pol: 'x' }, 'badValue'], [{ side: 'total' }, 'badValue'],
    [{ chips: null }, 'badValue'], [{ chips: { plan: [1, 2] } }, 'badValue'], [{ chips: { layersPerChip: 0 } }, 'badValue'],
    [{ chips: { witnessRatio: 20 } }, 'badValue'], [{ chips: { layer: 2 } }, 'unknownOption'], [{ wavelengths: [500, 600] }, 'badValue'],
    [{ wavelengths: 'best' }, 'badValue'], [{ wavelengths: -5 }, 'badValue'], [{ signalErrorPct: 0 }, 'badValue'], [{ noiseFloorPct: 11 }, 'badValue'],
    [{ maxTerminationErrPct: 200 }, 'badValue'], [{ speed: 2 }, 'unknownOption'],
];
ok('a value an option cannot take, or an option it does not take, is refused with its code',
    refusals.every(([options, code]) => thrown(() => api.monitorWorksheet(ar, options))?.code === code),
    refusals.map(([options]) => thrown(() => api.monitorWorksheet(ar, options))?.code).join(','));
ok('a chip glass that resolves to nothing is refused', /chips.glass: Unknown material/.test(thrown(() => api.monitorWorksheet(ar, { chips: { glass: 'Unobtainium' } }))?.message ?? ''));
ok('a material with no index at a chip\'s wavelength is refused in the window\'s words',
    thrown(() => api.monitorWorksheet(ar, { wavelengths: 110 }))?.message === 'monitorWorksheet: builtin:SiO2 has no refractive index at 110 nm, and the worksheet needs one there.');

// ── 3. Cross-check against the Process Exporter ─────────────────────────────
const twoSided = api.copySide(api.setDesignSetup(ar, { surfaceMode: 'both_independent', incidentMedium: 'SiO2' }), { from: 'front' });
const RUNS = [
    [backAr, { side: 'back' }],
    [twoSided, { chips: { plan: [2, 1, 2, 3, 1, 3], glass: 'builtin:SiO2', witnessRatio: 1.2 }, wavelengths: 'auto' }],
    [twoSided, { side: 'back', chips: { layersPerChip: 4, witnessRatio: 0.8 }, quantity: 'R', angle: 30, pol: 'p', wavelengths: 640 }],
    [withEmpty, { chips: { layersPerChip: 2 }, pol: 's', angle: 50 }],
];
for (const [design, options] of RUNS) {
    const sheet = api.monitorWorksheet(design, options);
    const at = sheet.chips.map(c => c.wavelength);
    const { wavelengths: _w, ...run } = options;
    const steps = api.processSteps(design, { ...run, chips: options.chips ?? {}, from: Math.min(...at) - 1, to: Math.max(...at) + 1, step: 1 });
    const value = (values, wavelength) => values[steps.wavelength.indexOf(wavelength)];
    let worst = 0;
    for (const row of sheet.rows.filter(r => r.thickness > 0)) {
        const step = steps.steps.find(s => s.layer === row.layer);
        worst = Math.max(worst, step.chip === row.chip ? Math.abs(value(step.values, row.wavelength) - row.signal) : Infinity);
    }
    const bare = Math.max(...sheet.chips.map(c => Math.abs(value(steps.bare, c.wavelength) - c.initialLevel)));
    ok(`${design.name} ${JSON.stringify(options)}: each layer's signal is processSteps's chip spectrum at its chip's wavelength`,
        steps.mode === sheet.mode && worst < 1e-12 && bare < 1e-12 && steps.steps.length === sheet.rows.filter(r => r.thickness > 0).length, `${worst} ${bare}`);
}

console.log(`api_monitor_worksheet: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

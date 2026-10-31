/**
 * The headless API's roughness (src/api/roughness.js) against the Roughness /
 * Scattering window's own code.
 *
 *   1. On the corpus designs whose materials resolve, the spectra, the loss,
 *      the thinned layers and the long-range flag are calculateRoughness's with
 *      the roughness spec the window's editor builds for the same settings:
 *      uniform long range, uniform short range, one rough interface alone, and
 *      every other interface short, at 0 and 45 degrees, on the front, the back
 *      and the whole part. Interface k is the editor's row whose label has
 *      layer k below it.
 *   2. Cross-checks: smooth is spectrum on every corpus design at 30 degrees, a
 *      design under a cone included, and a σ of 0 gives rough equal to smooth;
 *      short range of 2 nm at one interface is the mix (4·S32 − S16)/3 of two
 *      inhomogeneities calls, a 4 nm linear interlayer at 16 and at 32 slices
 *      on the design with the layer beneath 4 nm thinner, on four corpus
 *      designs at 30 degrees.
 *   3. Thinned layers by Design Editor number, a layer of 0 nm, a bare side.
 *   4. The objects' CSV is the window's table with every curve through its
 *      Copy CSV.
 *   5. Refusals with their codes and fields.
 *
 * Run: node tests/api_roughness.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspect, isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { calculateRoughness, getRoughnessContext } = await import('../src/components/windows/analysis/roughnessScattering/model.js');
const { SCATTER_CURVES } = await import('../src/components/windows/analysis/roughnessScattering/figure.js');
const { scatterColumns, scatterRows } = await import('../src/components/windows/analysis/roughnessScattering/tableModel.js');
const { designInterfaces } = await import('../src/components/windows/analysis/designInterfaces.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { cloneRoughness, emptyRoughness } = await import('../src/utils/physics/scattering.js');
const { makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-roughness-'));
const QUANTITIES = ['R', 'T', 'Rs', 'Rp', 'Ts', 'Tp'];
const RANGE = { start: 400, end: 800, step: 5 };

// ── The designs ────────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
const twoSided = api.stackFromFormula(api.stackFromFormula(api.newDesign({ name: 'Two sides', surfaceMode: 'both_independent' }), { formula: '(HL)^2 H' }),
    { formula: 'HL', side: 'back' });

// The layers of a side counted from the substrate, as the Design Editor
// numbers them: the front is stored air side first, the back substrate first.
const fromSubstrate = (design, side) => (side === 'back' ? [...(design.backLayers || [])] : [...(design.frontLayers || [])].reverse());
// How the window's editor keys each side: its lists of σ and kind, the count
// of interfaces getRoughnessContext gives it, and its index of interface k,
// the front listing its interfaces from the medium and the back from the
// substrate.
const EDITOR = {
    front: { sigmas: 'sigmas', ranges: 'ranges', count: 'frontN', index: (design, k) => design.frontLayers.length - k },
    back: { sigmas: 'backSigmas', ranges: 'backRanges', count: 'backN', index: (design, k) => k },
};
const sidesOf = (design, mode) => getRoughnessContext(design, mode).activeSides;
const countOf = (design, side) => getRoughnessContext(design, side)[EDITOR[side].count];
// The window's roughness for the API's options on `design` scored as `mode`:
// the uniform σ and kind set, then each row's σ and kind edited in the
// per-interface editor, in turn, as the hook's setInterfaceSigma and
// setInterfaceRange edit them; a value a row leaves out is set to the uniform
// one, which is what the editor shows there. A row without a side is on the
// one side computed.
function windowRough(design, mode, { sigma = 1, range = 'long', interfaces = [] }) {
    let rough = { ...emptyRoughness(), sigma: Math.max(0, sigma), range };
    const edit = (key, fill, index, value) => {
        const list = (rough[key] || []).slice();
        while (list.length <= index) list.push(rough[fill]);
        list[index] = value;
        rough = { ...rough, mode: 'perInterface', [key]: list };
    };
    for (const row of interfaces) {
        const editor = EDITOR[row.side ?? sidesOf(design, mode)[0]];
        const index = editor.index(design, row.interface);
        edit(editor.sigmas, 'sigma', index, Math.max(0, row.sigma ?? sigma));
        edit(editor.ranges, 'range', index, row.range ?? range);
    }
    return cloneRoughness(rough);
}
// The window's numbers for `design` scored as `mode`: the hook's request as
// the analysis worker's 'roughnessSpectra' computes it, which is
// calculateRoughness. The window calls that on the calling thread in
// collimated light, and in the worker on the design with its materials
// embedded under a cone.
function windowResult(design, mode, options, angle) {
    const shown = withHerpinRecords(design);
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    return dispatchAnalysisEvaluation('roughnessSpectra', {
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: RANGE.start, lambdaEnd: RANGE.end, lambdaStep: RANGE.step, theta: angle, polarization: 'avg' },
        rough: windowRough(shown, mode, options), evalMode: mode,
    }).data;
}
const curves = spectrum => Object.fromEntries(QUANTITIES.map(q => [q, Array.from(spectrum[q])]));
// The window's result in the call's shape.
function asCall(design, data) {
    const thinned = ['front', 'back'].flatMap(side => data.thinned[side].map(index => ({
        side, number: side === 'back' ? index + 1 : (design.frontLayers.length - index),
    })).sort((a, b) => a.number - b.number));
    return { wavelength: Array.from(data.lambda), smooth: curves(data.ideal), rough: curves(data.specular), loss: Array.from(data.loss), thinned, longRange: data.hasLongRange };
}
// The four settings of the map: uniform long, uniform short, one rough
// interface alone, and every other interface short on a long background.
function settings(design, mode, variant) {
    const all = sidesOf(design, mode);
    const sides = all.filter(side => countOf(design, side) > 0);
    const tagged = side => (all.length > 1 ? { side } : {});
    const one = sides.slice(0, 1).map(side => ({ ...tagged(side), interface: Math.floor(countOf(design, side) / 2), sigma: 3 }));
    const everyOther = sides.flatMap(side => Array.from({ length: countOf(design, side) }, (_, k) => k).filter(k => k % 2 === 0)
        .map(k => ({ ...tagged(side), interface: k, range: 'short', sigma: 1 + (k % 3) })));
    return [{ sigma: 2, range: 'long' }, { sigma: 1.5, range: 'short' }, { sigma: 0, interfaces: one }, { sigma: 1, range: 'long', interfaces: everyOther }][variant];
}

// ── 1. The window's numbers ────────────────────────────────────────────────
{
    const wrong = [];
    let cases = 0, rows = 0;
    const variants = new Set();
    corpus.forEach(([name, design]) => {
        ['front', 'back', 'total'].forEach(side => [0, 45].forEach(angle => [0, 1, 2, 3].forEach(variant => {
            const options = settings(design, side, variant);
            const r = api.roughness(design, { ...options, ...RANGE, angle, side });
            const expected = asCall(design, windowResult(design, side, options, angle));
            cases++;
            rows += options.interfaces?.length ?? 0;
            variants.add(variant);
            const said = [r.mode, r.angle, r.wavelength, r.smooth, r.rough, r.loss, r.thinned, r.longRange];
            if (!same(said, [side, angle, expected.wavelength, expected.smooth, expected.rough, expected.loss, expected.thinned, expected.longRange])) {
                wrong.push(`${name} ${side} ${angle} ${variant}`);
            }
        })));
    });
    ok(`on ${corpus.length} designs, the call gives calculateRoughness's numbers for the editor's spec: uniform long and short, one interface, every other one short, front, back and whole part at 0 and 45 degrees (${cases} cases, ${rows} rows)`,
        same([corpus.length, cases, variants.size, wrong.length], [16, 384, 4, 0]) && rows > 200, `${wrong.length} wrong: ${wrong.slice(0, 4).join('\n')}`);
}
{
    // Interface k is the editor's row whose label has layer k below it.
    const labels = [];
    let checked = 0;
    corpus.forEach(([name, design]) => {
        const interfaces = designInterfaces(design, en.roughnessScattering);
        for (const side of ['front', 'back']) {
            const n = fromSubstrate(design, side).length;
            if (!n) continue;
            for (let k = 0; k <= n; k++) {
                checked++;
                const [upper, lower] = interfaces[side][EDITOR[side].index(design, k)].label.split(' → ');
                // The front's labels run from the medium to the substrate, so
                // layer k is the second name; the back's from the substrate.
                const [nearer, farther] = side === 'back' ? [upper, lower] : [lower, upper];
                const layerNamed = (text, number) => (number >= 1 && number <= n ? text === `L${number}` : !/^L\d+$/.test(text));
                if (!layerNamed(nearer, k) || !layerNamed(farther, k + 1)) labels.push(`${name} ${side} ${k}: ${upper} → ${lower}`);
            }
        }
    });
    ok(`interface k is the editor's row with layer k below it (${checked} interfaces)`, same([checked, labels.length], [97, 0]), labels.slice(0, 4).join('\n'));
}
{
    // The defaults: the window's opening range and angle, the scored side, and
    // emptyRoughness, 1 nm of long-range roughness on every interface.
    const r = api.roughness(mirror);
    const shown = withHerpinRecords(mirror);
    const window = calculateRoughness({ design: shown, params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5, theta: 0, polarization: 'avg' }, rough: emptyRoughness(), evalMode: 'front' }).data;
    ok('without options it computes from 400 to 800 nm in steps of 0.5 at 0 degrees on the side scored, with 1 nm of long-range roughness on every interface',
        same([r.mode, r.angle, r.wavelength[0], r.wavelength.at(-1), r.wavelength.length, r.longRange, r.smooth, r.rough, r.loss],
            ['front', 0, 400, 800, 801, true, curves(window.ideal), curves(window.specular), Array.from(window.loss)]));
    const rows = { sigma: 0, interfaces: [{ side: 'back', interface: 2, sigma: 2 }, { side: 'front', interface: 0, sigma: 1, range: 'short' }] };
    const both = api.roughness(twoSided, { ...rows, ...RANGE });
    ok('on a part coated on both sides it computes the whole part, rows given with their side',
        same([both.mode, both.longRange, both], ['total', true, { ...both, ...asCall(twoSided, windowResult(twoSided, 'total', rows, 0)) }]));
    ok('short range alone sets no long-range flag, and a σ of 0 none either',
        same([api.roughness(mirror, { range: 'short', ...RANGE }).longRange, api.roughness(mirror, { sigma: 0, ...RANGE }).longRange], [false, false]));
}

// ── 2. Cross-checks ────────────────────────────────────────────────────────
{
    const off = corpus.filter(([, design]) => {
        const r = api.roughness(design, { ...RANGE, angle: 30 });
        const s = api.spectrum(design, { from: RANGE.start, to: RANGE.end, step: RANGE.step, angles: [30] });
        const flat = api.roughness(design, { ...RANGE, angle: 30, sigma: 0 });
        return !same([r.mode, r.wavelength, r.smooth, flat.rough, flat.loss],
            [s.evalMode, s.lambda, curves(s.angles[30]), flat.smooth, flat.loss.map(() => 0)]);
    }).map(([name]) => name);
    const coned = corpus.find(([name]) => name === 'cone-user-distribution')?.[1];
    const withoutCone = api.roughness({ ...coned, cone: undefined }, { ...RANGE, angle: 30 }).smooth.R;
    ok('smooth is spectrum on every corpus design at 30 degrees, averaged over the cone on the one under a cone, and a σ of 0 gives rough equal to smooth',
        off.length === 0 && !!coned && !same(api.roughness(coned, { ...RANGE, angle: 30 }).smooth.R, withoutCone), off.join(', '));
}
{
    // Short range of 2 nm at the top of front layer 2 is a 4 nm linear graded
    // layer taken out of layer 2, cut into 16 and into 32 slices and the two
    // combined as (4·S32 − S16)/3, on the first four corpus designs whose
    // layer 2 is thicker than that and whose layer 3 is there.
    const fits = ([, design]) => {
        const layers = fromSubstrate(design, 'front');
        return layers.length >= 3 && layers[1].thickness > 8 && layers[2].thickness > 0;
    };
    const picked = corpus.filter(fits).slice(0, 4);
    let moved = 0, worst = 0;
    for (const [, design] of picked) {
        const stored = design.frontLayers.length - 2;
        const thinner = api.setLayer(design, { index: stored, thickness: design.frontLayers[stored].thickness - 4 });
        const graded = slices => api.inhomogeneities(thinner, { interlayers: [{ interface: 2, thickness: 4, profile: 'linear', slices }], ...RANGE, angle: 30, side: 'front' }).graded;
        const [s16, s32] = [graded(16), graded(32)];
        const r = api.roughness(design, { sigma: 0, interfaces: [{ interface: 2, sigma: 2, range: 'short' }], ...RANGE, angle: 30, side: 'front' });
        for (const q of QUANTITIES) {
            r.rough[q].forEach((v, i) => {
                worst = Math.max(worst, Math.abs(v - (4 * s32[q][i] - s16[q][i]) / 3));
                moved = Math.max(moved, Math.abs(v - r.smooth[q][i]));
            });
        }
    }
    ok(`short range of 2 nm at one interface is (4·S32 − S16)/3 of two inhomogeneities calls on ${picked.map(([name]) => name).join(', ')} at 30 degrees, where it moves the curves by up to ${moved.toFixed(3)}`,
        picked.length === 4 && moved > 0.01 && worst < 1e-12, `${worst}`);
}

// ── 3. Thinned layers, a layer of 0 nm and a bare side ─────────────────────
{
    // HLH with its L at 3 nm: 2 nm of roughness on its top takes 4 nm from it.
    const hlh = api.stackFromFormula(api.newDesign({ name: 'HLH' }), { formula: 'HLH' });
    const thinL = api.setLayer(hlh, { index: 1, thickness: 3 });
    const r = api.roughness(thinL, { sigma: 0, interfaces: [{ interface: 2, sigma: 2 }], ...RANGE });
    const back = api.setLayer(twoSided, { side: 'back', index: 0, thickness: 3 });
    const both = api.roughness(back, { sigma: 2, ...RANGE });
    ok('a layer thinner than its transition layer is listed by side and Design Editor number',
        same([r.thinned, both.thinned, both.thinned], [[{ side: 'front', number: 2 }], [{ side: 'back', number: 1 }], asCall(back, windowResult(back, 'total', { sigma: 2 }, 0)).thinned]),
        JSON.stringify([r.thinned, both.thinned]));
    // The same L at 0 nm is not in the coating: the σ on its top is not used,
    // and the σ on its bottom, the top of layer 1, is the window's.
    const empty = { ...hlh, frontLayers: hlh.frontLayers.map((layer, i) => (i === 1 ? { ...layer, thickness: 0 } : layer)) };
    const onTop = api.roughness(empty, { sigma: 0, interfaces: [{ interface: 2, sigma: 3 }], ...RANGE });
    const beneath = { sigma: 0, interfaces: [{ interface: 1, sigma: 3, range: 'short' }] };
    const below = api.roughness(empty, { ...beneath, ...RANGE });
    ok('the σ set on top of a layer of 0 nm is not used, and the interface below it is the window\'s',
        same([onTop.rough, below], [onTop.smooth, { ...below, ...asCall(empty, windowResult(empty, 'front', beneath, 0)) }]));
    // A face with no layers has no interface: the back of the QW mirror, and
    // the front of a design coated on the back alone, read on its own or as
    // the whole part.
    const bare = api.roughness(mirror, { side: 'back', ...RANGE });
    const backOnly = corpus.find(([name]) => name === 'back-only-side')[1];
    const front = api.roughness(backOnly, { side: 'front', sigma: 5, ...RANGE });
    const smoothBack = { sigma: 1, interfaces: [0, 1, 2].map(k => ({ interface: k, sigma: 0 })) };
    const whole = api.roughness(backOnly, { side: 'total', ...smoothBack, ...RANGE });
    ok('a side with no layers gives its bare surface, front or back, and a whole part whose back is smooth loses nothing on its bare front',
        same([bare.mode, bare.rough, backOnly.frontLayers.length, front.rough, whole.rough, whole.loss.every(v => v === 0)],
            ['back', bare.smooth, 0, front.smooth, whole.smooth, true]));
    // The whole part of the back-face AR at σ 1 nm, long range: its three back
    // interfaces lose 87.1 ppm at 550 nm.
    const ar = api.roughness(backOnly, { side: 'total', sigma: 1, range: 'long', ...RANGE });
    const at550 = ar.loss[ar.wavelength.indexOf(550)] * 1e6;
    ok('the whole part of a back-face AR counts the back\'s three interfaces and loses 87.1 ppm at 550 nm',
        same([getRoughnessContext(backOnly, 'total').nIfaces, at550.toFixed(1)], [3, '87.1']), `${at550}`);
    // A face whose layers are all 0 nm is bare too, so a 0 nm layer added to
    // it changes nothing: on the front of the back-face AR, on its own and on
    // the whole part, and on the back of the QW mirror on the whole part.
    const zeroFront = { ...backOnly, frontLayers: [{ id: 'F0', material: backOnly.backLayers[0].material, thickness: 0 }] };
    const zeroAr = api.roughness(zeroFront, { side: 'total', sigma: 1, range: 'long', ...RANGE });
    const zeroAt550 = zeroAr.loss[zeroAr.wavelength.indexOf(550)] * 1e6;
    const zeroAlone = api.roughness(zeroFront, { side: 'front', sigma: 5, ...RANGE });
    const zeroBack = { ...mirror, backLayers: [{ id: 'B0', material: mirror.frontLayers[0].material, thickness: 0 }] };
    ok('a face of 0 nm layers is bare: the back-face AR with a 0 nm front reads as with none, 3 interfaces and 87.1 ppm at 550 nm',
        same([getRoughnessContext(zeroFront, 'total').nIfaces, zeroAt550.toFixed(1), zeroAr.rough, zeroAr.loss, zeroAlone.rough],
            [3, '87.1', ar.rough, ar.loss, zeroAlone.smooth]), `${zeroAt550}`);
    ok('and the QW mirror with a 0 nm back reads on the whole part as with no back',
        same(api.roughness(zeroBack, { side: 'total', sigma: 1, ...RANGE }).loss, api.roughness(mirror, { side: 'total', sigma: 1, ...RANGE }).loss));
}

// ── 4. The objects ─────────────────────────────────────────────────────────
{
    const every = Object.fromEntries(SCATTER_CURVES.map(key => [key, true]));
    const cases = [['mirror', mirror, { sigma: 2, range: 'short', ...RANGE }],
        ['two sides', twoSided, { interfaces: [{ side: 'back', interface: 1, sigma: 4 }], ...RANGE, angle: 20 }]];
    const wrong = cases.filter(([, design, options], i) => {
        const file = path.join(WORK, `${i}.csv`);
        new objects.Design(design).roughness(options).saveCsv(file);
        const { start, end, step, angle = 0, ...rough } = options;
        const calc = windowResult(design, api.roughness(design, options).mode, rough, angle);
        return fs.readFileSync(file, 'utf8') !== csvFromRows(scatterColumns(en, 'ppm', every, calc), scatterRows(calc, every));
    }).map(([what]) => what);
    ok('the CSV is the window\'s table with every curve and the loss in ppm through its Copy CSV', wrong.length === 0, wrong.join(', '));
    // Each value in the unit its heading names: (HL)^4 H with σ 2 nm, the row
    // at 500 nm, T smooth 2.25 % and a specular loss of 4343.6 ppm.
    const file = path.join(WORK, 'units.csv');
    const sample = new objects.Design(mirror).roughness({ sigma: 2, ...RANGE });
    sample.saveCsv(file);
    const [heading, ...lines] = fs.readFileSync(file, 'utf8').split('\n').map(line => line.split(','));
    const at500 = lines.find(line => Number(line[0]) === 500).map(Number);
    const read = label => at500[heading.indexOf(label)];
    ok('the CSV writes R and T in % and the loss in ppm, as its headings name them',
        same([read('T smooth (%)').toFixed(2), read('Specular loss (ppm)').toFixed(1), read('T smooth (%)'), read('Specular loss (ppm)')],
            ['2.25', '4343.6', sample.smooth.T.at(500) * 100, sample.loss.at(500) * 1e6]), at500.join(','));
    const r = new objects.Design(mirror).roughness({ sigma: 2, ...RANGE });
    const plain = api.roughness(mirror, { sigma: 2, ...RANGE });
    ok('the object\'s curves are the call\'s', same([r.smooth.R.at(550), [...r.rough.Tp], [...r.loss], r.loss.max(), r.longRange],
        [plain.smooth.R[plain.wavelength.indexOf(550)], plain.rough.Tp, plain.loss, Math.max(...plain.loss), true]));
    const shown = inspect(r);
    ok('it prints its side, angle, range and thinned layers', shown === '<Roughness front at 0 degrees from 400 to 800 nm, 81 points, 0 layers thinned to 0 nm>', shown);
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    // On the whole part of a design coated on one side, a row without a side
    // is that side's.
    const backOnly = corpus.find(([name]) => name === 'back-only-side')[1];
    const sideless = api.roughness(backOnly, { side: 'total', sigma: 0, interfaces: [{ interface: 1, sigma: 4 }], ...RANGE });
    const named = api.roughness(backOnly, { side: 'total', sigma: 0, interfaces: [{ side: 'back', interface: 1, sigma: 4 }], ...RANGE });
    ok('on the whole part of a design coated on the back alone, a row without a side is the back\'s',
        same(sideless, named) && !same(sideless.rough, sideless.smooth));
    const zeroFront = { ...backOnly, frontLayers: [{ id: 'F0', material: backOnly.backLayers[0].material, thickness: 0 }] };
    ok('and so it is when the front holds only a layer of 0 nm',
        same(api.roughness(zeroFront, { side: 'total', sigma: 0, interfaces: [{ interface: 1, sigma: 4 }], ...RANGE }).rough, named.rough));
    const REFUSED = [
        ['an option it does not take', () => api.roughness(mirror, { sigmas: [] }), 'unknownOption', { option: 'sigmas' },
            /^roughness: unknown option 'sigmas'; the options are sigma, range, interfaces, start, end, step, angle, side$/],
        ['a σ below 0', () => api.roughness(mirror, { sigma: -1 }), 'badValue', { option: 'sigma', value: -1 }, /sigma is a roughness in nm, 0 or more, not -1$/],
        ['a σ that is not a number', () => api.roughness(mirror, { sigma: '2' }), 'badValue', { option: 'sigma', value: '2' }, /sigma is a roughness in nm, 0 or more, not "2"$/],
        ['a kind it does not have', () => api.roughness(mirror, { range: 'medium' }), 'badValue', { option: 'range', value: 'medium' }, /range is 'short' or 'long', not "medium"$/],
        ['interfaces that are not a list', () => api.roughness(mirror, { interfaces: { interface: 1 } }), 'badValue', { option: 'interfaces' },
            /interfaces is a list of rows, each \{ side, interface, sigma, range \}, not /],
        ['a row that is not a record', () => api.roughness(mirror, { interfaces: [5] }), 'badValue', { option: 'interfaces[0]', value: 5 },
            /interfaces\[0\] is a row \{ side, interface, sigma, range \}, not 5$/],
        ['a field a row does not have', () => api.roughness(mirror, { interfaces: [{ interface: 1, thickness: 2 }] }), 'unknownOption', { option: 'interfaces[0].thickness' },
            /unknown option 'interfaces\[0\]\.thickness'; the options are side, interface, sigma, range$/],
        ['a row for a side not computed', () => api.roughness(mirror, { interfaces: [{ side: 'back', interface: 0 }] }), 'badValue', { option: 'interfaces[0].side', value: 'back' },
            /interfaces\[0\]\.side is 'front', the side computed, not "back"$/],
        ['a row with no side on the whole part of a design coated on both sides', () => api.roughness(twoSided, { interfaces: [{ interface: 0 }] }), 'badValue', { option: 'interfaces[0].side' },
            /interfaces\[0\]\.side is 'front' or 'back', given on each row of a whole part coated on both sides, not undefined$/],
        ['a back row on the whole part of a design coated on the front alone', () => api.roughness(mirror, { side: 'total', interfaces: [{ side: 'back', interface: 0 }] }), 'emptySide', { side: 'back' },
            /^roughness: the back has no layer thicker than 0 nm$/],
        ['a front row on the whole part of a design coated on the back alone', () => api.roughness(backOnly, { side: 'total', interfaces: [{ side: 'front', interface: 0 }] }), 'emptySide', { side: 'front' },
            /^roughness: the front has no layer thicker than 0 nm$/],
        ['a row on a bare front', () => api.roughness(backOnly, { side: 'front', interfaces: [{ interface: 0 }] }), 'emptySide', { side: 'front' },
            /^roughness: the front has no layer thicker than 0 nm$/],
        ['a front row on the whole part when the front holds only a layer of 0 nm', () => api.roughness(zeroFront, { side: 'total', interfaces: [{ side: 'front', interface: 0 }] }), 'emptySide', { side: 'front' },
            /^roughness: the front has no layer thicker than 0 nm$/],
        ['a row on a front of 0 nm layers', () => api.roughness(zeroFront, { side: 'front', interfaces: [{ interface: 1 }] }), 'emptySide', { side: 'front' },
            /^roughness: the front has no layer thicker than 0 nm$/],
        ['an interface past the side\'s count', () => api.roughness(mirror, { interfaces: [{ interface: 10 }] }), 'badValue', { option: 'interfaces[0].interface', value: 10 },
            /interfaces\[0\]\.interface is a whole number from 0, the substrate's surface, to 9, the front's layer count, not 10$/],
        ['an interface that is not whole', () => api.roughness(mirror, { interfaces: [{ interface: 2.5 }] }), 'badValue', { option: 'interfaces[0].interface', value: 2.5 }, /not 2\.5$/],
        ['one interface given twice', () => api.roughness(mirror, { interfaces: [{ interface: 3 }, { interface: 3, sigma: 2 }] }), 'badValue', { option: 'interfaces[1].interface', value: 3 },
            /interfaces\[1\]\.interface is an interface no other row of the front names, not 3$/],
        ['a row\'s σ below 0', () => api.roughness(mirror, { interfaces: [{ interface: 3, sigma: -2 }] }), 'badValue', { option: 'interfaces[0].sigma', value: -2 },
            /interfaces\[0\]\.sigma is a roughness in nm, 0 or more, not -2$/],
        ['a row\'s kind it does not have', () => api.roughness(mirror, { interfaces: [{ interface: 3, range: 'mid' }] }), 'badValue', { option: 'interfaces[0].range', value: 'mid' },
            /interfaces\[0\]\.range is 'short' or 'long', not "mid"$/],
        ['a row on a side with no layers', () => api.roughness(mirror, { side: 'back', interfaces: [{ interface: 0 }] }), 'emptySide', { side: 'back' },
            /^roughness: the back has no layer thicker than 0 nm$/],
        ['an angle of 90', () => api.roughness(mirror, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90$/],
        ['a range that runs down', () => api.roughness(mirror, { start: 800, end: 400 }), 'wavelengthRange', { from: 800, to: 400 }, /start and end are wavelengths in nm, 0 < start < end$/],
        ['a side it does not have', () => api.roughness(mirror, { side: 'whole' }), 'badValue', { option: 'side', value: 'whole' }, /side is 'front', 'back' or 'total', not "whole"$/],
    ];
    for (const [what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call: 'roughness', ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`roughness refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith('roughness: ')],
            [code, { call: 'roughness', ...fields }, true, true]), `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const [[name, lost] = []] = unresolved;
    const messages = ['roughness', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
    const objectError = thrown(() => new objects.Design(mirror).roughness({ interfaces: [{ interface: 12 }] }));
    ok('the object words a refusal as its own method', /^roughness: interfaces\[0\]\.interface is a whole number from 0, the substrate's surface, to 9, the front's layer count, not 12$/.test(objectError?.message ?? ''),
        objectError?.message);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

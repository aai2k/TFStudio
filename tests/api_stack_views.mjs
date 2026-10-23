/**
 * The headless API's indexProfile and layerThicknesses (src/api/stackViews.js)
 * against the Refractive Index Profile and Layer Thicknesses windows' own
 * code, and designFacts and a layer's QWOT (src/api/designFacts.js) against
 * the Report's design summary, the TT merit row and the Design Editor.
 *
 *   1. On the corpus designs with no catalog, each made coated on both sides
 *      too, in every surface mode, on every side with layers and at several
 *      wavelengths: indexProfile is computeProfileForSide field by field on
 *      one side and computeTotalRegions on the whole part, its layers carry
 *      the Design Editor's numbers, its sums are the window's summary and its
 *      outOfRange the window's range notice; layerThicknesses is
 *      computeThicknessRows on each side, front rows first on the whole part;
 *      saveCsv writes the window's table, csvFromRows of buildProfileTable,
 *      without the lead-in and tail on one side. A layer with no thickness is
 *      left out of the profile and keeps its row, and a design whose
 *      materials resolve to nothing is refused by both.
 *   2. Without side both follow the design's evaluation mode, for every pair
 *      of surface mode and scoring; without wavelength they read at the
 *      design's reference wavelength, and at the windows' 550 nm for a
 *      design that holds none.
 *   3. designFacts without side is designSummary: its total thickness, the
 *      optical thickness its rows add up to and their materials, on the
 *      sides the TT row sums; its thickness is the TT row's value with each
 *      surface mode and scoring, and each side its layers' sum.
 *   4. Each QWOT designFacts gives is the Design Editor's nmToUnit, null where
 *      the editor has none, and each row of layerThicknesses at the reference
 *      wavelength gives it too; setLayer with qwot sets unitToNm's thickness,
 *      which reads back as the QWOT set, on the front and the back, with a
 *      new material converted with that material.
 *   5. Each name and value they cannot use is refused with the code and
 *      fields an object layer words it from: an unknown option, a wavelength
 *      that is not one, a side the calls do not have, a side with no layers,
 *      a design with none, qwot with thickness, a qwot of 0 or less, and a
 *      qwot for a material that resolves to nothing or whose n is 0 or less.
 *
 * Run: node tests/api_stack_views.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { computeProfileForSide, computeTotalRegions } = await import('../src/components/windows/analysis/refractiveIndexProfiler/profileModel.js');
const { buildProfileTable } = await import('../src/components/windows/analysis/refractiveIndexProfiler/profileViewModel.js');
const { profilerSession } = await import('../src/components/windows/analysis/refractiveIndexProfiler/sessionState.js');
const { computeThicknessRows } = await import('../src/components/windows/analysis/layerThicknesses/thicknessModel.js');
const { thicknessSession } = await import('../src/components/windows/analysis/layerThicknesses/sessionState.js');
const { nmToUnit, unitToNm, resolveMaterial } = await import('../src/components/windows/design/designEditor/units.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { designSummary } = await import('../src/utils/report/reportData/sectionData.js');
const { designRangeCoverage } = await import('../src/utils/materials/materialRange.js');
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { mirrorLayers, resolveEvalMode, effectiveBackLayers } = await import('../src/utils/physics/optimizer.js');
const { coatedSide } = await import('../src/utils/synthesis/qualifiers.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
// What `fn` throws, or null.
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
// The texts of the checks of `checks`, each [held, what], that do not hold.
const failing = checks => checks.filter(([held]) => !held).map(([, what]) => what);
const same = (a, b) => isDeepStrictEqual(a, b);
const sum = layers => layers.reduce((total, layer) => total + layer.thickness, 0);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-stack-views-'));

// ── The designs ────────────────────────────────────────────────────────────
const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const SCORING = ['side', 'total'];
const KEYS = { front: 'frontLayers', back: 'backLayers' };
const stored = (design, side) => design[KEYS[side]] || [];
// The layers of `layers`, another side's, as a side of their own: reversed
// and 20 % thinner, so no number reads as the other side's.
const otherSide = (layers, tag) => [...layers].reverse().map(layer => ({ ...layer, id: `${tag}${layer.id}`, thickness: layer.thickness * 0.8 }));
// `design` coated on both sides in surface mode `mode`, a symmetric design's
// back the mirror of its front.
function made(design, mode) {
    const front = [design.frontLayers, otherSide(design.backLayers, 'f')].find(layers => layers.length);
    const back = { symmetric: mirrorLayers(front) }[mode] ?? [design.backLayers, otherSide(design.frontLayers, 'b')].find(layers => layers.length);
    return { ...design, surfaceMode: mode, frontLayers: front, backLayers: back };
}

const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.indexProfile(design, { side: 'total' }))?.message?.includes('resolve to nothing');
const cases = opened.filter(([, design]) => resolves(design)).flatMap(([name, design]) => [
    [name, design], ...MODES.map(mode => [`${name} ${mode}`, made(design, mode)]),
]);
const unresolved = opened.filter(([, design]) => !resolves(design));

// ── 1. The windows' numbers ────────────────────────────────────────────────
// The layer of `side` the Design Editor numbers `number`.
const EDITOR_INDEX = { front: (count, number) => count - number, back: (count, number) => number - 1 };
const layerAt = (design, side, number) => stored(design, side)[EDITOR_INDEX[side](stored(design, side).length, number)] ?? {};
// What is wrong with `layers` against the window's `valid` layers and
// `bounds`, and with the numbers naming the layers they come from.
function layersWrong(design, layers, valid, bounds, side) {
    const named = layers.map(l => [layerAt(design, side, l.number).material, layerAt(design, side, l.number).thickness]);
    return failing([
        [same(layers.map(l => [l.material, l.n, l.k, l.thickness, l.start, l.end]), valid.map((l, i) => [l.materialId, l.n, l.k, l.d, bounds[i], bounds[i + 1]])), 'its layers are not the window\'s'],
        [same(named, layers.map(l => [l.material, l.thickness])), 'a number names another layer'],
    ]);
}
// The window's summary sums over `layers`, as profileViewModel.js adds them.
const summed = layers => layers.reduce(([d, od], l) => [d + l.d, od + l.n * l.d], [0, 0]);
const notice = (design, lambda, side) => designRangeCoverage(design, [lambda, lambda], side).offenders;
const MEDIUM = { front: 'incidentMedium', back: 'exitMedium' };

function oneSideWrong(design, lambda, side) {
    const got = api.indexProfile(design, { wavelength: lambda, side });
    const profile = computeProfileForSide(withHerpinRecords(design), lambda, side);
    return [
        ...layersWrong(design, got.layers, profile.validLayers, profile.layerBounds, side),
        ...failing([
            [same([got.mode, got.wavelength, got.incident, got.substrate], [side, lambda, { material: design[MEDIUM[side]], ...profile.n0 }, { material: design.substrate.material, ...profile.ns }]), 'its media are not the window\'s'],
            [same([got.thickness, got.opticalThickness], [profile.totalThk, profile.optThk]), 'its sums are not the window\'s'],
            [same(got.outOfRange, notice(design, lambda, side)), 'its outOfRange is not the window\'s notice'],
        ]),
    ];
}

function wholePartWrong(design, lambda) {
    const got = api.indexProfile(design, { wavelength: lambda, side: 'total' });
    const regions = computeTotalRegions(withHerpinRecords(design), lambda, en.riProfile);
    const coats = regions.filter(r => r.key !== 'substrate');
    const bulk = regions.find(r => r.key === 'substrate');
    return [
        ...coats.flatMap(r => layersWrong(design, got.layers.filter(l => l.side === r.key), r.validLayers, r.layerBounds, r.key)),
        ...failing([
            [same(got.layers.map(l => l.side), coats.flatMap(r => r.validLayers.map(() => r.key))), 'its layers are not front first'],
            [same([got.incident, got.substrate], [null, { material: design.substrate.material, n: bulk.n[0], k: bulk.k[0], thickness: bulk.totalThk }]), 'its media are not the window\'s'],
            [same([got.thickness, got.opticalThickness], summed(coats.flatMap(r => r.validLayers))), 'its sums are not the window\'s'],
            [same(got.outOfRange, notice(design, lambda, 'total')), 'its outOfRange is not the window\'s notice'],
        ]),
    ];
}

// The window's rows of `side`, numbered, with `withSide` the side named on each.
const windowRows = (design, side, lambda, withSide) => computeThicknessRows(withHerpinRecords(design), side, lambda).map(r => ({
    ...withSide, number: r.layerNumber, material: r.materialId, thickness: r.d, opticalThickness: r.ot, qwot: r.qwot, fwot: r.fwot,
}));
const LISTED = {
    front: (design, lambda) => windowRows(design, 'front', lambda, {}),
    back: (design, lambda) => windowRows(design, 'back', lambda, {}),
    total: (design, lambda) => ['front', 'back'].flatMap(side => windowRows(design, side, lambda, { side })),
};
function thicknessesWrong(design, lambda, side) {
    const got = api.layerThicknesses(design, { wavelength: lambda, side });
    return failing([
        [same(got.rows, LISTED[side](design, lambda)), 'its rows are not the window\'s'],
        [same(got.outOfRange, notice(design, lambda, side)), 'its outOfRange is not the window\'s notice'],
    ]);
}

// The rows of the window's CSV of `design` at `lambda` on `side`: on one side
// without the lead-in and tail the window draws.
const TABLES = {
    one: (shown, lambda, side) => buildProfileTable(false, computeProfileForSide(shown, lambda, side), [], en.units),
    total: (shown, lambda) => buildProfileTable(true, null, computeTotalRegions(shown, lambda, en.riProfile), en.units),
};
const DRAWN_ENDS = { one: rows => rows.slice(1, -1), total: rows => rows };
function windowCsv(design, lambda, side) {
    const kind = side === 'total' ? 'total' : 'one';
    const { columns, rows } = TABLES[kind](withHerpinRecords(design), lambda, side);
    return csvFromRows(columns, DRAWN_ENDS[kind](rows)).split('\n').map(line => line.split(','));
}
let file = 0;
function csvWrong(design, lambda, side) {
    const written = path.join(WORK, `profile-${file++}.csv`);
    new objects.IndexProfile(api.indexProfile(design, { wavelength: lambda, side })).saveCsv(written);
    const got = fs.readFileSync(written, 'utf8').split('\r\n').filter(Boolean).map(line => line.split(','));
    return failing([[same(got, windowCsv(design, lambda, side)), 'its CSV is not the window\'s']]);
}

const sidesWith = design => ['front', 'back'].filter(side => stored(design, side).length);
const PROFILE_CHECKS = { front: oneSideWrong, back: oneSideWrong, total: wholePartWrong };
const views = cases.flatMap(([name, design]) => [design.referenceWavelength, 400, 633, 1064].flatMap(lambda =>
    [...sidesWith(design), 'total'].map(side => ({ name, design, lambda, side }))));
const wrong = views.flatMap(({ name, design, lambda, side }) => [
    ...PROFILE_CHECKS[side](design, lambda, side), ...thicknessesWrong(design, lambda, side), ...csvWrong(design, lambda, side),
].map(what => `${name} ${side} ${lambda}: ${what}`));
ok(`on ${cases.length} designs, ${views.length} views of a side or the whole part, indexProfile and layerThicknesses are the windows' computations and saveCsv the window's table`,
    cases.length >= 50 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
{
    // A layer with no thickness is left out of the profile and keeps its row, and the numbers skip it.
    const design = api.stackFromFormula(api.newDesign({ name: 'Gap' }), { formula: 'HLHL' });
    const [outer, gap, ...inner] = design.frontLayers;
    const gapped = { ...design, frontLayers: [outer, { ...gap, thickness: 0 }, ...inner] };
    const numbers = api.indexProfile(gapped).layers.map(l => l.number);
    ok('a layer with no thickness is left out of the profile, the others keeping their numbers, and keeps its row of thicknesses',
        same([numbers, api.layerThicknesses(gapped).rows.map(r => r.thickness === 0), oneSideWrong(gapped, 550, 'front')], [[4, 2, 1], [false, false, true, false], []]), numbers.join());
}
{
    const [[name, design] = []] = unresolved;
    const CALLS = { indexProfile: undefined, layerThicknesses: undefined, spectrum: { from: 500, to: 600 } };
    const refusedBoth = Object.entries(CALLS).map(([call, options]) => thrown(() => api[call](design, options))?.message);
    ok(`a design whose materials resolve to nothing (${name}) is refused by both, as spectrum refuses it`,
        !!design && new Set(refusedBoth).size === 1 && /resolve to nothing/.test(refusedBoth[0]), refusedBoth.join(' / '));
}

// ── 2. The defaults ────────────────────────────────────────────────────────
{
    const pairs = cases.filter(([n]) => n.endsWith('both_independent')).flatMap(([name, design]) => MODES.flatMap(surfaceMode => SCORING.map(mfEvalMode =>
        [name, { ...design, surfaceMode, mfEvalMode, backLayers: { symmetric: mirrorLayers(design.frontLayers) }[surfaceMode] ?? design.backLayers }])));
    const wrongModes = pairs.filter(([, each]) => {
        const evalMode = resolveEvalMode(each);
        const found = ['indexProfile', 'layerThicknesses'].map(call => [api[call](each).mode, same(api[call](each), api[call](each, { side: evalMode }))]);
        return !same(found, [[evalMode, true], [evalMode, true]]);
    }).map(([name, each]) => `${name} ${each.surfaceMode}/${each.mfEvalMode}`);
    ok('without side both follow the design\'s evaluation mode, for every surface mode and scoring', pairs.length >= 80 && wrongModes.length === 0, wrongModes.slice(0, 3).join('; '));
    const design = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H', referenceWavelength: 600 });
    const bare = { ...design, referenceWavelength: undefined };
    const at = d => ['indexProfile', 'layerThicknesses'].map(call => api[call](d).wavelength);
    const opens = d => [profilerSession.peek(d, null).lambda, thicknessSession.peek(d, null).lambda];
    ok('without wavelength both read at the design\'s reference wavelength, as the windows open at it, and at the windows\' own 550 nm for a design that holds none',
        same([at(design), opens(design), at(bare), opens(bare)], [[600, 600], [600, 600], [550, 550], [550, 550]])
        && same(api.indexProfile(design), api.indexProfile(design, { wavelength: 600 })), JSON.stringify(at(bare)));
}

// ── 3. The facts are the design summary's and the TT row's ─────────────────
const COATED = { front: ['front'], back: ['back'], both: ['front', 'back'] };
const COATED_MODE = { front: 'front', back: 'back', both: 'total' };
// The summary's rows of `side` in stored order: the front from its outer layer in, the back from the substrate out.
const SUMMARY_ROWS = { front: summary => [...summary.front].reverse(), back: summary => summary.back };
const ttOf = design => api.merit(api.setMerit(design, [{ type: 'TT', target: 0 }])).rows[0].value;
const countsOf = ids => ids.reduce((counts, id) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }), {});
// What designFacts of `design` should be, from its design summary.
function fromSummary(design) {
    const summary = designSummary(design);
    const coated = COATED[coatedSide(design)];
    const rows = coated.flatMap(side => SUMMARY_ROWS[side](summary));
    return {
        // The summary lists the stacks the design is evaluated with, which hold the coated sides.
        listed: rows.length === coated.map(side => stored(design, side).length).reduce((total, count) => total + count, 0),
        facts: {
            mode: COATED_MODE[coatedSide(design)], wavelength: summary.referenceWavelength, thickness: summary.totalThickness,
            opticalThickness: rows.reduce((total, row) => total + row.ot, 0), layerCounts: countsOf(rows.map(row => row.materialId)),
        },
    };
}
{
    const scored = cases.flatMap(([name, design]) => SCORING.map(mfEvalMode => [`${name} ${mfEvalMode}`, { ...design, mfEvalMode }]));
    const factsWrong = scored.flatMap(([name, each]) => {
        const { qwot, ...facts } = api.designFacts(each);
        const expected = fromSummary(each);
        const front = stored(each, 'front'), back = effectiveBackLayers(each);
        const coated = COATED[coatedSide(each)];
        const sides = ['front', 'back', 'total'].map(side => api.designFacts(each, { side }).thickness);
        return failing([
            [expected.listed && same(facts, expected.facts), `${JSON.stringify(facts)} / ${JSON.stringify(expected.facts)}`],
            [facts.thickness === ttOf(each), `${facts.thickness} / TT ${ttOf(each)}`],
            [same(sides, [sum(front), sum(back), sum([...front, ...back])]), `sides ${sides}`],
            [same([qwot.front.length, qwot.back.length], [front.length * coated.includes('front'), back.length * coated.includes('back')]), 'its QWOT lists a side not counted'],
        ]).map(what => `${name}: ${what}`);
    });
    ok(`on ${scored.length} designs scored on their side and on the whole part, designFacts is designSummary's total, optical thickness and materials, its thickness the TT row's value, and each side its layers' sum`,
        scored.length >= 100 && factsWrong.length === 0, factsWrong.slice(0, 3).join('\n'));
    const symmetric = cases.find(([n]) => n.endsWith('symmetric'))[1];
    const frontOnly = cases.find(([n]) => n.endsWith('front_only'))[1];
    const facts = api.designFacts(symmetric);
    ok('a symmetric design counts its front once by default, and its mirror too on total, and a back a design coated on the front holds counts not at all',
        same([facts.mode, facts.qwot.back.length, api.designFacts(symmetric, { side: 'total' }).thickness, api.designFacts(frontOnly).thickness, api.designFacts(frontOnly).qwot.back.length],
            ['front', 0, facts.thickness + sum(effectiveBackLayers(symmetric)), sum(frontOnly.frontLayers), 0]) && frontOnly.backLayers.length > 0);
    const [name, design] = unresolved[0] ?? [];
    const missing = api.designFacts(design ?? api.newDesign());
    ok(`on a design whose material resolves to nothing (${name}), its optical thickness and that layer's QWOT are null`,
        same([missing.opticalThickness, missing.qwot.front.includes(null), Number.isFinite(missing.thickness)], [null, true, true]), JSON.stringify(missing.qwot));
}

// ── 4. QWOT is the Design Editor's ─────────────────────────────────────────
// The QW column of the Design Editor, which reads the design with the Herpin
// layers' materials it rebuilds, at its reference wavelength, and the
// editor's n of a layer there, NaN where its material resolves to nothing.
const editorQwot = (design, layer) => nmToUnit(layer.thickness, layer.material, design.referenceWavelength || 550, 'QWOT', withHerpinRecords(design).materials);
const editorN = (design, layer) => resolveMaterial(layer.material, withHerpinRecords(design).materials)?.getNK(design.referenceWavelength || 550)[0] ?? NaN;
// The QWOT the editor shows, null where it has none: n of 0 or less, or no material.
const shownQwot = (design, layer) => [null, editorQwot(design, layer)][Number(editorN(design, layer) > 0)];
const NUMBERED = { front: design => [...stored(design, 'front')].reverse(), back: design => effectiveBackLayers(design) };
{
    const qwotWrong = [...cases, ...unresolved].flatMap(([name, design]) => {
        const { qwot } = api.designFacts(design, { side: 'total' });
        return ['front', 'back'].flatMap(side => failing([[same(qwot[side], NUMBERED[side](design).map(layer => shownQwot(design, layer))), `${name} ${side}: ${qwot[side]}`]]));
    });
    const rowsWrong = cases.flatMap(([name, design]) => sidesWith(design).flatMap(side => {
        const { rows } = api.layerThicknesses(design, { side });
        return failing([[same(rows.map(r => r.qwot), rows.map(row => editorQwot(design, layerAt(design, side, row.number)))), `${name} ${side} rows`]]);
    }));
    ok('each QWOT designFacts gives is the Design Editor\'s nmToUnit, null where the editor has none, and layerThicknesses at the reference wavelength gives the same',
        [...qwotWrong, ...rowsWrong].length === 0, [...qwotWrong, ...rowsWrong].slice(0, 3).join('\n'));
}
{
    const design = api.setDesignSetup(api.stackFromFormula(api.newDesign({ name: 'QW' }), { formula: '(HL)^2', referenceWavelength: 633 }), { surfaceMode: 'both_independent' });
    const twoSided = api.insertLayer(api.insertLayer(design, { side: 'back', material: 'MgF2', thickness: 80 }), { side: 'back', material: 'Ta2O5', thickness: 30 });
    // Each [side, index, qwot, the layer's material after], the last with a new material.
    const SETS = [['front', 0, 1.7, {}], ['front', 3, 0.35, {}], ['back', 1, 2.25, {}], ['front', 2, 1.5, { material: 'Al2O3' }]];
    const NUMBER = { front: (count, index) => count - index, back: (count, index) => index + 1 };
    const setWrong = SETS.flatMap(([side, index, qwot, changed]) => {
        const set = api.setLayer(twoSided, { side, index, qwot, ...changed });
        const material = changed.material ?? stored(twoSided, side)[index].material;
        const layer = stored(set, side)[index];
        const read = api.designFacts(set, { side }).qwot[side][NUMBER[side](stored(set, side).length, index) - 1];
        return failing([[same([layer.thickness, layer.material, Math.abs(read - qwot) < 1e-12 * qwot], [unitToNm(qwot, material, 633, 'QWOT', twoSided.materials), material, true]),
            `${side} ${index}: ${layer.thickness} nm, read ${read}`]]);
    });
    ok('setLayer with qwot sets the thickness unitToNm gives, which reads back as the QWOT set, on the front and the back, a new material converting with that material',
        setWrong.length === 0, setWrong.join('; '));
    const quarter = api.setLayer(twoSided, { index: 0, qwot: 1 }).frontLayers[0].thickness;
    ok('a QWOT of 1 is the quarter wave the stack formula builds', Math.abs(quarter - twoSided.frontLayers[0].thickness) < 1e-9, `${quarter} / ${twoSided.frontLayers[0].thickness}`);
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const design = api.stackFromFormula(api.newDesign({ name: 'Stack' }), { formula: '(HL)^2' });
    const NO_LAYER = { indexProfile: /the back has no layer thicker than 0 nm/, layerThicknesses: /the back has no layers/ };
    const REFUSED = [
        ...['indexProfile', 'layerThicknesses'].flatMap(call => [
            [call, 'an option it does not take', () => api[call](design, { lambda: 550 }), 'unknownOption', { option: 'lambda', options: ['wavelength', 'side'] }, /unknown option 'lambda'; the options are wavelength, side/],
            [call, 'a wavelength of 0', () => api[call](design, { wavelength: 0 }), 'badValue', { option: 'wavelength', value: 0 }, /wavelength is a wavelength in nm above 0, not 0/],
            [call, 'a wavelength as text', () => api[call](design, { wavelength: '550' }), 'badValue', { option: 'wavelength', value: '550' }, /not "550"/],
            [call, 'a side it does not have', () => api[call](design, { side: 'both' }), 'badValue', { option: 'side', takes: "'front', 'back' or 'total'", value: 'both' }, /side is 'front', 'back' or 'total', not "both"/],
            [call, 'a side with no layers', () => api[call](design, { side: 'back' }), 'emptySide', { side: 'back' }, NO_LAYER[call]],
            [call, 'a design with no layers on the whole part', () => api[call](api.newDesign(), { side: 'total' }), 'noLayers', {}, /the design has no layers/],
        ]),
        ['designFacts', 'an option it does not take', () => api.designFacts(design, { sides: 'front' }), 'unknownOption', { option: 'sides', options: ['side'] }, /unknown option 'sides'; the options are side/],
        ['designFacts', 'a side it does not have', () => api.designFacts(design, { side: 'both' }), 'badValue', { option: 'side', value: 'both' }, /side is 'front', 'back' or 'total', not "both"/],
        ['setLayer', 'a qwot of 0', () => api.setLayer(design, { index: 0, qwot: 0 }), 'badValue', { option: 'qwot', value: 0 }, /qwot is a quarter-wave optical thickness above 0, not 0/],
        ['setLayer', 'a qwot of NaN', () => api.setLayer(design, { index: 0, qwot: NaN }), 'badValue', { option: 'qwot' }, /not NaN/],
    ];
    for (const [call, what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call, ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`${call} refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith(`${call}: `)], [code, { call, ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const both = thrown(() => api.setLayer(design, { index: 0, qwot: 1, thickness: 50 }));
    ok('setLayer refuses thickness and qwot at once', both?.message === 'setLayer: give thickness or qwot, not both', both?.message);
    const [outer, ...inner] = design.frontLayers;
    const nowhere = { ...design, frontLayers: [{ ...outer, material: 'NoSuchFilm' }, ...inner] };
    const lost = thrown(() => api.setLayer(nowhere, { index: 0, qwot: 1 })) ?? {};
    ok('and a qwot for a layer whose material resolves to nothing, which has no quarter wave', same([lost.code, lost.fields, lost.message], ['noQwot',
        { call: 'setLayer', material: 'NoSuchFilm', wavelength: 550, n: null }, "setLayer: the layer's material 'NoSuchFilm' resolves to nothing, so it has no quarter wave; give its thickness in nm"]), lost.message);
    const NEGATIVE = { name: 'Negative index', formulaNum: -1, tabData: [[300, -0.5, 1], [900, -0.5, 1]] };
    const negative = { ...design, materials: { ...design.materials, negative: NEGATIVE }, frontLayers: [{ ...outer, material: 'negative' }, ...inner] };
    const below = thrown(() => api.setLayer(negative, { index: 0, qwot: 1 })) ?? {};
    ok('and one whose material has n of 0 or less, both reading null', same([below.code, below.fields?.n, api.designFacts(negative).qwot.front.at(-1), api.designFacts(nowhere).qwot.front.at(-1)], ['noQwot', -0.5, null, null])
        && /material 'negative' has n = -0.5 at 550 nm, so it has no quarter wave/.test(below.message), below.message);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

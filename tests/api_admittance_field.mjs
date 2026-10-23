/**
 * The headless API's admittance (src/api/admittance.js) and electricField
 * (src/api/electricField.js) against the Admittance Diagram and Electric
 * Field windows' own code, and against the spectrum and the EFMX merit row.
 *
 *   1. On the corpus designs with no catalog, each made coated on both sides
 *      too, in every surface mode, on every side with layers: admittance at 0
 *      and 45 degrees in both planes is buildDiagramData for both
 *      polarizations, its boundaries buildAdmittanceTableRows row by row with
 *      the layers' Design Editor numbers, its outOfRange the window's range
 *      notice, and saveCsv writes the window's Copy CSV; its complex values
 *      are in Macleod's sign, silver's admittance n − ik; electricField at 0
 *      and 45 degrees is computeProfile for s, p and avg, its depth depthScale
 *      in each unit, its amplitude the window's amplitude reading from
 *      incidentAmplitudeVpm, its layers the window's layers with their
 *      numbers, and saveCsv writes the window's table at its factory display.
 *   2. Cross-checks: on the designs with no cone scored on the side computed,
 *      |Γ|² at the outer surface is spectrum's Rs and Rp to 1e-12; on every
 *      design with no cone, an EFMX merit row for s, p and avg is the peak of
 *      that field's e2, on the side the row scores.
 *   3. Defaults: without side both compute the back of a back-only design and
 *      the front of any other, for every surface mode and scoring; without
 *      wavelength they read at the design's reference wavelength, as the
 *      windows open at it, and at 550 nm for a design that holds none; the
 *      angle, plane, depth unit and reference are the windows' factory ones.
 *   4. pointsPerLayer: without it computeProfile and the API take 60 per
 *      layer, so the window is unchanged; another count gives that many
 *      samples across each layer, and computeProfile takes it.
 *   5. Refusals with their codes and fields: an unknown option, a wavelength,
 *      angle, side, plane, depth unit, reference or point count it cannot use,
 *      more samples than the limit, a side with no layers or none thicker
 *      than 0 nm, and a design whose materials resolve to nothing.
 *
 * Run: node tests/api_admittance_field.mjs
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
const { buildDiagramData, sideStackLayers } = await import('../src/components/windows/analysis/admittanceDiagram/model.js');
const { buildAdmittanceTableRows, buildMaterialNames, tableColumns } = await import('../src/components/windows/analysis/admittanceDiagram/tableModel.js');
const { admittanceSession } = await import('../src/components/windows/analysis/admittanceDiagram/sessionState.js');
const { computeProfile } = await import('../src/components/windows/analysis/eFieldEvaluation/profileModel.js');
const { buildProfileTable } = await import('../src/components/windows/analysis/eFieldEvaluation/profileViewModel.js');
const { eFieldSession } = await import('../src/components/windows/analysis/eFieldEvaluation/sessionState.js');
const { depthScale, X_UNIT_IDS } = await import('../src/components/windows/analysis/eFieldEvaluation/xScale.js');
const { incidentAmplitudeVpm } = await import('../src/components/windows/analysis/eFieldEvaluation/yScale.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { designRangeCoverage } = await import('../src/utils/materials/materialRange.js');
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { mirrorLayers, resolveEvalMode, makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const failing = checks => checks.filter(([held]) => !held).map(([, what]) => what);
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-fields-'));

// ── The designs ────────────────────────────────────────────────────────────
const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const SCORING = ['side', 'total'];
const KEYS = { front: 'frontLayers', back: 'backLayers' };
const stored = (design, side) => design[KEYS[side]] || [];
const otherSide = (layers, tag) => [...layers].reverse().map(layer => ({ ...layer, id: `${tag}${layer.id}`, thickness: layer.thickness * 0.8 }));
function made(design, mode) {
    const front = [design.frontLayers, otherSide(design.backLayers, 'f')].find(layers => layers.length);
    const back = { symmetric: mirrorLayers(front) }[mode] ?? [design.backLayers, otherSide(design.frontLayers, 'b')].find(layers => layers.length);
    return { ...design, surfaceMode: mode, frontLayers: front, backLayers: back };
}
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const cases = opened.filter(([, design]) => resolves(design)).flatMap(([name, design]) => [
    [name, design], ...MODES.map(mode => [`${name} ${mode}`, made(design, mode)]),
]);
const unresolved = opened.filter(([, design]) => !resolves(design));
const sidesWith = design => ['front', 'back'].filter(side => stored(design, side).length);
const lambdaOf = design => design.referenceWavelength || 550;
const hasCone = design => coneIsActive(makeConeSpec(design.cone || {}));
// The layer of `side` the Design Editor numbers `number`.
const EDITOR_INDEX = { front: (count, number) => count - number, back: (count, number) => number - 1 };
const layerAt = (design, side, number) => stored(design, side)[EDITOR_INDEX[side](stored(design, side).length, number)] ?? {};
const notice = (design, lambda, side) => designRangeCoverage(design, [lambda, lambda], side).offenders;
const csvOf = file => fs.readFileSync(file, 'utf8');
let written = 0;
const saved = result => {
    const file = path.join(WORK, `out-${written++}.csv`);
    result.saveCsv(file);
    return csvOf(file);
};

// ── 1. The windows' numbers: admittance ────────────────────────────────────
// What is wrong with admittance of `design` on `side` against the window.
function admittanceWrong(design, side, angle, plane) {
    const lambda = lambdaOf(design);
    const got = api.admittance(design, { wavelength: lambda, angle, side, plane });
    const shown = withHerpinRecords(design);
    const series = buildDiagramData(shown, { lambda_nm: lambda, theta_deg: angle, pol: 'avg', side, view: plane });
    const names = buildMaterialNames(shown, sideStackLayers(shown, side).filter(l => l.thickness > 0));
    const rows = buildAdmittanceTableRows(series, names, shown);
    const perPol = rows.length / 2;
    const polWrong = ['s', 'p'].flatMap((pol, i) => {
        const one = series[i], locus = got[pol], table = rows.slice(i * perPol, (i + 1) * perPol);
        const asRows = locus.boundaries.map(b => [b.name, b.Y.re, b.Y.im, b.gamma.re, b.gamma.im]);
        const numbered = locus.boundaries.slice(1).map(b => layerAt(design, side, b.layer).material);
        return failing([
            [one.pol === pol && same([locus.eta0, locus.etaSubstrate], [{ re: one.eta0[0], im: one.eta0[1] }, { re: one.etaS[0], im: one.etaS[1] }]), `${pol} eta0 or etaSubstrate`],
            [same(locus.arcs, one.arcs.map(a => ({ layer: a.layerNum, material: a.material, re: a.re, im: a.im }))), `${pol} arcs`],
            [same(asRows, table.slice(0, -1).map(r => [r.material, r.re, r.im, r.gRe, r.gIm])), `${pol} boundaries are not the table's rows`],
            [same(locus.boundaries.map(b => b.layer), [0, ...one.arcs.map(a => a.layerNum)]) && table.slice(1, -1).every((r, k) => r.layer === `L${locus.boundaries[k + 1].layer} (${pol})`), `${pol} layer numbers`],
            [same(numbered, locus.boundaries.slice(1).map(b => b.material)), `${pol} a number names another layer`],
        ]);
    });
    const csv = csvFromRows(tableColumns(en), rows);
    return [...polWrong, ...failing([
        [same([got.mode, got.wavelength, got.angle, got.plane], [side, lambda, angle, plane]), 'its conditions'],
        [same([got.incident.name, got.substrate.name], [rows[perPol - 1].material, rows[0].material]), 'the media\'s names'],
        [same(got.outOfRange, notice(design, lambda, side)), 'its outOfRange is not the window\'s notice'],
        [saved(new objects.Admittance(got)) === csv, 'its CSV is not the window\'s'],
    ])];
}
{
    const views = cases.flatMap(([name, design]) => sidesWith(design).flatMap(side => [0, 45].flatMap(angle => ['admittance', 'reflection'].map(plane => ({ name, design, side, angle, plane })))));
    const wrong = views.flatMap(({ name, design, side, angle, plane }) => admittanceWrong(design, side, angle, plane).map(what => `${name} ${side} ${angle} ${plane}: ${what}`));
    ok(`on ${cases.length} designs, ${views.length} views of a side, admittance is the window's diagram and table, and saveCsv its Copy CSV`,
        cases.length >= 50 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
}

{
    // Macleod's sign: a metal substrate of index n + ik as the catalogs hold it
    // has the admittance n − ik at normal incidence.
    const silver = api.stackFromFormula(api.newDesign({ name: 'On silver', substrate: 'Ag' }), { formula: 'L' });
    const [{ n, k }] = api.materialNK('Ag', [550]).nk;
    const { etaSubstrate } = api.admittance(silver, { wavelength: 550 }).s;
    ok('complex values are in Macleod\'s sign: silver\'s admittance is n − ik', k > 1 && Math.abs(etaSubstrate.re - n) < 1e-12 && Math.abs(etaSubstrate.im + k) < 1e-12, JSON.stringify(etaSubstrate));
}

// ── 1. The windows' numbers: electric field ────────────────────────────────
const DISPLAY = { quantity: 'amplitude', component: 'total' };
function fieldWrong(design, side, angle) {
    const lambda = lambdaOf(design);
    const profile = computeProfile(withHerpinRecords(design), { lambda, theta: angle, pol: 'avg', side, refLambda: design.referenceWavelength > 0 ? design.referenceWavelength : null });
    const incident = incidentAmplitudeVpm(profile.incidentIndex);
    const amplitude = e2 => e2.map(v => Math.sqrt(Math.max(0, v)) * incident);
    const valid = stored(design, side).filter(l => l.material && l.thickness > 0);
    return X_UNIT_IDS.flatMap(unit => {
        const got = api.electricField(design, { wavelength: lambda, angle, side, depthUnit: unit });
        const scale = depthScale(profile, unit);
        const fields = ['s', 'p', 'avg'].map(pol => ({ e2: profile[pol].e2, e2Tangential: profile[pol].e2Tangential, e2Normal: profile[pol].e2Normal, amplitude: amplitude(profile[pol].e2) }));
        const layers = profile.validLayers.map((l, i) => [l.materialId, profile.s.layerBounds[i], profile.s.layerBounds[i + 1], scale.bounds[i], scale.bounds[i + 1]]);
        const table = buildProfileTable(profile, 'avg', en.eField, { ...DISPLAY, xUnit: unit });
        return failing([
            [same([got.mode, got.wavelength, got.angle, got.reference, got.depthUnit, got.pointsPerLayer], [side, lambda, angle, profile.refLambda, scale.id, 60]), `${unit} its conditions`],
            [same(got.z, profile.s.z) && same(got.depth, scale.map(profile.s.z)), `${unit} z or depth`],
            [same([got.s, got.p, got.avg], fields) && got.incidentAmplitude === incident, `${unit} the fields`],
            [same(got.layers.map(l => [l.material, l.start, l.end, l.depthStart, l.depthEnd]), layers), `${unit} the layers`],
            [same(got.layers.map(l => layerAt(design, side, l.number)), side === 'back' ? [...valid].reverse() : valid), `${unit} a number names another layer`],
            [same(got.outOfRange, notice(design, lambda, side)), `${unit} outOfRange`],
            [saved(new objects.ElectricField(got)) === csvFromRows(table.columns, table.rows), `${unit} its CSV is not the window's`],
        ]);
    });
}
{
    const views = cases.flatMap(([name, design]) => sidesWith(design).filter(side => stored(design, side).some(l => l.thickness > 0)).flatMap(side => [0, 45].map(angle => ({ name, design, side, angle }))));
    const wrong = views.flatMap(({ name, design, side, angle }) => fieldWrong(design, side, angle).map(what => `${name} ${side} ${angle}: ${what}`));
    ok(`on ${views.length} views of a side, electricField is computeProfile, depthScale in each unit and the window's amplitude, and saveCsv its table`,
        views.length >= 100 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
}

// ── 2. Cross-checks ────────────────────────────────────────────────────────
{
    const scored = cases.filter(([, design]) => !hasCone(design)).flatMap(([name, design]) => SCORING.map(mfEvalMode => [name, { ...design, mfEvalMode }]))
        .filter(([, design]) => ['front', 'back'].includes(resolveEvalMode(design)) && stored(design, resolveEvalMode(design)).length);
    const wrong = scored.flatMap(([name, design]) => [0, 45].flatMap(angle => {
        const lambda = lambdaOf(design);
        const { s, p, mode } = api.admittance(design, { wavelength: lambda, angle });
        const R = locus => { const { gamma } = locus.boundaries.at(-1); return gamma.re ** 2 + gamma.im ** 2; };
        const spectrum = api.spectrum(design, { from: lambda, to: lambda + 1, angles: [angle] });
        const [Rs, Rp] = [spectrum.angles[angle].Rs[0], spectrum.angles[angle].Rp[0]];
        return failing([[mode === spectrum.evalMode && Math.abs(R(s) - Rs) <= 1e-12 && Math.abs(R(p) - Rp) <= 1e-12, `${name} ${mode} ${angle}: ${R(s)} / ${Rs}, ${R(p)} / ${Rp}`]]);
    }));
    ok(`on ${scored.length} designs scored on the side computed, |Γ|² at the outer surface is spectrum's Rs and Rp to 1e-12`, scored.length >= 40 && wrong.length === 0, wrong.slice(0, 3).join('\n'));
}
{
    // The side an EFMX row scores, as phase_field_operands.mjs holds it.
    const rowSide = design => (design.surfaceMode === 'back_only' ? 'back' : 'front');
    const plain = cases.filter(([, design]) => !hasCone(design) && stored(design, rowSide(design)).some(l => l.thickness > 0));
    const peak = values => values.reduce((top, v) => (v > top ? v : top), 0);
    const wrong = plain.flatMap(([name, design]) => [0, 45].flatMap(angle => ['s', 'p', 'avg'].flatMap(pol => {
        const lambda = lambdaOf(design);
        const row = api.merit(api.setMerit(design, [{ type: 'EFMX', lambdaStart: lambda, aoi: angle, pol, target: 0 }])).rows[0].value;
        const field = api.electricField(design, { wavelength: lambda, angle });
        return failing([[row === peak(field[pol].e2), `${name} ${field.mode} ${angle} ${pol}: ${row} / ${peak(field[pol].e2)}`]]);
    })));
    ok(`on ${plain.length} designs with no cone, an EFMX row is the peak of the field's e2 for s, p and avg, on the side the row scores`, plain.length >= 50 && wrong.length === 0, wrong.slice(0, 3).join('\n'));
}

// ── 3. The defaults ────────────────────────────────────────────────────────
{
    const pairs = cases.filter(([n]) => n.endsWith('both_independent')).flatMap(([name, design]) => MODES.flatMap(surfaceMode => SCORING.map(mfEvalMode =>
        [name, { ...design, surfaceMode, mfEvalMode, backLayers: { symmetric: mirrorLayers(design.frontLayers) }[surfaceMode] ?? design.backLayers }])));
    const wrongModes = pairs.filter(([, each]) => {
        const side = each.surfaceMode === 'back_only' ? 'back' : 'front';
        return !same([api.admittance(each).mode, api.electricField(each).mode, same(api.admittance(each), api.admittance(each, { side })), same(api.electricField(each), api.electricField(each, { side }))], [side, side, true, true]);
    }).map(([name, each]) => `${name} ${each.surfaceMode}/${each.mfEvalMode}`);
    ok('without side both compute the back of a back-only design and the front of any other, for every surface mode and scoring', pairs.length >= 80 && wrongModes.length === 0, wrongModes.slice(0, 3).join('; '));
    const design = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H', referenceWavelength: 600 });
    const bare = { ...design, referenceWavelength: undefined };
    const at = d => [api.admittance(d).wavelength, api.electricField(d).wavelength, api.electricField(d).reference];
    const opens = d => [admittanceSession.peek(d, null).lambda, eFieldSession.peek(d, null).lambda];
    ok('without wavelength both read at the design\'s reference wavelength, as the windows open at it, and at their 550 nm for a design that holds none, the field\'s depth at the same λ0',
        same([at(design), opens(design), at(bare), opens(bare)], [[600, 600, 600], [600, 600], [550, 550, 550], [550, 550]]), JSON.stringify(at(bare)));
    const session = [admittanceSession.peek(design, null), eFieldSession.peek(design, null)];
    const factory = [
        same(api.admittance(design), api.admittance(design, { wavelength: 600, angle: session[0].theta, plane: session[0].view })),
        same(api.electricField(design), api.electricField(design, { wavelength: 600, angle: session[1].theta, depthUnit: session[1].xUnit, reference: 600 })),
        session[0].view, session[1].xUnit, session[1].axisRefFromDesign,
    ];
    ok('the angle, the plane and the depth unit are the windows\' factory ones, and the reference the window\'s depth axis takes',
        same(factory, [true, true, 'admittance', 'nm', true]), JSON.stringify(factory));
    const other = api.electricField(design, { depthUnit: 'QWOT', reference: 500 });
    const profile = computeProfile(withHerpinRecords(design), { lambda: 600, theta: 0, pol: 'avg', side: 'front', refLambda: 500 });
    ok('a reference given reads the depth at it, as the window\'s typed λ0 does', other.reference === 500 && same(other.depth, depthScale(profile, 'QWOT').map(profile.s.z)));
}

// ── 4. Points per layer ────────────────────────────────────────────────────
{
    const design = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
    const shown = withHerpinRecords(design);
    const params = { lambda: 550, theta: 30, pol: 'avg', side: 'front', refLambda: null };
    const layers = design.frontLayers.length;
    ok('without pointsPerLayer computeProfile takes 60 per layer, as before, and so does the API',
        same(computeProfile(shown, params), computeProfile(shown, { ...params, pointsPerLayer: 60 })) && computeProfile(shown, params).s.z.length === layers * 60 + 1
        && api.electricField(design, { angle: 30 }).z.length === layers * 60 + 1);
    const fine = api.electricField(design, { angle: 30, pointsPerLayer: 7 });
    const bounds = fine.layers.map(l => fine.z.filter(z => z > l.start && z <= l.end).length);
    ok('another count gives that many samples across each layer, as computeProfile takes it', fine.z.length === layers * 7 + 1 && bounds.every(n => n === 7)
        && same(fine.s.e2, computeProfile(shown, { ...params, pointsPerLayer: 7 }).s.e2) && fine.pointsPerLayer === 7, bounds.join());
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const design = api.stackFromFormula(api.newDesign({ name: 'Stack' }), { formula: '(HL)^2' });
    const zeroed = { ...design, frontLayers: design.frontLayers.map(l => ({ ...l, thickness: 0 })) };
    const REFUSED = [
        ...['admittance', 'electricField'].flatMap(call => [
            [call, 'an option it does not take', () => api[call](design, { lambda: 550 }), 'unknownOption', { option: 'lambda' }, /unknown option 'lambda'; the options are wavelength, angle, side, /],
            [call, 'a wavelength of 0', () => api[call](design, { wavelength: 0 }), 'badValue', { option: 'wavelength', value: 0 }, /wavelength is a wavelength in nm above 0, not 0/],
            [call, 'an angle of 90', () => api[call](design, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90/],
            [call, 'a negative angle', () => api[call](design, { angle: -1 }), 'badValue', { option: 'angle', value: -1 }, /not -1/],
            [call, 'side total', () => api[call](design, { side: 'total' }), 'badValue', { option: 'side', takes: "'front' or 'back'", value: 'total' }, /side is 'front' or 'back', not "total"/],
            [call, 'a side with no layers', () => api[call](design, { side: 'back' }), 'emptySide', { side: 'back' }, call === 'admittance' ? /the back has no layers/ : /the back has no layer thicker than 0 nm/],
        ]),
        ['admittance', 'a plane it does not have', () => api.admittance(design, { plane: 'smith' }), 'badValue', { option: 'plane', value: 'smith' }, /plane is 'admittance' or 'reflection', not "smith"/],
        ['electricField', 'a depth unit it does not have', () => api.electricField(design, { depthUnit: 'um' }), 'badValue', { option: 'depthUnit', value: 'um' }, /depthUnit is 'nm', 'OT', 'QWOT' or 'FWOT', not "um"/],
        ['electricField', 'a reference of 0', () => api.electricField(design, { reference: 0 }), 'badValue', { option: 'reference', value: 0 }, /reference is a wavelength in nm above 0, not 0/],
        ['electricField', 'one point per layer', () => api.electricField(design, { pointsPerLayer: 1 }), 'badValue', { option: 'pointsPerLayer', value: 1 }, /pointsPerLayer is a whole number of samples across a layer, 2 or more, not 1/],
        ['electricField', 'a point count that is not whole', () => api.electricField(design, { pointsPerLayer: 10.5 }), 'badValue', { option: 'pointsPerLayer', value: 10.5 }, /not 10.5/],
        ['electricField', 'a side with no layer thicker than 0 nm', () => api.electricField(zeroed), 'emptySide', { side: 'front' }, /the front has no layer thicker than 0 nm/],
    ];
    for (const [call, what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call, ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`${call} refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith(`${call}: `)], [code, { call, ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const many = thrown(() => api.electricField(design, { pointsPerLayer: 250001 }));
    ok('more samples than the API\'s point limit is refused, naming the limit', /^electricField: 1000005 samples \(layers times points per layer\) is more than 1000000; take fewer points per layer$/.test(many?.message), many?.message);
    ok('the admittance of a side whose layers have no thickness is the bare substrate, as the window draws it', api.admittance(zeroed).s.boundaries.length === 1);
    const [[name, lost] = []] = unresolved;
    const messages = ['admittance', 'electricField', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message);
    ok(`a design whose materials resolve to nothing (${name}) is refused by both, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

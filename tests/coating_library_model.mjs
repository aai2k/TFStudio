/**
 * Coating library entries: the conversions between an entry and a design side,
 * applying an entry to a design, and the checks an entry has to pass.
 *
 * The layer-order rule is what most of this pins down. An entry lists layers
 * from the substrate outward; a design stores its front coating from the
 * incident medium inward and its back coating from the substrate outward. A
 * coating saved from either side and applied to either side must come out the
 * same physical stack.
 *
 * Run: node tests/coating_library_model.mjs
 */
import assert from 'node:assert/strict';
import {
    COATING_TAGS, COATING_TAG_GROUPS, bandsText, entryDesign, entryFromDesign, entrySpecResults,
    entrySpectrum, makeCoatingEntry, previewRange, slugify, tagGroupOf,
} from '../src/utils/coatingLibrary/entryModel.js';
import { entryMetrics } from '../src/utils/coatingLibrary/entryProperties.js';
import { validateEntry } from '../src/utils/coatingLibrary/validateEntry.js';
import { applyCoatingPatch, mergeEntryMaterials } from '../src/utils/coatingLibrary/applyCoating.js';
import { filterEntries, substratesOf, tagCounts } from '../src/utils/coatingLibrary/filter.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A tabulated material of the kind that lives only in one user's catalog.
const LAB_TIO2 = {
    id: 'TiO2lab', name: 'Titania (lab)', formulaNum: -1, lambdaMin: 0.4, lambdaMax: 0.7, interp: 'pchip',
    tabData: [[400, 2.55, 0.004], [550, 2.42, 0.001], [700, 2.36, 0.0004]],
};
const LAB_TIO2_OTHER = { ...LAB_TIO2, tabData: [[400, 2.45, 0.004], [550, 2.32, 0.001], [700, 2.26, 0.0004]] };

const bbar = makeCoatingEntry({
    id: 'test-bbar', name: 'Test BBAR', type: 'ar', tags: ['visible', 'broadband', 'tio2-sio2'], use: 'test', source: 'test',
    incidentMedium: 'builtin:Air', substrate: 'builtin:BK7', referenceWavelength: 550, band: [450, 650],
    layers: [
        { material: 'builtin:TiO2', thickness: 12 },
        { material: 'builtin:SiO2', thickness: 40 },
        { material: 'builtin:TiO2', thickness: 110 },
        { material: 'builtin:SiO2', thickness: 90 },
    ],
    spec: [
        { kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.02 },
        { kind: 'MIN_MAX', channel: 'R', direction: 'max', cmp: 'le', target: 0.05 },
    ],
});

// ── Defaults and ids ──────────────────────────────────────────────────────────

assert.equal(slugify('  Broadband AR 420-680 nm, TiO2/SiO2 '), 'broadband-ar-420-680-nm-tio2-sio2');
assert.equal(makeCoatingEntry({ name: 'My AR' }).id, 'my-ar');
assert.equal(makeCoatingEntry({ type: 'nonsense' }).type, 'other');
assert.deepEqual(makeCoatingEntry({ band: [500, 600] }).band, [500, 600]);
assert.deepEqual(makeCoatingEntry({ band: [500, 600] }).bands, [[500, 600]], 'one band is a list of one');
assert.equal(makeCoatingEntry({ band: [500, 600] }).referenceWavelength, 550, 'λ₀ defaults to the band centre');
assert.deepEqual(previewRange(bbar), [390, 710], 'preview widens the band by 30% each side');
assert.deepEqual(previewRange(makeCoatingEntry({ band: [450, 650], preview: [400, 800] })), [400, 800]);
// The widened range stops where the materials' data stops: built-in TiO2 is
// tabulated on 370-827 nm, so a 400-800 nm band previews on that, not 280-920.
{
    const [from, to] = previewRange(makeCoatingEntry({ ...bbar, id: 'wide', bands: [[400, 800]] }));
    assert.ok(near(from, 370.1, 1e-6) && near(to, 826.56, 1e-6), `preview clamped to the TiO2 data, got ${from}-${to}`);
}
assert.deepEqual(previewRange(makeCoatingEntry({ ...bbar, id: 'mgf2', bands: [[450, 650]],
    layers: [{ material: 'builtin:MgF2', thickness: 100 }] })), [390, 710], 'a material with wider data leaves the margin alone');
assert.deepEqual(makeCoatingEntry({ tags: ['laser', 'laser', 'nir'] }).tags, ['laser', 'nir'], 'tags are a set');
assert.deepEqual(makeCoatingEntry({}).tags, []);

// The flat vocabulary is the groups laid end to end, and every tag knows its group.
const grouped = Object.values(COATING_TAG_GROUPS).reduce((n, group) => n + Object.keys(group).length, 0);
assert.equal(Object.keys(COATING_TAGS).length, grouped, 'no tag key is repeated across groups');
assert.equal(tagGroupOf('laser'), 'purpose');
assert.equal(tagGroupOf('mwir'), 'region');
assert.equal(tagGroupOf('tio2-sio2'), 'structure');
assert.equal(tagGroupOf('no-such-tag'), null);

// A multi-band entry keeps its bands apart, sorted, with the envelope as `band`.
const triBand = makeCoatingEntry({
    id: 'tri', name: 'Three-band AR', type: 'ar', tags: ['multi-band', 'visible', 'nir', 'mwir'],
    substrate: 'builtin:SiO2', bands: [[900, 1700], [400, 700], [3500, 4950]],
    layers: [{ material: 'builtin:MgF2', thickness: 100 }],
    spec: [
        { kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.3 },
        { kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.3, band: 2 },
        { kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.3, lambdaStart: 1000, lambdaEnd: 1100 },
    ],
});
assert.deepEqual(triBand.bands, [[400, 700], [900, 1700], [3500, 4950]]);
assert.deepEqual(triBand.band, [400, 4950]);
assert.equal(bandsText(triBand), '400-700, 900-1700, 3500-4950 nm');
assert.equal(bandsText(bbar), '450-650 nm');

// ── Entry ↔ design ────────────────────────────────────────────────────────────

{
    const design = entryDesign(bbar);
    assert.equal(design.frontLayers[0].material, 'builtin:SiO2', 'frontLayers[0] faces the incident medium');
    assert.equal(design.frontLayers.at(-1).material, 'builtin:TiO2', 'the last front layer touches the substrate');
    assert.equal(design.frontLayers[0].thickness, 90);
    assert.equal(design.surfaceMode, 'front_only');
    assert.strictEqual(entryDesign(bbar), design, 'the design of an entry is built once');
}

const source = {
    id: 'src', name: 'Source design',
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:SiO2',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    referenceWavelength: 550,
    frontLayers: [
        { id: 'f1', material: 'builtin:SiO2', thickness: 90 },
        { id: 'f2', material: 'lab:TiO2lab', thickness: 110 },
    ],
    backLayers: [
        { id: 'b1', material: 'builtin:MgF2', thickness: 100 },
        { id: 'b2', material: 'builtin:Al2O3', thickness: 60 },
    ],
    materials: { 'lab:TiO2lab': LAB_TIO2 },
};

{
    const front = entryFromDesign(source, 'front', { name: 'Front save', type: 'ar', band: [450, 650] });
    assert.deepEqual(front.layers, [
        { material: 'lab:TiO2lab', thickness: 110 },
        { material: 'builtin:SiO2', thickness: 90 },
    ], 'a front coating is saved substrate-first');
    assert.equal(front.incidentMedium, 'builtin:Air');
    assert.equal(front.substrate, 'builtin:BK7');
    assert.deepEqual(front.materials['lab:TiO2lab'].tabData, LAB_TIO2.tabData, 'a non-built-in material is embedded');
    assert.ok(!front.materials['builtin:SiO2'], 'built-in materials are referenced, not embedded');
    assert.ok(front.source.includes('front'), 'the source records which side was saved');
    assert.ok(front.created, 'a saved entry is dated');

    const back = entryFromDesign(source, 'back', { name: 'Back save', band: [450, 650] });
    assert.deepEqual(back.layers, [
        { material: 'builtin:MgF2', thickness: 100 },
        { material: 'builtin:Al2O3', thickness: 60 },
    ], 'a back coating is already substrate-first');
    assert.equal(back.incidentMedium, 'builtin:SiO2', 'a back coating faces the exit medium');
    assert.equal(back.materials, null);

    // Round trip: saving from the front and applying to the back gives the
    // stored back order, and applying to the front gives the stored front order.
    const target = { surfaceMode: 'front_only', frontLayers: [], backLayers: [] };
    const toBack = applyCoatingPatch(target, front, { side: 'back' }).patch;
    assert.deepEqual(toBack.backLayers.map(l => l.material), ['lab:TiO2lab', 'builtin:SiO2']);
    const toFront = applyCoatingPatch(target, front, { side: 'front' }).patch;
    assert.deepEqual(toFront.frontLayers.map(l => l.material), ['builtin:SiO2', 'lab:TiO2lab']);
    assert.deepEqual(toFront.frontLayers.map(l => l.thickness), source.frontLayers.map(l => l.thickness));
    assert.ok(toFront.frontLayers.every(l => l.id && l.locked === false), 'applied layers get fresh ids and are unlocked');
}

// ── Applying ──────────────────────────────────────────────────────────────────

{
    const design = {
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'x', material: 'builtin:Ag', thickness: 5 }],
        backLayers: [],
    };
    const replaced = applyCoatingPatch(design, bbar, { side: 'front', mode: 'replace' }).patch;
    assert.equal(replaced.frontLayers.length, 4);
    assert.equal(replaced.surfaceMode, undefined, 'front onto a front-only design keeps the mode');

    const appended = applyCoatingPatch(design, bbar, { side: 'front', mode: 'append' }).patch;
    assert.equal(appended.frontLayers.length, 5);
    assert.equal(appended.frontLayers[0].material, 'builtin:SiO2', 'appended layers are the outermost');
    assert.equal(appended.frontLayers.at(-1).material, 'builtin:Ag', 'the existing stack stays on the substrate');

    const onBack = applyCoatingPatch(design, bbar, { side: 'back', mode: 'replace' }).patch;
    assert.equal(onBack.surfaceMode, 'both_independent', 'a populated back side becomes visible');
    assert.equal(onBack.backLayers[0].material, 'builtin:TiO2', 'back storage starts at the substrate');
    assert.equal(onBack.frontLayers, undefined, 'the front is untouched');

    const appendBack = applyCoatingPatch({ ...design, backLayers: [{ id: 'k', material: 'builtin:Cr', thickness: 3 }] },
        bbar, { side: 'back', mode: 'append' }).patch;
    assert.equal(appendBack.backLayers[0].material, 'builtin:Cr', 'the existing back stack stays on the substrate');
    assert.equal(appendBack.backLayers.at(-1).material, 'builtin:SiO2', 'appended back layers are outermost');

    const bare = applyCoatingPatch({ surfaceMode: 'front_only', frontLayers: [], backLayers: [] }, bbar, { side: 'back' }).patch;
    assert.equal(bare.surfaceMode, 'back_only', 'a back coating on a bare substrate is a back-only design');

    const symmetric = applyCoatingPatch({ surfaceMode: 'symmetric', frontLayers: [], backLayers: [] }, bbar, { side: 'back' }).patch;
    assert.equal(symmetric.frontLayers.length, 4, 'in symmetric mode the coating goes on the front');
    assert.deepEqual(symmetric.backLayers.map(l => l.material), [...symmetric.frontLayers].reverse().map(l => l.material),
        'and the back is its mirror');
}

// ── Material merging ──────────────────────────────────────────────────────────

{
    const withLab = entryFromDesign(source, 'front', { name: 'Lab AR', band: [450, 650] });

    const fresh = { frontLayers: [], backLayers: [], materials: {} };
    let merged = mergeEntryMaterials(fresh, withLab);
    assert.deepEqual(merged.clashes, []);
    assert.ok(merged.materials['lab:TiO2lab'], 'an id new to the design brings its definition');

    const same = { frontLayers: [{ id: 'a', material: 'lab:TiO2lab', thickness: 50 }], backLayers: [], materials: { 'lab:TiO2lab': LAB_TIO2 } };
    merged = mergeEntryMaterials(same, withLab);
    assert.deepEqual(merged.clashes, [], 'the same dispersion under the same id is not a clash');

    const differs = { ...same, materials: { 'lab:TiO2lab': LAB_TIO2_OTHER } };
    merged = mergeEntryMaterials(differs, withLab);
    assert.deepEqual(merged.clashes, ['lab:TiO2lab'], 'a different embedded dispersion is reported');
    assert.deepEqual(merged.materials['lab:TiO2lab'].tabData, LAB_TIO2_OTHER.tabData, 'and the design keeps its own');

    const unresolved = { frontLayers: [{ id: 'a', material: 'lab:TiO2lab', thickness: 50 }], backLayers: [] };
    merged = mergeEntryMaterials(unresolved, withLab);
    assert.deepEqual(merged.clashes, []);
    assert.ok(merged.materials['lab:TiO2lab'], 'an id the design uses but cannot resolve takes the entry definition');

    assert.equal(mergeEntryMaterials(fresh, bbar).materials, null, 'nothing to merge for a built-in-only coating');
    assert.equal(applyCoatingPatch(fresh, bbar).patch.materials, undefined);
    assert.ok(applyCoatingPatch(fresh, withLab).patch.materials['lab:TiO2lab']);
}

// ── Validation ────────────────────────────────────────────────────────────────

assert.deepEqual(validateEntry(bbar), []);
{
    // `bands` outranks `band` when both are given, so an entry built by
    // spreading a normalized one has to override `bands`.
    const bad = makeCoatingEntry({ ...bbar, id: 'Bad Id', layers: [{ material: '', thickness: -1 }], bands: [[700, 400]] });
    const problems = validateEntry(bad);
    assert.ok(problems.some(p => p.includes('slug')));
    assert.ok(problems.some(p => p.includes('no material')));
    assert.ok(problems.some(p => p.includes('positive number')));
    assert.ok(problems.some(p => p.includes('band')));

    const missing = makeCoatingEntry({ ...bbar, id: 'missing', layers: [{ material: 'nowhere:X', thickness: 10 }] });
    assert.ok(validateEntry(missing).some(p => p.includes('cannot be resolved')));

    // Built-in TiO2 data stops at 827 nm: a claim past it is not a measurement.
    const outside = makeCoatingEntry({ ...bbar, id: 'outside', bands: [[700, 1000]] });
    assert.ok(validateEntry(outside).some(p => p.includes('builtin:TiO2') && p.includes('outside')));

    // The same coating with embedded data covering the band is fine.
    const embedded = makeCoatingEntry({
        ...bbar, id: 'embedded', bands: [[450, 650]],
        layers: [{ material: 'lab:TiO2lab', thickness: 60 }], materials: { 'lab:TiO2lab': LAB_TIO2 },
    });
    assert.deepEqual(validateEntry(embedded), []);
    assert.ok(!entrySpectrum(embedded).error, 'an embedded material evaluates');
}

// ── Metrics, spectrum and specification agree ─────────────────────────────────

{
    // Properties follow the family: an AR reports R avg, R max and T avg.
    const all = entryMetrics(bbar);
    assert.equal(all.layerCount, 4);
    assert.equal(all.totalThickness, 252);
    assert.deepEqual(all.bands, [[450, 650]]);
    const stat = (m, channel, s, pol = 'avg') => m.rows.find(r => r.channel === channel && r.stat === s && r.pol === pol);
    assert.deepEqual(all.rows.map(r => `${r.channel} ${r.stat}`), ['R avg', 'R max', 'T avg']);
    assert.deepEqual(all.shape, [], 'an AR has no shape figures');
    const rAvg = stat(all, 'R', 'avg').values[0];
    assert.ok(rAvg > 0 && rAvg < 0.02);
    assert.ok(stat(all, 'R', 'max').values[0] >= rAvg);
    const metrics = { rAvg };

    // A mirror at 45° reports its s, p and averaged reflectance minima.
    const tiltedMirror = makeCoatingEntry({ ...bbar, id: 'hr45', type: 'mirror', aoi: 45 });
    const mirrorRows = entryMetrics(tiltedMirror).rows.map(r => `${r.channel}${r.pol} ${r.stat}`);
    assert.deepEqual(mirrorRows.slice(0, 3), ['Rs min', 'Rp min', 'Ravg min']);
    assert.ok(mirrorRows.includes('A avg') || mirrorRows.includes('Aavg avg'), 'absorptance is not split by polarization');

    // A band-pass reports where its peak is and how wide it is, measured on
    // the band where T peaks; a notch the same for its dip.
    const bp = makeCoatingEntry({
        ...bbar, id: 'bp', type: 'bandpass', bands: [[500, 600]],
        layers: [...Array(4).fill([{ material: 'builtin:TiO2', thickness: 58 }, { material: 'builtin:SiO2', thickness: 94 }]).flat(),
            { material: 'builtin:TiO2', thickness: 116 },
            ...Array(4).fill([{ material: 'builtin:SiO2', thickness: 94 }, { material: 'builtin:TiO2', thickness: 58 }]).flat()],
    });
    const bpMetrics = entryMetrics(bp);
    assert.deepEqual(bpMetrics.shape.map(r => r.stat), ['center', 'fwhm']);
    const [bpCenter, bpWidth] = bpMetrics.shape.map(r => r.value);
    assert.ok(bpCenter > 500 && bpCenter < 600, `band-pass centre ${bpCenter}`);
    assert.ok(bpWidth > 0 && bpWidth < 100, `band-pass FWHM ${bpWidth}`);

    // A multi-band entry is measured in each band on its own, and its claims
    // land on the band they name.
    const tri = entryMetrics(triBand);
    assert.deepEqual(tri.bands, triBand.bands);
    assert.ok(tri.rows.every(r => r.values.length === 3 && r.values.every(Number.isFinite)));
    const triQuals = entrySpecResults(triBand).qualifiers;
    assert.deepEqual([triQuals[0].lambdaStart, triQuals[0].lambdaEnd], [400, 700], 'a claim defaults to the first band');
    assert.deepEqual([triQuals[1].lambdaStart, triQuals[1].lambdaEnd], [3500, 4950], 'band: 2 picks the third band');
    assert.deepEqual([triQuals[2].lambdaStart, triQuals[2].lambdaEnd], [1000, 1100], 'an explicit range wins');
    assert.ok(!('band' in triQuals[1]), 'the band index does not leak into the qualifier');

    // The band average through operands matches a direct fine-grid average of
    // the same TMM to well under the precision anyone reads off the window.
    const design = entryDesign(bbar);
    const resolve = designMaterialLookup(design);
    const direct = evaluateSpectrum({ lambdaStart: 450, lambdaEnd: 650, lambdaStep: 0.5, theta: 0, polarization: 'avg' },
        resolve(design.incidentMedium), resolve(design.substrate.material),
        design.frontLayers.map(l => ({ material: resolve(l.material), thickness: l.thickness })));
    const directAvg = direct.R.reduce((s, v) => s + v, 0) / direct.R.length;
    assert.ok(near(metrics.rAvg, directAvg, 2e-4), `operand average ${metrics.rAvg} vs grid average ${directAvg}`);
    // A notch is measured by where T comes back up through 50% either side of
    // its dip: centre between the crossings, width between them.
    const notch = makeCoatingEntry({
        ...bbar, id: 'notch', type: 'notch', bands: [[520, 545]],
        // Quarter waves at 532 nm: Al2O3 (n 1.77) 75.3 nm, SiO2 (n 1.46) 91.1 nm.
        layers: Array.from({ length: 41 }, (_, i) => (i % 2 ? { material: 'builtin:SiO2', thickness: 91.1 } : { material: 'builtin:Al2O3', thickness: 75.3 })),
    });
    const notchMetrics = entryMetrics(notch);
    assert.deepEqual(notchMetrics.shape.map(r => r.stat), ['notch-center', 'notch-width']);
    const [center, width] = notchMetrics.shape.map(r => r.value);
    assert.ok(center > 520 && center < 545, `notch centre ${center}`);
    // Twenty Al2O3/SiO2 pairs have an index contrast of 0.3, so the 50% width
    // of the stop band is several tens of nanometres.
    assert.ok(width > 30 && width < 120, `notch width ${width}`);

    const spectrum = entrySpectrum(bbar, 41);
    assert.equal(spectrum.lambda.length, 41);
    assert.ok(spectrum.Rs && spectrum.Rp && spectrum.Ts && spectrum.Tp, 'the s and p components come with the spectrum');
    assert.ok(spectrum.Rs.every((v, i) => near(v, spectrum.Rp[i], 1e-12)), 'at normal incidence s and p coincide');
    const tilted = entrySpectrum(makeCoatingEntry({ ...bbar, id: 'tilted', aoi: 45 }), 41);
    assert.ok(tilted.Rs.some((v, i) => Math.abs(v - tilted.Rp[i]) > 1e-3), 'at 45° they differ');
    assert.ok(near(spectrum.lambda[0], 390, 1e-9) && near(spectrum.lambda.at(-1), 710, 1e-9));
    assert.ok(spectrum.R.every(v => v >= 0 && v <= 1));

    const spec = entrySpecResults(bbar);
    assert.equal(spec.qualifiers.length, 2);
    assert.equal(spec.qualifiers[0].lambdaStart, 450, 'a claim inherits the entry band');
    assert.equal(spec.qualifiers[0].aoi, 0);
    assert.ok(spec.verdict.allPass, spec.results.map(r => r.summary).join('; '));
    assert.ok(near(spec.results[0].value, metrics.rAvg, 1e-12), 'the R avg claim and the R avg metric are one number');

    // The three-band entry's MgF2 covers 200-7000 nm, so it validates; the same
    // bands on TiO2 do not, and the message names the band that reaches outside.
    assert.deepEqual(validateEntry(triBand), []);
    const triTiO2 = makeCoatingEntry({ ...triBand, id: 'tri-tio2', layers: [{ material: 'builtin:TiO2', thickness: 50 }] });
    const triProblems = validateEntry(triTiO2);
    assert.ok(triProblems.some(p => p.includes('3500-4950')), triProblems.join('; '));
    assert.ok(!triProblems.some(p => p.includes('400-700')), 'the visible band is inside the TiO2 data');

    const failing = makeCoatingEntry({ ...bbar, id: 'failing', spec: [{ kind: 'R_AVG', channel: 'R', cmp: 'le', target: 1e-6 }] });
    assert.ok(!entrySpecResults(failing).verdict.allPass);
}

// ── Filtering ─────────────────────────────────────────────────────────────────

{
    const mirror = makeCoatingEntry({ ...bbar, id: 'hr', name: 'HR 1064', type: 'mirror', bands: [[1000, 1100]],
        tags: ['nir', 'laser', 'high-reflector', 'hfo2-sio2'],
        layers: Array.from({ length: 20 }, (_, i) => ({ material: i % 2 ? 'builtin:SiO2' : 'builtin:HfO2', thickness: 100 })) });
    const all = [bbar, mirror, triBand];
    assert.equal(filterEntries(all).length, 3);
    assert.deepEqual(filterEntries(all, { type: 'mirror' }).map(e => e.id), ['hr']);
    assert.deepEqual(filterEntries(all, { lambda: 500 }).map(e => e.id), ['test-bbar', 'tri']);
    assert.deepEqual(filterEntries(all, { lambda: '1064' }).map(e => e.id), ['hr', 'tri'], 'a typed wavelength is a number');
    assert.deepEqual(filterEntries(all, { lambda: 2000 }).map(e => e.id), [], 'a gap between bands is not a band');
    assert.deepEqual(filterEntries(all, { lambda: 4000 }).map(e => e.id), ['tri']);
    assert.deepEqual(filterEntries(all, { maxLayers: 4 }).map(e => e.id), ['test-bbar', 'tri']);
    assert.equal(filterEntries(all, { maxLayers: '' }).length, 3, 'an empty limit is no limit');
    assert.deepEqual(filterEntries(all, { substrate: 'builtin:SiO2' }).map(e => e.id), ['tri']);
    assert.deepEqual(filterEntries(all, { query: 'hfo2' }).map(e => e.id), ['hr'], 'search reaches layer materials');
    assert.deepEqual(filterEntries(all, { query: 'BK7' }).length, 2, 'search reaches the substrate');
    assert.deepEqual(filterEntries(all, { query: 'multi-band' }).map(e => e.id), ['tri'], 'search reaches tags');
    assert.equal(filterEntries(all, { query: 'nothing here' }).length, 0);

    // Tags narrow with AND; every chosen tag must be on the entry.
    assert.deepEqual(filterEntries(all, { tags: ['visible'] }).map(e => e.id), ['test-bbar', 'tri']);
    assert.deepEqual(filterEntries(all, { tags: ['visible', 'nir'] }).map(e => e.id), ['tri']);
    assert.deepEqual(filterEntries(all, { tags: ['laser', 'visible'] }), []);
    assert.equal(filterEntries(all, { tags: [] }).length, 3);

    assert.deepEqual(tagCounts(all).slice(0, 2), [{ tag: 'nir', count: 2 }, { tag: 'visible', count: 2 }],
        'most common tags first, ties by name');
    assert.equal(tagCounts(all).find(x => x.tag === 'mwir').count, 1);
    assert.deepEqual(substratesOf(all), ['builtin:BK7', 'builtin:SiO2']);
}

console.log('PASS coating_library_model');

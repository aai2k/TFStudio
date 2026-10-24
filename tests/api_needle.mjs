/**
 * The headless API's needleProfile and insertNeedle (src/api/needle.js)
 * against the Needle Manual window's own code.
 *
 *   1. needleProfile gives the candidates runNeedleScan gives on the window's
 *      rows (runOperands less the MNT and MXT rows) at the window's side
 *      setting, on the corpus designs whose materials resolve, each given a
 *      RAV row when it has no row the scan scores: front-only, back-only,
 *      coated on both and scored on the whole part, both sides of the
 *      designs coated on both. Each candidate's layer and position name, by
 *      their numbers from the substrate, the stored layer and gap the
 *      window's candidate names; gap and inside candidates are both seen, on
 *      the front and on the back.
 *   2. insertNeedle without a thickness gives insertForSelection's design at
 *      the starting thickness the window's Pick computes (golden-section
 *      search from the minimum thickness to 60 nm to 0.5 nm, the minimum
 *      when none is better, clamped to the slider range), on the steepest gap
 *      and inside candidates of each case; with a thickness, at that
 *      thickness.
 *   3. Cross-check: a 1 nm needle where the gradient is most negative lowers
 *      merit().optical, and where it is most positive raises it, as
 *      needle_manual.mjs checks the window's preview.
 *   4. Cross-check: insert, an MNT row at 1 nm, then refine with sqp and 80
 *      steps ends on the thicknesses of the window's Apply with Refine after
 *      insert (refineAndCommit, on this thread), on a gap and on an inside
 *      insertion.
 *   5. The defaults are the window's factory settings, each told apart from
 *      another value; the window's field limits and the window's side rule are
 *      refused past, and so are candidates the side does not have.
 *
 * Run: node tests/api_needle.mjs
 */
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();   // the window's model shares helpers with its components
const api = await import('../src/api/index.js');
const { findOptimalNeedleThickness, resolveScanSide } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup, resolveDesignMaterial, unresolvedMaterials } = await import('../src/utils/materials/designMaterials.js');
const model = await import('../src/components/windows/optimization/needleManual/model.js');
const { NEEDLE_MANUAL_DEFAULTS: FACTORY } = await import('../src/components/windows/optimization/needleManual/sessionState.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const quietly = async run => {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, error }); }
};

await api.init();

const RAV = { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 };
// Points inside each layer the scans here take, fewer than the window's 16 to keep the test short.
const INTRA = 4;
const POOL = ['TiO2', 'SiO2', 'MgF2'];
// The rows the window's scan scores on `design`.
const windowRows = design => model.scanOperands(model.runOperands(design, designMaterialLookup(design)));
// The pool as the window hands it to the scan: each id with its record.
const windowPool = (design, ids) => ids.map(id => ({ id, name: id, mat: resolveDesignMaterial(design, id).material }));
// Layers without their ids, which an insertion draws at random.
const shape = design => [design.frontLayers, design.backLayers].map(side => (side || []).map(({ id, ...rest }) => rest));

// ── 1. needleProfile is the window's scan ──────────────────────────────────
// Each corpus design whose materials resolve, scored by its own rows or by a
// RAV row, on each side it can be scanned on; requested is the window's side
// setting: its factory front, or back on a design coated on both.
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const cases = [];
for (const name of CORPUS) {
    const opened = api.openDesign(fixtureFile(name));
    if (unresolvedMaterials(opened).length) continue;
    const design = windowRows(opened).length ? opened : api.setMerit(opened, [RAV]);
    const sides = design.surfaceMode === 'both_independent' ? ['front', 'back'] : [undefined];
    for (const side of sides) cases.push({ name, design, side, requested: side ?? FACTORY.requestedSide });
}

// The candidate needleProfile is to give for the window's candidate `cand`
// on `side`, whose stored layers are `stored`: its places numbered from the
// substrate, counted here from the stored order.
function expectedCandidate(cand, side, stored, zb) {
    const common = { material: cand.materialId, depth: model.candidateDepth(cand, zb), gradient: cand.grad };
    const fromSubstrate = side === 'front' ? [...stored].reverse() : stored;
    if (cand.intra) return { ...common, kind: 'inside', layer: fromSubstrate.indexOf(stored[cand.layerK]) + 1, position: null, fraction: cand.frac };
    const between = side === 'front' ? stored.slice(cand.pos) : stored.slice(0, cand.pos);
    return { ...common, kind: 'gap', layer: null, position: between.length, fraction: null };
}
// The window's scan of case `c` (runNeedleScan at the window's side setting).
const windowScan = c => model.runNeedleScan({
    operands: windowRows(c.design), design: c.design, resolveMat: designMaterialLookup(c.design),
    candidateMats: windowPool(c.design, POOL), deltaNm: FACTORY.deltaNm, nIntra: INTRA, side: c.requested, tn: en.needleManual,
}).scan;

const wrongScans = [];
const seen = new Set();
for (const c of cases) {
    const got = api.needleProfile(c.design, { pool: POOL, side: c.side, intraSamples: INTRA });
    const scan = windowScan(c);
    const onSide = resolveScanSide(c.design.surfaceMode || 'front_only', c.requested);
    const expected = { mode: onSide, mf0: scan.mf0, candidates: scan.candidates.map(cand => expectedCandidate(cand, onSide, scan.layers, scan.zb)) };
    if (!isDeepStrictEqual(got, expected)) wrongScans.push(`${c.name} ${c.side}: ${JSON.stringify(got.candidates[0])} / ${JSON.stringify(expected.candidates[0])}`);
    for (const cand of got.candidates) seen.add(`${got.mode} ${cand.kind}`);
    c.profile = got;
}
ok(`on ${cases.length} corpus cases needleProfile gives the window's scan, its places numbered from the substrate`,
    cases.length >= 12 && wrongScans.length === 0, wrongScans.slice(0, 3).join('\n'));
ok('gap and inside candidates were seen on the front and on the back', ['back gap', 'back inside', 'front gap', 'front inside'].every(k => seen.has(k)), [...seen].join(', '));

// ── 2. insertNeedle is the window's Apply at its starting thickness ────────
// The window's candidate for the API's `cand` on the case's scan.
function windowCandidate(c, cand) {
    const stored = c.design[model.sideKey(c.profile.mode)] || [];
    const scan = windowScan(c);
    return scan.candidates.find(w => isDeepStrictEqual(expectedCandidate(w, c.profile.mode, stored, scan.zb), cand));
}
// The thickness the window's Pick starts the needle at: the hook's search
// from the minimum thickness, clamped into the slider range.
function pickThickness(c, selected) {
    const resolveMat = designMaterialLookup(c.design);
    let d0 = findOptimalNeedleThickness({
        operands: windowRows(c.design), design: c.design, resolveMat,
        candidate: { ...selected, _mat: resolveMat(selected.materialId) }, deltaNm: FACTORY.dMin, maxNm: 200, tol: 0.5, side: c.requested,
    });
    if (!(d0 >= FACTORY.dMin)) d0 = FACTORY.dMin;
    const stored = c.design[model.sideKey(c.profile.mode)] || [];
    const [lo, hi] = model.resolveDRange(selected, { hostThickness: stored[selected.layerK]?.thickness || 0 }, FACTORY.dMin);
    return Math.min(Math.max(d0, lo), hi);
}
// The candidate of kind with the most negative gradient, the first of equals.
const steepest = (profile, kind) => profile.candidates.filter(cand => cand.kind === kind).sort((a, b) => a.gradient - b.gradient)[0];
const wrongInserts = [];
let inserts = 0;
for (const c of cases) {
    for (const kind of ['gap', 'inside']) {
        const cand = steepest(c.profile, kind);
        if (!cand) continue;
        const selected = windowCandidate(c, cand);
        const d = pickThickness(c, selected);
        const got = api.insertNeedle(c.design, cand, { side: c.side });
        const expected = model.insertForSelection(selected, c.design, d, c.requested);
        const fixed = api.insertNeedle(c.design, cand, { side: c.side, thickness: 3 });
        const checks = [[got, expected, d], [fixed, model.insertForSelection(selected, c.design, 3, c.requested), 3]];
        for (const [made, wanted, at] of checks) if (!isDeepStrictEqual(shape(made), shape(wanted))) wrongInserts.push(`${c.name} ${kind} at ${at} nm`);
        inserts++;
    }
}
ok(`on ${inserts} insertions insertNeedle gives the window's Apply at its starting thickness, and at a thickness given`,
    inserts >= 20 && wrongInserts.length === 0, wrongInserts.slice(0, 3).join('; '));
{
    // Inside layers of 20 and 30 nm, where the search's best thickness is
    // past the slider's top, the host's thickness less the minimum.
    const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
    const design = api.setMerit({
        ...api.newDesign({ name: 'Thin layers' }), frontLayers: [layer('a', 'SiO2', 90), layer('b', 'TiO2', 6), layer('c', 'SiO2', 20), layer('d', 'TiO2', 30)],
    }, [RAV]);
    const c = { design, profile: api.needleProfile(design, { pool: POOL, intraSamples: INTRA }), requested: 'front' };
    const insides = c.profile.candidates.filter(cand => cand.kind === 'inside');
    const results = insides.map(cand => {
        const selected = windowCandidate(c, cand);
        const thickness = pickThickness(c, selected);
        return { thickness, same: isDeepStrictEqual(shape(api.insertNeedle(design, cand)), shape(model.insertForSelection(selected, design, thickness, 'front'))) };
    });
    const atTop = results.filter(({ thickness }, i) => thickness === design.frontLayers[design.frontLayers.length - insides[i].layer].thickness - FACTORY.dMin);
    ok('inside thin layers the needle starts at the slider\'s top where the search goes past it, as the window\'s Pick',
        results.every(r => r.same) && atTop.length > 0, `${atTop.length} at the top of ${results.length}`);
}

// ── 3. The gradient's sign is the merit's ──────────────────────────────────
const ar = api.setMerit(api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: 'H L' }), [RAV]);
{
    const profile = api.needleProfile(ar, { pool: POOL });
    const sorted = [...profile.candidates].sort((a, b) => a.gradient - b.gradient);
    const optical = design => api.merit(design).optical;
    const [down, up] = [sorted[0], sorted[sorted.length - 1]].map(cand => optical(api.insertNeedle(ar, cand, { thickness: 1 })));
    const signs = [sorted[0].gradient < 0, sorted[sorted.length - 1].gradient > 0, down < profile.mf0, up > profile.mf0, Math.abs(profile.mf0 - optical(ar)) < 1e-12];
    ok('a 1 nm needle at the most negative gradient lowers merit().optical and at the most positive raises it', signs.every(Boolean), `${profile.mf0} ${down} ${up}`);
}

// ── 4. Insert, MNT row, refine is the window's Apply with refine ───────────
// No module worker starts here, so the window's refine runs its loop on this
// thread, as it does in the app when the worker cannot start.
globalThis.Worker = class BlockedWorker { constructor() { throw new Error('module workers blocked'); } };
async function windowApply(design, selected, d) {
    const resolveMat = designMaterialLookup(design);
    const inserted = model.insertForSelection(selected, design, d, FACTORY.requestedSide);
    const job = model.insertionRefineJob(model.runOperands(design, resolveMat), inserted, FACTORY.dMin, FACTORY.dlsIter);
    const writes = [];
    await quietly(() => model.refineAndCommit({
        inserted, job, resolveMat, signal: new AbortController().signal, isCurrent: () => true, write: patch => writes.push(patch),
    }));
    return writes[writes.length - 1].frontLayers.map(l => l.thickness);
}
for (const kind of ['gap', 'inside']) {
    const base = [25, 40, 110, 20];
    const start = api.setMerit({
        ...api.newDesign({ name: 'AR off its optimum' }),
        frontLayers: Array.from({ length: 6 }, (_, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: base[i % 4] * (1 + 0.2 * Math.sin(i)), locked: false })),
    }, [RAV]);
    const cand = steepest(api.needleProfile(start, { pool: POOL, intraSamples: INTRA }), kind);
    const inserted = api.insertNeedle(start, cand);
    const selected = windowCandidate({ design: start, profile: { mode: 'front' }, requested: 'front' }, cand);
    const d = pickThickness({ design: start, profile: { mode: 'front' }, requested: 'front' }, selected);
    const bounded = api.setMerit(inserted, [...inserted.meritOperands, { type: 'MNT', target: FACTORY.dMin }]);
    const refined = (await quietly(() => api.refine(bounded, { method: 'sqp', maxIter: FACTORY.dlsIter }))).design.frontLayers.map(l => l.thickness);
    const windowed = await windowApply(start, selected, d);
    ok(`at a${kind === 'gap' ? ' gap' : 'n inside'} candidate, insert, an MNT row at ${FACTORY.dMin} nm and refine with sqp and ${FACTORY.dlsIter} steps ends on the window's Apply with refine`,
        isDeepStrictEqual(refined, windowed) && !isDeepStrictEqual(refined, inserted.frontLayers.map(l => l.thickness)), `${refined.join()} / ${windowed.join()}`);
}

// ── 5. Defaults and refusals ───────────────────────────────────────────────
{
    const byDefault = api.needleProfile(ar, { pool: POOL });
    ok('with no step or intraSamples the profile is the window\'s factory one, and each tells from another value',
        isDeepStrictEqual(byDefault, api.needleProfile(ar, { pool: POOL, step: FACTORY.deltaNm, intraSamples: FACTORY.nIntra }))
        && !isDeepStrictEqual(byDefault, api.needleProfile(ar, { pool: POOL, intraSamples: FACTORY.nIntra - 1 }))
        && byDefault.candidates.some(cand => cand.kind === 'inside' && cand.fraction === 1 / (FACTORY.nIntra + 1)));
    const sym = api.setDesignSetup(ar, { surfaceMode: 'symmetric' });
    const back = { ...api.setDesignSetup(ar, { surfaceMode: 'back_only' }), frontLayers: [], backLayers: ar.frontLayers };
    const onlyMnt = api.setMerit(ar, [{ type: 'MNT', target: 1 }]);
    const gap = byDefault.candidates.find(cand => cand.kind === 'gap');
    const inside = byDefault.candidates.find(cand => cand.kind === 'inside');
    const REFUSED = [
        ['a step below the window\'s', () => api.needleProfile(ar, { pool: POOL, step: 0.04 }), /needleProfile: step is a needle thickness in nm of 0.05 or more, not 0.04/],
        ['intraSamples past 60', () => api.needleProfile(ar, { pool: POOL, intraSamples: 61 }), /intraSamples is a whole number from 2 to 60, not 61/],
        ['intraSamples not whole', () => api.needleProfile(ar, { pool: POOL, intraSamples: 2.5 }), /intraSamples is a whole number from 2 to 60, not 2.5/],
        ['an option it does not take', () => api.needleProfile(ar, { pool: POOL, deltaNm: 1 }), /unknown option 'deltaNm'/],
        ['an empty pool', () => api.needleProfile(ar, { pool: [] }), /needleProfile: pool is a list of one or more material ids/],
        ['the back of a symmetric design', () => api.needleProfile(sym, { pool: POOL, side: 'back' }), /side is 'front' or left out: the window scans a symmetric design on its front, not "back"/],
        ['the front of a back-only design', () => api.needleProfile(back, { pool: POOL, side: 'front' }), /side is 'back' or left out: the window scans a back_only design on its back/],
        ['a design with no row the scan scores', () => api.needleProfile(onlyMnt, { pool: POOL }), /no merit row the scan scores; MNT, MXT and PPEF rows are not scored/],
        ['a thickness past the slider\'s range at a gap', () => api.insertNeedle(ar, gap, { thickness: 201 }), /insertNeedle: thickness is a needle thickness in nm from 1 to 200 there, not 201/],
        ['a thickness below the minimum', () => api.insertNeedle(ar, inside, { thickness: 0.5 }), /thickness is a needle thickness in nm from 1 to/],
        ['a gap the side does not have', () => api.insertNeedle(ar, { ...gap, position: 3 }), /candidate.position is a whole number from 0 to 2/],
        ['a layer the side does not have', () => api.insertNeedle(ar, { ...inside, layer: 3 }), /candidate.layer is a layer number from 1 to 2, not 3/],
        ['a kind it does not know', () => api.insertNeedle(ar, { ...gap, kind: 'edge' }), /candidate.kind is 'gap' or 'inside', not "edge"/],
        ['a field a candidate has not', () => api.insertNeedle(ar, { ...gap, side: 'front' }), /a candidate has no field 'side'/],
    ];
    for (const [what, run, pattern] of REFUSED) {
        const err = thrown(run);
        ok(`refused: ${what}`, !!err && pattern.test(err.message), err?.message ?? 'not refused');
    }
    const backProfile = api.needleProfile(back, { pool: POOL });
    const backInserted = api.insertNeedle(back, backProfile.candidates[0]);
    ok('a back-only design is scanned and filled on its back', backProfile.mode === 'back' && backInserted.backLayers.length > back.backLayers.length
        && backInserted.frontLayers.length === 0);
    const symInserted = api.insertNeedle(sym, steepest(api.needleProfile(sym, { pool: POOL }), 'gap'));
    ok('a symmetric design\'s back is the mirror of its front after an insert',
        isDeepStrictEqual(symInserted.backLayers.map(l => [l.material, l.thickness]), [...symInserted.frontLayers].reverse().map(l => [l.material, l.thickness])));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

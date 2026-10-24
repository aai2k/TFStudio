/**
 * The headless API's edge filter (src/api/edgeFilter.js) against the Edge
 * Filter window's own code (design/edgeFilter/model.js and the search in
 * utils/synthesis/edgeFilter.js).
 *
 *   1. edgeFilter gives the periods the window lists, searchEdgeFilters on
 *      the request the window builds from its inputs, with its indices, its
 *      absorbing materials and each period's formula, on the corpus designs:
 *      at the window's opening settings at 0 degrees on every design and at
 *      45 degrees on a third of them, and with a longwave pass, a range and
 *      step of a, another edge and periods; a material with no index at the
 *      edge is refused with the window's message.
 *   2. applyEdgeFilter gives the design the window's Replace and Append
 *      update to, edgeFilterPatch on the formula the window compiles, on the
 *      front and the back, the side taken without one the front or the back
 *      of a design coated on the back alone, a symmetric design's back
 *      refused, and the other refusals.
 *   3. Cross-checks: the applied layers are the layers Stack Formula builds
 *      from the same formula with each pair of touching layers of one
 *      material summed, computed here; Essential Macleod's worked example
 *      (Design Tools, Edge Filter: a = 0.4 with SiO2 outside, 45 degrees,
 *      edge 1000 nm) is found through the API with materials a design
 *      carries.
 *
 * Run: node tests/api_edge_filter.mjs
 */
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const model = await import('../src/components/windows/design/edgeFilter/model.js');
const { searchEdgeFilters } = await import('../src/utils/synthesis/edgeFilter.js');
const { buildStackFromFormula, stackFormulaResolvers } = await import('../src/utils/synthesis/stackFormula.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };

await api.init();

const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const OPENED = CORPUS.map(name => ({ name, design: api.openDesign(fixtureFile(name)) }));
// The window opens only once every material a design names resolves
// (MaterialResolutionModalGuard); the others are refused.
const { requireResolved } = await import('../src/api/materials.js');
const unresolved = ({ design }) => !!thrown(() => requireResolved(design));
const BLOCKED = OPENED.filter(unresolved);
const DESIGNS = OPENED.filter(entry => !BLOCKED.includes(entry));
ok('a design naming a material that resolves to nothing is refused, as the window does not open on it', BLOCKED.length > 0
    && BLOCKED.every(({ design }) => thrown(() => api.edgeFilter(design)) && thrown(() => api.applyEdgeFilter(design))), `${BLOCKED.length}`);

// The window's inputs with `options` typed in, by the API's option names.
const FIELDS = { pass: 'pass', edge: 'edgeLambda', angle: 'angle', a: 'matA', b: 'matB', incident: 'incidentMat', lower: 'lower', upper: 'upper', step: 'step', periods: 'periods' };
function windowInputs(design, options) {
    const typed = Object.fromEntries(Object.entries(options).map(([key, value]) => [FIELDS[key], value]));
    return { ...model.initialInputs(design, {}), ...typed };
}

// What the window lists for `inputs`, as the API reports it, or the window's message.
function windowList(design, inputs) {
    const prepared = model.edgeRequest(design, inputs);
    const found = prepared.errorKey ? prepared : searchEdgeFilters(prepared.request);
    if (found.errorKey) return { error: en.edgeFilter.errors[found.errorKey] };
    const symbols = model.formulaSymbols(inputs, prepared.request);
    return {
        materials: { a: inputs.matA, b: inputs.matB, incident: inputs.incidentMat },
        indices: { a: prepared.request.nA, b: prepared.request.nB, incident: prepared.request.nIncident },
        absorbing: prepared.absorbing, periods: inputs.periods,
        solutions: found.solutions.map(s => ({ ...s, formula: model.periodFormula(s, symbols, inputs.periods) })),
        symbols,
    };
}

function apiList(design, options) {
    try {
        const { pass: p, edge, angle, ...rest } = api.edgeFilter(design, options);
        return { ...rest, echo: [p, edge, angle] };
    } catch (err) {
        return { error: err.message.replace(/^edgeFilter: /, '') };
    }
}

// ── 1. The periods the window lists ─────────────────────────────────────────
const SETTINGS = [{}, { angle: 45 }, { pass: 'long', angle: 30, lower: 0.2, upper: 0.6, step: 0.1, periods: 4 }, { edge: 800, periods: 1, incident: 'builtin:MgF2' }];
let compared = 0, refusedHere = 0;
DESIGNS.forEach(({ name, design }, i) => {
    for (const options of SETTINGS.filter((o, k) => k === 0 || i % 3 === k - 1)) {
        const inputs = windowInputs(design, options);
        const { symbols, ...expected } = windowList(design, inputs);
        const got = apiList(design, options);
        if (expected.error) {
            refusedHere++;
            ok(`${name} ${JSON.stringify(options)}: refused with the window's message`, got.error === expected.error, JSON.stringify(got).slice(0, 200));
            continue;
        }
        compared++;
        const { echo, ...rest } = got;
        ok(`${name} ${JSON.stringify(options)}: the window's periods`, isDeepStrictEqual(rest, expected)
            && isDeepStrictEqual(echo, [inputs.pass, inputs.edgeLambda, inputs.angle]), JSON.stringify(got).slice(0, 300));
    }
});
ok('the corpus gives periods to compare, at 0 and 45 degrees', compared >= DESIGNS.length, `${compared} compared, ${refusedHere} refused`);

const air = api.newDesign({ name: 'Bare' });
const blank = apiList(air, {});
ok('a design with no layers searches SiO2 and TiO2, as a first opening does', blank.materials?.a === 'builtin:SiO2' && blank.materials?.b === 'builtin:TiO2'
    && blank.solutions.length === 2 && blank.solutions[0].c === null, JSON.stringify(blank.materials));
const refusals = [
    [{ pass: 'band' }, 'badValue'], [{ angle: 90 }, 'badValue'], [{ upper: 0.1 }, 'badValue'], [{ step: 0.00001 }, 'badValue'],
    [{ periods: 2.5 }, 'badValue'], [{ lower: -0.1 }, 'badValue'], [{ upper: 2.5 }, 'badValue'], [{ edge: 0 }, 'badValue'], [{ angles: 3 }, 'unknownOption'],
];
ok('a value an option cannot take, or an option it does not take, is refused with its code',
    refusals.every(([options, code]) => thrown(() => api.edgeFilter(air, options))?.code === code));
ok('A and B of one index are refused with the window\'s message', thrown(() => api.edgeFilter(air, { a: 'SiO2', b: 'SiO2' }))?.message === `edgeFilter: ${en.edgeFilter.errors.sameIndex}`);
ok('a material that resolves to nothing is refused', /edgeFilter: b: Unknown material 'Unobtainium'/.test(thrown(() => api.edgeFilter(air, { b: 'Unobtainium' }))?.message ?? ''));

// ── 2. Replace and Append ───────────────────────────────────────────────────
const withoutIds = design => JSON.parse(JSON.stringify(design, (key, value) => (key === 'id' ? undefined : value)));
function windowApplied(design, options, { solution = 0, side, mode = 'replace' } = {}) {
    const inputs = windowInputs(design, options);
    const { symbols, solutions } = windowList(design, inputs);
    const formula = model.periodFormula(solutions[solution], symbols, inputs.periods);
    const compiled = model.compileEdgeFilter(design, formula, symbols.symbolMap, inputs.edgeLambda);
    const isSym = design.surfaceMode === 'symmetric';
    const effSide = isSym ? 'front' : side;
    return { ...design, ...model.edgeFilterPatch({ design, mode, isSym, effSide, compiled, inputs, formula, stamp: 1 }) };
}
let applied = 0;
for (const { name, design } of DESIGNS.filter((_, i) => i % 2 === 0)) {
    const options = { a: 'builtin:SiO2', b: 'builtin:TiO2', periods: 3 };
    for (const [mode, side, solution] of [['replace', 'front', 0], ['append', 'front', 1], ['replace', 'back', 1], ['append', 'back', 0]]) {
        if (design.surfaceMode === 'symmetric' && side === 'back') continue;
        const got = api.applyEdgeFilter(design, { ...options, mode, side, solution });
        applied++;
        ok(`${name} ${mode} ${side} ${solution}: the design the window's ${mode} updates to`,
            isDeepStrictEqual(withoutIds(got), withoutIds(windowApplied(design, options, { solution, side, mode }))));
    }
}
ok('designs to apply on', applied > 10, `${applied}`);
const backOnly = api.setDesignSetup(air, { surfaceMode: 'back_only' });
const onBack = api.applyEdgeFilter(backOnly, { a: 'SiO2', b: 'TiO2' });
ok('without a side, the back of a design coated on the back alone, with the medium searched as its exit medium', onBack.backLayers.length > 0 && onBack.frontLayers.length === 0
    && isDeepStrictEqual(withoutIds(onBack), withoutIds(windowApplied(backOnly, { a: 'SiO2', b: 'TiO2' }, { side: 'back' }))));
const symmetric = api.setDesignSetup(air, { surfaceMode: 'symmetric' });
ok('the back of a symmetric design is refused, and its front gives the mirror on the back',
    /symmetric mode/.test(thrown(() => api.applyEdgeFilter(symmetric, { side: 'back' }))?.message ?? '')
    && isDeepStrictEqual(withoutIds(api.applyEdgeFilter(symmetric, {})), withoutIds(windowApplied(symmetric, {}, { side: 'front' }))));
ok('a solution not in the list and a mode it does not have are refused', thrown(() => api.applyEdgeFilter(air, { solution: 2 }))?.code === 'badValue'
    && thrown(() => api.applyEdgeFilter(air, { mode: 'new' }))?.code === 'badValue' && thrown(() => api.applyEdgeFilter(air, { side: 'total' }))?.code === 'badValue');
const fresh = api.applyEdgeFilter(air, {});
ok('each layer put in has an id of its own', new Set(fresh.frontLayers.map(l => l.id)).size === fresh.frontLayers.length && fresh.frontLayers.every(l => l.id));

// ── 3. Cross-checks ─────────────────────────────────────────────────────────
// Stack Formula's layers with each pair of touching layers of one material summed.
function summedStack(design, formula, symbolMap, edge) {
    const built = buildStackFromFormula({ text: formula, symbolMap, refLambda: edge, resolvers: stackFormulaResolvers(design) });
    const out = [];
    for (const layer of built.layers) {
        if (out.length && out[out.length - 1].material === layer.material) out[out.length - 1].thickness += layer.thickness;
        else out.push({ material: layer.material, thickness: layer.thickness });
    }
    return out;
}
for (const options of [{ angle: 45, edge: 650, periods: 6 }, { periods: 5 }]) {
    const found = api.edgeFilter(air, options);
    const symbolMap = found.indices.a > found.indices.b ? { H: found.materials.a, L: found.materials.b } : { H: found.materials.b, L: found.materials.a };
    const expected = summedStack(air, found.solutions[0].formula, symbolMap, found.edge);
    const layers = api.applyEdgeFilter(air, options).frontLayers;
    ok(`${JSON.stringify(options)}: the applied layers are Stack Formula's with touching layers of one material summed`, layers.length === expected.length && expected.length > 4
        && layers.every((l, i) => l.material === expected[i].material && Math.abs(l.thickness - expected[i].thickness) < 1e-9), `${layers.length} vs ${expected.length}`);
}
const constant = (id, n) => ({ id, name: id, formulaNum: -1, tabData: [[300, n, 0], [2000, n, 0]] });
const example = { ...air, materials: { 'user_x:Low': constant('Low', 1.45042), 'user_x:High': constant('High', 2.25) } };
const worked = api.edgeFilter(example, { edge: 1000, angle: 45, a: 'user_x:Low', b: 'user_x:High' }).solutions[0];
const near = (value, expected, within) => Math.abs(value - expected) < within;
const coefficientsMatch = [near(worked.a, 0.4, 1e-12), near(worked.b, 0.548835, 5e-5), near(worked.c, 0.362701, 5e-5)].every(Boolean);
ok('Essential Macleod\'s worked example: a = 0.4 with SiO2 outside, b and c to 5e-5, a first-order zone',
    coefficientsMatch && worked.outer === 'A' && worked.sigma === -1, JSON.stringify(worked));

console.log(`api_edge_filter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

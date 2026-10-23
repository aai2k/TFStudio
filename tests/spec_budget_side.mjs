/**
 * The side a thickness budget or layer count adds up.
 *
 * Checks:
 *   1. In every surface mode, front adds up the front stack, back the back
 *      stack the design is evaluated with (the front mirrored on a symmetric
 *      design, none on a front-only design scored on its front), and both the
 *      two. A back-only design scored on its back has no front.
 *   2. A check saved without a side reads both. A symmetric design saved with
 *      a stale back reads its mirrored front.
 *   3. A new check, or a row switched to one of these kinds, starts at the side
 *      the design coats; a row that names a side keeps it.
 *   4. Generate MF writes a thickness budget on the coating TT sums as TT rows,
 *      which read the check's value and are met exactly when the check passes,
 *      for ≥, ≤, a range and = with and without a tolerance. A budget on any
 *      other side, and every layer count, gets no row and is named in the
 *      bar's note.
 *
 * Run: node tests/spec_budget_side.mjs
 */
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

const {
    makeQualifier, evaluateQualifier, qualifiersToMFOperands, checksWithoutRow, startingSide, coatedSide,
} = await import('../src/utils/synthesis/qualifiers.js');
const { makeOperand, evaluateOperands, buildEvalContext, calcMF } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const resolveMat = id => getMaterial(id);
const layers = (prefix, spec) => spec.map(([material, thickness], i) => ({ id: `${prefix}${i}`, material, thickness, locked: false }));
const FRONT = layers('F', [['TiO2', 100], ['SiO2', 150], ['TiO2', 80]]);
const BACK = layers('B', [['SiO2', 200], ['TiO2', 60]]);
const design = (surfaceMode, backLayers = BACK) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode, mfEvalMode: 'side', frontLayers: FRONT, backLayers,
});
// The app keeps a symmetric design's stored back the mirror of its front.
const MODES = {
    front_only: design('front_only'),
    back_only: design('back_only'),
    symmetric: design('symmetric', [...FRONT].reverse()),
    both_independent: design('both_independent'),
};
const sum = list => list.reduce((s, l) => s + l.thickness, 0);
const valueOf = (fields, d) => evaluateQualifier(makeQualifier({ cmp: 'le', target: 1e6, ...fields }), d, resolveMat).value;

// ── 1-2. What each side adds up ──────────────────────────────────────────────
for (const [mode, d] of Object.entries(MODES)) {
    const back = { symmetric: [...FRONT].reverse(), front_only: [] }[mode] || BACK;
    const front = mode === 'back_only' ? [] : FRONT;
    const want = { front, back, both: [...front, ...back] };
    for (const side of ['front', 'back', 'both']) {
        ok(`${mode}: the ${side} budget adds up the ${side} layers`, valueOf({ kind: 'THICKNESS_BUDGET', side }, d) === sum(want[side]),
            `${valueOf({ kind: 'THICKNESS_BUDGET', side }, d)} vs ${sum(want[side])}`);
        ok(`${mode}: the ${side} layer count counts them`, valueOf({ kind: 'LAYER_COUNT', side }, d) === want[side].length);
    }
    ok(`${mode}: a budget without a side reads both added up`,
        valueOf({ kind: 'THICKNESS_BUDGET' }, d) === sum(want.both)
        && valueOf({ kind: 'LAYER_COUNT' }, d) === want.both.length);
}

// A symmetric design built without a stored back, as a script can build one,
// or saved with a stale one, still has the mirrored front on its back.
ok('symmetric with no stored back: the back budget reads the mirrored front',
    valueOf({ kind: 'THICKNESS_BUDGET', side: 'back' }, design('symmetric', [])) === sum(FRONT));
ok('symmetric with a stale stored back: a budget without a side reads the front twice',
    valueOf({ kind: 'THICKNESS_BUDGET' }, design('symmetric', BACK)) === 2 * sum(FRONT)
    && valueOf({ kind: 'LAYER_COUNT' }, design('symmetric', BACK)) === 2 * FRONT.length);

// ── 3. The side a new check starts at ────────────────────────────────────────
{
    const sides = Object.values(MODES).map(d => startingSide('THICKNESS_BUDGET', d).side).join();
    ok('a new budget starts at the side the design coats', sides === 'front,back,front,both', sides);
    ok('so does a layer count', startingSide('LAYER_COUNT', MODES.back_only).side === 'back');
    ok('a row that names a side keeps it', Object.keys(startingSide('THICKNESS_BUDGET', MODES.back_only, 'front')).length === 0);
    ok('other kinds start with no side', Object.keys(startingSide('T_AVG', MODES.back_only)).length === 0);
}

// ── 4. The TT rows Generate MF writes ────────────────────────────────────────
for (const [mode, d] of Object.entries(MODES)) {
    const side = coatedSide(d);
    const ctx = buildEvalContext(d, resolveMat);
    const v = valueOf({ kind: 'THICKNESS_BUDGET', side }, d);
    const tt = evaluateOperands([makeOperand({ type: 'TT', cmp: 'eq', target: 0, weight: 1 })], ctx)[0];
    ok(`${mode}: the ${side} budget reads what TT sums`, v === tt, `${v} vs ${tt}`);
    const cases = [
        ...[v - 1, v, v + 1].flatMap(target => [{ cmp: 'ge', target }, { cmp: 'le', target }]),
        { cmp: 'between', lo: v - 5, hi: v + 5 }, { cmp: 'between', lo: v + 1, hi: v + 5 }, { cmp: 'between', lo: v - 5, hi: v - 1 },
        { cmp: 'eq', target: v + 4, tol: 5 }, { cmp: 'eq', target: v + 6, tol: 5 }, { cmp: 'eq', target: v, tol: 0 }, { cmp: 'eq', target: v + 1, tol: 0 },
    ];
    for (const fields of cases) {
        const q = makeQualifier({ kind: 'THICKNESS_BUDGET', side, ...fields });
        const passes = evaluateQualifier(q, d, resolveMat).pass;
        const rows = qualifiersToMFOperands([q], { design: d });
        const met = calcMF(rows, evaluateOperands(rows, ctx)) === 0;
        const label = `${mode}: ${JSON.stringify(fields)} on ${v} nm`;
        ok(`${label} is written as TT rows`, rows.length > 0 && rows.every(op => op.type === 'TT'), rows.map(op => op.type).join());
        ok(`${label}: the rows are met exactly when the check passes`, met === passes, `met ${met}, passes ${passes}`);
    }
    const others = ['front', 'back', 'both'].filter(s => s !== side);
    const unwritten = [...others.map(s => makeQualifier({ kind: 'THICKNESS_BUDGET', side: s })), makeQualifier({ kind: 'LAYER_COUNT', side })];
    ok(`${mode}: a budget on another side, and a layer count, get no row`,
        unwritten.every(q => qualifiersToMFOperands([q], { design: d }).length === 0)
        && checksWithoutRow(unwritten, { design: d }).length === unwritten.length);
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

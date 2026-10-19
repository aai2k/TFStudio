/**
 * Generate MF writes a check of `= target ± tol` so its rows are met exactly
 * when the check passes.
 *
 * A check of `= target ± tol` passes within the tolerance. Written as the base
 * row alone at the target, a two-sided row (T, TAV, TIW, MXWT) keeps pulling to
 * the exact target after the check passes, and a one-sided row (TMN..AMX, PPEF)
 * counts the whole side past its target as met, so `max R = 0.10 ± 0.01` read
 * as `max R ≤ 0.10`.
 *
 * Checks:
 *   1. For T_AT, T_AVG, INTEGRAL, CENTRAL_LAMBDA, MIN_MAX (max R and min T) and
 *      PPEF, with the target inside, above and below the tolerance: the merit
 *      Generate MF writes is 0 exactly when the check passes.
 *   2. With no tolerance a two-sided check is its base row at the target; a
 *      one-sided one, worst case or PPEF, still gets the pair.
 *   3. A value on a bound of target ± tol passes the check exactly when it
 *      meets the rows; a negative tolerance is an exact target to both.
 *
 * Run: node tests/spec_eq_ranges.mjs
 */

const api = await import('../src/api/index.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { makeQualifier, evaluateQualifier, qualifiersToMFOperands } = await import('../src/utils/synthesis/qualifiers.js');
const { makeMeasuredCurve } = await import('../src/utils/io/spectrumTable/measuredCurve.js');
const { finishCompare } = await import('../src/utils/synthesis/qualifiers/format.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const stack = formula => api.stackFromFormula(api.newDesign(), { formula, symbols: { H: 'TiO2', L: 'SiO2' }, referenceWavelength: 550 });
const x = Array.from({ length: 21 }, (_, i) => 450 + 10 * i);
const curve = makeMeasuredCurve({ name: 'measured', quantity: 'T', x, y: x.map((_, i) => 0.95 + 0.02 * Math.sin(i / 2)) });
const ar = { ...stack('0.27H 0.33L 1.8H 1.05L'), measuredCurves: [curve] };
const cavity = stack('(HL)^4 2H (LH)^4');

const CASES = [
    ['T_AT', ar, { kind: 'T_AT', lambda: 550 }, 0.01],
    ['T_AVG', ar, { kind: 'T_AVG', lambdaStart: 450, lambdaEnd: 650 }, 0.01],
    ['INTEGRAL', ar, { kind: 'INTEGRAL', lambdaStart: 380, lambdaEnd: 780 }, 0.01],
    ['CENTRAL_LAMBDA', cavity, { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', lambdaStart: 530, lambdaEnd: 570 }, 1],
    ['max R', ar, { kind: 'MIN_MAX', channel: 'R', direction: 'max', lambdaStart: 450, lambdaEnd: 650 }, 0.01],
    ['min T', ar, { kind: 'MIN_MAX', channel: 'T', direction: 'min', lambdaStart: 450, lambdaEnd: 650 }, 0.01],
    ['PPEF', ar, { kind: 'PPEF', curveId: curve.id }, 0.1],
];
const meritOf = (design, check) => meritTable(design, qualifiersToMFOperands([check], { design })).mf;

// ── 1. Met exactly when the check passes ───────────────────────────────────
for (const [name, design, fields, tol] of CASES) {
    const lookup = designMaterialLookup(design);
    const value = evaluateQualifier(makeQualifier({ ...fields, cmp: 'ge', target: 0 }), design, lookup).value;
    for (const [where, target] of [['inside', value + 0.5 * tol], ['above', value + 2 * tol], ['below', value - 2 * tol]]) {
        const check = makeQualifier({ ...fields, cmp: 'eq', target, tol });
        const passes = evaluateQualifier(check, design, lookup).pass;
        const merit = meritOf(design, check);
        ok(`${name}, target ${where} the tolerance: the merit is 0 exactly when the check passes`, passes === (merit === 0),
            `check ${passes ? 'passes' : 'fails'}, merit ${merit}`);
    }
}

// ── 2. No tolerance ────────────────────────────────────────────────────────
{
    const exact = qualifiersToMFOperands([makeQualifier({ kind: 'T_AT', lambda: 550, cmp: 'eq', target: 0.9, tol: 0 })], { design: ar });
    ok('with no tolerance a two-sided check is its row at the target', exact.length === 1 && exact[0].target === 0.9 && exact[0].weight === 1,
        JSON.stringify(exact.map(op => [op.type, op.target, op.weight])));
    const oneSided = qualifiersToMFOperands([makeQualifier({ kind: 'MIN_MAX', channel: 'R', direction: 'max', lambdaStart: 450, lambdaEnd: 650, cmp: 'eq', target: 0.05, tol: 0 })], { design: ar });
    ok('a one-sided check still gets the pair', oneSided.map(op => op.type).join() === 'RMX,OPGT,OPLT' && oneSided[0].weight === 0,
        oneSided.map(op => op.type).join());
}

{
    const ppef = qualifiersToMFOperands([makeQualifier({ kind: 'PPEF', curveId: curve.id, cmp: 'eq', target: 1, tol: 0 })], { design: ar });
    ok('a PPEF check with no tolerance gets the pair too', ppef.map(op => op.type).join() === 'MCURVE,PPEF,OPGT,OPLT' && ppef[1].weight === 0,
        ppef.map(op => `${op.type}:${op.weight}`).join());
}

// ── 3. Bounds ──────────────────────────────────────────────────────────────
for (const [target, tol] of [[0.9, 0.01], [0.95, 0.02], [0.3, 0.1], [550, 0.1]]) {
    for (const value of [target - tol, target + tol]) {
        const check = { kind: 'T_AT', cmp: 'eq', target, tol };
        const rowsMet = value >= target - tol && value <= target + tol;
        ok(`${target} ± ${tol}: the check at ${value} passes as the rows are met`, finishCompare(check, value, '%').pass === rowsMet);
    }
}
{
    const negative = makeQualifier({ kind: 'T_AT', lambda: 550, cmp: 'eq', target: 0.9, tol: -0.01 });
    const rows = qualifiersToMFOperands([negative], { design: ar });
    ok('a negative tolerance writes the row at the target', rows.length === 1 && rows[0].target === 0.9, JSON.stringify(rows.map(op => [op.type, op.target])));
    ok('and the check passes there, and only there', finishCompare(negative, 0.9, '%').pass && !finishCompare(negative, 0.905, '%').pass);
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

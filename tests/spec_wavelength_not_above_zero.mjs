/**
 * A specification check that reads a wavelength of 0 nm or below has no
 * value: there is no spectrum there.
 *
 * Checks, on a corpus design and on checks made as the Specification window
 * makes and edits them, where a stray minus in a wavelength field is enough:
 *   1. T, R and A at -5 nm and at 0 nm, and each check over a band whose start
 *      is below 0, give no value, the reason notComputable, and fail, in the
 *      window's pass (the analysis worker's) and in checkSpecification, with
 *      the unit their value would have had.
 *   2. Monte Carlo's yield counts such a check as failed in every trial.
 *   3. A check at a wavelength above 0 still gives its value.
 *
 * Run: node tests/spec_wavelength_not_above_zero.mjs
 */
import { createRequire } from 'node:module';
import { fixtureFile } from './_apiCorpus.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');

const api = await import('../src/api/index.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { addQualifierTo, updateQualifierIn } = await import('../src/components/windows/design/specification/useSpecificationState.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const bare = api.openDesign(fixtureFile('front-only-total-mode'));

// A check of `kind` as the window adds one, with `fields` typed into it.
function windowCheck(kind, fields) {
    let qualifiers = [];
    const write = next => { qualifiers = next; };
    addQualifierTo(qualifiers, write, () => {}, kind, bare);
    updateQualifierIn(qualifiers, write, qualifiers[0].id, fields, bare);
    return qualifiers[0];
}

// Each check with no value, and the unit checkSpecification gives it.
const NONE = [
    [windowCheck('T_AT', { lambda: -5 }), 'fraction'],
    [windowCheck('R_AT', { lambda: -5 }), 'fraction'],
    [windowCheck('A_AT', { lambda: -5 }), 'fraction'],
    [windowCheck('T_AT', { lambda: 0 }), 'fraction'],
    [windowCheck('R_AT', { lambda: 0 }), 'fraction'],
    ...['T_AVG', 'R_AVG', 'A_AVG', 'MIN_MAX', 'INTEGRAL'].map(kind => [windowCheck(kind, { lambdaStart: -50 }), 'fraction']),
    ...['CENTRAL_LAMBDA', 'FWHM', 'EDGE_LAMBDA'].map(kind => [windowCheck(kind, { lambdaStart: -50 }), 'nm']),
];
const shown = check => `${check.kind} ${check.kind.endsWith('_AT') ? check.lambda : `${check.lambdaStart}..${check.lambdaEnd}`}`;

// ── 1. The window's pass and checkSpecification ────────────────────────────
const design = api.setSpecification(bare, [...NONE.map(([check]) => check), windowCheck('T_AT', { lambda: 550 })]);
const worker = dispatchAnalysisEvaluation('specification', { designs: [embedDesignMaterials(withHerpinRecords(design))] })[0];
const verdict = api.checkSpecification(design);
NONE.forEach(([check, unit], i) => {
    const said = worker[i], row = verdict.rows[i];
    ok(`${shown(check)}: the window's pass gives no value, not computable, failed`,
        said.value === null && said.summaryKey === 'notComputable' && said.pass === false, JSON.stringify(said));
    ok(`${shown(check)}: checkSpecification gives no value, notComputable, failed, in ${unit}`,
        row.value === null && row.reason === 'notComputable' && row.passed === false && row.margin === null && row.unit === unit, JSON.stringify(row));
});
const kept = verdict.rows[NONE.length];
ok('a check at 550 nm still gives its value', Number.isFinite(kept.value) && kept.value > 0 && kept.value <= 1 && kept.reason === null, JSON.stringify(kept));

// ── 2. Monte Carlo's yield ─────────────────────────────────────────────────
for (const [check] of [NONE[0], NONE[5]]) {
    const y = await api.estimateYield(api.setSpecification(bare, [check]), { runs: 10, seed: 1 });
    ok(`${shown(check)}: the yield counts it failed in every trial`, y.yield === 0 && y.evaluated === 10 && y.perQualifier[0].failRate === 1, JSON.stringify(y));
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

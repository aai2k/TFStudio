/**
 * Characterization test for defaultTolForKind (src/utils/synthesis/qualifiers.js).
 *
 * Pins the per-kind default `eq` tolerance used by makeQualifier and by
 * QRow.js when the user changes a qualifier's kind. nm-valued kinds get an
 * nm-scale tolerance; count kinds get an exact-match tolerance; everything
 * else (T/R/A specs) defaults to 1 %.
 *
 * Run: node tests/qualifiers_default_tol.mjs
 */
import { defaultTolForKind, makeQualifier } from '../src/utils/synthesis/qualifiers.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const EXPECTED = {
    CENTRAL_LAMBDA:   1.0,
    FWHM:             2.0,
    EDGE_LAMBDA:      1.0,
    THICKNESS_BUDGET: 10.0,
    LAYER_COUNT:      0,
    T_AT: 0.01, T_AVG: 0.01, R_AT: 0.01, R_AVG: 0.01, A_AT: 0.01, A_AVG: 0.01,
    MIN_MAX: 0.01, INTEGRAL: 0.01,
};

console.log('— defaultTolForKind per-kind defaults —');
for (const [kind, tol] of Object.entries(EXPECTED)) {
    ok(defaultTolForKind(kind) === tol, `${kind} → ${tol} (got ${defaultTolForKind(kind)})`);
}
ok(defaultTolForKind('NOT_A_KIND') === 0.01, 'unknown kind falls back to 0.01');

console.log('— makeQualifier picks up the kind-specific tol when not overridden —');
ok(makeQualifier({ kind: 'CENTRAL_LAMBDA' }).tol === 1.0, 'CENTRAL_LAMBDA qualifier tol=1.0');
ok(makeQualifier({ kind: 'LAYER_COUNT' }).tol === 0, 'LAYER_COUNT qualifier tol=0');
ok(makeQualifier({ kind: 'CENTRAL_LAMBDA', tol: 5 }).tol === 5, 'explicit tol overrides the kind default');

if (fails === 0) console.log('\nAll defaultTolForKind tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }

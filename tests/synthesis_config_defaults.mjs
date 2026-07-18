/**
 * Characterization test for synthesisConfig.js getters that have no localStorage
 * available (this is the actual runtime shape inside the headless test suite
 * and inside Web Workers) — pins the no-localStorage fallback defaults and the
 * pure helper functions (thread-count scaling, cand-mode → max-batches table).
 *
 * Run: node tests/synthesis_config_defaults.mjs
 */
import {
    SYNTHESIS_INNER_ENGINES, getSynthesisInnerEngine,
    defaultThreadCount, threadSelectOptions,
    SYNTHESIS_CAND_MODES, DEFAULT_SYNTHESIS_CAND_MODE, getSynthesisCandMode, getSynthesisMaxBatches,
    NEEDLE_SENS_MODES, DEFAULT_NEEDLE_SENS_MODE, getNeedleSensMode, getNeedleSensFloor,
    SYNTHESIS_SEED_MODES, DEFAULT_SYNTHESIS_SEED_MODE, getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    DEFAULT_CONSOLIDATE_TOL, getSynthesisConsolidate, getSynthesisConsolidateTol,
    getSynthesisSmartSeed,
} from '../src/utils/synthesis/synthesisConfig.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

console.log('— getSynthesisInnerEngine: no localStorage → per-tool default (cg) —');
for (const tool of ['needle', 'ge', 'structural']) {
    ok(getSynthesisInnerEngine(tool) === 'cg', `${tool} → cg (got ${getSynthesisInnerEngine(tool)})`);
}
ok(SYNTHESIS_INNER_ENGINES.includes('cg') && SYNTHESIS_INNER_ENGINES.includes('dls'),
    'engine list includes cg and dls');

console.log('— defaultThreadCount scaling —');
ok(defaultThreadCount(1) === 1, '1 core → 1');
ok(defaultThreadCount(2) === 1, '2 cores → 1');
ok(defaultThreadCount(4) === 3, '4 cores → cores-1 = 3');
ok(defaultThreadCount(8) === 6, '8 cores → cores-2 = 6');
ok(defaultThreadCount(16) === 12, '16 cores → round(cores*0.75) = 12');

console.log('— threadSelectOptions —');
{
    const opts = threadSelectOptions();
    ok(Array.isArray(opts) && opts.length >= 1, 'returns a non-empty option list');
    ok(opts[0][0] === '1', 'first option is "1"');
}

console.log('— cand mode default + max batches table —');
ok(getSynthesisCandMode() === DEFAULT_SYNTHESIS_CAND_MODE, `default cand mode = ${DEFAULT_SYNTHESIS_CAND_MODE}`);
ok(SYNTHESIS_CAND_MODES.includes(getSynthesisCandMode()), 'default mode is a valid mode');
ok(getSynthesisMaxBatches() === 2, `balanced (default) → 2 batches (got ${getSynthesisMaxBatches()})`);

console.log('— needle sensitivity default —');
ok(getNeedleSensMode() === DEFAULT_NEEDLE_SENS_MODE, `default sens mode = ${DEFAULT_NEEDLE_SENS_MODE}`);
ok(NEEDLE_SENS_MODES.includes(getNeedleSensMode()), 'default mode is a valid mode');
ok(getNeedleSensFloor() === 0, `off (default) → floor 0 (got ${getNeedleSensFloor()})`);

console.log('— seed mode default —');
ok(getSynthesisSeedMode() === DEFAULT_SYNTHESIS_SEED_MODE, `default seed mode = ${DEFAULT_SYNTHESIS_SEED_MODE}`);
ok(SYNTHESIS_SEED_MODES.includes(getSynthesisSeedMode()), 'default mode is a valid mode');
ok(PRESERVE_BULK_GENTLE_ITER === 15, `gentle-iter cap = 15 (got ${PRESERVE_BULK_GENTLE_ITER})`);

console.log('— consolidation default —');
ok(getSynthesisConsolidate() === true, 'consolidation default ON');
ok(getSynthesisConsolidateTol() === DEFAULT_CONSOLIDATE_TOL, `default tol = ${DEFAULT_CONSOLIDATE_TOL}`);

console.log('— smart seed per-scope defaults —');
ok(getSynthesisSmartSeed('needle') === false, 'needle default OFF');
ok(getSynthesisSmartSeed('ge') === true, 'ge default ON');
ok(getSynthesisSmartSeed('structural') === true, 'structural default ON');
ok(getSynthesisSmartSeed() === false, 'bare (no scope) default OFF');

if (fails === 0) console.log('\nAll synthesisConfig default tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }

import { createWindowSession } from '../../windowSession.js';
import { BENCH_CASES } from '../../../../utils/benchmark/optimizerBenchmark.js';

// Results are not here: a run writes them to the benchmark store, which already
// outlives the window. The inner-engine selection has its own saved setting.
export const optimizerBenchmarkSession = createWindowSession({
    selCases: new Set(BENCH_CASES.map(benchCase => benchCase.id)),
    // Sort within each benchmark's table (by MF / layers / time). 'none' = job order.
    sort: { key: 'none', dir: 1 },
});

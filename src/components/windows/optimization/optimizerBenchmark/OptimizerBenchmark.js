/**
 * Optimizer Benchmark — DEV/QA diagnostic window.
 *
 * Runs the cross-optimizer benchmark IN-APP with live updates: every
 * (design case × optimizer × setting) cell is dispatched to a pool of
 * benchmark Web Workers, so the UI never freezes and results stream into the
 * table row-by-row (synthesis cells stream a live best-MF while running).
 *
 * Shares ONE driver core with the CLI report
 * (src/utils/benchmark/optimizerBenchmark.js → tests/optimizer_grand_benchmark.mjs),
 * so the GUI numbers and the CLI numbers come from identical code, on the same
 * WASM kernel.
 *
 * PERSISTENCE: the run state lives in a MODULE-LEVEL store (not component
 * state), so switching docking tabs away and back keeps the results — and a run
 * in progress KEEPS RUNNING (its worker pool is not tied to the component
 * lifecycle). Completed runs are also snapshotted to localStorage so they
 * survive an app reload.
 *
 * Internal diagnostic (English-only by design — opened from the dev-only View
 * menu), benchmarking the fixed built-in suite, independent of the open design.
 */
import { useOptimizerBenchmark } from './useOptimizerBenchmark.js';
import { ConfigPanel } from './ConfigPanel.js';
import { ProgressBar } from './ProgressBar.js';
import { ResultsArea } from './ResultsArea.js';

const { createElement: h } = React;

export function OptimizerBenchmark({ c }) {
    const state = useOptimizerBenchmark();
    const props = { ...state, c };
    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, overflow: 'hidden' } },
        h(ConfigPanel, props),
        h(ProgressBar, props),
        h(ResultsArea, props));
}

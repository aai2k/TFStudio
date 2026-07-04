/**
 * TFStudio test-suite runner.
 *
 * Discovers every `tests/*.mjs` file, runs each as an isolated Node child
 * process, and aggregates pass / fail / skip / timeout into one report. This
 * turns the ~90 standalone test scripts into a single regression gate.
 *
 * CONVENTIONS the harness relies on (already used by the existing tests):
 *   • exit code 0  → PASS
 *   • exit code !0 → FAIL
 *   • a line beginning with "SKIP" + exit 0 → SKIP (e.g. WASM tests when the
 *     kernel isn't built)
 *
 * BENCH set: long-running benchmarks / reporting tools (no strict pass-fail, or
 * heavy synthesis/global-optimizer runs). These are EXCLUDED from the default
 * suite so `npm test` stays fast. Run them explicitly with `--bench` / `--all`.
 * Move a filename in or out of BENCH below to recategorize it.
 *
 * Usage:
 *   node tests/run-all.mjs                 # fast suite (default)
 *   node tests/run-all.mjs --all           # fast suite + benchmarks
 *   node tests/run-all.mjs --bench         # benchmarks ONLY
 *   node tests/run-all.mjs --filter=wasm   # only tests whose name contains "wasm"
 *   node tests/run-all.mjs --timeout=300   # per-test timeout in seconds
 *   node tests/run-all.mjs --jobs=4        # run N tests concurrently (default 1)
 *   node tests/run-all.mjs --list          # list the suite/bench split and exit
 */

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(TESTS_DIR, '..');

// ── Long-running benchmarks / reporting tools (excluded from default suite) ──
const BENCH = new Set([
    'optimizer_benchmarks.mjs',       // reporting tool — no pass/fail, multi-engine timing
    'global_optimizers.mjs',          // DE / SA / CG full runs
    'newton_perf.mjs',                // perf timing
    'cg_single_run_depth.mjs',        // deep CG convergence sweep
    'wasm_bench.mjs',                 // WASM vs JS micro-benchmark
    'structural_optimizer.mjs',       // SA over structure (mutation search)
    'structural_deep_spin.mjs',       // deep-mode spin (reporting tool, minutes)
    'mc_presample_equivalence.mjs',   // Monte-Carlo equivalence sweep
    'error_analysis_layer_sensitivity.mjs',
    'synthesis_inner_engine.mjs',
    'synthesis_scan_profile.mjs',
    'synthesis_conv_stop.mjs',
    'synthesis_4band_escape.mjs',
    'synthesis_merit_landscape.mjs',
    'synthesis_multipassband_diag.mjs',
    'synthesis_preserve_bulk.mjs',
    'central_lambda_vs_mxwt_diag.mjs',
    'filter_design_explore.mjs',      // (m,k)-equivalence sweep / reporting tool (not pass/fail)
    'sqp_benchmark.mjs',              // optimizer method × mode benchmark (reporting tool)
    'optimizer_grand_benchmark.mjs',  // grand cross-optimizer benchmark (reporting tool, minutes)
    'synthesis_single_seed_bbar.mjs', // single-layer-seed → BBAR GE/Structural (time-budgeted)
    'consolidate_achromat.mjs',       // achromat seed/consolidate diagnostic (reads user Documents)
]);

// ── Arg parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (k, d) => {
    const a = args.find((x) => x.startsWith(`--${k}=`));
    return a ? a.split('=')[1] : d;
};
const runAll   = has('--all');
const benchOnly = has('--bench');
const listOnly = has('--list');
const filter   = valOf('filter', null);
const jobs     = Math.max(1, parseInt(valOf('jobs', '1'), 10) || 1);
const defaultTimeout = benchOnly || runAll ? 900 : 180; // seconds
const timeoutMs = (parseInt(valOf('timeout', String(defaultTimeout)), 10) || defaultTimeout) * 1000;

// ── Discover tests ───────────────────────────────────────────────────────────
let files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs')
    .sort();

if (benchOnly)      files = files.filter((f) => BENCH.has(f));
else if (!runAll)   files = files.filter((f) => !BENCH.has(f));
if (filter)         files = files.filter((f) => f.includes(filter));

if (listOnly) {
    const all = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs').sort();
    console.log(`\nSuite (${all.filter((f) => !BENCH.has(f)).length} fast tests):`);
    all.filter((f) => !BENCH.has(f)).forEach((f) => console.log('  • ' + f));
    console.log(`\nBench (${[...BENCH].length} long-running, excluded by default):`);
    [...BENCH].sort().forEach((f) => console.log('  ⏱ ' + f));
    process.exit(0);
}

// ── Runner ───────────────────────────────────────────────────────────────────
const C = { gray: '\x1b[90m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };

function runOne(file) {
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        const child = spawn(process.execPath, [join(TESTS_DIR, file)], {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '', err = '', timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => {
            clearTimeout(timer);
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            const combined = out + err;
            const skipped = code === 0 && /^\s*SKIP\b/m.test(combined);
            let status;
            if (timedOut) status = 'TIMEOUT';
            else if (skipped) status = 'SKIP';
            else if (code === 0) status = 'PASS';
            else status = 'FAIL';
            resolve({ file, status, code, ms, out: combined });
        });
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve({ file, status: 'FAIL', code: -1, ms: 0, out: String(e) });
        });
    });
}

async function main() {
    const mode = benchOnly ? 'BENCH only' : runAll ? 'ALL (suite + bench)' : 'fast suite';
    console.log(`${C.bold}TFStudio test runner${C.reset} — ${mode}, ${files.length} test(s), ` +
        `timeout ${timeoutMs / 1000}s, jobs ${jobs}\n`);

    const results = [];
    const queue = [...files];
    const tally = (r) => {
        results.push(r);
        const tag = r.status === 'PASS' ? `${C.green}PASS${C.reset}`
            : r.status === 'SKIP' ? `${C.yellow}SKIP${C.reset}`
            : r.status === 'TIMEOUT' ? `${C.red}TIMEOUT${C.reset}`
            : `${C.red}FAIL${C.reset}`;
        console.log(`  ${tag} ${C.gray}${r.ms.toFixed(0).padStart(6)}ms${C.reset}  ${r.file}`);
    };

    async function worker() {
        while (queue.length) {
            const file = queue.shift();
            tally(await runOne(file));
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

    // ── Summary ──
    const by = (s) => results.filter((r) => r.status === s);
    const pass = by('PASS'), fail = by('FAIL'), skip = by('SKIP'), to = by('TIMEOUT');
    const totalMs = results.reduce((a, r) => a + r.ms, 0);

    console.log(`\n${C.bold}── Summary ──${C.reset}`);
    console.log(`  ${C.green}PASS ${pass.length}${C.reset}   ${C.red}FAIL ${fail.length}${C.reset}   ` +
        `${C.yellow}SKIP ${skip.length}${C.reset}   ${C.red}TIMEOUT ${to.length}${C.reset}   ` +
        `${C.gray}(${(totalMs / 1000).toFixed(1)}s total)${C.reset}`);

    if (fail.length || to.length) {
        console.log(`\n${C.red}${C.bold}Failures:${C.reset}`);
        for (const r of [...fail, ...to]) {
            console.log(`\n${C.red}● ${r.file}${C.reset} (${r.status}, exit ${r.code})`);
            const tail = r.out.trim().split('\n').slice(-12).join('\n');
            console.log(tail.split('\n').map((l) => '    ' + l).join('\n'));
        }
    }
    process.exit(fail.length || to.length ? 1 : 0);
}

main();

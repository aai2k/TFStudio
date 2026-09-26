/**
 * Simulated Annealing across layer counts.
 *
 * Runs the Refinement window's SA (400-iteration cap, the seed as given, dMin
 * 1 nm) from the fixed perturbed quarter-wave starts of the optimizer
 * benchmark, at 8, 12, 16, 40, 100 and 120 layers, and reports the best merit
 * per seed, the median, why each run stopped, and its cost. REPORTING tool (no
 * pass/fail), in the BENCH set.
 *
 * The operands are scored on the benchmark cases' own wavelength grid, which
 * is coarser than the grid the Refinement window builds before a run. A
 * design's merit agrees within a few percent between the two, but a given seed
 * takes a different path on each, so per-seed numbers do not replay in the
 * window.
 *
 * On one start SA's result can differ twentyfold from seed to seed, so a change
 * to the engine is judged on the median, not on one seed, and three seeds can
 * all land on one side of the spread. Below 100 layers a run takes seconds and
 * ten seeds are run; the two large starts take up to a minute per run on an
 * engine that stops early, and several on one that does not, so they get three.
 *
 * Each run is its own child process, spread over the cores less two.
 *
 * Run: node tests/sa_benchmark.mjs
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const CASES = [
    { id: 'bbar',      n: 8,   seeds: range(10) },
    { id: 'bandpass',  n: 12,  seeds: range(10) },
    { id: 'otf4',      n: 16,  seeds: range(10) },
    { id: 'shortpass', n: 40,  seeds: range(10) },
    { id: 'shortpass', n: 120, seeds: range(3) },
    { id: 'bbar',      n: 100, seeds: range(3) },
];

async function runOneAndPrint(caseId, n, seed) {
    const { makeEngine } = await import('../src/utils/optimizers/index.js');
    const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
    const { refineStart, caseById, GLOBAL_MAXITER } = await import('../src/utils/benchmark/optimizerBenchmark.js');
    const { initWasmForTest, tmmWasmActive } = await import('./_wasmInit.mjs');
    await initWasmForTest();
    const e = makeEngine('sa', caseById(caseId).ops, refineStart(n), (id) => getMaterial(id), { seed, dMin: 1 });
    const t0 = performance.now();
    while (!e.isConverged() && e.iter < GLOBAL_MAXITER.sa) e.step();
    let stop = 'cap';
    if (e.mfBest < e.tol) stop = 'target';
    else if (e.T < e.Tmin) stop = 'cold';
    else if (e._stall >= e._stallLimit) stop = 'stall';
    console.log(JSON.stringify({ mf: e.mfBest, iters: e.iter, stop, s: (performance.now() - t0) / 1000, wasm: tmmWasmActive() }));
}

function runChild(task) {
    return new Promise((resolve) => {
        const args = [SELF, '--one', task.id, String(task.n), String(task.seed)];
        const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', () => {
            const line = out.split('\n').find((l) => l.startsWith('{'));
            if (!line) console.error(`${task.id} ${task.n} seed ${task.seed} failed:\n${err.trim()}`);
            resolve({ ...task, r: line ? JSON.parse(line) : null });
        });
    });
}

async function runAll(tasks, jobs) {
    const queue = tasks.slice().sort((a, b) => b.n - a.n);
    const done = [];
    const worker = async () => {
        while (queue.length) done.push(await runChild(queue.shift()));
    };
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
    return done;
}

const fmt = (x) => (x == null ? 'error' : x >= 0.1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(4) : x.toPrecision(2));
function median(v) {
    const s = v.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
function countBy(values) {
    const c = {};
    for (const v of values) c[v] = (c[v] || 0) + 1;
    return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');
}

function report(results) {
    // The GUI runs every TMM hot path on the WASM kernel; a JS-fallback run
    // would time a path the app never takes.
    const wasm = results.every((q) => q.r?.wasm);
    console.log(`WASM ${wasm ? 'ON' : 'off (JS fallback) in at least one run'}\n`);
    console.log('| start | median | per seed | stopped | iterations | s per run |');
    console.log('|---|---|---|---|---|---|');
    for (const c of CASES) {
        const rows = results.filter((q) => q.id === c.id && q.n === c.n).sort((a, b) => a.seed - b.seed);
        const ok = rows.map((q) => q.r).filter(Boolean);
        const mfs = ok.map((r) => r.mf);
        const iters = ok.map((r) => r.iters);
        console.log(`| ${c.id} ${c.n} | ${fmt(ok.length ? median(mfs) : null)} | ${rows.map((q) => fmt(q.r?.mf)).join(' / ')} | ` +
            `${countBy(ok.map((r) => r.stop))} | ${Math.min(...iters)}-${Math.max(...iters)} | ${median(ok.map((r) => r.s)).toFixed(0)} |`);
    }
    return results.every((q) => q.r);
}

if (process.argv[2] === '--one') {
    const [, , , caseId, n, seed] = process.argv;
    await runOneAndPrint(caseId, Number(n), Number(seed));
} else {
    const tasks = CASES.flatMap((c) => c.seeds.map((seed) => ({ id: c.id, n: c.n, seed })));
    const jobs = Math.max(1, cpus().length - 2);
    console.log(`SA benchmark · ${tasks.length} runs on ${jobs} processes\n`);
    const allRan = report(await runAll(tasks, jobs));
    process.exit(allRan ? 0 : 1);
}

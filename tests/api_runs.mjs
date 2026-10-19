/**
 * Runs through the headless API (src/api/runs.js, tolerance.js) in plain Node.
 *
 *   1. A refinement and each synthesis method, briefly, on a TiO2/SiO2 AR:
 *      each ends on its own with a design no worse than it started from.
 *      Gradual Evolution, Structural and Deep given no floor keep their layers
 *      at the strictest MNT row, as their windows do. On a symmetric design
 *      Deep's answer is mirrored onto the back; on a back_only design the
 *      answers land on the back.
 *   2. Stop: before a run, and from a run's own progress hook (Needle and
 *      Gradual Evolution, whose jobs go to the in-thread pool, and a refine).
 *      Each ends stopped with the design as it was.
 *   3. The in-thread synthesis pool keeps the WorkerPool contract: a job that
 *      fails rejects, terminate() rejects the jobs not answered and any posted
 *      after it.
 *   4. Monte Carlo and layer sensitivity.
 *
 * Run: node tests/api_runs.mjs
 */
const api = await import('../src/api/index.js');
const { InThreadSynthesisPool } = await import('../src/utils/workers/inThreadSynthesisPool.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const quietly = async run => {
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { return await run(); } finally { console.log = log; console.warn = warn; }
};
// A run that has not ended after this long is stuck.
const within = (promise, ms = 60000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('stuck'), ms))]);

await api.init();
const AR_ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }];
const twoLayers = setup => api.insertLayer(api.insertLayer(api.newDesign(setup), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
const start = api.setMerit(twoLayers(), AR_ROWS);
const startMerit = api.merit(start).total;
const POOL = ['TiO2', 'SiO2'];

// ── 1. Runs ────────────────────────────────────────────────────────────────
{
    let ticks = 0, started = 0;
    const refined = await quietly(() => api.refine(start, { method: 'dls', maxIter: 30 }, { onStart: () => { started++; }, onProgress: () => { ticks++; } }));
    const after = api.merit(refined.design).total;
    ok('a refinement ends on its own with a better design', refined.result.completed && after < startMerit
        && refined.design.frontLayers.length === 2, `${startMerit} -> ${after}`);
    ok('it reports its start and its progress', started === 1 && ticks > 0, `${started} starts, ${ticks} reports`);
}
const RUNS = {
    needle: { maxLayers: 6, refineIter: 10, threads: 1 },
    ge: { maxLayers: 6, maxGeCycles: 2, refineIter: 10, threads: 1 },
    structural: { maxIter: 3, refineIter: 5, threads: 1, seed: 7 },
    deep: { dMin: 20, maxLayers: 6, seed: 7, threads: 1, method: { search: { rounds: 2, children: 3 } } },
};
for (const [method, settings] of Object.entries(RUNS)) {
    const run = await quietly(() => api.synthesize(start, { method, pool: POOL, settings }));
    const after = api.merit(run.design).total;
    ok(`${method} ends on its own with a design no worse than its start`, run.result.completed && after <= startMerit + 1e-12
        && run.design.frontLayers.every(l => l.id && l.thickness > 0), `${run.result.stopReason}, ${startMerit} -> ${after}`);
}
{
    const MNT = 25;
    const bounded = api.setMerit(start, [...AR_ROWS, { type: 'MNT', target: MNT, weight: 1 }]);
    for (const method of ['ge', 'structural', 'deep']) {
        const { dMin: _, ...settings } = RUNS[method];
        const run = await quietly(() => api.synthesize(bounded, { method, pool: POOL, settings }));
        const thinnest = Math.min(...run.design.frontLayers.map(l => l.thickness));
        ok(`${method} with no floor given keeps its layers at the MNT row`, run.result.completed && thinnest >= MNT - 1e-6, `thinnest ${thinnest}`);
    }
}
{
    const symmetric = api.setMerit(twoLayers({ surfaceMode: 'symmetric' }), AR_ROWS);
    const run = await quietly(() => api.synthesize(symmetric, { method: 'deep', pool: POOL, settings: RUNS.deep }));
    const sides = d => JSON.stringify([d.frontLayers.map(l => [l.material, l.thickness]), [...d.backLayers].reverse().map(l => [l.material, l.thickness])]);
    const [front, back] = JSON.parse(sides(run.design));
    ok('on a symmetric design Deep\'s answer is mirrored onto the back', run.result.completed && JSON.stringify(front) === JSON.stringify(back), sides(run.design));
}

{
    // A back_only design: the layers sit on the back, light enters from the exit medium.
    const back = api.setMerit(api.stackFromFormula(api.newDesign({ surfaceMode: 'back_only' }), { side: 'back', formula: 'H L', referenceWavelength: 550 }), AR_ROWS);
    const before = api.merit(back).total;
    const landed = [];
    const refined = await quietly(() => api.refine(back, { method: 'dls', maxIter: 30 }));
    landed.push(['refine', refined]);
    for (const method of ['needle', 'ge', 'structural', 'deep']) landed.push([method, await quietly(() => api.synthesize(back, { method, pool: POOL, settings: RUNS[method] }))]);
    const off = landed.filter(([, run]) => !(run.result.completed && run.design.frontLayers.length === 0 && run.design.backLayers.length > 0
        && api.merit(run.design).total <= before + 1e-12)).map(([method, run]) => `${method}: ${run.result.stopReason}`);
    ok('on a back_only design each run answers on the back', off.length === 0, off.join(', '));
}

{
    // Every hook a run takes is called (runs.js runHooks).
    const silent = [];
    for (const method of ['refine', ...Object.keys(RUNS)]) {
        const calls = {};
        const hooks = Object.fromEntries(api.runHooks(method).filter(name => name !== 'signal').map(name => [name, () => { calls[name] = (calls[name] || 0) + 1; }]));
        await quietly(() => (method === 'refine' ? api.refine(start, { method: ['dls', 'cg'] }, hooks)
            : api.synthesize(start, { method, pool: POOL, settings: RUNS[method] }, hooks)));
        for (const name of Object.keys(hooks)) if (!calls[name]) silent.push(`${method} ${name}`);
    }
    ok('every hook a run takes is called', silent.length === 0, silent.join(', '));
}

// ── 2. Stop ────────────────────────────────────────────────────────────────
{
    const stop = new AbortController();
    stop.abort();
    const stopped = await quietly(() => api.synthesize(start, { method: 'structural', pool: ['TiO2'], settings: RUNS.structural }, { signal: stop.signal }));
    ok('a run stopped before it starts leaves the design as it was', stopped.result.stopReason === 'stopped' && stopped.design === start);
}
for (const method of ['needle', 'ge']) {
    const stop = new AbortController();
    const settings = { ...RUNS[method], maxLayers: 20, targetMF: 0 };
    const run = await quietly(() => within(api.synthesize(start, { method, pool: POOL, settings }, {
        signal: stop.signal, onProgress: () => stop.abort(),
    })));
    ok(`${method} stopped from its own progress hook ends stopped`, run !== 'stuck' && run.result.stopReason === 'stopped' && run.design === start,
        run === 'stuck' ? 'never ended' : run.result.stopReason);
}
{
    const stop = new AbortController();
    const refined = await quietly(() => api.refine(start, { method: 'dls', maxIter: 30 }, { signal: stop.signal, onProgress: () => stop.abort() }));
    ok('a refine stopped from its progress hook ends stopped, with the design as it was', refined.result.stopReason === 'stopped'
        && !refined.result.completed && refined.design === start, refined.result.stopReason);
}

// ── 3. The in-thread synthesis pool ────────────────────────────────────────
{
    const pool = new InThreadSynthesisPool(2);
    let failed = null;
    try { await pool.run({ type: 'noSuchJob' }); } catch (err) { failed = err.message; }
    ok('a job that fails rejects', typeof failed === 'string' && failed.length > 0, failed);
    const waiting = pool.run({ type: 'noSuchJob' }).catch(err => err.message);
    pool.terminate();
    const later = await pool.run({ type: 'noSuchJob' }).catch(err => err.message);
    ok('terminate() rejects the jobs not answered, and any posted after it', await waiting === 'pool terminated' && later === 'pool terminated',
        `${await waiting} / ${later}`);
}

// ── 4. Tolerancing ─────────────────────────────────────────────────────────
{
    const opts = { quantity: 'R', from: 450, to: 650, step: 10, runs: 5, thicknessRelPct: 2, seed: 3 };
    const a = await api.monteCarlo(start, opts), b = await api.monteCarlo(start, opts);
    ok('Monte Carlo runs its trials over the range and repeats with its seed', a.nTrials === 5 && a.lambda.length === 21
        && a.mean.length === 21 && JSON.stringify(a.mean) === JSON.stringify(b.mean));
    const stop = new AbortController();
    let reports = 0;
    const cut = await api.monteCarlo(start, { ...opts, runs: 400 }, { signal: stop.signal, onProgress: ({ trial }) => { reports++; if (trial === 40) stop.abort(); } });
    ok('Monte Carlo reports each trial and stops between trials with the ones it ran', reports >= 40 && cut.nTrials >= 40 && cut.nTrials < 400,
        `${reports} reports, ${cut.nTrials} trials`);
    // A Stop from outside the run, as a job's thread gets one, waits for no more than the trial under way.
    const outside = new AbortController();
    globalThis.setImmediate(() => outside.abort());
    const early = await api.monteCarlo(start, { ...opts, runs: 400 }, { signal: outside.signal });
    ok('a Stop from outside ends the run after the trial it is in', early.nTrials === 1, `${early.nTrials} trials`);
    const one = await api.monteCarlo(start, { ...opts, runs: 1, seed: null });
    ok('a single trial runs, with a fresh seed when none is given', one.nTrials === 1 && Number.isInteger(one.seed) && one.seed >= 1, JSON.stringify({ n: one.nTrials, seed: one.seed }));
    const ranked = api.layerSensitivity(start);
    const sensitivities = ranked.rows.map(r => r.sensitivity);
    ok('layer sensitivity ranks every layer, the most sensitive at 100', sensitivities.length === 2
        && Math.max(...sensitivities) === 100 && Math.min(...sensitivities) >= 0, JSON.stringify(sensitivities));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

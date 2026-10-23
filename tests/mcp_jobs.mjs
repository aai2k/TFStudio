/**
 * Jobs on the MCP server (src/mcp/jobs.js, runTools.js), driven over stdio.
 *
 *   1. A refinement ends with a better design under a new id and leaves the
 *      one it started from as it was; when that design is edited while the
 *      job runs, the answer is still a design of its own.
 *   2. A long synthesis is stopped and keeps its design; a job with a setting
 *      the run does not take fails and says why; what a job prints reaches
 *      stderr; Monte Carlo runs as a job, and on a design with a
 *      specification its spec is the yield estimateYield gives, each check's
 *      fail rate with it.
 *   3. Cancelling: a cancelled jobStatus gets no answer, also after its job
 *      ends; a cancelled call that started a job stops that job.
 *   4. Closing stdin ends the server with a job running.
 *
 * Run: node tests/mcp_jobs.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClient, onlyMessages, INIT } from './_mcpClient.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.js');
const api = await import('../src/api/index.js');
await api.init();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(10000).then(() => 'still running')]);

const POOL = ['TiO2', 'SiO2'];
const AR = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];
const LONG = { maxLayers: 60, targetMF: 0, refineIter: 60 };

const server = startClient(process.execPath, ['--no-warnings', SERVER]);
await server.request('initialize', INIT);
server.write({ jsonrpc: '2.0', method: 'notifications/initialized' });

async function twoLayerAR() {
    const id = (await server.call('newDesign', {})).designId;
    await server.call('insertLayer', { designId: id, material: 'TiO2', thickness: 30 });
    await server.call('insertLayer', { designId: id, material: 'SiO2', thickness: 50 });
    const rated = await server.call('setMerit', { designId: id, rows: AR });
    return { id, merit: rated.total };
}

// ── 1. Answers ─────────────────────────────────────────────────────────────
const ar = await twoLayerAR();
{
    const refined = await server.call('refine', { designId: ar.id, method: 'dls', maxIter: 30, waitSeconds: 50 });
    const after = await server.call('merit', { designId: refined.designId });
    ok('a refinement ends with a better design under a new id', refined.state === 'done' && refined.designId !== ar.id
        && after.total < ar.merit && refined.result?.completed === true, JSON.stringify(refined));
    ok('the design it started from is as it was', (await server.call('merit', { designId: ar.id })).total === ar.merit);
}
{
    // All layers locked: the run keeps the layers it started from.
    const locked = await twoLayerAR();
    await server.call('setLayer', { designId: locked.id, index: 0, locked: true });
    await server.call('setLayer', { designId: locked.id, index: 1, locked: true });
    const job = await server.call('refine', { designId: locked.id, method: 'dls', maxIter: 30, waitSeconds: 0 });
    await server.call('setLayer', { designId: locked.id, index: 0, thickness: 99 });
    const done = await server.call('jobStatus', { jobId: job.jobId, waitSeconds: 30 });
    ok('a design edited while its job runs is not named as the answer', done.state === 'done' && done.designId !== locked.id, JSON.stringify(done));
}

// ── 2. Stop, failure, output, Monte Carlo ──────────────────────────────────
{
    const long = await server.call('synthesize', { designId: ar.id, method: 'needle', pool: POOL, settings: LONG, waitSeconds: 0 });
    await sleep(300);
    const stopping = await server.call('stopJob', { jobId: long.jobId });
    const stopped = await server.call('jobStatus', { jobId: long.jobId, waitSeconds: 20 });
    ok('a long synthesis is stopped and keeps its design', long.state === 'running' && ['stopping', 'stopped'].includes(stopping.state)
        && stopped.state === 'stopped' && stopped.designId === ar.id, JSON.stringify(stopped));
    const refused = await server.call('synthesize', { designId: ar.id, method: 'ge', pool: ['TiO2'], settings: { maxLayer: 5 }, waitSeconds: 20 });
    ok('a job with a setting the run does not take fails and says why', refused.state === 'failed' && /unknown setting 'maxLayer'/.test(refused.error), JSON.stringify(refused));
    // An MNT row makes the run print its thickness bounds, which must reach stderr.
    const bounded = (await server.call('copyDesign', { designId: ar.id })).designId;
    await server.call('setMerit', { designId: bounded, rows: [...AR, { type: 'MNT', target: 12, weight: 1 }] });
    const structural = await server.call('synthesize', { designId: bounded, method: 'structural', pool: POOL, settings: { maxIter: 2, refineIter: 5, seed: 3 }, waitSeconds: 50 });
    ok('a structural run ends on its own', structural.state === 'done', JSON.stringify(structural));
    ok('it counts the history rows it reported', structural.rows > 0, String(structural.rows));
    ok('what a job prints goes to stderr', /\[Structural\] constraint-bound synthesis/.test(server.stderr));
    const trials = await server.call('monteCarlo', { designId: ar.id, from: 450, to: 650, step: 10, runs: 5, seed: 3, waitSeconds: 50 });
    ok('Monte Carlo runs as a job', trials.state === 'done' && trials.result?.nTrials === 5 && trials.result.mean?.length === 21 && !trials.designId,
        JSON.stringify({ state: trials.state, n: trials.result?.nTrials, error: trials.error }));
    const checks = [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'le', target: 0.02, label: 'R avg' }, { kind: 'R_AT', lambda: 550, cmp: 'le', target: 0.01 }];
    const specified = (await server.call('copyDesign', { designId: ar.id })).designId;
    await server.call('setSpecification', { designId: specified, checks });
    const judged = await server.call('monteCarlo', { designId: specified, from: 450, to: 650, step: 10, runs: 20, thicknessRelPct: 3, seed: 3, waitSeconds: 50 });
    const here = api.setSpecification(api.setMerit(api.insertLayer(api.insertLayer(api.newDesign({}), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 }), AR), checks);
    const estimated = await api.estimateYield(here, { runs: 20, thicknessRelPct: 3, seed: 3 });
    // The fields of the yield that a Monte Carlo result's spec holds, in its order.
    const yieldHere = Object.fromEntries(['nTrials', 'evaluated', 'passCount', 'yield', 'yieldInterval', 'perQualifier'].map(key => [key, estimated[key]]));
    ok('on a design with a specification its spec is the yield estimateYield gives, each check\'s fail rate with it', judged.state === 'done'
        && JSON.stringify(judged.result?.spec) === JSON.stringify(yieldHere) && judged.result.spec.perQualifier.length === 2, JSON.stringify([judged.result?.spec, yieldHere]));
    const many = await server.call('monteCarlo', { designId: ar.id, from: 400, to: 800, step: 1, runs: 200000, waitSeconds: 0 });
    await sleep(1500);
    const midway = await server.call('jobStatus', { jobId: many.jobId });
    ok('a Monte Carlo job reports the trial it has reached', midway.state === 'running' && midway.progress?.trial > 0, JSON.stringify(midway.progress));
    const asked = Date.now();
    await server.call('stopJob', { jobId: many.jobId });
    const halted = await server.call('jobStatus', { jobId: many.jobId, waitSeconds: 10 });
    const ran = halted.result?.nTrials ?? 0;
    ok('a stopped Monte Carlo job answers with the trials it ran', halted.state === 'stopped' && ran > 0 && ran < 200000, `${halted.state}, ${ran} trials`);
    ok('it stops within seconds, with no error', !halted.error && Date.now() - asked < 3000, halted.error);
    ok('a job that reports no history rows shows no row count', !('rows' in trials), Object.keys(trials).join());
    const listed = (await server.call('listJobs', {})).jobs;
    const entry = listed.find(job => job.jobId === trials.jobId);
    ok('listJobs leaves out each job\'s progress and result', listed.every(job => !('result' in job) && !('progress' in job)));
    ok('it names the job, its kind, state and design', entry?.kind === 'monteCarlo' && entry.state === 'done' && entry.sourceDesignId === ar.id, JSON.stringify(entry));
    const refinedEntry = listed.find(job => job.kind === 'refine' && job.state === 'done');
    const failedEntry = listed.find(job => job.state === 'failed');
    ok('a listed refine names the design it answered with, a failed job its error', /^d\d+$/.test(refinedEntry?.designId) && /unknown setting 'maxLayer'/.test(failedEntry?.error),
        JSON.stringify([refinedEntry, failedEntry]));
    const deep = await server.call('synthesize', { designId: ar.id, method: 'deep', pool: POOL, settings: { dMin: 20, maxLayers: 4, seed: 7 }, waitSeconds: 50 });
    const lastRound = deep.result?.search?.rounds;
    ok('an ended Deep Synthesis job shows the round its search ended on', deep.state === 'done' && deep.progress?.phase === 'search' && deep.progress.round === lastRound,
        JSON.stringify({ state: deep.state, progress: deep.progress, rounds: lastRound }));
}

// ── 3. Cancelling ──────────────────────────────────────────────────────────
{
    const running = await server.call('synthesize', { designId: ar.id, method: 'needle', pool: POOL, settings: LONG, waitSeconds: 0 });
    const waiter = 1000;
    server.write({ jsonrpc: '2.0', id: waiter, method: 'tools/call', params: { name: 'jobStatus', arguments: { jobId: running.jobId, waitSeconds: 50 } } });
    await sleep(200);
    server.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: waiter, reason: 'test' } });
    await server.call('stopJob', { jobId: running.jobId });
    const end = await server.call('jobStatus', { jobId: running.jobId, waitSeconds: 20 });
    await sleep(300);
    ok('a cancelled call gets no answer, also after its job ends', end.state === 'stopped' && !server.answers.has(waiter), end.state);

    const starter = 1001;
    server.write({ jsonrpc: '2.0', id: starter, method: 'tools/call', params: { name: 'synthesize', arguments: { designId: ar.id, method: 'needle', pool: POOL, settings: LONG, waitSeconds: 50 } } });
    await sleep(300);
    server.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: starter, reason: 'test' } });
    let job = null;
    for (let i = 0; i < 40 && !(job && job.state === 'stopped'); i++) {
        await sleep(250);
        job = (await server.call('listJobs', {})).jobs.at(-1);
    }
    ok('a cancelled call that started a job stops it', job?.state === 'stopped' && !server.answers.has(starter), job?.state);
}
ok('every line on stdout is a JSON-RPC message', onlyMessages(server), server.lines.find(line => !line.startsWith('{')));

// ── 4. Closing with a job running ──────────────────────────────────────────
await server.call('synthesize', { designId: ar.id, method: 'needle', pool: POOL, settings: LONG, waitSeconds: 0 });
server.child.stdin.end();
ok('closing stdin ends the server with a job running', await ended(server) === 0);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

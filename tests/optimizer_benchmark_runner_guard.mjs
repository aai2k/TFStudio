/**
 * Characterization guard for optimizerBenchmark.js orchestration.
 *
 * The expected hashes were captured from the known-good pre-refactor
 * implementation.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    buildJobs, caseById, runJob, runStructural, runSynth,
} from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = (id) => getMaterial(id);

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function withDeterminism(run, timeStep = 0.25) {
    const savedRandom = Math.random;
    const savedNow = Object.getOwnPropertyDescriptor(performance, 'now');
    let randomState = 0x12345678;
    let clock = 1000;
    Math.random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 0x100000000;
    };
    Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => { const value = clock; clock += timeStep; return value; },
    });
    try {
        return run();
    } finally {
        Math.random = savedRandom;
        if (savedNow) Object.defineProperty(performance, 'now', savedNow);
        else delete performance.now;
    }
}

function runnerSnapshot(run, timeStep) {
    const ticks = [];
    const result = withDeterminism(() => run((tick) => ticks.push(tick)), timeStep);
    return { result, ticks };
}

const fullExpansion = buildJobs({
    cases: ['bs', 'missing', 'bbar'],
    refineLocal: true,
    refineGlobal: true,
    dlsMulti: true,
    seed: true,
    needle: true,
    ge: true,
    structural: true,
    dMins: [2, 9],
    mnts: [null, 40],
    synthEngines: ['cg', 'dls'],
    consolidate: true,
    synthCfg: { budgetMs: 321, maxSteps: 7, marker: 'preserved' },
});

const jobs = {
    fullExpansion,
    explicitSweep: buildJobs({
        cases: ['missing', 'bs'],
        refineLocal: true,
        refineConverge: false,
        refineMaxIters: [3, 1],
        refineGlobal: true,
        dlsMulti: false,
        needle: false,
        ge: false,
        structural: false,
    }),
    emptyDefaults: buildJobs({
        cases: [],
        refineLocal: false,
        seed: true,
        needle: true,
        dMins: [],
        mnts: [],
        synthEngines: [],
    }),
    emptySweep: buildJobs({
        cases: ['bbar'],
        refineLocal: true,
        refineConverge: false,
        refineMaxIters: [],
    }),
};

const C = caseById('bbar');
const runners = {
    needle: runnerSnapshot((onTick) => runSynth(
        false, C.thick(), C.ops, 40, resolveMat,
        { budgetMs: 10000, maxLayers: 8, maxSteps: 4, innerIter: 3 }, onTick,
    )),
    gradualEvolution: runnerSnapshot((onTick) => runSynth(
        true, C.thin(), C.ops, 40, resolveMat,
        { budgetMs: 10000, maxLayers: 8, maxSteps: 8, innerIter: 3 }, onTick,
    )),
    structural: runnerSnapshot((onTick) => runStructural(
        C.thin(), C.ops, 40, resolveMat,
        { budgetMs: 10000, maxLayers: 8, innerIter: 2, structK: 2, structMaxIter: 8, seed: 2468 }, onTick,
    )),
    structuralDeepBudget: runnerSnapshot((onTick) => runStructural(
        C.thin(), C.ops, 40, resolveMat,
        { budgetMs: 80, maxLayers: 2, innerIter: 0, structK: 1, structMaxIter: 6, seed: 97531, deepMode: true }, onTick,
    ), 1),
};

const actual = {
    fullExpansion: digest(jobs.fullExpansion),
    explicitSweep: digest(jobs.explicitSweep),
    emptyDefaults: digest(jobs.emptyDefaults),
    emptySweep: digest(jobs.emptySweep),
    needle: digest(runners.needle),
    gradualEvolution: digest(runners.gradualEvolution),
    structural: digest(runners.structural),
    structuralDeepBudget: digest(runners.structuralDeepBudget),
};
const expected = {
    fullExpansion: '162bdc6371ab6375ea27c9ef7c6c3d6d6f0a5d1cfd5b6cf701b088777d087615',
    explicitSweep: 'a3d955d4acb20e214ba36d5aa34a6d8a4f1eda9869e8c8fe4193ee93ad7e304a',
    emptyDefaults: '052521ec864608e9fb75ef94a65d424974c735450215e0f0980ae7e4061df392',
    emptySweep: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    needle: '679aa1b60001bb72e481b1f0a08ac0e1f5a74ffd0a03ab6de400fbe74074cc29',
    gradualEvolution: '6f590e46e15258bfabbd6a7084d77c4afebd8e03f9ad7d9f4ce1f673f051ce27',
    structural: '17cca1a1c93b082e388c1ce525aae20274a54eed033fea08e6f9d3cfe57fe8cf',
    structuralDeepBudget: '05dd9d628870036c9ed78484d4fd0f6909bbaf88e1a912275ee883ef33670f08',
};
assert.deepEqual(actual, expected);

for (const kind of ['missing', 'toString', 'constructor', '__proto__']) {
    assert.deepEqual(
        runJob({ caseId: 'bbar', kind }, resolveMat),
        { err: `unknown kind ${kind}` },
    );
}

const ids = fullExpansion.map((job) => job.id);
if (!ids.every((id, index) => id === `j${index}`)) {
    console.error('FAIL: buildJobs IDs are not sequential in expansion order');
    process.exit(1);
}

const matchesVariant = (job, consolidate) => [
    job.caseId === 'bs', job.mnt == null, job.engine === 'cg',
    job.dMin === 2, job.cfg?.consolidate === consolidate,
].every(Boolean);
const firstVariant = fullExpansion.filter((job) => matchesVariant(job, false));
if (firstVariant.map((job) => job.kind).join(',') !== 'needle,ge,structural') {
    console.error('FAIL: synthesis tool ordering changed');
    process.exit(1);
}
if (!firstVariant.every((job) => job.cfg === firstVariant[0].cfg)) {
    console.error('FAIL: jobs in one synthesis variant no longer share cfg identity');
    process.exit(1);
}
const consolidatedVariant = fullExpansion.find((job) => matchesVariant(job, true));
if (!consolidatedVariant || consolidatedVariant.cfg === firstVariant[0].cfg) {
    console.error('FAIL: consolidation variants no longer have distinct cfg objects');
    process.exit(1);
}

console.log(`PASS optimizer benchmark guard (${fullExpansion.length} full-expansion jobs, 4 runner scenarios)`);

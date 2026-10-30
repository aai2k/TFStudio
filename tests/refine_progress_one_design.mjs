/**
 * A refinement's progress reports the best merit and the best optical merit of
 * one design (refinement/methodsFlow.js).
 *
 * A 4-layer TiO2/SiO2 AR on BK7 with one RAV row over 450-650 nm. With that
 * one row the merit and the optical merit of any design are the same number,
 * so in every update that carries both, mfBest and omfBest agree.
 *
 *   1. CG alone: an omfBest held at the start's value while CG's merit falls
 *      does not agree.
 *   2. CG, then DLS from the same start: nor does one taken from DLS while its
 *      merit is still above CG's best.
 *
 * Run: node tests/refine_progress_one_design.mjs
 */
const api = await import('../src/api/index.js');

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

await api.init();
const STACK = [['TiO2', 25], ['SiO2', 40], ['TiO2', 110], ['SiO2', 85]];
const bare = api.newDesign({ name: 'AR', substrate: 'BK7' });
const layered = STACK.reduce((d, [material, thickness]) => api.insertLayer(d, { material, thickness }), bare);
const start = api.setMerit(layered, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }]);
const agree = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

for (const [name, settings] of [['CG', { method: 'cg', maxIter: 60 }], ['CG then DLS', { method: ['cg', 'dls'] }]]) {
    const updates = [];
    const { result } = await quietly(() => api.refine(start, settings, {
        onProgress: patch => { if (patch.mfBest != null && patch.omfBest != null) updates.push([patch.mfBest, patch.omfBest]); },
    }));
    const apart = updates.filter(([mf, omf]) => !agree(mf, omf));
    ok(`${name}: the run ends on its own with a lower merit`, result.completed && result.mf < result.mfInitial,
        `${result.stopReason}, ${result.mfInitial} -> ${result.mf}`);
    ok(`${name}: progress reports mfBest and omfBest together`, updates.length > 2, `${updates.length} updates`);
    ok(`${name}: every update pairs mfBest with the optical merit of the same design`, apart.length === 0,
        `${apart.length} of ${updates.length} apart, first ${apart[0]?.map(v => v.toPrecision(6)).join(' vs ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

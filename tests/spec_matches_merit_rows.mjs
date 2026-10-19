/**
 * A Specification check reads the number its merit row reads.
 *
 * Generate MF writes one base row for each optical check; the Merit Function
 * Editor shows that row on a grid sampled for the design's fringes. The check
 * must read the same row on the same grid, or a check passes while its row is
 * not met.
 *
 * Checks:
 *   1. T_AVG, R_AVG, INTEGRAL (Tvis), MIN_MAX, CENTRAL_LAMBDA and T_AT, on a
 *      thin AR, a 60-layer random stack, a cavity filter and the cavity under
 *      a 10 degree cone: the check's value equals its base row in the merit
 *      table.
 *   2. An integral check written without a source or detector reads its row.
 *   3. The coating library's band figures (R avg, T avg) equal the merit
 *      table's band rows on the entry's design.
 *
 * Run: node tests/spec_matches_merit_rows.mjs
 */

const api = await import('../src/api/index.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { makeQualifier, evaluateQualifier, qualifiersToMFOperands } = await import('../src/utils/synthesis/qualifiers.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { entryDesign } = await import('../src/utils/coatingLibrary/entryModel.js');
const { entryMetrics } = await import('../src/utils/coatingLibrary/entryProperties.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const same = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

await api.init();
const stack = formula => api.stackFromFormula(api.newDesign(), { formula, symbols: { H: 'TiO2', L: 'SiO2' }, referenceWavelength: 550 });
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let random60 = api.newDesign();
for (let i = 0; i < 60; i++) random60 = api.insertLayer(random60, { material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + 120 * rand() });
const cavity = stack('(HL)^4 2H (LH)^4');
const DESIGNS = {
    'thin AR': stack('0.27H 0.33L 1.8H 1.05L'),
    '60-layer random stack': random60,
    'cavity': cavity,
    'cavity under a 10 degree cone': { ...cavity, cone: { enabled: true, halfAngleDeg: 10 } },
};
const CHECKS = [
    makeQualifier({ kind: 'T_AVG', lambdaStart: 500, lambdaEnd: 600, cmp: 'ge', target: 0.5 }),
    makeQualifier({ kind: 'R_AVG', lambdaStart: 420, lambdaEnd: 680, cmp: 'le', target: 0.01 }),
    makeQualifier({ kind: 'INTEGRAL', lambdaStart: 380, lambdaEnd: 780, cmp: 'ge', target: 0.05 }),
    makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', lambdaStart: 530, lambdaEnd: 570, cmp: 'le', target: 0.5 }),
    makeQualifier({ kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', lambdaStart: 530, lambdaEnd: 570, cmp: 'ge', target: 549 }),
    makeQualifier({ kind: 'T_AT', lambda: 550, cmp: 'ge', target: 0.5 }),
];

// ── 1. Each check against its base row ─────────────────────────────────────
for (const [name, design] of Object.entries(DESIGNS)) {
    const lookup = designMaterialLookup(design);
    for (const check of CHECKS) {
        const value = evaluateQualifier(check, design, lookup).value;
        const rows = qualifiersToMFOperands([check], { design });
        const row = meritTable(design, rows).computed[0];
        ok(`${name}: ${check.kind} reads its merit row`, same(value, row), `${value} against ${row}`);
    }
}

// ── 2. An integral without source or detector ──────────────────────────────
{
    const bare = makeQualifier({ kind: 'INTEGRAL', lambdaStart: 380, lambdaEnd: 780, cmp: 'ge', target: 0.05 });
    delete bare.source;
    delete bare.detector;
    const design = DESIGNS['thin AR'];
    const value = evaluateQualifier(bare, design, designMaterialLookup(design)).value;
    const row = meritTable(design, qualifiersToMFOperands([bare], { design })).computed[0];
    ok('an integral without source or detector reads its merit row', same(value, row), `${value} against ${row}`);
}

// ── 3. The library's band figures ──────────────────────────────────────────
for (const entry of BUILTIN_COATINGS.filter(e => e.type === 'ar' || e.type === 'mirror').slice(0, 6)) {
    const design = entryDesign(entry);
    const metrics = entryMetrics(entry);
    for (const row of metrics.rows.filter(r => r.stat === 'avg')) {
        const ops = entry.bands.map(([lambdaStart, lambdaEnd]) => makeOperand({
            type: `${row.channel}AV`, lambdaStart, lambdaEnd, aoi: entry.aoi, pol: row.pol, target: 0, weight: 1,
        }));
        const table = meritTable(design, ops).computed;
        ok(`library ${entry.id}: ${row.channel} avg (${row.pol}) reads the merit table's band rows`,
            row.values.every((v, b) => same(v, table[b])), `${row.values} against ${table}`);
    }
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

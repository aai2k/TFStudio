/**
 * The Step flag on band rows: the coarsest step of a band average, integral,
 * range target or flatness row's grid.
 *
 * The fringe grid puts eight samples on each interference fringe, and a
 * cavity's pass band is about a fringe divided by the cavity's finesse wide,
 * so on a cavity filter a band average over the pass band can read a fraction
 * of its value. The flag asks for a grid no coarser than 1, 0.1, 0.01 or
 * 0.001 nm; a row without one keeps the fringe grid.
 *
 * Checks:
 *   1. On TiO2/SiO2 cavities at 550 nm a TAV row over 500-600 nm reads its
 *      dense value at the flag the cavity needs, in the merit table and at the
 *      start of a run, and reads as before without a flag.
 *   2. The flag only raises a count: the fringe grid of a thick stack stays,
 *      and a count the row carries is raised to the flag's and kept above it.
 *   3. Band averages, integrals, range targets and flatness rows take the flag;
 *      a dip row, a single-wavelength row and a measured curve do not.
 *   4. The Flag cell: a band row without a flag shows nothing, a peak row 1; an
 *      empty cell clears the flag; a pasted line keeps a band row's flag; a
 *      flag survives a retype between rows that take one.
 *   5. A status-bar average monitor, whose rows carry the monitors' search
 *      step, keeps the band grid it had; setMerit refuses a flag out of range.
 *
 * Run: node tests/band_step_flag.mjs
 */

const api = await import('../src/api/index.js');
const { takesStepFlag, withDesignSampleCounts, operandSampleLambdas, requiredLambdas } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { flagCellText, cellEdit } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js');
const { parseOperandsTsv } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/operandClipboard.js');
const { retypeOperand } = await import('../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
const { computeMonitor } = await import('../src/utils/physics/statusMonitorEvaluation.js');
const { makeOperand, evaluateOperands, buildEvalContext } = await import('../src/utils/physics/optimizer.js');

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
const stack = formula => api.stackFromFormula(api.newDesign(), { formula, symbols: { H: 'TiO2', L: 'SiO2' }, referenceWavelength: 550 });
const tav = extra => ({ type: 'TAV', lambdaStart: 500, lambdaEnd: 600, target: 0, weight: 1, ...extra });
const value = (design, row) => api.merit(api.setMerit(design, [row])).rows[0].value;
const stamped = (design, row) => withDesignSampleCounts(api.setMerit(design, [row]).meritOperands, design, designMaterialLookup(design))[0];

// ── 1. Cavities ────────────────────────────────────────────────────────────
const CAVITIES = [
    { formula: '(HL)^4 2H (LH)^4', flag: 2, unflagged: 0.0262 },
    { formula: '(HL)^8 2H (LH)^8', flag: 3, unflagged: 0.00958 },
];
for (const { formula, flag, unflagged } of CAVITIES) {
    const design = stack(formula);
    const dense = value(design, tav({ bandPoints: 80001 }));
    const flagged = value(design, tav({ flag }));
    ok(`${formula}: TAV at flag ${flag} reads its dense value`, Math.abs(flagged - dense) <= 0.005 * dense, `${flagged} against ${dense}`);
    const plain = value(design, tav());
    ok(`${formula}: without a flag it reads as on its default grid`, Math.abs(plain - unflagged) <= 0.01 * unflagged, String(plain));
    const run = await quietly(() => api.refine(api.setMerit(design, [tav({ flag })]), { method: 'dls', maxIter: 1 }));
    ok(`${formula}: a run starts on the flag's grid`, Math.abs(run.result.mfInitial - flagged) <= 1e-12 * Math.max(1, flagged), `${run.result.mfInitial} against ${flagged}`);
}

// ── 2. Counts ──────────────────────────────────────────────────────────────
{
    let thick = api.newDesign();
    for (let i = 0; i < 80; i++) thick = api.insertLayer(thick, { material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + (i * 37) % 120 });
    const wide = { type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, target: 0, weight: 1 };
    const fringe = stamped(thick, wide).bandPoints;
    ok('a flag coarser than the fringe grid leaves it', stamped(thick, { ...wide, flag: 1 }).bandPoints === fringe && fringe > 1201, String(fringe));
    const thin = stack('H L');
    ok('a flag finer than the fringe grid sets the count', stamped(thin, tav({ flag: 2 })).bandPoints === 1001, String(stamped(thin, tav({ flag: 2 })).bandPoints));
    ok('a count the row carries is raised to the flag', operandSampleLambdas(tav({ flag: 2, bandPoints: 50 })).length === 1001);
    ok('and a larger one is kept', operandSampleLambdas(tav({ flag: 1, bandPoints: 500 })).length === 500);
    ok('without a design the flag still sets the grid', operandSampleLambdas(tav({ flag: 3 })).length === 10001);
    const rows = [tav({ flag: 2, enabled: true }), { type: 'T', lambdaStart: 550, lambdaEnd: 550, enabled: true }];
    const all = new Set(requiredLambdas(rows));
    ok('a worker samples its materials on every wavelength of the flagged grid', operandSampleLambdas(rows[0]).every(lam => all.has(lam)));
}

// ── 3. Which rows take it ──────────────────────────────────────────────────
{
    const takes = ['TAV', 'RAV', 'AAV', 'TIW', 'RIW', 'AIW', 'TGT', 'RGT', 'AGT', 'GDTFLAT', 'TMX', 'RMN'];
    const takesNot = ['TMN', 'RMX', 'T', 'R', 'MCURVE'];
    ok('band rows and peak rows take the flag', takes.every(type => takesStepFlag({ type, lambdaStart: 500, lambdaEnd: 600 })),
        takes.filter(type => !takesStepFlag({ type, lambdaStart: 500, lambdaEnd: 600 })).join());
    ok('dip rows, single-wavelength rows and measured curves do not', takesNot.every(type => !takesStepFlag({ type, lambdaStart: 500, lambdaEnd: 600 })),
        takesNot.filter(type => takesStepFlag({ type, lambdaStart: 500, lambdaEnd: 600 })).join());
    for (const type of ['TIW', 'TGT']) {
        const row = { ...api.setMerit(api.newDesign(), [{ type, lambdaStart: 500, lambdaEnd: 600 }]).meritOperands[0], flag: 2 };
        ok(`a ${type} row samples on the flag's grid`, operandSampleLambdas(row).length === 1001, String(operandSampleLambdas(row).length));
    }
}

// ── 4. The Flag cell ───────────────────────────────────────────────────────
{
    ok('a band row without a flag shows an empty cell', flagCellText(tav()) === '');
    ok('a band row shows its flag', flagCellText(tav({ flag: 2 })) === '2');
    ok('a peak row without a flag shows 1', flagCellText({ type: 'TMX', lambdaStart: 500, lambdaEnd: 600 }) === '1');
    ok('an empty cell clears the flag', JSON.stringify(cellEdit(tav({ flag: 2 }), 'flag', '')) === JSON.stringify(['flag', undefined]));
    ok('a level out of range is refused', cellEdit(tav(), 'flag', '5') === null && cellEdit(tav(), 'flag', '3')[1] === 3);
    const pasted = parseOperandsTsv('TAV\t500\t600\t0\tavg\t2\t95\t1');
    ok('a pasted band row keeps its flag', pasted?.[0]?.flag === 2, JSON.stringify(pasted?.[0]));
    const fromPeak = retypeOperand({ id: 'x', type: 'TMX', lambdaStart: 500, lambdaEnd: 600, flag: 2, target: 0.5, weight: 1 }, 'TAV');
    ok('a flag survives a retype from a peak row to a band row', fromPeak.flag === 2);
    const toDip = retypeOperand({ ...tav({ flag: 2 }), id: 'y' }, 'TMN');
    ok('and goes on a retype to a dip row', !('flag' in toDip) || toDip.flag === undefined);
}

// ── 5. Monitors and the API ────────────────────────────────────────────────
{
    const design = stack('(HL)^4 2H (LH)^4');
    const lookup = designMaterialLookup(design);
    const shown = computeMonitor({ type: 'avg', qty: 'T', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg' }, design, lookup);
    const plainRow = 100 * evaluateOperands([makeOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 600, target: 0, weight: 1 })], buildEvalContext(design, lookup))[0];
    ok('an average monitor keeps its band grid', Math.abs(shown - plainRow) <= 1e-10, `${shown} against ${plainRow}`);
    let refused = '';
    try { api.setMerit(design, [tav({ flag: 5 })]); } catch (err) { refused = err.message; }
    ok('setMerit refuses a flag out of range', /flag is a whole number from 1 to 4/.test(refused), refused);
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

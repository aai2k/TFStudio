/**
 * The Step flag on band rows: the coarsest step of a band average, integral,
 * range target or flatness row's grid.
 *
 * The fringe grid puts eight samples on each interference fringe, and a
 * cavity's pass band is about a fringe divided by the cavity's finesse wide,
 * so on a cavity filter a band average over the pass band can read a fraction
 * of its value. Step 0, a band row's default, is the fringe grid, no coarser
 * than 2 nm. Steps 1 to 4 sample at exactly 1, 0.1, 0.01 or 0.001 nm, and a
 * negative Step at that many nm, whether the fringes are finer or not.
 *
 * Checks:
 *   1. On TiO2/SiO2 cavities at 550 nm a TAV row over 500-600 nm reads its
 *      dense value at the flag the cavity needs, in the merit table and at the
 *      start of a run, and reads its Step 0 value without one.
 *   2. Step 0 is the fringe grid of a thick stack, and 2 nm on a thin one. A
 *      set step is exactly that step, finer or coarser than the fringes, and a
 *      count the row carries is raised to it and kept above it. A negative Step
 *      samples at that many nm, a step wider than the band gives its two ends,
 *      and one finer than 0.001 nm is no step.
 *   3. Band averages, integrals, range targets and flatness rows take the flag;
 *      a dip row, a single-wavelength row and a measured curve do not. A new
 *      band row is written at Step 0, a peak row at none.
 *   4. The Flag cell: a band row shows 0 at Step 0 and a peak row 1 without a
 *      flag; an empty cell is refused; 0 is taken on a band row only, a
 *      negative step on both; a pasted line keeps a band row's flag; a flag
 *      survives a retype between rows that take one, and Step 0 goes on a
 *      retype to a peak row.
 *   5. A status-bar average monitor, whose rows carry the monitors' search
 *      step, keeps the band grid it had; setMerit refuses a flag out of range
 *      and 0 on a peak row; a Specification check takes a negative step.
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
const { makeOperand, evaluateOperands, buildEvalContext, extremumStepNm } = await import('../src/utils/physics/optimizer.js');
const { makeQualifier, takesCheckFlag, hasOwnStep } = await import('../src/utils/synthesis/qualifiers.js');

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
    { formula: '(HL)^4 2H (LH)^4', flag: 2, unflagged: 0.0297 },
    { formula: '(HL)^8 2H (LH)^8', flag: 3, unflagged: 0.0192 },
];
for (const { formula, flag, unflagged } of CAVITIES) {
    const design = stack(formula);
    const dense = value(design, tav({ bandPoints: 80001 }));
    const flagged = value(design, tav({ flag }));
    ok(`${formula}: TAV at flag ${flag} reads its dense value`, Math.abs(flagged - dense) <= 0.005 * dense, `${flagged} against ${dense}`);
    const plain = value(design, tav());
    ok(`${formula}: without a flag it reads its Step 0 value`, Math.abs(plain - unflagged) <= 0.01 * unflagged, String(plain));
    const run = await quietly(() => api.refine(api.setMerit(design, [tav({ flag })]), { method: 'dls', maxIter: 1 }));
    ok(`${formula}: a run starts on the flag's grid`, Math.abs(run.result.mfInitial - flagged) <= 1e-12 * Math.max(1, flagged), `${run.result.mfInitial} against ${flagged}`);
}

// ── 2. Counts ──────────────────────────────────────────────────────────────
{
    let thick = api.newDesign();
    for (let i = 0; i < 80; i++) thick = api.insertLayer(thick, { material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + (i * 37) % 120 });
    const wide = { type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, target: 0, weight: 1 };
    const fringe = stamped(thick, wide).bandPoints;
    ok('Step 0 on a thick stack is its fringe grid', fringe > 601 && stamped(thick, { ...wide, flag: 0 }).bandPoints === fringe, String(fringe));
    ok('a set step coarser than the fringes is kept', stamped(thick, { ...wide, flag: 1 }).bandPoints === 1201 && fringe > 1201, String(fringe));
    const thin = stack('H L');
    ok('Step 0 on a thin coating is no coarser than 2 nm', stamped(thin, { ...wide, lambdaEnd: 700 }).bandPoints === 151,
        String(stamped(thin, { ...wide, lambdaEnd: 700 }).bandPoints));
    ok('a flag finer than the fringe grid sets the count', stamped(thin, tav({ flag: 2 })).bandPoints === 1001, String(stamped(thin, tav({ flag: 2 })).bandPoints));
    ok('a count the row carries is raised to the flag', operandSampleLambdas(tav({ flag: 2, bandPoints: 50 })).length === 1001);
    ok('and a larger one is kept', operandSampleLambdas(tav({ flag: 1, bandPoints: 500 })).length === 500);
    ok('without a design the flag still sets the grid', operandSampleLambdas(tav({ flag: 3 })).length === 10001);
    const rows = [tav({ flag: 2, enabled: true }), { type: 'T', lambdaStart: 550, lambdaEnd: 550, enabled: true }];
    const all = new Set(requiredLambdas(rows));
    ok('a worker samples its materials on every wavelength of the flagged grid', operandSampleLambdas(rows[0]).every(lam => all.has(lam)));

    // A pass band 12 nm wide on the thick stack, as in a multi-line filter.
    const narrow = { type: 'TAV', lambdaStart: 500, lambdaEnd: 512, target: 1, weight: 1 };
    const atStep = flag => stamped(thick, { ...narrow, flag }).bandPoints;
    ok('Step 0 samples it at the fringe grid, finer than 2 nm', atStep(0) > 7 && atStep(0) < 101, String(atStep(0)));
    ok('and so does a row written without a Step', stamped(thick, narrow).bandPoints === atStep(0));
    ok('Step 1 samples it at exactly 1 nm', atStep(1) === 13, String(atStep(1)));
    ok('a negative Step is a step in nm', operandSampleLambdas(tav({ flag: -0.5 })).length === 201 && operandSampleLambdas(tav({ flag: -2 })).length === 51);
    ok('and is kept where the fringes are finer', atStep(-5) === 4 && atStep(-2) === 7, `${atStep(-5)}, ${atStep(-2)}`);
    ok('a step wider than the band gives its two ends', operandSampleLambdas(tav({ flag: -1000 })).length === 2);
    ok('a step finer than 0.001 nm is no step: Step 0', operandSampleLambdas(tav({ flag: -0.0001 })).length === operandSampleLambdas(tav({ flag: 0 })).length);
    ok('a peak row searches at a negative Step in nm, at 1 nm with none or 0',
        extremumStepNm({ flag: -0.25 }) === 0.25 && extremumStepNm({}) === 1 && extremumStepNm({ flag: 0 }) === 1);
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
    ok('a new band row is written at Step 0', ['TAV', 'TIW', 'TGT'].every(type => makeOperand({ type }).flag === 0));
    ok('a new peak row carries no Step', makeOperand({ type: 'TMX' }).flag === undefined);
}

// ── 4. The Flag cell ───────────────────────────────────────────────────────
{
    const peak = { type: 'TMX', lambdaStart: 500, lambdaEnd: 600 };
    ok('a band row without a flag shows 0', flagCellText(tav()) === '0' && flagCellText(tav({ flag: 0 })) === '0');
    ok('a band row shows its flag', flagCellText(tav({ flag: 2 })) === '2' && flagCellText(tav({ flag: -0.25 })) === '-0.25');
    ok('a peak row without a flag shows 1', flagCellText(peak) === '1');
    ok('an empty cell is refused', cellEdit(tav({ flag: 2 }), 'flag', '') === null && cellEdit(peak, 'flag', '') === null);
    ok('a level out of range is refused', cellEdit(tav(), 'flag', '5') === null && cellEdit(tav(), 'flag', '2.5') === null
        && cellEdit(tav(), 'flag', '3')[1] === 3);
    ok('0 is taken on a band row only', cellEdit(tav({ flag: 2 }), 'flag', '0')?.[1] === 0 && cellEdit(peak, 'flag', '0') === null);
    ok('a negative step is taken on both, with a dot or a comma',
        cellEdit(tav(), 'flag', '-0.25')?.[1] === -0.25 && cellEdit(peak, 'flag', '-0,25')?.[1] === -0.25);
    ok('a step finer than 0.001 nm is refused', cellEdit(tav(), 'flag', '-0.0001') === null);
    const pasted = parseOperandsTsv('TAV\t500\t600\t0\tavg\t2\t95\t1');
    ok('a pasted band row keeps its flag', pasted?.[0]?.flag === 2, JSON.stringify(pasted?.[0]));
    ok('and a negative step', parseOperandsTsv('TAV\t500\t600\t0\tavg\t-0.5\t95\t1')?.[0]?.flag === -0.5);
    const fromPeak = retypeOperand({ id: 'x', type: 'TMX', lambdaStart: 500, lambdaEnd: 600, flag: 2, target: 0.5, weight: 1 }, 'TAV');
    ok('a flag survives a retype from a peak row to a band row', fromPeak.flag === 2);
    const toDip = retypeOperand({ ...tav({ flag: 2 }), id: 'y' }, 'TMN');
    ok('and goes on a retype to a dip row', !('flag' in toDip) || toDip.flag === undefined);
    const toPeak = retypeOperand({ ...tav({ flag: 0 }), id: 'z' }, 'TMX');
    ok('Step 0 goes on a retype to a peak row', !('flag' in toPeak) || toPeak.flag === undefined, JSON.stringify(toPeak.flag));
}

// ── 5. Monitors and the API ────────────────────────────────────────────────
{
    const design = stack('(HL)^4 2H (LH)^4');
    const lookup = designMaterialLookup(design);
    const shown = computeMonitor({ type: 'avg', qty: 'T', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg' }, design, lookup);
    const plainRow = 100 * evaluateOperands([makeOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 600, target: 0, weight: 1 })], buildEvalContext(design, lookup))[0];
    ok('an average monitor keeps its band grid', Math.abs(shown - plainRow) <= 1e-10, `${shown} against ${plainRow}`);
    const refusedFor = row => {
        try { api.setMerit(design, [row]); return ''; } catch (err) { return err.message; }
    };
    ok('setMerit refuses a flag out of range', /flag is a whole number from 1 to 4/.test(refusedFor(tav({ flag: 5 }))), refusedFor(tav({ flag: 5 })));
    ok('and 0 on a peak row', /flag is/.test(refusedFor({ type: 'TMX', lambdaStart: 500, lambdaEnd: 600, flag: 0 })));
    ok('and takes 0 on a band row and a negative step', refusedFor(tav({ flag: 0 })) === '' && refusedFor(tav({ flag: -0.25 })) === '');
    const average = makeQualifier({ kind: 'T_AVG', lambdaStart: 500, lambdaEnd: 600 });
    const width = makeQualifier({ kind: 'FWHM', lambdaStart: 500, lambdaEnd: 600 });
    ok('a check takes a negative step, and 0 on an average only',
        takesCheckFlag(average, -0.25) && takesCheckFlag(width, -0.25) && takesCheckFlag(average, 0) && !takesCheckFlag(width, 0));
    ok('a check at a negative step reads its own step', hasOwnStep({ ...average, flag: -2 }) && !hasOwnStep({ ...average, flag: 0 }));
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

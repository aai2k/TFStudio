// What runs and tolerance checks answer with: a run's progress and result, a
// Monte Carlo run and the yield of trials against a specification, the verdict
// on a specification, a layer sensitivity ranking, and what a cleanup did.

import { inspect } from 'node:util';
import { curveOf } from './spectrum.js';

/**
 * What a run has reported so far, given to the function passed as
 * `progress` each time the run reports. An attribute the run has not
 * reported, or does not report, is null.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 450, 650, { target: 0 });
 * await design.refine({ method: 'dls', maxIter: 5, progress: p => console.log(p.iteration, p.merit) });
 */
export class Progress {
    constructor(reported) {
        this._values = reported;
    }

    /**
     * The merit the run reports now: of the layers it is on (refinement), or
     * of the design it goes on from (synthesis).
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ maxIter: 5, progress: p => console.log(p.merit) });
     */
    get merit() { return this._values.mf ?? null; }

    /**
     * The best merit so far, where the run reports one.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ maxIter: 5, progress: p => console.log(p.bestMerit) });
     */
    get bestMerit() { return this._values.mfBest ?? null; }

    /**
     * The merit without the manufacturing rows MNT, MXT, TT and STR, where
     * the run reports it.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.add('MNT', { target: 10 });
     * await design.refine({ maxIter: 5, progress: p => console.log(p.merit, p.opticalMerit) });
     */
    get opticalMerit() { return this._values.omf ?? null; }

    /**
     * The iteration under way: refinement, and Structural synthesis.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ maxIter: 5, progress: p => console.log(p.iteration) });
     */
    get iteration() { return this._values.iter ?? null; }

    /**
     * The last generation the run accepted: Needle, Gradual Evolution and
     * Structural synthesis.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.layers.append('SiO2', 100);
     * design.merit.add('RAV', 420, 680, { target: 0 });
     * await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.generation, p.layerCount) });
     */
    get generation() { return this._values.genNum ?? null; }

    /**
     * The layers of the design the run goes on from: synthesis.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.layers.append('SiO2', 100);
     * design.merit.add('RAV', 420, 680, { target: 0 });
     * await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.layerCount) });
     */
    get layerCount() { return this._values.layerCount ?? null; }

    /**
     * The refinement method under way, such as `'dls'`, for a refinement
     * that tries several.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ method: ['dls', 'cg'], progress: p => console.log(p.method) });
     */
    get method() { return this._values.method ?? null; }

    /**
     * The seed the run's random draws start from, once the run has started;
     * null for a run that draws none.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ method: 'sa', maxIter: 5, progress: p => console.log(p.seed) });
     */
    get seed() { return this._values.seed ?? null; }

    /**
     * The trials made so far: Monte Carlo.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * await design.monteCarlo(400, 700, { step: 10, runs: 20, progress: p => console.log(p.trial, 'of', p.total) });
     */
    get trial() { return this._values.trial ?? null; }

    /**
     * The trials the run makes: Monte Carlo.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * await design.monteCarlo(400, 700, { step: 10, runs: 20, progress: p => console.log(p.trial / p.total) });
     */
    get total() { return this._values.total ?? null; }

    /**
     * What a synthesis is doing, an object such as `{ id: 'scanning' }`, or
     * null.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.layers.append('SiO2', 100);
     * design.merit.add('RAV', 420, 680, { target: 0 });
     * await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.activity) });
     */
    get activity() { return this._values.activity ?? null; }

    /**
     * Everything the run has reported so far, by name, such as `design`, the
     * layers the run is on.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * await design.refine({ maxIter: 5, progress: p => console.log(Object.keys(p.reported).sort().join(', ')) });
     */
    get reported() { return this._values; }
}

/**
 * How a refinement or a synthesis ended. The run has already left its
 * answer in the design it was made on: the new layers when it finished, the
 * layers as they were when it was stopped.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 450, 650, { target: 0 });
 * const run = await design.refine({ method: 'dls', maxIter: 20 });
 * console.log(run.merit, run.stopReason);
 */
export class RunResult {
    constructor(result, mode) {
        this._result = result;
        this._mode = mode;
    }

    /**
     * `true` when the run ended on its own, `false` when it was stopped or
     * could not run.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const run = await design.refine({ maxIter: 20 });
     * console.log(run.completed ? 'ended on its own' : `ended: ${run.stopReason}`);
     */
    get completed() { return this._result.completed ?? null; }

    /**
     * Why the run ended: such as `'target'`, `'maxiter'`, `'stalled'` or
     * `'stopped'` for a refinement, `'maxLayers'` or `'needleOptimal'` for
     * Needle. The API Reference lists them under refine and synthesize.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log((await design.refine({ maxIter: 20 })).stopReason);
     */
    get stopReason() { return this._result.stopReason ?? null; }

    /**
     * The merit at the end, as the run's window shows it, or null when the
     * run has no answer.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log((await design.refine({ maxIter: 20 })).merit);
     */
    get merit() { return this._result.mf ?? null; }

    /**
     * The merit at the end without the manufacturing rows MNT, MXT, TT and
     * STR, or null where the run does not report it.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.add('MNT', { target: 10 });
     * const run = await design.refine({ maxIter: 20 });
     * console.log(run.merit, run.opticalMerit);
     */
    get opticalMerit() { return this._result.omf ?? null; }

    /**
     * The merit at the start: refinement; null otherwise.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const run = await design.refine({ maxIter: 20 });
     * console.log(run.initialMerit, '->', run.merit);
     */
    get initialMerit() { return this._result.mfInitial ?? null; }

    /**
     * The iterations a refinement took, or the generations a Structural
     * synthesis ran; null for the other runs.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log((await design.refine({ maxIter: 20 })).iterations);
     */
    get iterations() { return this._result.iter ?? this._result.iters ?? null; }

    /**
     * The seed the run's random draws started from: the same seed, design and
     * settings repeat the run. null for a run that draws none.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const before = design.copy();
     * const run = await design.refine({ method: 'sa', maxIter: 20 });
     * const again = await before.refine({ method: 'sa', maxIter: 20, seed: run.seed });
     * console.log(run.seed, run.merit === again.merit);
     */
    get seed() { return this._result.seed ?? null; }

    /**
     * What the run scored: `'front'` or `'back'`, the coated side alone, or
     * `'total'`, the whole part, as the design's `sides` and `scoreOn` said.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.scoreOn = 'whole part';
     * console.log((await design.refine({ maxIter: 20 })).mode);
     */
    get mode() { return this._mode; }

    /**
     * Everything the run answered, by name, such as `geSteps`, the forced
     * steps of a Gradual Evolution run, or `reheats`, the restarts of a
     * Structural deep search.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const run = await design.refine({ maxIter: 20 });
     * console.log(Object.keys(run.reported).join(', '));
     */
    get reported() { return this._result; }

    // What console.log prints for a run's result.
    [inspect.custom]() { return `<RunResult ${this.stopReason}: merit ${this.merit}>`; }
}

// The curves of a Monte Carlo result, by their names here and in the API's answer.
const MONTE_CARLO_CURVES = [['theory', 'theory'], ['mean', 'mean'], ['stdev', 'stdev'], ['lower', 'lower'], ['upper', 'upper'],
    ['lowest', 'envLower'], ['highest', 'envUpper']];

/**
 * Monte Carlo trials of a design with random layer errors, as
 * design.monteCarlo() runs them: the spread of one quantity over a range of
 * wavelengths. Each spread is a Curve of fractions of 1.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 20, seed: 1 });
 * console.log(mc.runs, 'trials, largest spread:', Math.max(...mc.stdev));
 */
export class MonteCarlo {
    constructor(result, mode) {
        const wavelength = Array.from(result.lambda);
        this._curves = Object.fromEntries(MONTE_CARLO_CURVES.map(([name, key]) => [name, curveOf(result[key], wavelength)]));
        this._result = result;
        this._wavelength = wavelength;
        this._mode = mode;
        this._spec = result.spec ? new Yield({ ...result.spec, seed: result.seed, mode }) : null;
    }

    /**
     * The wavelengths, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 50, runs: 5 });
     * console.log(mc.wavelength.join(', '));
     */
    get wavelength() { return this._wavelength; }

    /**
     * The quantity for the design without errors, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.max(...mc.theory));
     */
    get theory() { return this._curves.theory; }

    /**
     * The mean over the trials, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(mc.mean.mean(450, 650));
     */
    get mean() { return this._curves.mean; }

    /**
     * The standard deviation over the trials, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.max(...mc.stdev));
     */
    get stdev() { return this._curves.stdev; }

    /**
     * The mean less one standard deviation, 0 at the least, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.min(...mc.lower));
     */
    get lower() { return this._curves.lower; }

    /**
     * The mean plus one standard deviation, 1 at the most, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.max(...mc.upper));
     */
    get upper() { return this._curves.upper; }

    /**
     * The lowest value over the trials, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.min(...mc.lowest));
     */
    get lowest() { return this._curves.lowest; }

    /**
     * The highest value over the trials, a Curve.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(Math.max(...mc.highest));
     */
    get highest() { return this._curves.highest; }

    /**
     * The trials made: as many as asked, or fewer when the run was stopped.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).runs);
     */
    get runs() { return this._result.nTrials; }

    /**
     * The quantity, `'R'`, `'T'` or `'A'`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5, quantity: 'T' })).quantity);
     */
    get quantity() { return this._result.char; }

    /**
     * The seed the draws started from: the same seed and settings repeat the
     * run.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).seed);
     */
    get seed() { return this._result.seed; }

    /**
     * With the design's specification, the share of the trials that meet it,
     * a Yield, as specification.estimateYield() counts it; null for a design
     * without one.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 20, seed: 1 });
     * console.log('yield', mc.spec.value, 'of', mc.spec.runs, 'trials');
     */
    get spec() { return this._spec; }

    /**
     * What the trials scored: `'front'` or `'back'`, the coated side alone,
     * or `'total'`, the whole part, as the design's `sides` and `scoreOn`
     * said.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).mode);
     */
    get mode() { return this._mode; }

    // What console.log prints for a Monte Carlo result.
    [inspect.custom]() { return `<MonteCarlo ${this.runs} trials of ${this.quantity}, seed ${this.seed}>`; }
}

/**
 * The yield of Monte Carlo trials with random layer errors against a design's
 * specification, as the Monte Carlo window counts it: the share of the trials
 * that meet every enabled check, each check read at its own Step.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^5 H');
 * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
 * const y = await design.specification.estimateYield(50, { thicknessRelPct: 2, seed: 1 });
 * console.log('yield', y.value, 'from', y.interval[0], 'to', y.interval[1]);
 */
export class Yield {
    constructor(result) {
        this._result = result;
        this._checks = result.perQualifier.map(({ label, failRate }) => ({ label, failRate }));
    }

    /**
     * The yield: the share of the trials checked that met every enabled
     * check, 0 to 1; null when no trial was checked.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * console.log((await design.specification.estimateYield(20, { seed: 1 })).value);
     */
    get value() { return this._result.yield ?? null; }

    /**
     * How many trials met every enabled check.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * const y = await design.specification.estimateYield(20, { seed: 1 });
     * console.log(y.passCount, 'of', y.evaluated);
     */
    get passCount() { return this._result.passCount; }

    /**
     * How many trials were checked: those run, less any whose checks could
     * not be evaluated.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * console.log((await design.specification.estimateYield(20, { seed: 1 })).evaluated);
     */
    get evaluated() { return this._result.evaluated; }

    /**
     * The 95 % interval of the yield, `[low, high]`, 0 to 1; null when no
     * trial was checked.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * const [low, high] = (await design.specification.estimateYield(20, { seed: 1 })).interval;
     * console.log(low, high);
     */
    get interval() { return this._result.yieldInterval ?? null; }

    /**
     * One object per check of the specification, in its order: `{ label,
     * failRate }`, the check's label, or its kind when it has none, and the
     * share of all the trials run in which it failed. A check left out of the
     * verdict fails in none.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
     * const y = await design.specification.estimateYield(20, { thicknessRelPct: 2, seed: 1 });
     * for (const check of y.checks) console.log(check.label, check.failRate);
     */
    get checks() { return this._checks; }

    /**
     * The trials run: as many as asked, or fewer when the run was stopped.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * console.log((await design.specification.estimateYield(20, { seed: 1 })).runs);
     */
    get runs() { return this._result.nTrials; }

    /**
     * The seed the draws started from: the same seed, design and settings
     * repeat the trials.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * const y = await design.specification.estimateYield(20);
     * const again = await design.specification.estimateYield(20, { seed: y.seed });
     * console.log(y.seed, y.value === again.value);
     */
    get seed() { return this._result.seed; }

    /**
     * What the trials scored: `'front'` or `'back'`, the coated side alone,
     * or `'total'`, the whole part, as the design's `sides` and `scoreOn`
     * said.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * console.log((await design.specification.estimateYield(20, { seed: 1 })).mode);
     */
    get mode() { return this._result.mode; }

    // What console.log prints for a yield.
    [inspect.custom]() { return `<Yield ${this.value} (${this.passCount} of ${this.evaluated} checked), seed ${this.seed}>`; }
}

/**
 * One check of a design's specification as specification.check() judged it,
 * as the Specification window shows its row.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^5 H');
 * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
 * for (const row of design.specification.check().rows) console.log(row.kind, row.value, row.passed, row.margin);
 */
export class CheckResult {
    constructor(row) {
        this._row = row;
    }

    /**
     * The check's kind, such as `'R_AVG'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.check().rows[0].kind);
     */
    get kind() { return this._row.kind; }

    /**
     * The check's label, `''` when it has none.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9, label: 'Stop band' });
     * console.log(design.specification.check().rows[0].label);
     */
    get label() { return this._row.label; }

    /**
     * The check's value: T, R and A as fractions of 1, wavelengths, widths
     * and thicknesses in nm, PPEF in dB, a layer count as a count; null when
     * there is none, as for a check left out of the verdict.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.check().rows[0].value);
     */
    get value() { return this._row.value; }

    /**
     * The value's unit: `'fraction'`, `'nm'` or `'dB'`, or `''` for a layer
     * count and for a check left out of the verdict.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('THICKNESS_BUDGET', { cmp: 'le', target: 2000 });
     * const row = design.specification.check().rows[0];
     * console.log(row.value, row.unit);
     */
    get unit() { return this._row.unit; }

    /**
     * Whether the value meets the threshold, as the window marks it: `false`
     * when there is no value, null for a check left out of the verdict.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
     * console.log(design.specification.check().rows[0].passed);
     */
    get passed() { return this._row.passed; }

    /**
     * How far the value is from the nearest bound, in its unit: positive by
     * the room left, negative by how far it is out, so `passed` is `true`
     * exactly when it is 0 or more; null when there is no value. A bound lies
     * half the last digit the window shows past the stated one, so a value the
     * window shows on its bound passes: 0.000005 for a fraction, 0.005 nm,
     * 0.0005 dB, nothing for a layer count.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
     * console.log(design.specification.check().rows[0].margin);
     */
    get margin() { return this._row.margin; }

    /**
     * The comparison the value is held to, as the check holds it: an object
     * `{ cmp, target, tol, lo, hi }`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'eq', target: 0.98, tol: 0.01 });
     * const { cmp, target, tol } = design.specification.check().rows[0].threshold;
     * console.log(cmp, target, tol);
     */
    get threshold() { return this._row.threshold; }

    /**
     * Why there is no value, or null: `'disabled'`, a check left out of the
     * verdict; `'notComputable'`, a value that came out as no number;
     * `'noCurve'`, a PPEF check whose curve the design does not hold;
     * `'fwhmNotBracketed'` or `'edgeNotCrossed'`, a width or an edge whose
     * crossing is not inside the band; `'unknownKind'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9, enabled: false });
     * console.log(design.specification.check().rows[0].reason);
     */
    get reason() { return this._row.reason; }

    // What console.log prints for a check's result; a disabled check is not judged.
    [inspect.custom]() {
        if (this.passed === null) return `<CheckResult ${this.kind}: disabled>`;
        return `<CheckResult ${this.kind}: ${this.value}${this.unit ? ` ${this.unit}` : ''}, ${this.passed ? 'passed' : 'not passed'}>`;
    }
}

/**
 * A design judged against its specification, as specification.check()
 * judges it and the Specification window shows it: a CheckResult per check.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^5 H');
 * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
 * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
 * const report = design.specification.check();
 * console.log(report.passing, 'of', report.total, 'checks pass');
 */
export class SpecReport {
    constructor(verdict) {
        this._verdict = verdict;
        this._rows = verdict.rows.map(row => new CheckResult(row));
    }

    /**
     * One CheckResult per check, in the specification's order.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * for (const row of design.specification.check().rows) console.log(row.kind, row.passed);
     */
    get rows() { return this._rows; }

    /**
     * `true` when every enabled check passes and there is one at least.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.check().passed);
     */
    get passed() { return this._verdict.passed; }

    /**
     * How many enabled checks pass.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
     * console.log(design.specification.check().passing);
     */
    get passing() { return this._verdict.passing; }

    /**
     * How many checks are enabled.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9, enabled: false });
     * console.log(design.specification.check().total);
     */
    get total() { return this._verdict.total; }

    /**
     * What the checks were computed on: `'front'` or `'back'`, the coated
     * side alone, or `'total'`, the whole part, as the design's `sides` and
     * `scoreOn` said.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * design.scoreOn = 'whole part';
     * console.log(design.specification.check().mode);
     */
    get mode() { return this._verdict.mode; }

    // What console.log prints for a verdict.
    [inspect.custom]() { return `<SpecReport ${this.passing} of ${this.total} checks pass>`; }
}

/**
 * One layer of a layer sensitivity ranking.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 450, 650, { target: 0 });
 * for (const row of design.layerSensitivity().rows) console.log(row.side, row.number, row.material, row.sensitivity);
 */
export class SensitivityRow {
    constructor(row, frontCount) {
        this._row = row;
        this._number = row.side === 'front' ? frontCount - row.layerIndex : row.layerIndex + 1;
    }

    /**
     * The layer's side, `'front'` or `'back'`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().rows[0].side);
     */
    get side() { return this._row.side; }

    /**
     * The layer's number on its side, 1 next to the substrate, as
     * design.layers and design.backLayers number it.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const row = design.layerSensitivity().rows[0];
     * console.log(row.number, design.layers[row.number].material);
     */
    get number() { return this._number; }

    /**
     * The layer's material, by id.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().rows[0].material);
     */
    get material() { return this._row.materialId; }

    /**
     * The layer's thickness, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().rows[0].thickness);
     */
    get thickness() { return this._row.thickness; }

    /**
     * The thickness step the layer was made thicker and thinner by, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity({ step: 'percent', relPct: 2 }).rows[0].step);
     */
    get step() { return this._row.deltaNm; }

    /**
     * The mean change of the merit over the two steps.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().rows[0].meritChange);
     */
    get meritChange() { return this._row.deltaMFAbs; }

    /**
     * The same change, positive when the thicker layer costs more and
     * negative when the thinner one does.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const row = design.layerSensitivity().rows[0];
     * console.log(row.signedMeritChange > 0 ? 'thicker costs more' : 'thinner costs more');
     */
    get signedMeritChange() { return this._row.deltaMF; }

    /**
     * The layer's score as a share of the highest, 0 to 100.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().rows[0].sensitivity);
     */
    get sensitivity() { return this._row.sensitivity; }

    /**
     * `true` for a locked layer.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.layers[1].locked = true;
     * for (const row of design.layerSensitivity({ includeLocked: true }).rows) console.log(row.number, row.locked);
     */
    get locked() { return this._row.locked; }

    // What console.log prints for a row.
    [inspect.custom]() { return `<SensitivityRow ${this.side} ${this.number} ${this.material}: ${this.sensitivity}>`; }
}

/**
 * How much the merit moves when each layer's thickness is off, as
 * design.layerSensitivity() ranks the layers.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 450, 650, { target: 0 });
 * const ls = design.layerSensitivity();
 * const worst = ls.rows.reduce((a, b) => (b.sensitivity > a.sensitivity ? b : a));
 * console.log('most sensitive: layer', worst.number, worst.material);
 */
export class LayerSensitivity {
    constructor(result, frontCount, mode) {
        this._rows = result.rows.map(row => new SensitivityRow(row, frontCount));
        this._merit = result.mf0;
        this._mode = mode;
    }

    /**
     * One SensitivityRow per layer scored, the front's first.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * for (const row of design.layerSensitivity().rows) console.log(row.number, row.sensitivity);
     */
    get rows() { return this._rows; }

    /**
     * The merit of the design as it is, without the MNT and MXT rows.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().merit);
     */
    get merit() { return this._merit; }

    /**
     * What was scored: `'front'` or `'back'`, the coated side alone, or
     * `'total'`, the whole part, as the design's `sides` and `scoreOn` said.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.layerSensitivity().mode);
     */
    get mode() { return this._mode; }

    // What console.log prints for a ranking.
    [inspect.custom]() { return `<LayerSensitivity of ${this.rows.length} layers>`; }
}

/**
 * What design.clean() did to the design, as the Design Cleaner window lists
 * its operations: the layers it took out and those it merged into a
 * neighbour.
 *
 * @example
 * const design = tf.newDesign('Stack with a thin layer');
 * design.stack('(HL)^2 0.03H L');
 * const report = design.clean();
 * console.log(report.removed, 'taken out,', report.merged, 'merged');
 */
export class CleanReport {
    constructor(cleaned) {
        this._cleaned = cleaned;
    }

    /**
     * How many layers were taken out.
     *
     * @example
     * const design = tf.newDesign('Stack with a thin layer');
     * design.stack('(HL)^2 0.03H L');
     * console.log(design.clean().removed);
     */
    get removed() { return this._cleaned.removed; }

    /**
     * How many layers were merged into a neighbour.
     *
     * @example
     * const design = tf.newDesign('Stack with a thin layer');
     * design.stack('(HL)^2 0.03H L');
     * console.log(design.clean().merged);
     */
    get merged() { return this._cleaned.merged; }

    /**
     * One object per operation, in the order they were made, the front's
     * first: `{ side, kind, number, material, thickness, mergedInto }`. kind
     * is `'remove'` or `'merge'`; number the layer's number on its side
     * before the cleanup, 1 next to the substrate, as design.layers and
     * design.backLayers numbered it then; material its material, by id;
     * thickness, nm, for a layer taken out its thickness then, which counts
     * any layer merged into it before, and for a merge what it adds to the
     * layer it is merged into; mergedInto, for a merge, the number of that
     * layer, numbered as number is, and null for a layer taken out.
     *
     * @example
     * const design = tf.newDesign('Stack with a thin layer');
     * design.stack('(HL)^2 0.03H L');
     * for (const op of design.clean().operations) console.log(op.kind, op.side, op.number, op.material, op.thickness, op.mergedInto);
     */
    get operations() { return this._cleaned.operations; }

    // What console.log prints for a cleanup.
    [inspect.custom]() { return `<CleanReport ${this.removed} taken out, ${this.merged} merged>`; }
}

// What runs and tolerance checks answer with: a run's progress and result, a
// Monte Carlo run and a layer sensitivity ranking.

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
     * With the design's specification, the share of trials that meet it: an
     * object `{ yield, passCount, evaluated, yieldInterval }`, `yieldInterval`
     * the 95 % interval of the share; null for a design without one.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
     * console.log(mc.spec ? `yield ${mc.spec.yield}` : 'no specification');
     */
    get spec() { return this._result.spec ?? null; }

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

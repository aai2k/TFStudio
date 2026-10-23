// A design and its substrate, and the computations made on it.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { checkOptions, requireValue } from '../check.js';
import { resolveEvalMode } from '../../utils/physics/optimizer.js';
import { ended, hooksFor } from './hooks.js';
import { Layers } from './layers.js';
import { Merit } from './merit.js';
import { defined, optionsOf } from './options.js';
import { worded } from './refusals.js';
import { CleanReport, LayerSensitivity, MonteCarlo, RunResult } from './results.js';
import { Specification } from './specification.js';
import { Spectrum } from './spectrum.js';

// design.sides by the API's surfaceMode, and design.scoreOn by its mfEvalMode;
// the API Reference's table of what a design computes on is made from them.
export const SIDES = { front: 'front_only', back: 'back_only', both: 'both_independent', symmetric: 'symmetric' };
export const SCORE_ON = { side: 'side', 'whole part': 'total' };
const nameOf = (mapping, value) => Object.keys(mapping).find(name => mapping[name] === value);
// layerSensitivity()'s kinds of step by the API's modes.
const STEPS = { nm: 'absolute', percent: 'relative' };
// The attributes that set what setDesignSetup's options set, where their
// names differ.
const SETUP_NAMES = { referenceWavelength: 'reference', substrate: 'substrate.material', substrateThicknessMm: 'substrate.thickness' };

// The API's name of `value`, one of the names `mapping` holds for the
// attribute `what`.
function named(mapping, what, value) {
    if (!Object.hasOwn(mapping, value)) {
        const names = Object.keys(mapping).map(name => `'${name}'`);
        throw new Error(`${what} is ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}, not ${JSON.stringify(value)}`);
    }
    return mapping[value];
}

// design.stack()'s options by the API's names for them.
const STACK_OPTIONS = { at: 'referenceWavelength', side: 'side', fromSubstrate: 'startFromSubstrate' };
const STACK_NAMES = Object.fromEntries(Object.entries(STACK_OPTIONS).map(([name, apiName]) => [apiName, name]));
// design.clean()'s names for cleanDesign's options, where they differ.
const CLEAN_NAMES = { mergeAdjacent: 'merge', cleanBack: 'back' };

/**
 * A design's substrate: its material and thickness. Setting either changes
 * the design.
 *
 * @example
 * const design = tf.newDesign('Bare SiO2');
 * design.substrate.material = 'SiO2';
 * design.substrate.thickness = 3;
 * console.log(design.substrate.material, design.substrate.thickness, 'mm');
 */
export class Substrate {
    constructor(design) {
        this._design = design;
    }

    /**
     * The substrate's material, by id.
     *
     * @throws a material id that resolves to nothing
     * @example
     * const design = tf.newDesign('Bare SiO2');
     * design.substrate.material = 'SiO2';
     * console.log(design.substrate.material);
     */
    get material() { return this._design._data.substrate.material; }

    set material(material) { this._design._setup({ substrate: material }); }

    /**
     * The substrate's thickness, mm.
     *
     * @throws a thickness of 0 or less
     * @example
     * const design = tf.newDesign('Bare BK7');
     * design.substrate.thickness = 3;
     * console.log(design.substrate.thickness, 'mm');
     */
    get thickness() { return this._design._data.substrate.thickness; }

    set thickness(thickness) { this._design._setup({ substrateThicknessMm: thickness }); }

    // What console.log prints for a substrate.
    [inspect.custom]() { return `<Substrate ${this.material} ${this.thickness} mm>`; }
}

/**
 * A thin-film design, as a .tfs file holds it: its media and substrate, the
 * layers of each side, and its merit function. tf.newDesign(),
 * tf.openDesign() and copy() give one; in the Script Console, `tf.design` is
 * the open design.
 *
 * Methods that change a design change it in place: stack(), the layer edits,
 * clean(), refine() and synthesize(). copy() keeps a copy first.
 *
 * @example
 * const design = tf.newDesign('Mirror 550', { substrate: 'BK7', reference: 550 });
 * design.stack('(HL)^4 H', { H: 'TiO2', L: 'SiO2' });
 * console.log(design);
 */
export class Design {
    constructor(data) {
        this._data = data;
    }

    /**
     * The design's name. In the Script Console, a new name of `tf.design` is
     * not applied to the open design, whose name is its file's.
     *
     * @throws a name that is not text, or is empty
     * @example
     * const design = tf.newDesign('Bare BK7');
     * design.name = 'BK7 window';
     * console.log(design.name);
     */
    get name() { return this._data.name; }

    set name(name) { this._setup({ name }); }

    /**
     * The reference wavelength, nm, at which stack formulas count quarter
     * waves. Setting it rescales every layer to keep its count of quarter
     * waves, as the Design Editor's reference wavelength field does.
     *
     * @throws a wavelength of 0 or less
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.reference = 600;
     * console.log(design.reference, 'nm, layer 1', design.layers[1].thickness, 'nm');
     */
    get reference() { return this._data.referenceWavelength; }

    set reference(wavelength) { this._setup({ referenceWavelength: wavelength }); }

    /**
     * Which sides carry layers: `'front'`, `'back'`, `'both'`, or
     * `'symmetric'`, whose back mirrors its front. Making a design symmetric
     * gives it the mirror of its front as its back.
     *
     * With `scoreOn`, it decides what a spectrum, the merit and every run
     * compute on: the front alone, the back alone, or the whole part, which
     * each result gives as its `mode`.
     *
     * @throws any other value
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.sides = 'both';
     * console.log(design.sides, design.spectrum(400, 700).mode);
     */
    get sides() { return nameOf(SIDES, this._data.surfaceMode || 'front_only'); }

    set sides(sides) { this._setup({ surfaceMode: named(SIDES, 'sides', sides) }); }

    /**
     * How a design coated on one side is scored: `'side'`, its coated side
     * alone, or `'whole part'`, the substrate's other surface included. A
     * design coated on both sides is scored as the whole part. It is the
     * Design Editor's Ignore other side: `'side'` with it ticked.
     *
     * @throws any other value
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.scoreOn = 'whole part';
     * console.log(design.scoreOn, design.spectrum(400, 700).mode);
     */
    get scoreOn() { return nameOf(SCORE_ON, this._data.mfEvalMode || 'side'); }

    set scoreOn(scoreOn) { this._setup({ mfEvalMode: named(SCORE_ON, 'scoreOn', scoreOn) }); }

    /**
     * The medium the light comes from, by material id.
     *
     * @throws a material id that resolves to nothing
     * @example
     * const design = tf.newDesign('Prism coating');
     * design.stack('(HL)^2');
     * design.incidentMedium = 'BK7';
     * console.log(design.incidentMedium);
     */
    get incidentMedium() { return this._data.incidentMedium; }

    set incidentMedium(material) { this._setup({ incidentMedium: material }); }

    /**
     * The medium behind the substrate, by material id.
     *
     * @throws a material id that resolves to nothing
     * @example
     * const design = tf.newDesign('Cemented');
     * design.exitMedium = 'BK7';
     * console.log(design.exitMedium);
     */
    get exitMedium() { return this._data.exitMedium; }

    set exitMedium(material) { this._setup({ exitMedium: material }); }

    /**
     * The substrate: its material and thickness, a Substrate.
     *
     * @example
     * const design = tf.newDesign('Bare BK7');
     * design.substrate.thickness = 3;
     * console.log(design.substrate);
     */
    get substrate() { return new Substrate(this); }

    /**
     * The front's layers, a Layers numbered from 1 next to the substrate.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].thickness = 12.5;
     * console.log(design.layers);
     */
    get layers() { return new Layers(this, 'front'); }

    /**
     * The back's layers, a Layers numbered from 1 next to the substrate. On a
     * symmetric design they mirror the front and cannot be changed here.
     *
     * @example
     * const design = tf.newDesign('Two-sided AR');
     * design.sides = 'both';
     * design.backLayers.append('MgF2', 100);
     * console.log(design.backLayers);
     */
    get backLayers() { return new Layers(this, 'back'); }

    /**
     * The merit function, a Merit: its rows and the merit they add up to.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 420, 680, { target: 0 });
     * console.log(design.merit.value);
     */
    get merit() { return new Merit(this); }

    /**
     * The specification, a Specification: the pass or fail checks of the
     * Specification window, the verdict on them and the yield against them.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.check().passed);
     */
    get specification() { return new Specification(this); }

    /**
     * Replaces the layers of one side with those a stack formula builds, as
     * the Stack Formula dialog's Replace builds them. Each letter is a quarter
     * wave at the reference wavelength, so `'(HL)^5 H'` is eleven quarter-wave
     * layers. Filling a side a design coated on one side does not score makes
     * it coated on both, as the dialog does.
     *
     * @param formula The layers alone, such as `'(HL)^5 H'`; the media stay the design's.
     * @param [options]
     * @param [options.at] The wavelength, nm, the quarter waves are counted at, which the design then keeps as its reference. Without it, the design's reference wavelength.
     * @param [options.side='front'] `'front'` or `'back'`; a symmetric design takes the front.
     * @param [options.fromSubstrate=true] `true` makes the formula's first letter the layer on the substrate, `false` the layer next to the incident medium.
     * @param [options.H] The material of the letter H, by id, such as `'Ta2O5'`; any other letter of the formula likewise. A letter left out is H TiO2, L SiO2 or M Al2O3.
     * @throws a formula that does not read, saying where the reading stopped; a formula that names media; a letter the formula does not use; an option stack does not take; the back of a symmetric design; or a material id that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H', { H: 'Ta2O5', L: 'SiO2', at: 600 });
     * console.log(design.layers.length, 'layers at', design.reference, 'nm');
     */
    stack(formula, options) {
        const given = optionsOf('stack', options);
        const unknown = Object.keys(given).find(name => name.length > 1 && !Object.hasOwn(STACK_OPTIONS, name));
        if (unknown) throw new Error(`stack: unknown option '${unknown}'; the options are at, side, fromSubstrate, and a letter for each symbol`);
        const symbols = Object.fromEntries(Object.entries(given).filter(([name]) => name.length === 1));
        const settings = Object.fromEntries(Object.entries(STACK_OPTIONS).map(([name, apiName]) => [apiName, given[name]]));
        this._data = worded({ method: 'stack', call: 'stackFromFormula', names: STACK_NAMES },
            () => api.stackFromFormula(this._data, { ...settings, formula, symbols }));
    }

    /**
     * Cleans the stack as the Design Cleaner window does: adjacent layers of
     * one material merged into one, and layers thinner than `minThickness`
     * taken out, in passes, since taking a layer out can leave two layers of
     * one material touching. Locked layers are never merged or taken out, and
     * a symmetric design's back follows its front. The design then holds the
     * cleaned layers.
     *
     * The merit usually worsens a little, since the stack changed. To do what
     * the window's Re-optimize does, add an MNT row at `minThickness` and
     * refine with sqp: `design.merit.add('MNT', { target: 5 })`, then
     * `await design.refine({ method: 'sqp', maxIter: 80 })`. The layers end
     * on the thicknesses the window's pass gives. The window's pass keeps each
     * layer at `minThickness` or above, and sqp keeps each layer inside the
     * MNT row; without that row refine keeps layers at 1 nm or above.
     *
     * @param [options]
     * @param [options.minThickness=5] The thinnest layer kept, nm: a layer below it is taken out. 0 takes none out.
     * @param [options.merge=true] `true` merges adjacent layers of one material.
     * @param [options.back=true] `true` cleans the back too, also on a design scored on its front alone, whose back the layer edits refuse to change; `false` cleans the front alone, also on a design coated on the back alone.
     * @returns A CleanReport.
     * @throws an option clean does not take, a minThickness that is not a number of 0 or more, a merge or back other than `true` or `false`, or a design with no layers
     * @example
     * const design = tf.newDesign('Stack with a thin layer');
     * design.stack('(HL)^2 0.03H L');
     * const report = design.clean({ minThickness: 5 });
     * for (const op of report.operations) console.log(op.kind, op.side, 'layer', op.number, op.material, op.thickness);
     * console.log(design.layers.length, 'layers now');
     */
    clean(options) {
        const { minThickness, merge, back } = checkOptions('clean', options, ['minThickness', 'merge', 'back']);
        const cleaned = worded({ method: 'clean', call: 'cleanDesign', names: CLEAN_NAMES },
            () => api.cleanDesign(this._data, defined({ minThickness, mergeAdjacent: merge, cleanBack: back })));
        this._data = cleaned.design;
        return new CleanReport(cleaned);
    }

    /**
     * R, T and A over a range of wavelengths, for unpolarized light and for s
     * and p, as the Optical Evaluation window computes them. What it is
     * computed on follows the design's `sides` and `scoreOn`, and the
     * spectrum's `mode` says which it was. A design under a cone of incidence
     * is averaged over its cone.
     *
     * @param start The first wavelength, nm.
     * @param end The last wavelength, nm, above `start`.
     * @param [options]
     * @param [options.step=1] The wavelength step, nm.
     * @param [options.angles=[0]] The angles of incidence, degrees in the incident medium, each from 0 up to but not including 90.
     * @returns A Spectrum.
     * @throws a range that is not one, an angle outside 0 to 90, a design that names a material that resolves to nothing, or more than a million points (wavelengths times angles): take a larger step or fewer angles
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 800, { step: 1, angles: [0, 45] });
     * console.log(s.mode, Math.max(...s.R), Math.min(...s.angle(45).Tp));
     */
    spectrum(start, end, options) {
        const { step = 1, angles = [0] } = checkOptions('spectrum', options, ['step', 'angles']);
        const answer = worded({ method: 'spectrum', call: 'spectrum' }, () => api.spectrum(this._data, { from: start, to: end, step, angles }));
        const asked = [...angles];
        return new Spectrum(answer.evalMode, answer.lambda, asked, asked.map(angle => answer.angles[angle]), answer.outOfRange);
    }

    /**
     * Refines the layer thicknesses against the merit function, as the
     * Refinement window does; no layer is added or taken out. The design then
     * holds the refined layers, or, when the run is stopped, the layers it
     * had. The layers it moves follow the design's `sides`.
     *
     * @param [options]
     * @param [options.method='dls'] The method: an id from the API Reference's table of refine methods, such as `'dls'`, `'cg'` or `'de'`; `'all'` for each of them in turn; or a list of ids tried one by one from the same start, keeping the best. The Refinement window opens with `'sqp'` until you pick another method in it.
     * @param [options.maxIter] The iterations a one-method run may take. Without it, the method's own.
     * @param [options.nRestarts] The restarts of a multi-start method.
     * @param [options.perturbPct] How far a multi-start method moves each thickness at a restart, %.
     * @param [options.seed] The number the random draws of a method that makes them start from, a whole number from 1 to 2^32 - 1; the same seed, design and settings repeat the run. Without it, a fresh one, which the result reports.
     * @param [options.threads=1] The workers multi-start and parallel differential evolution use at once.
     * @param [options.progress] A function called with a Progress each time the run reports. An error it throws ends the run, which then rejects with it, the design as it was.
     * @param [options.stop] An AbortSignal; aborting its AbortController ends the run, which then leaves the design as it was.
     * @returns A promise of a RunResult.
     * @throws a design with no merit function, a method or setting the run does not know, or a value it cannot take
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const run = await design.refine({ method: 'dls', maxIter: 50, progress: p => console.log(p.iteration, p.merit) });
     * console.log(run.merit, run.stopReason);
     */
    async refine(options) {
        const { method = 'dls', progress, stop, ...settings } = optionsOf('refine', options);
        const control = hooksFor(progress, stop, () => api.runHooks('refine'));
        return this._run('refine', api.refine, { ...settings, method }, control);
    }

    /**
     * Grows or restructures the design against its merit function with a
     * synthesis method, inserting materials from a pool, as the method's
     * window does. The design then holds the run's answer, or, when the run is
     * stopped, the layers it had. Each method's settings, with their
     * defaults, are in the API Reference under synthesize; a setting left out
     * takes its default.
     *
     * @param method `'needle'`, `'ge'` (Gradual Evolution) or `'structural'`.
     * @param pool The materials the run may insert, by id, none twice.
     * @param [options]
     * @param [options.maxLayers] The most layers the design may grow to.
     * @param [options.targetMF] The merit at which the run stops.
     * @param [options.refineIter] The refinement steps after each insertion.
     * @param [options.threads] How many candidates are refined as one batch; the answer depends on it.
     * @param [options.seed] Structural: the number its random draws start from.
     * @param [options.dMin] Any other setting of the method, such as `dMin`.
     * @param [options.progress] A function called with a Progress each time the run reports. An error it throws ends the run, which then rejects with it, the design as it was.
     * @param [options.stop] An AbortSignal; aborting its AbortController ends the run, which then leaves the design as it was.
     * @returns A promise of a RunResult.
     * @throws a design with no merit function, a method or setting the run does not know, a value it cannot take, or a pool material id that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.layers.append('SiO2', 100);
     * design.merit.add('RAV', 420, 680, { target: 0 });
     * const run = await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 12 });
     * console.log(run.stopReason, design.layers.length, 'layers, merit', run.merit);
     */
    async synthesize(method, pool, options) {
        const { progress, stop, ...settings } = optionsOf('synthesize', options);
        const control = hooksFor(progress, stop, () => api.runHooks(method));
        return this._run('synthesize', api.synthesize, { method, pool, settings }, control);
    }

    /**
     * Monte Carlo trials of the design with random layer errors, as the Monte
     * Carlo window runs them: the spread of one quantity over a range of
     * wavelengths, computed on what the design's `sides` and `scoreOn` say.
     * With the design's specification, the share of trials that meet it is
     * counted too. The design is not changed.
     *
     * @param start The first wavelength, nm.
     * @param end The last wavelength, nm, above `start`.
     * @param [options]
     * @param [options.runs=100] How many trials.
     * @param [options.step=1] The wavelength step, nm.
     * @param [options.quantity='R'] `'R'`, `'T'` or `'A'`.
     * @param [options.angle=0] The angle of incidence, degrees in the incident medium.
     * @param [options.polarization='avg'] `'avg'`, `'s'` or `'p'`.
     * @param [options.thicknessRelPct=1] The thickness error, % of each layer.
     * @param [options.thicknessAbsNm=0] A thickness error in nm added to every layer's.
     * @param [options.indexRe=0] The error on n, an absolute amount: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`.
     * @param [options.indexIm=0] The error on k, an amount as `indexRe` is on n; k does not go below 0.
     * @param [options.distribution='gaussian'] `'gaussian'`, `'uniform'` or `'truncated'` (a bound at three standard deviations).
     * @param [options.seed] The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and settings repeat the run. Without it, a fresh one, which the result reports.
     * @param [options.progress] A function called with a Progress (`trial` and `total`) as the trials go. An error it throws ends the run, which then rejects with it.
     * @param [options.stop] An AbortSignal; aborting its AbortController ends the run, which then answers with the trials it made.
     * @returns A promise of a MonteCarlo.
     * @throws a design with no layer the trials can change on the side it is scored on, a setting it does not take, a value outside its range, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * const mc = await design.monteCarlo(400, 700, { runs: 50, step: 5, thicknessRelPct: 2, seed: 1 });
     * console.log('Largest spread of R:', Math.max(...mc.stdev));
     */
    async monteCarlo(start, end, options) {
        const { progress, stop, ...settings } = optionsOf('monteCarlo', options);
        const control = hooksFor(progress, stop, () => ['onProgress']);
        const mode = resolveEvalMode(this._data);
        const words = { method: 'monteCarlo', call: 'monteCarlo', hidden: ['from', 'to'], extra: ['progress', 'stop'] };
        const run = () => worded(words, () => api.monteCarlo(this._data, { ...defined(settings), from: start, to: end }, control.hooks));
        return new MonteCarlo(await ended(control, run), mode);
    }

    /**
     * How much the merit moves when each layer's thickness is off, as the
     * Layer Sensitivity window ranks the layers: each layer is made thicker
     * and thinner by a step, and the mean change of the merit is its score.
     * The merit here leaves out the MNT and MXT rows.
     *
     * @param [options]
     * @param [options.step='nm'] How the step is given: `'nm'`, `deltaNm` for every layer, or `'percent'`, `relPct` % of each layer.
     * @param [options.deltaNm=1] The step, nm, with step `'nm'`.
     * @param [options.relPct=1] The step, % of each layer, with step `'percent'`.
     * @param [options.includeLocked=false] `true` scores the locked layers too.
     * @returns A LayerSensitivity.
     * @throws a design with no merit function, a step other than `'nm'` or `'percent'`, or a value a setting cannot take
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * for (const row of design.layerSensitivity({ deltaNm: 2 }).rows) console.log(row.side, row.number, row.material, row.sensitivity);
     */
    layerSensitivity(options) {
        const { step = 'nm', ...others } = checkOptions('layerSensitivity', options, ['step', 'deltaNm', 'relPct', 'includeLocked']);
        requireValue('layerSensitivity', 'step', step, kind => Object.hasOwn(STEPS, kind), "'nm' or 'percent'");
        const ranked = worded({ method: 'layerSensitivity', call: 'layerSensitivity' },
            () => api.layerSensitivity(this._data, { ...others, mode: STEPS[step] }));
        return new LayerSensitivity(ranked, (this._data.frontLayers || []).length, resolveEvalMode(this._data));
    }

    /**
     * A copy of the design, which changes apart from it.
     *
     * @returns A Design.
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const before = design.copy();
     * await design.refine({ method: 'dls', maxIter: 20 });
     * console.log('Merit', before.merit.value, 'before,', design.merit.value, 'after');
     */
    copy() {
        // As JSON carries it, which is how a .tfs file holds a design.
        return new Design(JSON.parse(JSON.stringify(this._data)));
    }

    /**
     * Writes the design to a .tfs file as TFStudio saves it, with the
     * materials it uses that are not built in carried inside the file.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @param [options]
     * @param [options.overwrite=false] `true` writes over a file that is there.
     * @throws a file that is there, without `overwrite: true`
     * @example
     * const file = require('path').join(require('os').homedir(), `mirror-${Date.now()}.tfs`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.save(file);
     * console.log('Saved', file);
     */
    save(path, options) {
        worded({ method: 'save', call: 'saveDesign' }, () => api.saveDesign(this._data, path, options));
    }

    _setup(options) {
        this._data = worded({ call: 'setDesignSetup', names: SETUP_NAMES }, () => api.setDesignSetup(this._data, options));
    }

    // Makes the run `run` with `request` for the method `method`, and returns
    // how it ended. The design then holds the run's answer, unless the run was
    // stopped or the progress function threw, which leave it as it was.
    async _run(method, run, request, control) {
        const mode = resolveEvalMode(this._data);
        const answer = await ended(control, () => worded({ method, call: method, extra: ['progress', 'stop'] }, () => run(this._data, request, control.hooks)));
        if (answer.result.stopReason !== 'stopped') this._data = answer.design;
        return new RunResult(answer.result, mode);
    }

    // What console.log prints for a design.
    [inspect.custom]() {
        return `<Design '${this.name}' on ${this.substrate.material}: ${this.layers.length} front layers, ${this.backLayers.length} back layers, sides ${this.sides}>`;
    }
}

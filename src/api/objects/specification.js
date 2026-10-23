// A design's specification: its checks, the verdict on them, and the yield of
// Monte Carlo trials against them.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { shown } from '../check.js';
import { SIDE_KINDS } from '../../utils/synthesis/qualifiers.js';
import { ended, hooksFor } from './hooks.js';
import { defined, optionsOf, trailingOptions } from './options.js';
import { worded } from './refusals.js';
import { SpecReport, Yield } from './results.js';

// How add() words what setSpecification refuses of the one check it is
// given: the check's wavelengths are its start and end, which with its kind
// are its arguments, and the id is the one every check added gets.
const ADD_WORDS = {
    method: 'add', call: 'setSpecification: check 0', names: { lambda: 'start', lambdaStart: 'start', lambdaEnd: 'end' },
    hidden: ['kind', 'lambda', 'lambdaStart', 'lambdaEnd', 'id'],
};
const YIELD_WORDS = { method: 'estimateYield', call: 'estimateYield', hidden: ['runs'], extra: ['progress', 'stop'] };

// The kinds checked at one wavelength, and those that read none: a thickness
// budget, a layer count, and a peak-to-peak error, read at the wavelengths of
// its measured curve. The others read a band.
const AT_ONE_WAVELENGTH = ['T_AT', 'R_AT', 'A_AT'];
const NO_WAVELENGTH = [...SIDE_KINDS, 'PPEF'];

// The fields of a check of `kind` that add()'s start and end give, refusing
// one the kind does not read.
function wavelengthsOf(kind, start, end) {
    if (AT_ONE_WAVELENGTH.includes(kind)) {
        if (end !== undefined) throw new Error(`add: ${kind} is checked at one wavelength, start, and takes no end, not ${shown(end)}`);
        return { lambda: start };
    }
    if (NO_WAVELENGTH.includes(kind)) {
        if (start !== undefined || end !== undefined) {
            throw new Error(`add: ${kind} reads no wavelength, and takes no start or end, not ${shown(start !== undefined ? start : end)}`);
        }
        return {};
    }
    return { lambdaStart: start, lambdaEnd: end };
}

// Refuses an option that names a field add() takes as an argument, or the
// id, which add() gives each check it adds, so no two checks share one.
function refuseArgumentOptions(options) {
    const given = Object.keys(options ?? {});
    const argument = given.find(name => ['kind', 'lambda', 'lambdaStart', 'lambdaEnd'].includes(name));
    if (argument) throw new Error(`add: unknown option '${argument}'; a check's kind and wavelengths are add()'s arguments, kind, start and end`);
    if (given.includes('id')) throw new Error("add: unknown option 'id'; each check add() adds gets an id of its own");
}

/**
 * One check of a design's specification, as it was when
 * design.specification.rows was read. Each attribute holds the check's field
 * as the design holds it, null for a field it holds none of; a field the
 * check's kind does not read holds the value it was given, or the one a check
 * added in the Specification window starts with.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^5 H');
 * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
 * for (const check of design.specification.rows) console.log(check.kind, check.start, check.end, check.cmp, check.target);
 */
export class SpecCheck {
    constructor(check) {
        // As JSON carries it, as copy() copies a design.
        this._check = JSON.parse(JSON.stringify(check));
    }

    /**
     * What the check checks, such as `'R_AVG'` or `'LAYER_COUNT'`;
     * specification.add() lists the kinds.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * console.log(design.specification.rows[0].kind);
     */
    get kind() { return this._check.kind; }

    /**
     * The check's label, `''` when it has none.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { label: 'Stop band' });
     * console.log(design.specification.rows[0].label);
     */
    get label() { return this._check.label ?? null; }

    /**
     * `false` for a check left out of the verdict.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { enabled: false });
     * console.log(design.specification.rows[0].enabled);
     */
    get enabled() { return this._check.enabled ?? null; }

    /**
     * The comparison: `'ge'`, `'le'`, `'eq'` or `'between'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * console.log(design.specification.rows[0].cmp);
     */
    get cmp() { return this._check.cmp ?? null; }

    /**
     * The bound of `'ge'` and `'le'`, and the value `'eq'` holds to, in the
     * check's unit: T, R and A as fractions of 1, wavelengths, widths and
     * thicknesses in nm, a layer count as a count, PPEF in dB.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.rows[0].target);
     */
    get target() { return this._check.target ?? null; }

    /**
     * The tolerance of `'eq'`, in the check's unit.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('CENTRAL_LAMBDA', 500, 600, { cmp: 'eq', target: 550 });
     * console.log(design.specification.rows[0].tol, 'nm');
     */
    get tol() { return this._check.tol ?? null; }

    /**
     * The lowest value of `'between'`, in the check's unit.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
     * console.log(design.specification.rows[0].lo);
     */
    get lo() { return this._check.lo ?? null; }

    /**
     * The highest value of `'between'`, in the check's unit.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
     * console.log(design.specification.rows[0].hi);
     */
    get hi() { return this._check.hi ?? null; }

    /**
     * The wavelength of a check at one wavelength, T_AT, R_AT or A_AT, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
     * console.log(design.specification.rows[0].wavelength, 'nm');
     */
    get wavelength() { return this._check.lambda ?? null; }

    /**
     * The first wavelength of the band a check over a band reads, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.rows[0].start, 'nm');
     */
    get start() { return this._check.lambdaStart ?? null; }

    /**
     * The last wavelength of the band, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
     * console.log(design.specification.rows[0].end, 'nm');
     */
    get end() { return this._check.lambdaEnd ?? null; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { aoi: 45, pol: 's' });
     * console.log(design.specification.rows[0].aoi);
     */
    get aoi() { return this._check.aoi ?? null; }

    /**
     * The polarization, `'avg'`, `'s'` or `'p'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { aoi: 45, pol: 's' });
     * console.log(design.specification.rows[0].pol);
     */
    get pol() { return this._check.pol ?? null; }

    /**
     * What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read:
     * `'T'`, `'R'` or `'A'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('MIN_MAX', 520, 580, { channel: 'R', direction: 'min', cmp: 'ge', target: 0.9 });
     * console.log(design.specification.rows[0].channel);
     */
    get channel() { return this._check.channel ?? null; }

    /**
     * For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: `'max'`, the
     * highest value or a peak, or `'min'`, the lowest value or a dip.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('MIN_MAX', 520, 580, { channel: 'R', direction: 'min', cmp: 'ge', target: 0.9 });
     * console.log(design.specification.rows[0].direction);
     */
    get direction() { return this._check.direction ?? null; }

    /**
     * For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with
     * direction `'max'` that fraction of the band's highest value, with
     * `'min'` that fraction of the way from its lowest value up to 1.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('FWHM', 400, 800, { channel: 'R', level: 0.5, cmp: 'ge', target: 100 });
     * console.log(design.specification.rows[0].level);
     */
    get level() { return this._check.level ?? null; }

    /**
     * For EDGE_LAMBDA, `'left'` or `'right'`, the crossing below or above the
     * peak; null for the one below it, or the one above where there is none
     * below.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('EDGE_LAMBDA', 400, 800, { channel: 'R', edgeSide: 'right', cmp: 'ge', target: 600 });
     * console.log(design.specification.rows[0].edgeSide);
     */
    get edgeSide() { return this._check.edgeSide ?? null; }

    /**
     * The window's Step, or null for its default; specification.add() says
     * what it is on each kind.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { flag: 2 });
     * console.log(design.specification.rows[0].flag);
     */
    get flag() { return this._check.flag ?? null; }

    /**
     * For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: `'front'`,
     * `'back'` or `'both'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('THICKNESS_BUDGET', { cmp: 'le', target: 2000 });
     * console.log(design.specification.rows[0].side);
     */
    get side() { return this._check.side ?? null; }

    /**
     * For INTEGRAL, the integral preset that set its channel, band, source
     * and detector, such as `'Tvis'`, or `''` for none.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
     * console.log(design.specification.rows[0].presetKey);
     */
    get presetKey() { return this._check.presetKey ?? null; }

    /**
     * For INTEGRAL, the preset's name as the window shows it.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
     * console.log(design.specification.rows[0].presetLabel);
     */
    get presetLabel() { return this._check.presetLabel ?? null; }

    /**
     * For INTEGRAL, the source the band is weighted by, such as
     * `{ id: 'D65' }`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
     * console.log(design.specification.rows[0].source);
     */
    get source() { return this._check.source ?? null; }

    /**
     * For INTEGRAL, the detector the band is weighted by, such as
     * `{ id: 'photopic' }`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
     * console.log(design.specification.rows[0].detector);
     */
    get detector() { return this._check.detector ?? null; }

    /**
     * For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is sampled
     * at; null for the default.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('FWHM', 400, 800, { channel: 'R', bandPoints: 801, cmp: 'ge', target: 100 });
     * console.log(design.specification.rows[0].bandPoints);
     */
    get bandPoints() { return this._check.bandPoints ?? null; }

    /**
     * For PPEF, the id of the measured curve the error is taken against;
     * null on a check of another kind, such as the layer count below.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * const check = design.specification.rows[0];
     * console.log(check.kind, 'is taken against no curve:', check.curveId);
     */
    get curveId() { return this._check.curveId ?? null; }

    // What console.log prints for a check.
    [inspect.custom]() { return `<SpecCheck ${this.kind} ${this.cmp} ${this.cmp === 'between' ? `${this.lo}..${this.hi}` : this.target}>`; }
}

/**
 * A design's specification, as the Specification window holds it: pass or
 * fail checks in order, each a requirement on the design, such as R of 0.99
 * or more over a band, or no more than 30 layers. check() judges the design
 * against them as the window does, and estimateYield() counts the share of
 * Monte Carlo trials that meet them.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^5 H');
 * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
 * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
 * const report = design.specification.check();
 * console.log(report.passed, report.rows.map(row => row.margin));
 */
export class Specification {
    constructor(design) {
        this._design = design;
    }

    /**
     * Adds a check at the end of the specification, made as the
     * Specification window makes a row: a field left out takes the value a
     * row added there starts with, and a thickness budget or layer count
     * given no side adds up the side the design coats. The wavelengths
     * follow the kind: one, `start`, for a check at one wavelength, `start`
     * and `end` for a check over a band, and none for THICKNESS_BUDGET,
     * LAYER_COUNT and PPEF. An INTEGRAL check given a preset takes its band
     * from the preset, so its `start` and `end` may be left out.
     *
     * @param kind What is checked: `'T_AT'`, `'R_AT'` or `'A_AT'` at one wavelength; `'T_AVG'`, `'R_AVG'` or `'A_AVG'`, the average over a band; `'MIN_MAX'`, the lowest or highest value over a band; `'INTEGRAL'`, a weighted average such as Tvis; `'CENTRAL_LAMBDA'`, the wavelength of the band's peak or dip; `'FWHM'`, the width of the peak at `level`; `'EDGE_LAMBDA'`, where the curve crosses `level` of the peak; `'THICKNESS_BUDGET'`, the total thickness; `'LAYER_COUNT'`, the number of layers; `'PPEF'`, the peak-to-peak error against a measured curve.
     * @param [start] The wavelength of a check at one wavelength, or the first wavelength of the band, nm. Without it, 550 nm for one wavelength and 400 nm for a band.
     * @param [end] The last wavelength of the band, nm, no lower than `start`. Without it, 700 nm.
     * @param [options]
     * @param [options.cmp='ge'] The comparison: `'ge'` or `'le'` with `target`, `'eq'` within `target` plus or minus `tol`, or `'between'` from `lo` to `hi`.
     * @param [options.target=0.99] The bound, in the check's unit: T, R and A as fractions of 1, where the window shows percent; wavelengths, widths and thicknesses in nm; a layer count as a count; PPEF in dB.
     * @param [options.tol] The tolerance of `'eq'`, in the check's unit; 0 or less holds the value to the target itself. Without it, 0.01 for T, R and A, 1 nm for a centre or an edge, 2 nm for a width, 10 nm for a thickness, 0 for a layer count, 0.05 dB for PPEF.
     * @param [options.lo=0.95] The lowest value of `'between'`, in the check's unit.
     * @param [options.hi=1] The highest value of `'between'`, no lower than `lo`.
     * @param [options.aoi=0] The angle of incidence, degrees in the incident medium.
     * @param [options.pol='avg'] `'avg'`, `'s'` or `'p'`.
     * @param [options.channel='T'] What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read: `'T'`, `'R'` or `'A'`.
     * @param [options.direction='max'] For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: `'max'`, the highest value or a peak, or `'min'`, the lowest value or a dip.
     * @param [options.level=0.5] For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with direction `'max'` that fraction of the band's highest value, with `'min'` that fraction of the way from its lowest value up to 1. A level below 0.001 or above 0.999 is taken as 0.001 or 0.999.
     * @param [options.edgeSide] For EDGE_LAMBDA, `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.
     * @param [options.flag] The window's Step, null for its default: on T_AVG, R_AVG, A_AVG and INTEGRAL 1 to 4, a grid no coarser than 1, 0.1, 0.01 or 0.001 nm, the default being the design's fringe grid; on FWHM and EDGE_LAMBDA, and on MIN_MAX and CENTRAL_LAMBDA of the highest T or A or the lowest R, 2 to 4, a search at 0.1, 0.01 or 0.001 nm, the default being 1 nm. A check at one wavelength, MIN_MAX and CENTRAL_LAMBDA of the lowest T or A or the highest R, a thickness budget, a layer count and PPEF have no Step, and take null.
     * @param [options.side] For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: `'front'`, `'back'` or `'both'`. Without it, the side the design coats.
     * @param [options.presetKey=''] For INTEGRAL, one of the integral presets Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR and RNIR, which sets the channel, band, source, detector and `presetLabel` as picking it in the window does, or `''` for none.
     * @param [options.presetLabel=''] For INTEGRAL, the preset's name as the window shows it.
     * @param [options.source={ id: 'D65' }] For INTEGRAL without a preset, the source: `{ id }`, the id one of D65, D50, A, AM1.5G, E, blackbody (with `T` in K) or custom (with `table`, rows of [nm, value]).
     * @param [options.detector={ id: 'photopic' }] For INTEGRAL without a preset, the detector: `{ id }`, the id photopic, flat or custom (with `table`).
     * @param [options.bandPoints] For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is sampled at in place of the default, a whole number of 2 or more; a width or edge scan takes 11 at the least.
     * @param [options.curveId] For PPEF, the id of one of the design's measured curves.
     * @param [options.label=''] The check's label.
     * @param [options.enabled=true] `false` leaves the check out of the verdict.
     * @throws a kind this version does not evaluate, a field no check has, a value its field cannot take, a band whose end is below its start, or a `hi` below `lo`
     * @throws a wavelength the kind does not read, more than `start` and `end` before the options, or the check's kind, wavelengths or id among the options
     * @throws a preset the window does not offer, a field the check gives otherwise than its preset sets it, a PPEF check whose curve is not one of the design's measured curves, or a flag on a check with no Step
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97, aoi: 45, pol: 's' });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * console.log(design.specification.length, 'checks, the layer count on the', design.specification.rows[2].side);
     */
    add(kind, ...args) {
        const [[start, end], options] = trailingOptions('add', args, ['start', 'end']);
        refuseArgumentOptions(options);
        const check = defined({ ...options, kind, ...wavelengthsOf(kind, start, end) });
        const design = this._design;
        const [made] = worded(ADD_WORDS, () => api.setSpecification(design._data, [check])).qualifiers;
        design._data = { ...design._data, qualifiers: [...this._checks(), made] };
    }

    /**
     * Takes check `index` out; the checks after it move one up.
     *
     * @param index The check's place in the specification, from 0, as in `rows`.
     * @throws an index the specification has no check at
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * design.specification.remove(0);
     * console.log(design.specification.length, 'check:', design.specification.rows[0].kind);
     */
    remove(index) {
        const checks = this._checks();
        if (!(Number.isInteger(index) && index >= 0 && index < checks.length)) {
            throw new Error(`check ${shown(index)}: the specification has ${checks.length} checks, numbered from 0`);
        }
        this._design._data = { ...this._design._data, qualifiers: checks.filter((_, i) => i !== index) };
    }

    /**
     * Takes every check out of the specification.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * design.specification.clear();
     * console.log(design.specification.length, 'checks');
     */
    clear() {
        const design = this._design;
        design._data = api.setSpecification(design._data, []);
    }

    /**
     * The checks, in order, each a SpecCheck.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * for (const check of design.specification.rows) console.log(check.kind, check.cmp, check.target);
     */
    get rows() { return this._checks().map(check => new SpecCheck(check)); }

    /**
     * How many checks the specification has.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
     * console.log(design.specification.length, 'check');
     */
    get length() { return this._checks().length; }

    /**
     * The design as it is now judged against its specification, as the
     * Specification window judges it: each check read at its own Step, and
     * averaged over the design's cone of incidence when it has one.
     *
     * @returns A SpecReport.
     * @throws a design with no check
     * @throws a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
     * const report = design.specification.check();
     * for (const row of report.rows) console.log(row.kind, row.value, row.unit, row.passed, 'margin', row.margin);
     * console.log('Passes:', report.passed);
     */
    check() {
        return new SpecReport(worded({ method: 'check', call: 'checkSpecification' }, () => api.checkSpecification(this._design._data)));
    }

    /**
     * The share of Monte Carlo trials with random layer errors that meet the
     * specification, as the Monte Carlo window counts its yield: each trial
     * is judged by every enabled check, at the check's own Step, on what the
     * design's `sides` and `scoreOn` say. The trials draw the errors
     * design.monteCarlo() draws with the same seed and settings, so the yield
     * is its `spec`; no spread is computed. The design is not changed.
     *
     * @param runs How many trials, a whole number of 1 or more.
     * @param [options]
     * @param [options.thicknessRelPct=1] The thickness error, % of each layer.
     * @param [options.thicknessAbsNm=0] A thickness error in nm added to every layer's.
     * @param [options.indexRe=0] The error on n, an absolute amount: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`.
     * @param [options.indexIm=0] The error on k, an amount as `indexRe` is on n; k does not go below 0.
     * @param [options.distribution='gaussian'] `'gaussian'`, `'uniform'` or `'truncated'` (a bound at three standard deviations).
     * @param [options.seed] The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and settings repeat the run. Without it, a fresh one, which the result reports.
     * @param [options.progress] A function called with a Progress (`trial` and `total`) as the trials go. An error it throws ends the run, which then rejects with it.
     * @param [options.stop] An AbortSignal; aborting its AbortController ends the run, which then answers with the trials it made.
     * @returns A promise of a Yield.
     * @throws a design with no enabled check, or with no layer the trials can change on the side it is scored on
     * @throws a setting it does not take, a value outside its range, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^5 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
     * const y = await design.specification.estimateYield(100, { thicknessRelPct: 2, seed: 1 });
     * console.log('Yield', y.value, 'of', y.runs, 'trials; fails:', y.checks.map(check => check.failRate));
     */
    async estimateYield(runs, options) {
        const { progress, stop, ...settings } = optionsOf('estimateYield', options);
        if ('runs' in settings) throw new Error("estimateYield: unknown option 'runs'; the trials are estimateYield()'s first argument");
        const control = hooksFor(progress, stop, () => ['onProgress']);
        const data = this._design._data;
        const run = () => worded(YIELD_WORDS, () => api.estimateYield(data, { ...defined(settings), runs }, control.hooks));
        return new Yield(await ended(control, run));
    }

    _checks() { return this._design._data.qualifiers || []; }

    // What console.log prints for a specification.
    [inspect.custom]() { return `<Specification of ${this.length} checks>`; }
}

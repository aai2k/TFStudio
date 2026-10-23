// A design and its substrate, and the computations made on it.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { checkOptions, requireValue } from '../check.js';
import { resolveEvalMode } from '../../utils/physics/optimizer.js';
import { ended, hooksFor } from './hooks.js';
import { Layers } from './layers.js';
import { Merit } from './merit.js';
import { defined, optionsOf, trailingOptions } from './options.js';
import { worded } from './refusals.js';
import { Admittance } from './admittance.js';
import { ElectricField } from './electricField.js';
import { Color } from './color.js';
import { Integrals } from './integrals.js';
import { Ellipsometry } from './ellipsometry.js';
import { GroupDelay } from './groupDelay.js';
import { CleanReport, LayerSensitivity, MonteCarlo, RunResult } from './results.js';
import { Specification } from './specification.js';
import { Spectrum } from './spectrum.js';
import { IndexProfile, LayerThicknesses } from './stackViews.js';

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
        return new Spectrum(answer.evalMode, answer.lambda, asked, asked.map(angle => answer.angles[angle]), answer.outOfRange)._named(this.name);
    }

    /**
     * The refractive index of the layers at one wavelength, laid out by
     * depth, as the Refractive Index Profile window shows it. The sides
     * follow the design's `sides` and `scoreOn`, as a spectrum does, unless
     * `side` is given: on one side, the layers in the order light meets them
     * coming from that side's medium; on the whole part, the front, the
     * substrate and the back, as the window's Total view lays them. A layer
     * with no thickness is left out, as the window leaves it out.
     *
     * @param [options]
     * @param [options.wavelength] The wavelength n and k are read at, nm. Without it, the design's reference wavelength.
     * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
     * @returns An IndexProfile.
     * @throws an option it does not take, a wavelength of 0 or less, a side other than `'front'`, `'back'` or `'total'`, a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const profile = design.indexProfile({ wavelength: 633 });
     * for (const l of profile.layers) console.log(l.number, l.material, l.n.toFixed(4), l.start.toFixed(1), 'to', l.end.toFixed(1), 'nm');
     */
    indexProfile(options) {
        return new IndexProfile(worded({ method: 'indexProfile', call: 'indexProfile' }, () => api.indexProfile(this._data, options)));
    }

    /**
     * Each layer's physical and optical thickness, as the Layer Thicknesses
     * window lists them, with the optical ones taken at one wavelength. The
     * sides follow the design's `sides` and `scoreOn`, as a spectrum does,
     * unless `side` is given; on the whole part, the front's layers and then
     * the back's. Every layer has its row, one with no thickness too.
     *
     * @param [options]
     * @param [options.wavelength] The wavelength λ0 the optical thicknesses are taken at, nm. Without it, the design's reference wavelength.
     * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, what the design is scored on.
     * @returns A LayerThicknesses.
     * @throws an option it does not take, a wavelength of 0 or less, a side other than `'front'`, `'back'` or `'total'`, a side with no layers, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * for (const row of design.layerThicknesses({ wavelength: 600 }).rows) console.log(row.number, row.material, row.thickness.toFixed(2), 'nm, QWOT', row.qwot.toFixed(4));
     */
    layerThicknesses(options) {
        return new LayerThicknesses(worded({ method: 'layerThicknesses', call: 'layerThicknesses' }, () => api.layerThicknesses(this._data, options)));
    }

    /**
     * The physical thickness of the layers, nm. Without `side`, of the
     * sides a TT merit row sums, as the row reads it: the front of a design
     * coated on the front or symmetric, the back of one coated on the back,
     * both of one coated on both. So a symmetric design counts its front
     * once. `'total'` counts the front and the back the design holds, a
     * symmetric design's back as the mirror of its front.
     *
     * @param [options]
     * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides.
     * @returns The thickness, nm.
     * @throws an option it does not take, or a side other than `'front'`, `'back'` or `'total'`
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.sides = 'symmetric';
     * console.log(design.totalThickness(), 'nm coated,', design.totalThickness({ side: 'total' }), 'nm on both sides');
     */
    totalThickness(options) {
        return this._facts('totalThickness', options).thickness;
    }

    /**
     * The optical thickness of the layers, the sum of n times thickness at
     * the design's reference wavelength, nm, over the layers totalThickness()
     * counts with the same `side`.
     *
     * @param [options]
     * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides.
     * @returns The optical thickness, nm; null when a material of a layer counted resolves to nothing.
     * @throws an option it does not take, or a side other than `'front'`, `'back'` or `'total'`
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.opticalThickness(), 'nm, seven quarter waves of', design.reference / 4, 'nm');
     */
    opticalThickness(options) {
        return this._facts('opticalThickness', options).opticalThickness;
    }

    /**
     * How many layers of each material, over the layers totalThickness()
     * counts with the same `side`.
     *
     * @param [options]
     * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides.
     * @returns An object of counts by material id.
     * @throws an option it does not take, or a side other than `'front'`, `'back'` or `'total'`
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H', { H: 'Ta2O5', L: 'SiO2' });
     * console.log(design.layerCounts());
     */
    layerCounts(options) {
        return this._facts('layerCounts', options).layerCounts;
    }

    // The design's facts (designFacts) for the method `method`.
    _facts(method, options) {
        return worded({ method, call: 'designFacts' }, () => api.designFacts(this._data, options));
    }

    /**
     * The admittance locus of one coated side at one wavelength, for s and p,
     * as the Admittance Diagram window draws it and lists it in its table:
     * from the substrate's admittance through the admittance at the outer
     * surface of each layer to the coating's outer surface. It is computed on
     * the front, or on the back of a design coated on the back alone, unless
     * `side` is given. The design's cone of incidence is not used, as the
     * window does not use it. Complex values are `{ re, im }` in Macleod's
     * sign, the window's: an absorbing material's index is n − ik.
     *
     * @param [wavelength] The wavelength, nm. Without it, the design's reference wavelength.
     * @param [options]
     * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
     * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
     * @param [options.plane='admittance'] What the arcs are drawn in: `'admittance'`, the Y plane, or `'reflection'`, the plane of the reflection coefficient Γ.
     * @returns An Admittance.
     * @throws an option it does not take, a wavelength of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a plane other than `'admittance'` or `'reflection'`, a side with no layers, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const locus = design.admittance(550, { angle: 45 });
     * const { Y, gamma } = locus.s.boundaries.at(-1);
     * console.log(locus.mode, 'Y', Y.re.toFixed(4), Y.im.toFixed(4), 'Rs', (gamma.re ** 2 + gamma.im ** 2).toFixed(6));
     */
    admittance(...args) {
        const [[wavelength], options] = trailingOptions('admittance', args, ['wavelength']);
        const words = { method: 'admittance', call: 'admittance', hidden: ['wavelength'] };
        const given = checkOptions('admittance', options, ['angle', 'side', 'plane']);
        return new Admittance(worded(words, () => api.admittance(this._data, defined({ ...given, wavelength }))));
    }

    /**
     * The electric field through one coated side at one wavelength, for s, p
     * and unpolarized light, as the Electric Field window computes it, from
     * the medium light comes from to the substrate. It is computed on the
     * front, or on the back of a design coated on the back alone, unless
     * `side` is given. The design's cone of incidence is not used, as the
     * window does not use it. |E|² is a fraction of the incident |E|², and
     * the amplitude is in V/m for 1 W/m² incident.
     *
     * @param [wavelength] The wavelength, nm. Without it, the design's reference wavelength.
     * @param [options]
     * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
     * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
     * @param [options.pointsPerLayer=60] The samples taken across each layer, a whole number of 2 or more.
     * @param [options.depthUnit='nm'] What `depth` is in: `'nm'`, `'OT'` (n times thickness summed, nm), `'QWOT'` or `'FWOT'`.
     * @param [options.reference] The wavelength λ0, nm, the optical depth units read n at. Without it, the design's reference wavelength.
     * @returns An ElectricField.
     * @throws an option it does not take, a wavelength or reference of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a depth unit it does not have, a pointsPerLayer that is not a whole number of 2 or more, more than a million samples, a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror', { reference: 1064 });
     * design.stack('(HL)^4 H');
     * const field = design.electricField(1064, { angle: 45 });
     * const peak = field.p.e2.indexOf(Math.max(...field.p.e2));
     * console.log('peak |E|², p:', field.p.e2[peak].toFixed(4), 'at', field.z[peak].toFixed(1), 'nm');
     */
    electricField(...args) {
        const [[wavelength], options] = trailingOptions('electricField', args, ['wavelength']);
        const words = { method: 'electricField', call: 'electricField', hidden: ['wavelength'] };
        const given = checkOptions('electricField', options, ['angle', 'side', 'pointsPerLayer', 'depthUnit', 'reference']);
        return new ElectricField(worded(words, () => api.electricField(this._data, defined({ ...given, wavelength }))));
    }

    /**
     * The CIE colour of the design's reflectance or transmittance, as the
     * Color Evaluation window computes it: the tristimulus values of R or T
     * on the 380-780 nm band under one illuminant, and the colour spaces,
     * dominant wavelength, correlated colour temperature and sRGB swatch the
     * window shows. What it is computed on follows the design's `sides` and
     * `scoreOn`, as a spectrum does, unless `side` is given, and a design
     * under a cone of incidence is averaged over its cone, as the window
     * averages it. A side with no layers gives the colour of its bare surface.
     *
     * @param [options]
     * @param [options.quantity='R'] What is coloured: `'R'` or `'T'`.
     * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90.
     * @param [options.pol='avg'] The polarization: `'avg'`, unpolarized, `'s'` or `'p'`.
     * @param [options.observer=2] The CIE standard observer, by its field in degrees: `2` (CIE 1931) or `10` (CIE 1964).
     * @param [options.illuminant='D65'] The CIE illuminant: `'D65'`, `'D50'`, `'A'` or `'E'`.
     * @param [options.step=0.5] The wavelength step of the spectrum the colour is integrated on, nm.
     * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
     * @returns A Color.
     * @throws an option it does not take, a quantity, polarization, observer, illuminant or side it does not have, an angle outside 0 to 90, a step of 0 or less, more than a million wavelengths, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const c = design.color({ quantity: 'R', illuminant: 'D65' });
     * console.log(c.mode, 'x', c.x.toFixed(4), 'y', c.y.toFixed(4), 'Y', c.Y.toFixed(2), '%, dominant', c.dominant.wavelength?.toFixed(1), 'nm');
     */
    color(options) {
        return new Color(worded({ method: 'color', call: 'color' }, () => api.color(this._data, options)));
    }

    /**
     * Weighted averages of the design's T, R and A, as the Integral Values
     * window computes them: each integral is ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ over
     * its weighting's band, on the spectrum's grid. The built-in rows are the
     * window's, Tvis to RNIR; rows of your own come in `custom`. What it is
     * computed on follows the design's `sides` and `scoreOn`, as a spectrum
     * does, unless `side` is given, and a design under a cone of incidence is
     * averaged over its cone, as the window averages it. A row whose band the
     * spectrum does not span has no value: its numbers are NaN and `covered`
     * is false. A row whose weighting is 0 over the whole band has no value
     * either, though `covered` is true.
     *
     * @param [options]
     * @param [options.start=300] The first wavelength of the spectrum, nm.
     * @param [options.end=2500] The last wavelength, nm, above `start`.
     * @param [options.step=0.5] The wavelength step, nm.
     * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90.
     * @param [options.pol='avg'] The polarization: `'avg'`, unpolarized, `'s'` or `'p'`.
     * @param [options.custom=[]] Rows of your own, each `{ key, quantity, source, detector, band }`: `key` its name, which no other row has; `quantity` `'T'`, `'R'` or `'A'`; `source` `{ id }` with an id of `'D65'`, `'D50'`, `'A'`, `'AM1.5G'`, `'E'`, `'blackbody'` with `T`, its temperature in K, or `'custom'` with `table`, its `[nm, value]` rows, at least two at different wavelengths; `detector` `{ id }` with an id of `'photopic'`, `'flat'` or `'custom'` with its `table`; `band` `[start, end]` in nm, which the weighting's own range narrows. Left out: `'T'`, D65, photopic and 380-780 nm; a blackbody's T 5778 K.
     * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
     * @returns An Integrals.
     * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a polarization or side it does not have, more than a million wavelengths, a custom row with a field it does not have or cannot use, a key another row has, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * const iv = design.integrals({ custom: [{ key: 'T3000K', source: { id: 'blackbody', T: 3000 }, band: [400, 700] }] });
     * console.log('Tvis', iv.get('Tvis').value.toFixed(4), 'T3000K', iv.get('T3000K').value.toFixed(4));
     */
    integrals(options) {
        return new Integrals(worded({ method: 'integrals', call: 'integrals' }, () => api.integrals(this._data, options)));
    }

    /**
     * Ψ and Δ of one coated side against wavelength, at one angle of
     * incidence or several, as the Ellipsometry window's spectral sweep
     * computes them, from ρ = r_p / r_s = tan Ψ · exp(i Δ). It is computed on
     * the front, or on the back of a design coated on the back alone, unless
     * `side` is given; a side with no layers gives its bare surface. The
     * design's cone of incidence is not used, as the window does not use it.
     *
     * @param [start=400] The first wavelength, nm.
     * @param [end=800] The last wavelength, nm, above `start`.
     * @param [options]
     * @param [options.step=0.5] The wavelength step, nm.
     * @param [options.angles=[65]] The angles of incidence, degrees in the medium light comes from, each 0 up to but not including 90.
     * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
     * @param [options.deltaConvention='azzam'] The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that. Ψ is the same in both.
     * @returns An Ellipsometry.
     * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, more than a million points (wavelengths times angles), or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometry(400, 800, { step: 1, angles: [55, 70] });
     * console.log(e.mode, 'Psi at 55 degrees from', Math.min(...e.psi).toFixed(2), 'to', Math.max(...e.psi).toFixed(2));
     */
    ellipsometry(...args) {
        const [[start, end], options] = trailingOptions('ellipsometry', args, ['start', 'end']);
        const words = { method: 'ellipsometry', call: 'ellipsometry', hidden: ['from', 'to'] };
        const given = checkOptions('ellipsometry', options, ['step', 'angles', 'side', 'deltaConvention']);
        return new Ellipsometry(worded(words, () => api.ellipsometry(this._data, defined({ ...given, from: start, to: end }))));
    }

    /**
     * Ψ and Δ of one coated side against angle of incidence at one
     * wavelength, as the Ellipsometry window's angular sweep computes them.
     * The angles run from `start` by `step`, each rounded to 0.001 degree, to
     * `end`. It is computed on the front, or on the back of a design coated on
     * the back alone, unless `side` is given; a side with no layers gives its
     * bare surface. The design's cone of incidence is not used, as the window
     * does not use it.
     *
     * @param [wavelength] The wavelength, nm. Without it, the design's reference wavelength.
     * @param [start=45] The first angle of incidence, degrees in the medium light comes from, 0 or more.
     * @param [end=80] The last angle, degrees, above `start` and at most 89.5.
     * @param [options]
     * @param [options.step=0.5] The angle step, degrees, from 0.05 up to the span, `end` minus `start`.
     * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
     * @param [options.deltaConvention='azzam'] The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that. Ψ is the same in both.
     * @returns An Ellipsometry.
     * @throws an option it does not take, a wavelength of 0 or less, angles that are not a range from 0 to 89.5, a step below 0.05 degrees or above the span, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometryVsAngle(633, 45, 80, { step: 0.5 });
     * console.log('lowest Psi', e.psi.min().toFixed(3), 'at', e.psi.angle[e.psi.indexOf(e.psi.min())], 'degrees');
     */
    ellipsometryVsAngle(...args) {
        const [[wavelength, start, end], options] = trailingOptions('ellipsometryVsAngle', args, ['wavelength', 'start', 'end']);
        const words = { method: 'ellipsometryVsAngle', call: 'ellipsometryVsAngle', hidden: ['wavelength', 'angleStart', 'angleEnd'], names: { angleStep: 'step' } };
        const { step, ...given } = checkOptions('ellipsometryVsAngle', options, ['step', 'side', 'deltaConvention']);
        return new Ellipsometry(worded(words, () => api.ellipsometryVsAngle(this._data, defined({ ...given, wavelength, angleStart: start, angleEnd: end, angleStep: step }))));
    }

    /**
     * Phase, group delay, GDD, TOD and CDC of the design's reflected or
     * transmitted light against wavelength, as the Group Delay / GDD window
     * computes them. They are computed on the front, or on the back of a
     * design coated on the back alone, unless `side` is given; a side with no
     * layers gives its bare surface. `side: 'total'`, with `response: 'T'`
     * alone, is the whole part as Pulse Analysis computes it: the front
     * coating, one pass through the substrate and the back coating. The
     * design's cone of incidence is not used, as the window does not use it.
     *
     * GD, GDD and TOD are analytic values at each wavelength, so they do not
     * depend on the grid. The phase is unwrapped along the grid, so on a
     * uniform grid it can land 2π off across a resonance narrower than the
     * step. On the whole part the substrate's own phase, −2π n d cosθ / λ, n,
     * d and θ its index, thickness and the angle in it, is added as it is, so
     * only the coatings' phase is unwrapped. `step: 'auto'` gives the window's
     * own grid, which adds points at reflection minima and table knots, so a
     * mean over it leans toward the spikes there.
     *
     * @param [start=400] The first wavelength, nm.
     * @param [end=800] The last wavelength, nm, above `start`.
     * @param [options]
     * @param [options.step=0.5] The wavelength step, nm, or `'auto'`, the window's own grid.
     * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
     * @param [options.pol='avg'] The polarization: `'avg'`, `'s'` or `'p'`.
     * @param [options.response='R'] The light whose phase is taken: `'R'`, reflected, or `'T'`, transmitted.
     * @param [options.side] `'front'`, `'back'`, or with `response: 'T'` `'total'`, the whole part. Without it, the back of a design coated on the back alone and the front of any other.
     * @param [options.reference] A wavelength, nm: the phase is then 0 at the sample nearest it, as the window plots it; when that sample has no value, the phase stays absolute and `reference` is `null`. Without it, the phase is absolute.
     * @returns A GroupDelay.
     * @throws an option it does not take, a range that is not one, a step that is not a positive number or `'auto'`, an angle outside 0 to 90, a polarization, response or side it does not have, `'total'` with `response: 'R'`, a reference that is not a wavelength above 0, more than a million wavelengths, or a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const g = design.groupDelay(500, 600, { step: 1 });
     * console.log(g.mode, 'GDD from 520 to 580 nm:', g.gdd.min(520, 580).toFixed(3), 'to', g.gdd.max(520, 580).toFixed(3), 'fs²');
     */
    groupDelay(...args) {
        const [[start, end], options] = trailingOptions('groupDelay', args, ['start', 'end']);
        const words = { method: 'groupDelay', call: 'groupDelay', hidden: ['from', 'to'] };
        const given = checkOptions('groupDelay', options, ['step', 'angle', 'pol', 'response', 'side', 'reference']);
        return new GroupDelay(worded(words, () => api.groupDelay(this._data, defined({ ...given, from: start, to: end }))));
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

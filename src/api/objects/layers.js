// The layers of one side of a design, by their numbers in the Design Editor.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { checkOptions, shown } from '../check.js';
import { worded } from './refusals.js';

/**
 * One layer of a design, by its number on its side: 1 is next to the
 * substrate. Reading an attribute reads the design as it is then, and
 * setting one changes the design, as an edit in the Design Editor does.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const layer = design.layers[1];
 * layer.thickness += 5;
 * console.log(layer.number, layer.material, layer.thickness, layer.locked);
 */
export class Layer {
    constructor(layers, number) {
        this._layers = layers;
        this._number = number;
    }

    /**
     * The layer's number on its side, 1 next to the substrate.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * for (const layer of design.layers) console.log(layer.number, layer.material);
     */
    get number() { return this._number; }

    /**
     * The layer's side, `'front'` or `'back'`.
     *
     * @example
     * const design = tf.newDesign('Two-sided AR');
     * design.sides = 'both';
     * design.backLayers.append('MgF2', 100);
     * console.log(design.backLayers[1].side);
     */
    get side() { return this._layers._side; }

    /**
     * The layer's material, by id; set it to change the material.
     *
     * @throws a material id that resolves to nothing, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].material = 'Ta2O5';
     * console.log(design.layers[1].material);
     */
    get material() { return this._stored().material; }

    set material(material) { this._layers._set(this._number, { material }); }

    /**
     * The layer's physical thickness, nm; set it to change the thickness.
     *
     * @throws a thickness of 0 or less, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].thickness = 12.5;
     * console.log(design.layers[1].thickness, 'nm');
     */
    get thickness() { return this._stored().thickness; }

    set thickness(thickness) { this._layers._set(this._number, { thickness }); }

    /**
     * The layer's quarter-wave optical thickness, 4 n d / λ0, with n its
     * material's index at the design's reference wavelength λ0, as the
     * Design Editor's QW column shows it; null for a layer whose material
     * resolves to nothing or has n of 0 or less there, which has no quarter
     * wave. Set it to change the thickness, converted to nm as the QW column
     * converts a value typed in it. A locked layer changes too: a lock holds
     * a layer in refinement and synthesis.
     *
     * @throws a value of 0 or less, a layer with no quarter wave, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].qwot = 2;
     * console.log(design.layers[1].qwot, 'quarter waves,', design.layers[1].thickness, 'nm');
     */
    get qwot() {
        const side = this._layers._side;
        this._layers._index(this._number);
        return api.designFacts(this._layers._design._data, { side }).qwot[side][this._number - 1];
    }

    set qwot(qwot) { this._layers._set(this._number, { qwot }); }

    /**
     * `true` for a locked layer, which refinement and synthesis leave as it
     * is; set it to lock or free the layer.
     *
     * @throws a value other than `true` or `false`, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].locked = true;
     * console.log(design.layers[1].locked);
     */
    get locked() { return !!this._stored().locked; }

    set locked(locked) { this._layers._set(this._number, { locked }); }

    _stored() { return this._layers._stored()[this._layers._index(this._number)]; }

    // What console.log prints for a layer.
    [inspect.custom]() {
        return `<Layer ${this.number} on the ${this.side}: ${this.material} ${this.thickness} nm${this.locked ? ', locked' : ''}>`;
    }
}

// A key that reads as a number, as `layers[1]` gives it: the text of that
// number, NaN and Infinity included, so that layers[0], layers[-1] and
// layers[1.5] are refused as layer numbers rather than read as properties.
const isNumberKey = key => typeof key === 'string' && String(Number(key)) === key;

/**
 * Layer `number`, a Layer: 1 is next to the substrate.
 *
 * @param number The layer's number, from 1 to as many as the side has.
 * @returns A Layer.
 * @throws a number the side has no layer of
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * console.log(design.layers[1], design.layers[design.layers.length]);
 */
const BY_NUMBER = {
    get: (layers, key, proxy) => (isNumberKey(key) ? layers._layer(Number(key)) : Reflect.get(layers, key, proxy)),
    // Setting layers[n] is refused, since a layer is changed through its attributes.
    set: (layers, key, value, proxy) => {
        if (isNumberKey(key)) throw new Error(`layers[${key}] cannot be set: set its material, thickness or locked, or use insert() and remove()`);
        return Reflect.set(layers, key, value, proxy);
    },
};

/**
 * The layers of one side of a design, numbered as the Design Editor numbers
 * them: 1 is next to the substrate. `layers[n]` is layer n, `layers.length`
 * how many there are, and a for...of loop goes from layer 1 outward. The
 * methods change the design.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.layers.append('MgF2', 95);
 * for (const layer of design.layers) console.log(layer.number, layer.material, layer.thickness);
 */
export class Layers {
    constructor(design, side) {
        this._design = design;
        this._side = side;
        return new Proxy(this, BY_NUMBER);
    }

    /**
     * How many layers the side has.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.layers.length, 'layers on the front');
     */
    get length() { return this._stored().length; }

    /**
     * The layers from 1, next to the substrate, outward, each a Layer. The
     * layers are the ones the side has when the loop starts.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * for (const layer of design.layers) console.log(layer.number, layer.material, layer.thickness);
     */
    [Symbol.iterator]() {
        return Array.from({ length: this.length }, (_, i) => new Layer(this, i + 1))[Symbol.iterator]();
    }

    /**
     * Adds a layer outside the others: the new outermost layer.
     *
     * @param material The layer's material, by id.
     * @param thickness The layer's physical thickness, nm.
     * @param [options]
     * @param [options.locked=false] `true` locks the layer, so that refinement and synthesis leave it as it is.
     * @throws a material id that resolves to nothing, a thickness of 0 or less, or a side the design does not let you edit, such as the back of a symmetric design
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.layers.append('MgF2', 95);
     * console.log(design.layers.length, 'layers, the outermost', design.layers[design.layers.length].material);
     */
    append(material, thickness, options) {
        const { locked = false } = checkOptions('append', options, ['locked']);
        this._insert('append', this.length + 1, material, thickness, locked);
    }

    /**
     * Adds a layer that becomes layer `number`; the layers from that number
     * outward move one out.
     *
     * @param number The new layer's number, from 1, next to the substrate, to one more than the side has, which adds it outermost.
     * @param material The layer's material, by id.
     * @param thickness The layer's physical thickness, nm.
     * @param [options]
     * @param [options.locked=false] `true` locks the layer.
     * @throws a number outside 1 to one more than the side has, a material id that resolves to nothing, a thickness of 0 or less, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers.insert(1, 'Al2O3', 20);
     * console.log(design.layers[1].material, 'is now on the substrate');
     */
    insert(number, material, thickness, options) {
        const { locked = false } = checkOptions('insert', options, ['locked']);
        this._insert('insert', number, material, thickness, locked);
    }

    /**
     * Takes layer `number` out; the layers outside it move one in.
     *
     * @param number The layer's number, 1 next to the substrate.
     * @throws a number the side has no layer of, or a side the design does not let you edit
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers.remove(design.layers.length);
     * console.log(design.layers.length, 'layers');
     */
    remove(number) {
        this._change('remove', 'deleteLayer', { index: this._index(number) });
    }

    /**
     * Reverses the side's layer order on the substrate, as the Design
     * Editor's Invert button does: layer 1 becomes the outermost. On a
     * symmetric design the back follows the flipped front.
     *
     * @throws a side the design does not let you edit, such as the back of a symmetric design
     * @example
     * const design = tf.newDesign('Graded');
     * design.stack('H 2L M');
     * design.layers.flip();
     * console.log(design.layers[1].material, 'is now on the substrate');
     */
    flip() {
        this._change('flip', 'flipLayers', {});
    }

    _layer(number) {
        this._index(number);
        return new Layer(this, number);
    }

    _insert(method, number, material, thickness, locked) {
        this._change(method, 'insertLayer', { index: this._index(number, true), material, thickness, locked });
    }

    _set(number, changes) {
        this._change(`layer ${number}`, 'setLayer', { index: this._index(number), ...changes });
    }

    // The design changed by the API's call `call` on this side, for the
    // method `method`, whose name its refusals then begin with.
    _change(method, call, options) {
        const design = this._design;
        design._data = worded({ method, call }, () => api[call](design._data, { ...options, side: this._side }));
    }

    _stored() {
        return this._design._data[this._side === 'front' ? 'frontLayers' : 'backLayers'] || [];
    }

    // The API's index of layer `number`: the front stores its layers from the
    // outermost in, the back from the substrate out.
    _index(number, insert = false) {
        const count = this.length;
        const last = insert ? count + 1 : count;
        if (!(Number.isInteger(number) && number >= 1 && number <= last)) {
            throw new Error(`layer ${shown(number)}: the ${this._side} has ${count} layers, numbered from 1 next to the substrate`
                + `${insert ? `, and a new one can be layer ${last}` : ''}`);
        }
        return this._side === 'back' ? number - 1 : last - number;
    }

    // What console.log prints for a side's layers, from the substrate out.
    [inspect.custom]() {
        const stored = this._stored();
        const fromSubstrate = this._side === 'front' ? [...stored].reverse() : stored;
        const side = this._side[0].toUpperCase() + this._side.slice(1);
        return `<${side} layers: ${fromSubstrate.map(layer => `${layer.material} ${layer.thickness} nm`).join(', ')}>`;
    }
}

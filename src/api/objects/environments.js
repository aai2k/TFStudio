// A design's environments, by their numbers from 1: environment 1 is the
// design itself, and each later one another condition the same coating is
// used in.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { shown } from '../check.js';
import { isNumberKey } from './layers.js';
import { worded } from './refusals.js';

// The attributes that set what setEnvironment's options set, where their
// names differ.
const ATTRIBUTE_NAMES = { substrate: 'substrate.material', substrateThicknessMm: 'substrate.thickness' };

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

// `given` as a whole new map in place of `held`: each material `held` has and
// `given` leaves out is given null, which drops it. Anything but a map goes
// to the call as it is, null to drop them all and any other to be refused.
const replacing = (held, given) => (isMap(given) ? { ...Object.fromEntries(Object.keys(held).map(id => [id, null])), ...given } : given);

const counted = count => `${count} environment${count === 1 ? '' : 's'}`;

/**
 * The substrate of one environment: its material and thickness, its own or
 * environment 1's. Setting either gives the environment its own; setting it
 * to null makes the environment follow environment 1's again.
 *
 * @example
 * const design = tf.newDesign('Window AR');
 * const thick = design.environments.add({ name: 'Thick plate' });
 * thick.substrate.thickness = 6;
 * console.log(thick.substrate.material, thick.substrate.thickness, 'mm');
 */
export class EnvironmentSubstrate {
    constructor(environment) {
        this._environment = environment;
    }

    /**
     * The substrate's material in this environment, by id: its own, or
     * environment 1's. Set it to null to follow environment 1's again.
     *
     * @throws a material id that resolves to nothing, or any value on environment 1, whose substrate is the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * const sapphire = design.environments.add({ name: 'Sapphire' });
     * sapphire.substrate.material = 'Al2O3';
     * console.log(sapphire.substrate.material, 'in place of', design.substrate.material);
     */
    get material() { return this._environment._entry().substrate.material; }

    set material(material) { this._environment._set({ substrate: material }); }

    /**
     * The substrate's thickness in this environment, mm: its own, or
     * environment 1's. Set it to null to follow environment 1's again.
     *
     * @throws a thickness of 0 or less, or any value on environment 1, whose substrate is the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * const thick = design.environments.add({ name: 'Thick plate' });
     * thick.substrate.thickness = 6;
     * console.log(thick.substrate.thickness, 'mm in place of', design.substrate.thickness, 'mm');
     */
    get thickness() { return this._environment._entry().substrate.thickness; }

    set thickness(thickness) { this._environment._set({ substrateThicknessMm: thickness }); }

    // What console.log prints for an environment's substrate.
    [inspect.custom]() { return `<EnvironmentSubstrate of environment ${this._environment.number}: ${this.material} ${this.thickness} mm>`; }
}

/**
 * One environment of a design: environment 1, the design itself, or another
 * condition the same coating is used in. An environment holds what it sets
 * and follows environment 1 for the rest. Reading an attribute reads the
 * design as it is then, and setting one changes the design. It stays the
 * same environment when an earlier one is removed, and takes its new number.
 *
 * @example
 * const design = tf.newDesign('Window AR');
 * design.stack('(HL)^2');
 * const water = design.environments.add({ name: 'Under water' });
 * water.incidentMedium = 'H2O';
 * console.log(water.number, water.name, water.incidentMedium, water.follows);
 */
export class Environment {
    constructor(environments, id) {
        this._environments = environments;
        this._id = id;
        this._generation = environments._generation(id);
    }

    /**
     * The environment's number, from 1: environment 1 is the design itself.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * for (const env of design.environments) console.log(env.number, env.name);
     */
    get number() { return this._entry().number; }

    /**
     * The environment's id, which a .tfs file names it by; environment 1's
     * is `'base'`.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * console.log(design.environments[1].id, water.id);
     */
    get id() { return this._entry().id; }

    /**
     * The environment's name, or null; set it to name the environment, or to
     * null for none.
     *
     * @throws a name that is not text, or is empty, or environment 1 of a design with one environment, which holds no name until another is added
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add();
     * design.environments[1].name = 'In air';
     * water.name = 'Under water';
     * console.log(design.environments[1].name, water.name);
     */
    get name() { return this._entry().name; }

    set name(name) { this._set({ name }); }

    /**
     * `false` for an environment switched off; set it to switch the
     * environment off or on.
     *
     * @throws a value other than `true` or `false`, or environment 1 of a design with one environment, which holds no switch until another is added
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * water.enabled = false;
     * console.log(water.name, water.enabled);
     */
    get enabled() { return this._entry().enabled; }

    set enabled(enabled) { this._set({ enabled }); }

    /**
     * The medium the light comes from in this environment, by material id:
     * its own, or environment 1's. Set it to null to follow environment 1's
     * again.
     *
     * @throws a material id that resolves to nothing, or any value on environment 1, whose media are the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add({ name: 'Under water' });
     * water.incidentMedium = 'H2O';
     * console.log(water.incidentMedium, 'in place of', design.incidentMedium);
     */
    get incidentMedium() { return this._entry().incidentMedium; }

    set incidentMedium(material) { this._set({ incidentMedium: material }); }

    /**
     * The medium behind the substrate in this environment, by material id:
     * its own, or environment 1's. Set it to null to follow environment 1's
     * again.
     *
     * @throws a material id that resolves to nothing, or any value on environment 1, whose media are the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * const cemented = design.environments.add({ name: 'Cemented' });
     * cemented.exitMedium = 'BK7';
     * console.log(cemented.exitMedium, 'in place of', design.exitMedium);
     */
    get exitMedium() { return this._entry().exitMedium; }

    set exitMedium(material) { this._set({ exitMedium: material }); }

    /**
     * The environment's substrate, an EnvironmentSubstrate: its material and
     * thickness, its own or environment 1's.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * const sapphire = design.environments.add({ name: 'Sapphire', substrate: 'Al2O3' });
     * console.log(sapphire.substrate);
     */
    get substrate() { return new EnvironmentSubstrate(this); }

    /**
     * The environment's thickness factors, a map of material id to factor:
     * each layer of that material is that many times as thick in this
     * environment, as at a chamber position where the films grow thinner.
     * Reading it gives a copy; setting it replaces every factor with those
     * given, `{}` or null leaving none.
     *
     * @throws a map whose factor is not a number above 0, a material id that resolves to nothing, or any value on environment 1, whose layers are the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * design.stack('(HL)^2');
     * const edge = design.environments.add({ name: 'Dome edge' });
     * edge.thicknessFactors = { TiO2: 0.95, SiO2: 0.97 };
     * console.log(edge.thicknessFactors);
     */
    get thicknessFactors() { return this._entry().thicknessFactors; }

    set thicknessFactors(factors) { this._set({ thicknessFactors: replacing(this._entry().thicknessFactors, factors) }); }

    /**
     * The environment's material swaps, a map of material id to material id:
     * each layer of the first is made of the second in this environment.
     * Reading it gives a copy; setting it replaces every swap with those
     * given, `{}` or null leaving none.
     *
     * @throws a map whose value is not a material id, a material id that resolves to nothing, or any value on environment 1, whose layers are the design's
     * @example
     * const design = tf.newDesign('Window AR');
     * design.stack('(HL)^2');
     * const tantala = design.environments.add({ name: 'Tantala' });
     * tantala.materialSwaps = { TiO2: 'Ta2O5' };
     * console.log(tantala.materialSwaps);
     */
    get materialSwaps() { return this._entry().materialSwaps; }

    set materialSwaps(swaps) { this._set({ materialSwaps: replacing(this._entry().materialSwaps, swaps) }); }

    /**
     * What the environment takes from environment 1, by the names
     * environments.add() takes: any of `'incidentMedium'`, `'exitMedium'`,
     * `'substrate'` and `'substrateThicknessMm'`. Environment 1 follows none.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * console.log(water.follows);
     */
    get follows() { return this._entry().follows; }

    /**
     * Takes the environment out of the design, with the merit rows scored in
     * it alone and the rows that read them. The environments after it move
     * one number down.
     *
     * @throws environment 1, the design itself
     * @example
     * const design = tf.newDesign('Window AR');
     * const water = design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * water.remove();
     * console.log(design.environments.length, 'environment');
     */
    remove() {
        this._entry();
        this._environments._remove('remove', this._id);
    }

    // A removed environment's id can be given to one added later; that one is
    // another environment, which this object does not reach.
    _entry() {
        if (this._environments._generation(this._id) !== this._generation) throw this._environments._missing(this._id);
        return this._environments._entry(this._id);
    }

    _set(options) {
        this._entry();
        this._environments._set(this._id, options);
    }

    // What console.log prints for an environment.
    [inspect.custom]() {
        const env = this._entry();
        const map = (held, join) => Object.entries(held).map(([id, value]) => `${id} ${join}${value}`).join(', ');
        return [
            `<Environment ${env.number}${env.name ? ` '${env.name}'` : ''}: incident ${env.incidentMedium}, substrate ${env.substrate.material} ${env.substrate.thickness} mm, exit ${env.exitMedium}`,
            ...(Object.keys(env.thicknessFactors).length ? [`, factors ${map(env.thicknessFactors, 'x')}`] : []),
            ...(Object.keys(env.materialSwaps).length ? [`, swaps ${map(env.materialSwaps, 'to ')}`] : []),
            env.enabled ? '>' : ', switched off>',
        ].join('');
    }
}

/**
 * Environment `number`, an Environment: environment 1 is the design itself.
 *
 * @param number The environment's number, from 1 to as many as the design has.
 * @returns An Environment.
 * @throws a number the design has no environment of
 * @example
 * const design = tf.newDesign('Window AR');
 * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
 * console.log(design.environments[1], design.environments[2]);
 */
const BY_NUMBER = {
    get: (environments, key, proxy) => (isNumberKey(key) ? environments._environment(Number(key)) : Reflect.get(environments, key, proxy)),
    // Setting environments[n] is refused, since an environment is changed through its attributes.
    set: (environments, key, value, proxy) => {
        if (isNumberKey(key)) throw new Error(`environments[${key}] cannot be set: set its attributes, or use add() and remove()`);
        return Reflect.set(environments, key, value, proxy);
    },
};

/**
 * A design's environments, numbered from 1: environment 1 is the design
 * itself, with its own media and substrate, and each later one another
 * condition the same coating is used in, such as another substrate, the
 * coating under water, or a chamber position where the films grow thinner.
 * `environments[n]` is environment n, `environments.length` how many there
 * are, and a for...of loop goes from environment 1. A design without other
 * environments has environment 1 alone. The methods change the design.
 *
 * @example
 * const design = tf.newDesign('Window AR');
 * design.stack('(HL)^2');
 * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
 * for (const env of design.environments) console.log(env.number, env.name, env.incidentMedium);
 */
export class Environments {
    constructor(design) {
        this._design = design;
        return new Proxy(this, BY_NUMBER);
    }

    /**
     * How many environments the design has, environment 1 among them.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * console.log(design.environments.length, 'environments');
     */
    get length() { return this._listed().length; }

    /**
     * The environments from 1, each an Environment. The environments are the
     * ones the design has when the loop starts.
     *
     * @example
     * const design = tf.newDesign('Window AR');
     * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * design.environments.add({ name: 'Sapphire', substrate: 'Al2O3' });
     * for (const env of design.environments) console.log(env.number, env.name, env.incidentMedium, env.substrate.material);
     */
    [Symbol.iterator]() {
        return this._listed().map(env => new Environment(this, env.id))[Symbol.iterator]();
    }

    /**
     * Adds an environment after the others. A medium, substrate or
     * thickness left out, or given as null, follows environment 1. A factor
     * or a swap is keyed by the material the layers name, under either form
     * of a built-in id (`'TiO2'` or `'builtin:TiO2'`).
     *
     * @param [options]
     * @param [options.name] The environment's name.
     * @param [options.enabled=true] `false` switches the environment off.
     * @param [options.incidentMedium] The medium the light comes from, by material id.
     * @param [options.exitMedium] The medium behind the substrate, by material id.
     * @param [options.substrate] The substrate material, by id.
     * @param [options.substrateThicknessMm] The substrate thickness, mm, above 0.
     * @param [options.thicknessFactors] A map of material id to factor: each layer of that material is that many times as thick, the factor above 0.
     * @param [options.materialSwaps] A map of material id to material id: each layer of the first is made of the second.
     * @returns The new Environment.
     * @throws an option it does not take, a value the option cannot take, or a material id that resolves to nothing
     * @example
     * const design = tf.newDesign('Window AR');
     * design.stack('(HL)^2');
     * const edge = design.environments.add({ name: 'Dome edge', thicknessFactors: { TiO2: 0.95 } });
     * console.log(edge.number, edge.name, edge.thicknessFactors);
     */
    add(options) {
        const design = this._design;
        design._data = worded({ method: 'add', call: 'addEnvironment' }, () => api.addEnvironment(design._data, options));
        const listed = this._listed();
        const { id } = listed[listed.length - 1];
        const added = design._environmentAdds ?? (design._environmentAdds = new Map());
        added.set(id, (added.get(id) ?? 0) + 1);
        return new Environment(this, id);
    }

    /**
     * Takes environment `number` out, with the merit rows scored in it alone
     * and the rows that read them; the environments after it move one number
     * down.
     *
     * @param number The environment's number, 2 or more: environment 1 is the design itself.
     * @throws a number the design has no environment of, or 1
     * @example
     * const design = tf.newDesign('Window AR');
     * design.environments.add({ name: 'Under water', incidentMedium: 'H2O' });
     * design.environments.add({ name: 'Sapphire', substrate: 'Al2O3' });
     * design.environments.remove(2);
     * console.log(design.environments[2].name);
     */
    remove(number) {
        this._remove('remove', this._listed()[this._index(number)].id);
    }

    _environment(number) {
        return new Environment(this, this._listed()[this._index(number)].id);
    }

    // The place of environment `number` in the list.
    _index(number) {
        if (!(Number.isInteger(number) && number >= 1 && number <= this.length)) throw this._missing(number);
        return number - 1;
    }

    // The refusal of an environment the design does not have, by its number
    // or, for an Environment whose environment was removed, its id.
    _missing(environment) {
        return new Error(`environment ${shown(environment)}: the design has ${counted(this.length)}, numbered from 1`);
    }

    // How many times this design object has added an environment under `id`:
    // an Environment made before the last of them reaches another environment.
    _generation(id) { return this._design._environmentAdds?.get(id) ?? 0; }

    _entry(id) {
        const entry = this._listed().find(env => env.id === id);
        if (!entry) throw this._missing(id);
        return entry;
    }

    _set(id, options) {
        const design = this._design;
        design._data = worded({ call: 'setEnvironment', names: ATTRIBUTE_NAMES }, () => api.setEnvironment(design._data, id, options));
    }

    _remove(method, id) {
        const design = this._design;
        design._data = worded({ method, call: 'removeEnvironment' }, () => api.removeEnvironment(design._data, id));
    }

    _listed() { return api.environments(this._design._data); }

    // What console.log prints for a design's environments.
    [inspect.custom]() {
        return `<Environments: ${this._listed().map(env => (env.name ? `${env.number} '${env.name}'` : String(env.number))).join(', ')}>`;
    }
}

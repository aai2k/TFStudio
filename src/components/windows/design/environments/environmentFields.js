/**
 * The fields of an environment that the Design Editor's Settings and the
 * Environments window show and edit, read and written the same way in both.
 *
 * A field is `{ key }` for the media, the substrate, the cone of incidence,
 * the back side and the temperature, `key` being incidentMedium,
 * substrateMaterial, substrateThickness (mm), exitMedium, cone, mfEvalMode or
 * temperatureC (°C), or `{ key, material }` for a layer material's thickness
 * factor (`factor`) or the material put in its place (`swap`). In environment
 * 1 the media, the substrate, the cone, the back side and the temperature are
 * the design's own fields, and there is no factor or swap: its layers are the
 * layer list. Another environment holds only the fields it sets; a field it
 * does not set reads as environment 1's, and its cone each part it does not
 * set.
 */
import {
    BASE_ENVIRONMENT, environmentById, environmentsOf, sameMaterial, valueFor,
} from '../../../../utils/environments/environments.js';
import { setEnvironment } from '../../../../utils/environments/environmentEdits.js';
import {
    designTemperature, materialsLackingConstants, temperatureChange,
} from '../../../../utils/environments/environmentTemperature.js';

// A field the design holds under `key`, and an environment under the same
// key; `fallback` is what the design's field reads as when it has none.
function plain(key, fallback = design => design[key]) {
    return {
        held: env => env[key],
        base: fallback,
        own: (design, value) => ({ [key]: value }),
        fields: (field, value) => ({ [key]: value }),
    };
}

const medium = key => plain(key);

// The substrate's material or its thickness, set on an environment one part
// at a time so the other part keeps following environment 1.
function substrate(part) {
    return {
        held: env => env.substrate?.[part],
        base: design => design.substrate?.[part],
        own: (design, value) => ({ substrate: { ...design.substrate, [part]: value } }),
        fields: (field, value) => ({ substrate: { [part]: value } }),
    };
}

// Each field: what an environment holds of it, the value it reads as when it
// holds nothing, the edit of the design's own field (none for a factor or a
// swap), and the fields setEnvironment takes for it.
const FIELDS = {
    incidentMedium: medium('incidentMedium'),
    exitMedium: medium('exitMedium'),
    substrateMaterial: substrate('material'),
    substrateThickness: substrate('thickness'),
    // The cone reads as environment 1's with the parts the environment sets
    // over it; an edit gives the parts it changes.
    cone: {
        held: env => env.cone,
        base: design => design.cone,
        own: (design, value) => ({ cone: { ...design.cone, ...value } }),
        fields: (field, value) => ({ cone: value }),
        over: (design, held) => ({ ...design.cone, ...held }),
    },
    mfEvalMode: plain('mfEvalMode', design => design.mfEvalMode || 'side'),
    temperatureC: plain('temperatureC', designTemperature),
    factor: {
        held: (env, field) => valueFor(env.thicknessFactors, field.material),
        base: () => 1,
        fields: (field, value) => ({ thicknessFactors: { [field.material]: value } }),
    },
    swap: {
        held: (env, field) => valueFor(env.materialSwaps, field.material),
        base: (design, field) => field.material,
        fields: (field, value) => ({ materialSwaps: { [field.material]: value } }),
    },
};

/** The media and substrate fields, in the order the windows show them. */
export const MEDIA_FIELDS = Object.freeze(['incidentMedium', 'substrateMaterial', 'substrateThickness', 'exitMedium']
    .map(key => Object.freeze({ key })));

/** The fields of how the coating is lit and held: the cone, the back side and the temperature. */
export const CONDITION_FIELDS = Object.freeze(['cone', 'mfEvalMode', 'temperatureC'].map(key => Object.freeze({ key })));

/**
 * Field `field` of environment `id`: `{ value, own, fixed }`, `value` being
 * what the environment computes with, `own` whether the environment sets it
 * (environment 1 sets every field it has) and `fixed` for a factor or a swap
 * of environment 1, which has neither.
 */
export function fieldValue(design, id, field) {
    const spec = FIELDS[field.key];
    if (id === BASE_ENVIRONMENT) return { value: spec.base(design, field), own: !!spec.own, fixed: !spec.own };
    const held = spec.held(environmentById(design, id), field);
    if (held == null) return { value: spec.base(design, field), own: false, fixed: false };
    return { value: spec.over ? spec.over(design, held) : held, own: true, fixed: false };
}

/**
 * The change setting field `field` of environment `id` to `value` makes, as
 * the patch updateDesign takes: in environment 1 the design's own field, in
 * another that environment's, where null gives the field back to
 * environment 1.
 */
export function fieldEdit(design, id, field, value) {
    const spec = FIELDS[field.key];
    if (id === BASE_ENVIRONMENT) return spec.own(design, value);
    return { environments: setEnvironment(design, id, spec.fields(field, value)).environments };
}

/**
 * The patch that turns `design` into `next`, a design one of the edits in
 * environmentEdits.js returned: its environments, and its merit rows and its
 * specification checks when the edit changed them. A key the edit dropped is
 * given as undefined, which a saved file and the changed-design check leave
 * out.
 */
export function environmentPatch(design, next) {
    return {
        environments: next.environments,
        ...(next.meritOperands === design.meritOperands ? {} : { meritOperands: next.meritOperands }),
        ...(next.qualifiers === design.qualifiers ? {} : { qualifiers: next.qualifiers }),
    };
}

/**
 * The materials a thickness factor or a swap can be set for: each material
 * the layers name, once whatever spelling of its id, front coating first, and
 * then any material an environment still holds a factor or a swap for that no
 * layer names now, so it can be taken out.
 */
export function layerMaterials(design) {
    const named = [...(design.frontLayers || []), ...(design.backLayers || [])].map(layer => layer.material);
    const held = environmentsOf(design).slice(1).flatMap(env => [
        ...Object.keys(env.thicknessFactors || {}), ...Object.keys(env.materialSwaps || {}),
    ]);
    const out = [];
    for (const id of [...named, ...held]) if (id && !out.some(kept => sameMaterial(kept, id))) out.push(id);
    return out;
}

/**
 * The materials environment `id` computes with at its temperature that lack
 * a constant of the temperature model, `{ id, missing }` each
 * (materialsLackingConstants): the films its layers are made of there and its
 * substrate. Null when its temperature is environment 1's, where the model
 * changes nothing.
 */
export function missingConstants(design, id) {
    const env = environmentById(design, id);
    if (id === BASE_ENVIRONMENT || temperatureChange(design, env) === 0) return null;
    const films = [...(design.frontLayers || []), ...(design.backLayers || [])]
        .map(layer => valueFor(env.materialSwaps, layer.material) ?? layer.material);
    return materialsLackingConstants(design, films, fieldValue(design, id, { key: 'substrateMaterial' }).value);
}

/**
 * What a copy of environment `id` holds: the fields it sets, switched on, and
 * its name as `copyName` marks a copy. A copy of environment 1 follows it in
 * every field.
 */
export function copiedFields(design, id, copyName) {
    // eslint-disable-next-line no-unused-vars
    const { id: _id, name, enabled, ...fields } = environmentById(design, id);
    return { ...fields, ...(name ? { name: copyName(name) } : {}) };
}

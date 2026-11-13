/**
 * The dispersion model of each material a phase value was computed with, kept
 * two ways from the same items: `models`, one English line per material as the
 * API gives them ("TiO2: Table (PCHIP)"), and `modelEntries`, the same lines
 * in parts, `{ key, material, role, parts }`, which materialModelText.js words
 * for a window. `key` is the English line, so the two never disagree.
 */

/** The English name of a material by the role it plays, when it has none. */
export const ROLE_NAMES = {
    incident: 'Incident medium',
    substrate: 'Substrate',
    layer: 'Layer',
    referenceIncident: 'Reference incident medium',
};

/**
 * The notes of `items`, each `{ material, role, response }`: the material's
 * name or id (or null), its role (incident, substrate, layer or
 * referenceIncident) and its materialOmegaResponse. One line per distinct
 * material and model.
 */
export function modelNotes(items) {
    return joinModelNotes({
        modelEntries: items.map(({ material, role, response }) => ({
            key: `${material ?? ROLE_NAMES[role]}: ${response.model}`,
            material, role, parts: response.modelParts,
        })),
    });
}

/** The notes of several values together, each line once. */
export function joinModelNotes(...notes) {
    const byKey = new Map();
    for (const note of notes) for (const entry of note?.modelEntries || []) {
        if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    }
    const modelEntries = [...byKey.values()];
    return { models: modelEntries.map(entry => entry.key), modelEntries };
}

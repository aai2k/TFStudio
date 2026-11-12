import { DEFAULT_INTEGRALS, computeIntegralValueBatch } from '../../../../utils/physics/integralValues.js';
import { composeWeighting } from '../../../../utils/physics/spectralWeightings.js';

export const INITIAL_BUILDER = {
    char: 'T',
    source: { id: 'D65', T: 5778, table: null },
    detector: { id: 'photopic', table: null },
    bandMin: 380,
    bandMax: 780,
};

export function buildIntegralDefinitions(customDefinitions) {
    const definitions = DEFAULT_INTEGRALS.map(definition => ({ ...definition, builtin: true }));
    for (const custom of customDefinitions) {
        // Named in the UI language from the integral's own name; see weightingText.
        const weighting = {
            ...composeWeighting({
                source: custom.sourceSpec,
                detector: custom.detectorSpec,
                band: custom.band,
                label: custom.label,
            }),
            labelTr: 'custom',
            labelArg: custom.label,
        };
        definitions.push({
            key: custom.key,
            label: custom.label,
            char: custom.char,
            weighting,
            builtin: false,
            _custom: custom,
        });
    }
    return definitions;
}

/**
 * The window's table for `spectrum`: the built-in integrals and then each of
 * `customDefinitions`, as makeCustomDefinition makes them, with each one's
 * result by its key. `results` is null when there is no spectrum.
 *
 * @returns {{ definitions: object[], results: object|null }}
 */
export function integralTable(spectrum, customDefinitions) {
    const definitions = buildIntegralDefinitions(customDefinitions);
    return { definitions, results: spectrum ? computeIntegralValueBatch(spectrum, definitions) : null };
}

export function highestCustomCounter(presets) {
    let highest = 0;
    for (const preset of presets) {
        const match = /^custom_(\d+)$/.exec(preset.key || '');
        if (match) highest = Math.max(highest, parseInt(match[1], 10));
    }
    return highest;
}

const kelvin = source => Math.round(source.T || 5778);

/**
 * Short name of a custom integral, such as "T·D65·V(λ)". `parts` is
 * t.integralValues.customParts; an illuminant goes by its designation. The
 * Merit Function Editor names an integral operand the same way.
 */
export function customIntegralName(char, source, detector, parts) {
    const sourceLabel = source.id === 'blackbody' ? parts.blackbody(kelvin(source))
        : (source.id === 'custom' ? parts.sourceTable : source.id);
    const detectorLabel = detector.id === 'custom' ? parts.detectorTable
        : detector.id === 'photopic' ? 'V(λ)' : parts.flat;
    return `${char}·${sourceLabel}·${detectorLabel}`;
}

// Source and detector of a custom integral in words. `words` is
// t.integralValues.customReference; a table loaded with a name of its own keeps
// it. A custom slot with no table loaded is weighted by equal energy (source) or
// flat (detector), as composeWeighting does, and is named that way.
function weightingWords(custom, words) {
    const source = custom.sourceSpec, detector = custom.detectorSpec;
    const loaded = spec => spec.table?.length > 0;
    let sourceText = source.id;
    if (source.id === 'blackbody') sourceText = words.blackbody(kelvin(source));
    else if (source.id === 'custom') sourceText = loaded(source) ? (source.label || words.sourceTable) : 'E';
    let detectorText = words.flat;
    if (detector.id === 'photopic') detectorText = words.photopic;
    else if (detector.id === 'custom' && loaded(detector)) detectorText = detector.label || words.detectorTable;
    return `${sourceText} × ${detectorText}`;
}

/** What a custom integral weights by, for its row's tooltip: source × detector on the band. */
export function customIntegralReference(custom, words) {
    return `${weightingWords(custom, words)}  ${words.band(custom.band[0], custom.band[1])}`;
}

/**
 * What a custom integral integrates, shown after its name in the table: the
 * channel, then source × detector, such as "T · D65 × Photopic V(λ)". The band
 * has a column of its own.
 */
export function customIntegralWeighting(custom, words) {
    return `${custom.char} · ${weightingWords(custom, words)}`;
}

// ── The dialog a custom integral is made and changed in ──────────────────────
//
// A draft is what the dialog holds: `key` (null for a new integral), the
// channel `char`, the `source` and `detector` specs, `bandMin` and `bandMax` in
// nm, and the name. Until the name is typed in (`named`) it is the suggested
// one and follows the channel, source and detector.

const copySpec = spec => ({ ...spec, table: spec.table ? [...spec.table] : null });

/** A draft for a new integral, starting from `builder`, the values the last one was added with. */
export function newCustomDraft(builder) {
    return {
        key: null, char: builder.char,
        source: copySpec(builder.source), detector: copySpec(builder.detector),
        bandMin: builder.bandMin, bandMax: builder.bandMax,
        name: '', named: false,
    };
}

/**
 * The name the dialog suggests: the short name, with #2, #3 added when another
 * custom integral already has it, since the integral selector and the Merit
 * Function Editor tell integrals apart by name.
 */
export function suggestedCustomName(draft, parts, customDefinitions) {
    const base = customIntegralName(draft.char, draft.source, draft.detector, parts);
    const taken = new Set(customDefinitions.filter(custom => custom.key !== draft.key).map(custom => custom.label));
    if (!taken.has(base)) return base;
    let number = 2;
    while (taken.has(`${base} #${number}`)) number++;
    return `${base} #${number}`;
}

/** The name `draft` is saved under, as typed or as suggested. */
export function draftName(draft, parts, customDefinitions) {
    return (draft.named ? draft.name : suggestedCustomName(draft, parts, customDefinitions)).trim();
}

/**
 * A draft holding everything `custom` is, for the dialog to change it. A name
 * that is the one the dialog would suggest goes on following the choices.
 */
export function customDraft(custom, parts, customDefinitions) {
    const draft = {
        key: custom.key, char: custom.char,
        source: copySpec(custom.sourceSpec), detector: copySpec(custom.detectorSpec),
        bandMin: custom.band[0], bandMax: custom.band[1],
        name: custom.label, named: true,
    };
    return { ...draft, named: custom.label !== suggestedCustomName(draft, parts, customDefinitions) };
}

/** The custom integral `draft` defines, saved under `key`. */
export function customDefinitionFrom(draft, key, parts, customDefinitions) {
    return {
        key,
        label: draftName(draft, parts, customDefinitions),
        char: draft.char,
        sourceSpec: copySpec(draft.source),
        detectorSpec: copySpec(draft.detector),
        band: [draft.bandMin, draft.bandMax],
    };
}

/** A new custom integral, the `counter`-th made, from a draft or from the builder values. */
export function makeCustomDefinition(draft, counter, parts, customDefinitions = []) {
    return customDefinitionFrom(draft, `custom_${counter}`, parts, customDefinitions);
}

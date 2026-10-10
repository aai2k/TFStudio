import { DEFAULT_INTEGRALS } from '../../../../utils/physics/integralValues.js';
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

/**
 * What a custom integral weights by, for its row's tooltip: source × detector
 * on the band. `words` is t.integralValues.customReference; a table loaded
 * with a name of its own keeps it. A custom slot with no table loaded is
 * weighted by equal energy (source) or flat (detector), as composeWeighting
 * does, and is named that way.
 */
export function customIntegralReference(custom, words) {
    const source = custom.sourceSpec, detector = custom.detectorSpec;
    const loaded = spec => spec.table?.length > 0;
    let sourceText = source.id;
    if (source.id === 'blackbody') sourceText = words.blackbody(kelvin(source));
    else if (source.id === 'custom') sourceText = loaded(source) ? (source.label || words.sourceTable) : 'E';
    let detectorText = words.flat;
    if (detector.id === 'photopic') detectorText = words.photopic;
    else if (detector.id === 'custom' && loaded(detector)) detectorText = detector.label || words.detectorTable;
    return `${sourceText} × ${detectorText}  ${words.band(custom.band[0], custom.band[1])}`;
}

export function makeCustomDefinition(builder, counter, parts) {
    const baseLabel = customIntegralName(builder.char, builder.source, builder.detector, parts);
    return {
        key: `custom_${counter}`,
        label: `${baseLabel} #${counter}`,
        char: builder.char,
        sourceSpec: {
            ...builder.source,
            table: builder.source.table ? [...builder.source.table] : null,
        },
        detectorSpec: {
            ...builder.detector,
            table: builder.detector.table ? [...builder.detector.table] : null,
        },
        band: [builder.bandMin, builder.bandMax],
    };
}

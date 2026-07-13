import { DEFAULT_INTEGRALS } from '../../../../utils/physics/integralValues.js';
import { composeWeighting } from '../../../../utils/physics/spectralWeightings.js';

export const INITIAL_PARAMS = {
    lambdaStart: 300,
    lambdaEnd: 2500,
    lambdaStep: 5,
    theta: 0,
    polarization: 'avg',
};

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
        const weighting = composeWeighting({
            source: custom.sourceSpec,
            detector: custom.detectorSpec,
            band: custom.band,
            label: custom.label + ' weight',
        });
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

export function makeCustomDefinition(builder, counter) {
    const sourceLabel = builder.source.id === 'blackbody'
        ? `BB${Math.round(builder.source.T || 5778)}K`
        : (builder.source.id === 'custom' ? 'srcTbl' : builder.source.id);
    const detectorLabel = builder.detector.id === 'custom' ? 'detTbl'
        : builder.detector.id === 'photopic' ? 'V(λ)' : 'flat';
    const baseLabel = `${builder.char}·${sourceLabel}·${detectorLabel}`;
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

export function hasLayersForMode(design, evalMode) {
    const hasFront = !!design.frontLayers?.length;
    const hasBack = !!design.backLayers?.length;
    if (evalMode === 'back') return hasBack;
    if (evalMode === 'front') return hasFront;
    return hasFront || hasBack;
}

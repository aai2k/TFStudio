/**
 * Integral Values draws the weighting curve under the spectrum, and its legend
 * entry names that weighting.
 *
 * A built-in weighting carries a locale key for its name rather than a name,
 * the way the chart title and the results table read it; a weighting imported
 * from a table carries the name it was given.
 *
 * Run: node tests/integral_weighting_legend.mjs
 */
import assert from 'node:assert/strict';
import { getLocale } from '../src/constants/locales/index.js';
import {
    BUILTIN_WEIGHTINGS, makeUserWeighting,
} from '../src/utils/physics/integralValues/builtinWeightings.js';
import { buildOverlayOption } from '../src/components/windows/analysis/integralValues/overlayFigure.js';

const colors = { text: '#cccccc', grid: '#3a3a3a', panel: '#252526' };
const lambda = Array.from({ length: 221 }, (_, index) => 300 + 10 * index);
const spectrum = { lambda, T: lambda.map(() => 0.5) };

function weightingLegend(weighting, labels) {
    const option = buildOverlayOption({ spectrum, char: 'T', weighting, colors, labels });
    const curve = option.series.find(series => series.lineStyle?.type === 'dotted');
    assert.ok(curve, 'the weighting curve is drawn');
    assert.ok(option.legend.data.some(item => (item.name ?? item) === curve.name),
        'the weighting curve is listed in the legend');
    return curve.name;
}

// Tsol, TUV and TNIR. The photopic weighting is not drawn as a curve.
for (const code of ['en', 'ru', 'zh', 'it']) {
    const labels = getLocale(code).integralValues;
    for (const id of ['solar', 'uv', 'nir']) {
        const name = weightingLegend(BUILTIN_WEIGHTINGS[id], labels);
        assert.ok(name.startsWith(labels.weightings[id]),
            `${code}: the ${id} weighting curve is named in the legend, got "${name}"`);
    }
}

{
    const labels = getLocale('en').integralValues;
    const lamp = makeUserWeighting([[400, 1], [700, 2], [1000, 1]], 'Halogen lamp');
    assert.ok(weightingLegend(lamp, labels).startsWith('Halogen lamp'),
        'an imported weighting keeps its own name');
    const unnamed = weightingLegend(makeUserWeighting([[400, 1], [700, 2], [1000, 1]]), labels);
    assert.ok(!unnamed.includes('undefined'),
        `a weighting with no name is not called "undefined", got "${unnamed}"`);
}

console.log('integral_weighting_legend passed.');

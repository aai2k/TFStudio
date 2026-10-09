/**
 * Plot Engine 3D surface: a layer picked as an axis is numbered the way the
 * Design Editor numbers it, layer 1 on the substrate.
 *
 * Front layers are stored air side first. Numbering them in storage order made
 * L2 and L4 of a four-layer design sweep the Design Editor's layers 3 and 1.
 *
 * Run: node tests/plot_engine_layer_numbers.mjs
 */
import assert from 'node:assert/strict';
import {
    buildAxisTargetOptions, makeDefaultSurfaceSpec, surfaceAxisLabel,
} from '../src/utils/physics/plotQuantities.js';
import { surfacePlotAxisLabel } from '../src/components/windows/analysis/plotEngine/charts/surfaceOption.js';
import { displayLayerNumber } from '../src/components/windows/analysis/layerSensitivity/viewModel.js';
import { getLocale } from '../src/constants/locales/index.js';

// A four-layer AR, stored air side first: MgF2 faces the air, TiO2 the substrate.
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { material: 'MgF2', thickness: 95 },
        { material: 'ZrO2', thickness: 120 },
        { material: 'SiO2', thickness: 30 },
        { material: 'TiO2', thickness: 15 },
    ],
    backLayers: [],
};
const count = design.frontLayers.length;
const labels = getLocale('en').plotEngine;

// The number a layer token carries, read from the dropdown entry for it.
const layerOptions = buildAxisTargetOptions(design, true).filter(option => option.value.startsWith('layer:'));
const numberOf = option => Number(/^L(\d+)/.exec(option.label)[1]);

for (const option of layerOptions) {
    const index = Number(option.value.slice('layer:'.length));
    assert.equal(numberOf(option), displayLayerNumber({ side: 'front', layerIndex: index }, count),
        `${option.label} must name the layer the Design Editor numbers the same`);
}
assert.equal(layerOptions[0].label, 'L1 (TiO2)', 'L1 is the layer on the substrate');
assert.deepEqual(layerOptions.map(numberOf), [1, 2, 3, 4], 'layers are listed L1 first, as in the Design Editor');

// The axis titles of a computed surface carry the same numbers.
const spec = makeDefaultSurfaceSpec(design, { xVar: 'thk:2', yVar: 'thk:0' });
assert.ok(surfaceAxisLabel(spec.xVar, design, labels).startsWith('L2 (SiO2)'),
    'the X axis title names Design Editor layer 2');
assert.ok(surfaceAxisLabel(spec.yVar, design, labels).startsWith('L4 (MgF2)'),
    'the Y axis title names Design Editor layer 4');

// The chart writes the titles and cell readouts of a layer axis itself, and
// numbers the layer the same way.
for (const [token, quantity] of [['thk:2', 'd (nm)'], ['thk:0', 'd (nm)'], ['k:3', 'k']]) {
    const index = Number(token.split(':')[1]);
    const number = displayLayerNumber({ side: 'front', layerIndex: index }, count);
    assert.equal(surfacePlotAxisLabel(token, design, labels), `L${number} ${quantity}`,
        `the chart titles ${token} with Design Editor layer ${number}`);
}

console.log('plot_engine_layer_numbers passed.');

import assert from 'node:assert/strict';
import {
    fixedLayerTrack, LAYER_TABLE, LAYER_TABLE_MIN_WIDTH, LAYER_THICKNESS_COLUMNS,
    materialLayerTrack, nextThicknessCell, shiftedThicknessUnit,
} from '../src/components/windows/design/designEditor/layerTableLayout.js';

assert.ok(LAYER_TABLE.materialMinWidth >= 80,
    'the responsive table must not collapse the material column');
assert.ok(LAYER_TABLE.gap <= 2,
    'compact layer tracks use a small, uniform inter-column gap');
assert.equal(fixedLayerTrack(LAYER_TABLE.thicknessWidth).width, LAYER_TABLE.thicknessWidth,
    'all thickness units share one track width');
assert.equal(materialLayerTrack().minWidth, LAYER_TABLE.materialMinWidth,
    'the material track has an explicit minimum width');
assert.ok(LAYER_TABLE.materialTextInset > 0,
    'the Material header accounts for the picker swatch and trigger padding');
assert.ok(LAYER_TABLE.numericTextInset > 0,
    'numeric headers and values share a visible right-edge inset');
assert.ok(LAYER_TABLE_MIN_WIDTH > 0,
    'narrower panes use horizontal overflow instead of crushing protected tracks');
assert.equal(LAYER_THICKNESS_COLUMNS.length, 4, 'all four editable thickness representations share metadata');
assert.equal(shiftedThicknessUnit('nm', -1), 'nm', 'left navigation clamps at the first column');
assert.equal(shiftedThicknessUnit('nm', 1), 'OT', 'right navigation enters optical thickness');
assert.equal(shiftedThicknessUnit('FWOT', 1), 'FWOT', 'right navigation clamps at the last column');

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.deepEqual(nextThicknessCell(rows, 'a', 'OT', 'down'), { rowId: 'b', unit: 'OT' },
    'Enter advances to the same thickness representation on the next layer');
assert.deepEqual(nextThicknessCell(rows, 'b', 'nm', 'up'), { rowId: 'a', unit: 'nm' },
    'Shift+Enter advances to the preceding layer');
assert.deepEqual(nextThicknessCell(rows, 'a', 'FWOT', 'right'), { rowId: 'b', unit: 'nm' },
    'Tab wraps from the final thickness column to the next layer');
assert.equal(nextThicknessCell(rows, 'c', 'OT', 'down'), null,
    'navigation stops cleanly at the final layer');

console.log('Layer table layout passed.');

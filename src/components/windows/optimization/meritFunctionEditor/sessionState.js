import { FILTER_CATEGORIES, defaultFilterParams } from '../../../../utils/physics/optimizer.js';
import { createWindowSession } from '../../windowSession.js';

// The selected operand row belongs to one design's merit function, so it is kept
// per design and does not follow the user to another design's table.
export const meritOperandSession = createWindowSession({
    selectedId: null,
}, { scope: 'design' });

// Preset-bar choices are about how to apply a preset, not about the design.
export const meritPresetSession = createWindowSession({
    diskSel: '',
    applyMode: 'replace',
});

const firstType = FILTER_CATEGORIES[0].types[0];

// Everything the wizard form holds. Kept across a remount so switching tabs or
// moving the window does not send the form back to its shipped values. The
// start row is not here: it follows the table's length.
export const meritWizardSession = createWindowSession({
    open: true,
    catId: FILTER_CATEGORIES[0].id,
    typeId: firstType,
    params: defaultFilterParams(firstType),
    aoi: 0,
    aoiEnd: 0,
    aoiSteps: 3,
    pol: 'avg',
    targetMode: 'continuous',
    stepNm: 1,
    constraintsEnabled: true,
    minThick: 40,
    maxThick: 1000,
    totalEnabled: false,
    maxTotal: 3000,
});

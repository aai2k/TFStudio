import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';
import { tenth } from './angles.js';

// Observer, illuminant, geometry, exposure and what the diagram draws come from
// the analysis registry, so Settings edits the same values the window opens
// with. Which diagram, results view and table columns are shown is what you are
// looking at, not what the window should open with, so they are not configured
// defaults.
//
// A range's first angle, last angle and step are kept to 0.1°, as the range is
// counted, so its fields show the angles the window computes.
export const colorEvaluationSession = createWindowSession({
    ...sessionDefaults('colorEvaluation'),
    diagram: 'xy',
    resultsView: 'table',
    tableSpace: 'xyY',
}, {
    id: 'colorEvaluation',
    savable: registryKeys('colorEvaluation'),
    normalize: state => ({
        ...state,
        angleStart: tenth(state.angleStart), angleEnd: tenth(state.angleEnd), angleStep: tenth(state.angleStep),
    }),
});

// Target editing: whether it is on, which tool is in hand, and the angle a drawn
// target is written at, 'nearest' or one of the window's angles in degrees.
// They describe how the user works rather than the coating, so they carry
// across a design change.
export const colorTargetSession = createWindowSession({
    editMode: false,
    editTool: 'draw',
    drawAoi: 'nearest',
});

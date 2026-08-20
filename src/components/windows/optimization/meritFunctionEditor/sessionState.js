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

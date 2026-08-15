import {
    isFullSystemEval, isPhaseDispersion,
} from '../../../utils/physics/optimizer.js';

export function phaseOperandScopeNotice(design, operands, text) {
    if (!isFullSystemEval(design?.surfaceMode || 'front_only', design?.mfEvalMode || 'side')
        || !(operands || []).some(op => op.enabled && isPhaseDispersion(op.type))) return null;
    const side = design?.surfaceMode === 'back_only' ? 'back' : 'front';
    if (typeof text?.totalPhaseScope === 'function') return text.totalPhaseScope(side);
    return `Total merit mode: R/T operands score the whole element. Phase, GD, GDD, and TOD operands score the ${side} coating only.`;
}

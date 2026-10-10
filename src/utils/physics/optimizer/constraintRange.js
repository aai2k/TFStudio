/**
 * The layer range of an MNT/MXT row, read on the thickness vector the
 * constraints act on (fullThicks: the front, the back, or the front followed by
 * the back in both_independent mode). Layers are numbered as the Design Editor
 * numbers them, layer 1 on the substrate. With both sides independent the back
 * layers follow the front ones, each side counted out from the substrate.
 */

import { editorLayerNumber } from '../../misc/layerNumbers.js';

// The 1-based range number of vector position `index`; `nFront` is the front
// layer count, read only in both_independent mode.
function constraintLayerNumber(surfaceMode, nFront, length, index) {
    if (surfaceMode === 'back_only') return editorLayerNumber('back', length, index);
    const front = surfaceMode === 'both_independent' ? nFront : length;
    return index < front
        ? editorLayerNumber('front', front, index)
        : front + editorLayerNumber('back', length - front, index - front);
}

// Vector positions inside the row's range [lambdaStart, lambdaEnd], in storage
// order. Empty when the range holds no layer.
export function constraintRangeIndices(op, surfaceMode, nFront, length) {
    const first = Math.round(op.lambdaStart), last = Math.round(op.lambdaEnd);
    const indices = [];
    for (let i = 0; i < length; i++) {
        const number = constraintLayerNumber(surfaceMode, nFront, length, i);
        if (number >= first && number <= last) indices.push(i);
    }
    return indices;
}

// The same positions for an evaluation context.
export function contextConstraintIndices(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    return constraintRangeIndices(op, ctx.surfaceMode, ctx.frontThicks?.length ?? 0, all.length);
}

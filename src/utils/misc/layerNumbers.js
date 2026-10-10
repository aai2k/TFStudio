/**
 * The number the Design Editor gives layer `index` of a coating of `count`
 * layers. Front layers are stored incident medium first and back layers
 * substrate first; on both sides layer 1 is the one on the substrate.
 */
export function editorLayerNumber(side, count, index) {
    return side === 'back' ? index + 1 : count - index;
}

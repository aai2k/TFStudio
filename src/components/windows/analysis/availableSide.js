/**
 * Which sides a window's Side switch offers: a face with no layers has nothing
 * to show and is greyed out, and Total (where a window has it) needs layers on
 * either face.
 */
export function offeredSides(design) {
    const front = (design?.frontLayers?.length ?? 0) > 0;
    const back = (design?.backLayers?.length ?? 0) > 0;
    return { front, back, total: front || back };
}

export function resolveAvailableSide(side, hasFront, hasBack) {
    if (side === 'front' && !hasFront && hasBack) return 'back';
    if (side === 'back' && !hasBack && hasFront) return 'front';
    return side;
}

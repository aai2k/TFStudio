export function resolveAvailableSide(side, hasFront, hasBack) {
    if (side === 'front' && !hasFront && hasBack) return 'back';
    if (side === 'back' && !hasBack && hasFront) return 'front';
    return side;
}

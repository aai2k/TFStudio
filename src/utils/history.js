export function appendDistinctSnapshot(past, snapshot, limit) {
    if (past[past.length - 1] === snapshot) return past;
    return [...past.slice(-(limit - 1)), snapshot];
}

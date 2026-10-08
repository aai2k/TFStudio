const TURN = 2 * Math.PI;
// How far past one turn a wrapped phase may still span: a value near ±π written
// to three decimals is rounded outward by up to 4.1e-4 rad at each end.
const ROUNDING_RAD = 1e-3;

function span(values) {
    let low = Infinity;
    let high = -Infinity;
    for (const value of values) {
        if (value < low) low = value;
        if (value > high) high = value;
    }
    return high - low;
}

/**
 * Phases in radians, unwrapped when they are written wrapped. A phase whose
 * values all lie within one turn is taken as wrapped, and every jump of more
 * than π between neighbours is taken out by whole turns: a wrapped phase and
 * the same phase unwrapped are one field at the samples, but an interpolation
 * through the jumps would read them as steep slopes. A phase that spans more
 * than one turn is not wrapped and comes back as given, since a smooth phase
 * sampled coarsely can change by more than π from one sample to the next.
 */
export function unwrappedPhase(values) {
    const out = values.slice();
    if (span(values) > TURN + ROUNDING_RAD) return out;
    for (let index = 1; index < out.length; index++) {
        const turns = Math.round((out[index] - out[index - 1]) / TURN);
        if (turns) out[index] -= turns * TURN;
    }
    return out;
}

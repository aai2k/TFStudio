// The object API's names for a design's settings: design.sides by the API's
// surfaceMode, and design.scoreOn and an environment's scoreOn by its
// mfEvalMode. The API Reference's table of what a design computes on is made
// from them.

export const SIDES = { front: 'front_only', back: 'back_only', both: 'both_independent', symmetric: 'symmetric' };
export const SCORE_ON = { side: 'side', 'whole part': 'total' };

/** The name `mapping` gives `value`. */
export const nameOf = (mapping, value) => Object.keys(mapping).find(name => mapping[name] === value);

/**
 * The API's value of `value`, one of the names `mapping` holds for the
 * attribute `what`.
 *
 * @throws a name `mapping` does not hold
 */
export function named(mapping, what, value) {
    if (!Object.hasOwn(mapping, value)) {
        const names = Object.keys(mapping).map(name => `'${name}'`);
        throw new Error(`${what} is ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}, not ${JSON.stringify(value)}`);
    }
    return mapping[value];
}

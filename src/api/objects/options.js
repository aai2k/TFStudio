// How the object API's methods take their arguments: required ones in order,
// then an options object, the counterpart of Python's keyword arguments.

const isOptions = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `options` (an object or nothing) after refusing anything else, for a method
 * that hands its options on to a call that checks their names.
 */
export function optionsOf(call, options) {
    if (options == null) return {};
    if (!isOptions(options)) throw new Error(`${call}: the options are an object, such as { maxIter: 100 }`);
    return options;
}

/**
 * The optional arguments `args` of a method as [given, options]: the last is
 * the options when it is an object, so the optional arguments before it may be
 * left out, as a Python call leaves them out by giving keywords. A last one of
 * undefined or null is no options, as optionsOf takes it. More of them than
 * `names` lists is refused, so a value meant as an option is not dropped.
 */
export function trailingOptions(call, args, names) {
    const last = args[args.length - 1];
    const optionsLast = args.length > 0 && (last == null || isOptions(last));
    const [given, options] = optionsLast ? [args.slice(0, -1), last ?? undefined] : [args, undefined];
    if (given.length > names.length) throw new Error(`${call}: takes ${names.join(' and ')} before its options object, not ${given.length} values`);
    return [given, options];
}

/** `values` without the entries given as undefined, so the call's own defaults apply. */
export const defined = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

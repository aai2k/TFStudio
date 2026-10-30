/**
 * The stack tmmcore's calls take, { incident, substrate, layers: [{ n, k, d }] },
 * built from the shapes the rest of TFStudio carries: an index as an [n, k]
 * pair (ñ = n + ik), a layer as { n: [n, k], d } with d in nm, and over a
 * wavelength grid one [n, k] pair per wavelength.
 */

/** A stack at one wavelength. */
export function pointStack(n0, ns, layers) {
    return {
        incident: { n: n0[0], k: n0[1] },
        substrate: { n: ns[0], k: ns[1] },
        layers: layers.map(layer => ({ n: layer.n[0], k: layer.n[1], d: layer.d })),
    };
}

// One index over a grid, from its [n, k] pair at each wavelength.
const overGrid = pairs => ({ n: pairs.map(pair => pair[0]), k: pairs.map(pair => pair[1]) });

/**
 * A stack over a wavelength grid: the incident and substrate indices per
 * wavelength, `layerNK[layer][i]` the index of a layer at wavelength i, and
 * the thicknesses in nm.
 */
export function gridStack(n0List, nsList, layerNK, thick) {
    return {
        incident: overGrid(n0List),
        substrate: overGrid(nsList),
        layers: layerNK.map((row, k) => ({ ...overGrid(row), d: thick[k] })),
    };
}

const ZERO = [0, 0];

// An index as a jet with no dispersion: phase and |r|² need nothing more, and
// jet arithmetic keeps order 0 a function of the order-0 terms only.
const constantJet = pair => [pair, ZERO, ZERO, ZERO];

/**
 * A grid stack for tmmcore's phase calls, each index a jet with no dispersion
 * at every wavelength. Phase and magnitude come out exact; GD and its higher
 * orders would leave out the materials' dispersion, so callers read neither.
 */
export function constantJetGridStack(n0List, nsList, layerNK, thick) {
    return {
        incident: { n: n0List.map(constantJet) },
        substrate: { n: nsList.map(constantJet) },
        layers: layerNK.map((row, k) => ({ n: row.map(constantJet), d: thick[k] })),
    };
}

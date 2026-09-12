/**
 * What the field plot reads on its horizontal axis.
 *
 * Depth can be read as physical distance, or as optical distance: the running
 * sum of n·d, which is what sets the phase the wave has accumulated. The two
 * differ layer by layer, so an optical axis is a piecewise-linear remap of
 * depth with a kink at every boundary, not a relabelling of the same numbers.
 *
 * The dimensionless units divide optical distance by the design's reference
 * wavelength λ₀, and n is taken at λ₀ as well. That is the same convention as
 * the Design Editor's thickness column, so a layer that reads 0.25 FWOT there
 * spans 0.25 on this axis and a peak can be traced back to a row in the layer
 * table. It also means the axis describes the stack and does not move when the
 * wavelength the field is computed at changes.
 *
 * Essential Macleod does the same: its Electric Field plot measures optical
 * distance from the medium in FWOT, and its manual fixes those "in terms of
 * full waves at the reference wavelength" (Analysis and Design Tools, Electric
 * Field). Macleod, Thin-Film Optical Filters, 5th ed., §3.1 defines the unit.
 */

export const X_UNIT_IDS = ['nm', 'OT', 'QWOT', 'FWOT'];

// `factor` turns optical distance in nm into the axis unit. `decimals` is the
// places the results table carries: a dimensionless unit spans single digits
// over a whole coating and needs more of them than a depth in nm.
const SCALES = {
    nm:   { id: 'nm',   optical: false, decimals: 1, factor: () => 1 },
    OT:   { id: 'OT',   optical: true,  decimals: 1, factor: () => 1 },
    QWOT: { id: 'QWOT', optical: true,  decimals: 4, factor: lambda0 => 4 / lambda0 },
    FWOT: { id: 'FWOT', optical: true,  decimals: 4, factor: lambda0 => 1 / lambda0 },
};

function xScaleOf(id) { return SCALES[id] || SCALES.nm; }

/** Whether a unit measures optical distance, and so is read at a λ₀. */
export function isOpticalUnit(id) { return xScaleOf(id).optical; }

/**
 * Layer boundaries in propagation order, in physical nm and in optical nm at
 * λ₀. Both start at 0, so entry i is where layer i begins and the last entry
 * is the whole stack.
 */
function boundaries(layers) {
    const physical = [0];
    const optical = [0];
    for (const layer of layers) {
        physical.push(physical[physical.length - 1] + layer.d);
        optical.push(optical[optical.length - 1] + layer.nRef * layer.d);
    }
    return { physical, optical };
}

function physicalAxis(edges) {
    return {
        id: 'nm',
        decimals: SCALES.nm.decimals,
        optical: false,
        bounds: edges,
        total: edges[edges.length - 1] || 0,
        map: depths => depths,
    };
}

/**
 * Depths to axis values, walking the layer the previous point landed in. The
 * profile arrives sorted, so the walk advances once per boundary; it steps
 * back as well, which keeps an unsorted array correct rather than fast.
 */
function opticalMapper(layers, edges, factor) {
    return depths => {
        const out = new Array(depths.length);
        let i = 0;
        for (let k = 0; k < depths.length; k++) {
            const depth = depths[k];
            while (i + 1 < layers.length && depth >= edges.physical[i + 1]) i++;
            while (i > 0 && depth < edges.physical[i]) i--;
            out[k] = (edges.optical[i] + layers[i].nRef * (depth - edges.physical[i])) * factor;
        }
        return out;
    };
}

/** Whether an optical unit can be honoured: a stack, a λ₀, and an index at it. */
function opticalUsable(scale, layers, edges, refLambda) {
    if (!scale.optical || layers.length === 0) return false;
    if (!(refLambda > 0) || !Number.isFinite(refLambda)) return false;
    return edges.optical.every(Number.isFinite);
}

/**
 * The horizontal axis for one computed profile.
 *
 * Returns the unit actually used, which falls back to physical depth when the
 * profile carries no usable λ₀ or index at it, so the axis title and the table
 * heading can never claim a unit the numbers are not in. Optical distance in
 * nanometres needs λ₀ as much as the dimensionless units do: the indices it
 * sums were taken there, and the axis title says so.
 */
export function depthScale(profileData, unitId) {
    const scale = xScaleOf(unitId);
    const layers = profileData?.validLayers || [];
    const edges = boundaries(layers);
    const refLambda = profileData?.refLambda;
    if (!opticalUsable(scale, layers, edges, refLambda)) return physicalAxis(edges.physical);

    const factor = scale.factor(refLambda);
    return {
        id: scale.id,
        decimals: scale.decimals,
        optical: true,
        bounds: edges.optical.map(value => value * factor),
        total: edges.optical[edges.optical.length - 1] * factor,
        map: opticalMapper(layers, edges, factor),
    };
}

/** Horizontal-axis title: the unit, and the λ₀ an optical unit is fixed at. */
export function xAxisTitle(scale, refLambda, tr) {
    return scale.optical
        ? tr.xAxisOptical(tr.xUnits[scale.id], refLambda)
        : tr.xAxisTitle;
}

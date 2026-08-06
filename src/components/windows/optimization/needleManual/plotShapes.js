/**
 * Layer zones for the P-function profile plot.
 *
 * The plot's x axis is stack depth, so every candidate insertion point sits
 * inside some layer. Those layers are drawn the way the E-field profile draws
 * them — each zone tinted in its material colour across the full plot height,
 * with dotted guides on the boundaries — so a candidate picked off a curve can
 * be read against the layer it lands in.
 */

// Fraction of the depth axis a zone must span to be labelled. A stack of a few
// hundred layers would otherwise draw a number per layer, none of them legible.
const MIN_LABEL_FRACTION = 0.035;

const ZONE_OPACITY = 0.13;
const HOST_ZONE_OPACITY = 0.3;

/**
 * Index of the layer the current selection would be inserted into, or -1 when
 * nothing is selected or the selection is a gap between layers.
 */
export function hostLayerIndex(selected) {
    return selected && selected.intra ? selected.layerK : -1;
}

/**
 * Zone rectangles, boundary guides and the selection marker, in draw order.
 *
 * `boundaries` carries the outer edges of the stack as well as the interfaces;
 * only the interfaces get a guide, since the edges coincide with the axis.
 * `selectionColor` marks a gap insertion, which lands on a boundary rather than
 * inside a layer and so has no zone to emphasize.
 */
export function buildZoneShapes({ bands, boundaries, selected, gridColor, selectionColor }) {
    const hostK = hostLayerIndex(selected);
    const shapes = bands.map(band => ({
        type: 'rect', x0: band.z0, x1: band.z1, yref: 'paper', y0: 0, y1: 1,
        fillcolor: band.color,
        opacity: band.k === hostK ? HOST_ZONE_OPACITY : ZONE_OPACITY,
        line: band.k === hostK ? { color: band.color, width: 1 } : { width: 0 },
        layer: 'below',
    }));
    for (const z of boundaries.slice(1, -1)) {
        shapes.push({
            type: 'line', x0: z, x1: z, yref: 'paper', y0: 0, y1: 1,
            line: { color: gridColor, width: 0.6, dash: 'dot' },
        });
    }
    if (selected && !selected.intra) {
        const zGap = boundaries[selected.pos];
        if (zGap != null) {
            shapes.push({
                type: 'line', x0: zGap, x1: zGap, yref: 'paper', y0: 0, y1: 1,
                line: { color: selectionColor, width: 2 },
            });
        }
    }
    return shapes;
}

/** Layer numbers along the bottom of the plot, one per zone wide enough to hold one. */
export function buildLayerLabels({ bands, totalZ, selected, textColor, dimColor }) {
    const span = totalZ || 1;
    const hostK = hostLayerIndex(selected);
    return bands
        .filter(band => (band.z1 - band.z0) / span >= MIN_LABEL_FRACTION)
        .map(band => ({
            x: (band.z0 + band.z1) / 2, y: 0, yref: 'paper', yanchor: 'bottom',
            text: String(band.k + 1), showarrow: false,
            font: { size: 9, color: band.k === hostK ? textColor : dimColor },
        }));
}

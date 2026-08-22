/** Renderer-neutral layer geometry for the manual-needle P-function chart. */

const MIN_LABEL_FRACTION = 0.035;
const ZONE_OPACITY = 0.13;
const HOST_ZONE_OPACITY = 0.3;

export function hostLayerIndex(selected) {
    return selected?.intra ? selected.layerK : -1;
}

export function buildZoneBands(bands, selected) {
    const host = hostLayerIndex(selected);
    return (bands || []).map(band => ({
        x0: band.z0,
        x1: band.z1,
        color: band.color,
        opacity: band.k === host ? HOST_ZONE_OPACITY : ZONE_OPACITY,
        selected: band.k === host,
    }));
}

export function buildBoundaryGuides(boundaries, selected, gridColor, selectionColor) {
    const guides = (boundaries || []).slice(1, -1).map(x => ({ x, color: gridColor, width: 0.6, dash: 'dotted' }));
    if (selected && !selected.intra) {
        const x = boundaries[selected.pos];
        if (x != null) guides.push({ x, color: selectionColor, width: 2, dash: 'solid' });
    }
    return guides;
}

export function buildLayerLabels({ bands, totalZ, selected, textColor, dimColor }) {
    const span = totalZ || 1;
    const host = hostLayerIndex(selected);
    return (bands || [])
        .filter(band => (band.z1 - band.z0) / span >= MIN_LABEL_FRACTION)
        .map(band => ({
            x: (band.z0 + band.z1) / 2,
            text: String(band.k + 1),
            color: band.k === host ? textColor : dimColor,
        }));
}

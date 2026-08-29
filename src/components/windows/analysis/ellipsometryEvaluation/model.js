import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { convertDeltaConvention } from '../../../../utils/physics/thinFilmMath.js';

/**
 * The measured Ψ/Δ this plot should draw over the calculated curves.
 *
 * Only in the spectral sweep: a measured curve runs against wavelength, and the
 * angular sweep's x axis is angle of incidence, so there is nothing to plot it
 * against. A curve is drawn on the side it was measured on, and only while the
 * axis it belongs to is on screen.
 *
 * Δ is moved from the convention its file was written in into the one the plot
 * is showing, so the measurement and the design can actually be compared. Ψ is a
 * magnitude ratio and is the same in either convention.
 */
export function measuredEllipsometryOverlays(design, view) {
    const { mode, side, showPsi, showDelta, deltaConvention } = view;
    if (mode !== 'spectral') return [];
    return (design?.measuredEllipsometry || [])
        .filter(curve => curve && curve.visible !== false && curve.x?.length
            && (curve.side || 'front') === (side || 'front')
            && (curve.quantity === 'PSI' ? showPsi : showDelta))
        .map((curve) => {
            const data = measuredCurveData(curve);
            const psi = curve.quantity === 'PSI';
            return {
                id: curve.id,
                name: curve.name,
                color: curve.color,
                aoi: curve.aoi ?? 0,
                psi,
                x: data.x,
                y: psi
                    ? data.y
                    : convertDeltaConvention(data.y, curve.deltaConvention || 'azzam', deltaConvention),
            };
        });
}

// thinFilmMath uses n + ik with nonnegative k for passive absorption.
export function nkAt(material, lambdaNm) {
    const [nr, nk] = material.getNK(lambdaNm);
    return [nr, nk];
}

// Back-side deposition order is reversed so both side lists run from the
// incident medium toward the substrate.
export function sideStack(resolveMaterial, design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
}

// The same stack sampled at one wavelength, as the point evaluators take it.
export function sideLayersAt(resolveMaterial, design, side, lambdaNm) {
    return sideStack(resolveMaterial, design, side)
        .map(layer => ({ n: nkAt(layer.material, lambdaNm), d: layer.thickness }));
}

export function sideMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium, nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

export function sideHasLayers(design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    return layers.some(layer => layer.material && layer.thickness > 0);
}

export function sideSummary(design, side) {
    const sideLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const validLayers = sideLayers.filter(layer => layer.material && layer.thickness > 0);
    return {
        validLayers,
        totalThickness: validLayers.reduce((sum, layer) => sum + layer.thickness, 0),
    };
}


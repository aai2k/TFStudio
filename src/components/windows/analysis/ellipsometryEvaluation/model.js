import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { isEllipsometricMeasuredCurve } from '../../../../utils/physics/optimizer.js';
import { convertDeltaConvention } from '../../../../utils/physics/thinFilmMath.js';

// One drawn measurement. Δ is moved from the convention it was written in into
// the one the plot is showing; Ψ is a magnitude ratio and is the same in either.
function overlay({ id, name, color, aoi, quantity, x, y, from, to }) {
    const psi = quantity === 'PSI';
    return {
        id, name, color, aoi: aoi ?? 0, psi, x,
        y: psi ? y : convertDeltaConvention(y, from || 'azzam', to),
    };
}

/**
 * The measured Ψ/Δ this plot should draw over the calculated curves.
 *
 * Only in the spectral sweep: a measured curve runs against wavelength, and the
 * angular sweep's x axis is angle of incidence, so there is nothing to plot it
 * against. A curve is drawn on the side it was measured on, and only while the
 * axis it belongs to is on screen.
 *
 * A fit target carries a snapshot of the curve it was made from and is drawn
 * from that snapshot when the curve itself is not on the plot, the way a
 * measured spectrum's target is on Optical Evaluation: a merit function loaded
 * from a preset carries the target but not the curve. While the curve is drawn
 * the target is not, or the same measurement would appear twice.
 */
export function measuredEllipsometryOverlays(design, view) {
    const { mode, side, showPsi, showDelta, deltaConvention } = view;
    if (mode !== 'spectral') return [];
    const onSide = item => (item.side || 'front') === (side || 'front');
    const onAxis = item => (item.quantity === 'PSI' ? showPsi : showDelta);
    const visible = curve => curve?.visible !== false && (curve?.x?.length ?? 0) > 0;
    const drawn = (design?.measuredEllipsometry || [])
        .filter(curve => visible(curve) && onSide(curve) && onAxis(curve));
    const drawnIds = new Set(drawn.map(curve => curve.id));
    const curves = drawn.map((curve) => {
        const data = measuredCurveData(curve);
        return overlay({
            id: curve.id, name: curve.name, color: curve.color, aoi: curve.aoi,
            quantity: curve.quantity, x: data.x, y: data.y,
            from: curve.deltaConvention, to: deltaConvention,
        });
    });
    const snapshot = op => op.enabled !== false && isEllipsometricMeasuredCurve(op)
        && (op.sampleLambdas?.length ?? 0) > 0;
    const orphaned = op => !drawnIds.has(op.curveId) && onSide(op) && onAxis(op);
    const targets = (design?.meritOperands || [])
        .filter(op => snapshot(op) && orphaned(op))
        .map(op => overlay({
            id: op.id, name: `${op.curveName || 'Measured curve'} (fit target)`, color: null,
            aoi: op.aoi, quantity: op.quantity, x: op.sampleLambdas, y: op.sampleTargets,
            from: op.deltaConvention, to: deltaConvention,
        }));
    return [...curves, ...targets];
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


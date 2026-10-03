/**
 * The design's own spectrum drawn behind a measured curve, at the curve's
 * angle and over its span, so the first thing a preview answers is whether the
 * measurement sits where the design can reach. The import preview draws it,
 * and so does the curve editor.
 */
import { computeDesignSpectrum } from '../../../../utils/io/designSpectrum.js';
import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer.js';

/**
 * The λ grid a design curve is drawn on behind a measured span: about 600
 * points, no closer than 0.1 nm, and a single point's span widened to one step.
 */
export function previewGrid(min, max) {
    const span = Math.max(0, max - min);
    const step = span > 0 ? Math.max(0.1, span / 600) : 1;
    return { lambdaStart: min, lambdaEnd: max > min ? max : min + step, lambdaStep: step };
}

/** Which series of a computed spectrum stands for a T, R or A curve at its polarization. */
export function designSeriesKey(curve) {
    if (curve.quantity === 'A') return 'A';
    return curve.pol === 's' || curve.pol === 'p' ? `${curve.quantity}${curve.pol}` : curve.quantity;
}

/**
 * The design's spectrum over a curve's visible span at its angle, as
 * { data, range, error }. `error` is 'empty' for a curve with no point in its
 * trim, 'materials' while a design material is missing, and 'evaluation' when
 * the spectrum could not be computed.
 */
export function designPreview(design, curve, missingMaterialIds) {
    if (!curve) return { data: null, range: null, error: null };
    const visible = measuredCurveData(curve);
    if (!visible.x.length) return { data: null, range: null, error: 'empty' };
    const min = visible.x[0], max = visible.x[visible.x.length - 1];
    const range = { min, max };
    if (missingMaterialIds.length) return { data: null, range, error: 'materials' };
    try {
        // Draw what the merit function scores. In whole-sample mode that is the
        // total spectrum, not the single front surface, and a measurement of a
        // coated substrate is a whole-sample measurement.
        const data = computeDesignSpectrum(design, {
            ...previewGrid(min, max),
            thetas: [curve.aoi ?? 0],
        }, resolveEvalMode(design));
        return { data, range, error: null };
    } catch (error) {
        console.error('Measured spectrum preview error:', error);
        return { data: null, range, error: 'evaluation' };
    }
}

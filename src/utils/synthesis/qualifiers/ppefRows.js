/**
 * The merit rows a PPEF qualifier stands for: a block holding every point of
 * the design's measured curve it names, as Fit… stores one, and a PPEF row
 * measured against that block. The Specification verdict evaluates them and
 * Generate MF writes them, so both read the same row.
 */

import { measuredCurveData } from '../../io/spectrumTable.js';
import { makeMeasuredCurveOperand, makeOperand } from '../../physics/optimizer.js';

/**
 * { block, row } for a PPEF qualifier, or null when the curve it names is not
 * among the design's measured spectra. `weight` is the block's: a block that
 * is there to be measured against, not fitted, carries 0.
 */
export function ppefRows(qual, design, { blockWeight = 0, rowWeight = 1 } = {}) {
    const curve = (design?.measuredCurves || []).find(item => item.id === qual.curveId);
    if (!curve) return null;
    const data = measuredCurveData(curve);
    if (!data.x.length) return null;
    const block = makeMeasuredCurveOperand({
        curveId: curve.id, curveName: curve.name || 'Measured curve', quantity: curve.quantity || 'R',
        aoi: curve.aoi ?? 0, pol: curve.pol || 'avg', sampleLambdas: data.x, sampleTargets: data.y,
        weight: blockWeight,
    });
    const row = makeOperand({ type: 'PPEF', refId: block.id, target: 0, weight: rowWeight });
    return { block, row };
}

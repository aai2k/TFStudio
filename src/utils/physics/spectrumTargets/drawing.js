/**
 * Convert a freshly drawn line into a new merit-operand's overrides. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 */

import { clampFrac } from './style.js';

// Convert a freshly drawn line into operand overrides for makeOperand().
// `curve` ∈ {R,T,A}, `pol` ∈ {avg,s,p}, `mode` ∈ {'average','continuous'}:
//   - 'average'    → band-average (TAV/RAV/AAV), a single flat level (the
//                    midpoint of the drawn line); slope is ignored.
//   - 'continuous' → per-λ target (TGT/RGT/AGT); a tilted line becomes a linear
//                    ramp (target at λStart → targetEnd at λEnd), flat stays flat.
export function operandOverridesFromDrawnLine(line, curve, pol, mode = 'average') {
    const leftIsStart = line.x0 <= line.x1;
    const lamA = Math.max(0.01, Math.min(line.x0, line.x1));
    const lamB = Math.max(0.01, Math.max(line.x0, line.x1));
    const yStart = leftIsStart ? line.y0 : line.y1;
    const yEnd   = leftIsStart ? line.y1 : line.y0;
    const fam = (curve === 'T' || curve === 'A') ? curve : 'R';

    if (mode === 'continuous') {
        const type = fam === 'T' ? 'TGT' : fam === 'A' ? 'AGT' : 'RGT';
        return {
            type, pol: pol || 'avg',
            lambdaStart: lamA, lambdaEnd: lamB,
            target: clampFrac(yStart / 100),
            targetEnd: clampFrac(yEnd / 100),
        };
    }
    const type = fam === 'T' ? 'TAV' : fam === 'A' ? 'AAV' : 'RAV';
    return {
        type, pol: pol || 'avg',
        lambdaStart: lamA, lambdaEnd: lamB,
        target: clampFrac(((yStart + yEnd) / 2) / 100),
        targetEnd: null,
    };
}

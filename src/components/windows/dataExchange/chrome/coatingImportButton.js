/**
 * The button the coating file windows import a stack with, one per side of the
 * open design it can write.
 */

import { ActionButton } from '../../analysis/chrome/controls.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer.js';

const { createElement: h } = React;

// Why importing to `side` is off, or undefined while it is on. With no design
// selected there is nothing to import into. The back of a symmetric design is
// the mirror of its front, so layers written there would not stay. A design
// coated on one side alone and scored on that side does not compute the other
// side, so layers written there would change nothing it shows; the API's
// imports refuse that side too.
function offReason(z, side, design, hasActiveDesign) {
    if (hasActiveDesign === false) return z.importNoDesign;
    if (side === 'back' && design?.surfaceMode === 'symmetric') return z.importBackSymmetric;
    const computed = resolveEvalMode(design);
    if (computed !== 'total' && computed !== side) return side === 'front' ? z.importFrontIgnored : z.importBackIgnored;
    return undefined;
}

/**
 * Import to `side`, 'front' or 'back', of the open design: off where the
 * import would write nothing the design keeps or computes, with the reason as
 * its tooltip.
 *
 *   z  the window's strings: importNoDesign, and for the side it imports to
 *      importFrontIgnored, or importBackIgnored and importBackSymmetric
 */
export function CoatingImportButton({ c, z, side, label, design, hasActiveDesign, onClick }) {
    const reason = offReason(z, side, design, hasActiveDesign);
    return h('span', { title: reason },
        h(ActionButton, { c, label, onClick, disabled: reason != null }));
}

/**
 * The band a tabulated material is fitted over.
 *
 * A table can cover far more photon energy than any one dispersion model
 * describes. Free-electron behaviour, an interband edge and the approach to
 * transparency are different physics, and no Drude-Lorentz or Sellmeier of any
 * order holds all of them at once, so a fit taken over such a table is poor
 * everywhere rather than good anywhere. The band is the user's to choose; these
 * are the two things the window needs in order to say anything useful about it.
 */

import { MINIMUM_FIT_ROWS } from './dispersionFits.js';

// Beyond this much photon energy in one band, a table is likely to hold more
// than one regime and no single model covers it. Silver from 102.5 nm to
// 9919 nm is 2 decades, 0.125 to 12.1 eV.
export const WIDE_BAND_DECADES = 1;

/**
 * Decades of photon energy a wavelength band covers. Energy is hc/λ, so the
 * span is the ratio of the band's edges either way round.
 */
export function photonEnergyDecades(rangeNm) {
    const low = Math.min(...rangeNm);
    const high = Math.max(...rangeNm);
    return low > 0 && Number.isFinite(high) ? Math.log10(high / low) : 0;
}

/** Widen a row span outward until it holds enough rows to fit. */
function widenToFittableRows(sorted, [firstIndex, lastIndex]) {
    let first = firstIndex;
    let last = lastIndex;
    while (last - first + 1 < MINIMUM_FIT_ROWS) {
        if (first > 0) first--;
        if (last - first + 1 < MINIMUM_FIT_ROWS && last < sorted.length - 1) last++;
    }
    return [first, last];
}

/**
 * The band to fit for someone designing over `workingNm`, or null when the
 * table has nothing there.
 *
 * A fit is read inside its own range and the table outside it, so a fit no
 * wider than the wavelengths being designed at costs nothing, and it is the
 * band the model has the best chance of describing. The working band is clipped
 * to the wavelengths the table actually covers, since a model extrapolated past
 * its data is worth less than the last row of the table, and widened outward
 * only where it holds too few rows to fit at all: a design at one laser line
 * still has to be fitted from something.
 *
 * @param {number[]} wavelengths  the table's wavelengths in nm, in any order
 * @param {number[]} workingNm    the band being designed over
 * @returns {number[]|null} [low, high] in nm
 */
export function anchoredFitRange(wavelengths, workingNm) {
    const sorted = [...(wavelengths || [])].filter(Number.isFinite).sort((left, right) => left - right);
    if (sorted.length < MINIMUM_FIT_ROWS) return null;
    const low = Math.max(Math.min(...workingNm), sorted[0]);
    const high = Math.min(Math.max(...workingNm), sorted[sorted.length - 1]);
    if (!(low < high)) return null;
    const first = sorted.findIndex(value => value >= low);
    const last = sorted.findLastIndex(value => value <= high);
    // A band that falls between two rows is anchored on the two it sits between.
    const [wideFirst, wideLast] = widenToFittableRows(sorted, first <= last ? [first, last] : [last, first]);
    return [Math.min(low, sorted[wideFirst]), Math.max(high, sorted[wideLast])];
}

/**
 * Savitzky-Golay smoothing: each point is replaced by the value, at that point,
 * of a polynomial fitted by least squares to it and its neighbours.
 *
 * A. Savitzky and M. J. E. Golay, Anal. Chem. 36, 1627-1639 (1964). On evenly
 * spaced points the fit reduces to fixed convolution weights, the ones tabled
 * there: five points and a quadratic give (-3, 12, 17, 12, -3)/35. Here the fit
 * is made in the points' own abscissae, so an unevenly spaced run is smoothed
 * by the same rule instead of by weights that assume a spacing it does not
 * have; on an even run the two agree. A polynomial of the fitted order or lower
 * comes through unchanged, which is what keeps a band edge's slope and a peak's
 * height where they were while the ripple on them is removed.
 *
 * Near either end the window slides inward instead of shrinking, so every
 * point is fitted from the same number of neighbours.
 *
 * Each fit is solved by Householder QR (qrLeastSquares.js) in the coordinate
 * (x - x_i)/h, h the half-width of the window, so the powers stay within ±1.
 */
import { solveLeastSquaresQR } from './qrLeastSquares.js';

/**
 * Why a run cannot be smoothed with these settings, or null when it can.
 *   'window'  the window is not an odd number of at least three points
 *   'order'   the polynomial order is not below the window
 *   'points'  the run is shorter than the window
 */
export function savitzkyGolayProblem(count, window, order) {
    if (!Number.isInteger(window) || window < 3 || window % 2 === 0) return 'window';
    if (!Number.isInteger(order) || order < 0 || order >= window) return 'order';
    return count < window ? 'points' : null;
}

function windowStart(index, count, window) {
    const half = (window - 1) / 2;
    return Math.min(Math.max(0, index - half), count - window);
}

// The fitted polynomial's value at x[index], from the points start..start+window-1.
function fittedValue({ x, y, window, order }, index, start) {
    const center = x[index];
    let halfWidth = 0;
    for (let j = start; j < start + window; j++) halfWidth = Math.max(halfWidth, Math.abs(x[j] - center));
    if (!(halfWidth > 0)) return y[index];
    const rows = [];
    const rhs = [];
    for (let j = start; j < start + window; j++) {
        const t = (x[j] - center) / halfWidth;
        const row = [1];
        for (let power = 1; power <= order; power++) row.push(row[power - 1] * t);
        rows.push(row);
        rhs.push(y[j]);
    }
    const fit = solveLeastSquaresQR(rows, rhs);
    return fit ? fit.solution[0] : y[index];
}

/**
 * The smoothed values of y over x, ascending x, as a new array. `window` is
 * the number of points each fit uses, odd; `order` the polynomial's degree.
 * Returns null when `savitzkyGolayProblem` names a reason. A window whose
 * points cannot fix a polynomial of that order, such as repeated abscissae,
 * leaves its point as it was.
 */
export function smoothSavitzkyGolay(x, y, window, order) {
    const count = Math.min(x.length, y.length);
    if (savitzkyGolayProblem(count, window, order)) return null;
    const run = { x, y, window, order };
    const smoothed = new Array(count);
    for (let index = 0; index < count; index++) {
        smoothed[index] = fittedValue(run, index, windowStart(index, count, window));
    }
    return smoothed;
}

/**
 * The convolution weights the fit applies to an evenly spaced window for its
 * centre point, found by smoothing a unit impulse at each position.
 */
export function savitzkyGolayWeights(window, order) {
    const x = Array.from({ length: window }, (_, index) => index);
    const centre = (window - 1) / 2;
    return x.map(position => {
        const impulse = x.map(index => (index === position ? 1 : 0));
        return fittedValue({ x, y: impulse, window, order }, centre, 0);
    });
}

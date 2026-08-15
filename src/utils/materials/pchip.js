/**
 * Shape-preserving interpolation for tabulated optical constants.
 *
 * Slopes follow the local monotone piecewise cubic construction from:
 * F. N. Fritsch and J. Butland, SIAM J. Sci. Stat. Comput. 5 (1984), 300-304.
 * Values are clamped to the first/last sample outside the tabulated range,
 * matching TFStudio's existing material-range policy.
 */

export const TABULATED_INTERPOLATION = 'pchip';

function sameSign(a, b) {
    return (a > 0 && b > 0) || (a < 0 && b < 0);
}

function endpointSlope(h0, h1, delta0, delta1) {
    let slope = ((2 * h0 + h1) * delta0 - h0 * delta1) / (h0 + h1);
    if (!sameSign(slope, delta0)) return 0;
    if (!sameSign(delta0, delta1) && Math.abs(slope) > 3 * Math.abs(delta0)) {
        slope = 3 * delta0;
    }
    return slope;
}

function normalizePoints(points) {
    const sorted = (points || [])
        .map(point => [Number(point?.[0]), Number(point?.[1])])
        .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .sort((a, b) => a[0] - b[0]);

    // A wavelength identifies one optical-constant value. If malformed input
    // repeats it, keep the last row instead of constructing a zero-width piece.
    const unique = [];
    for (const point of sorted) {
        if (unique.length && point[0] === unique[unique.length - 1][0]) {
            unique[unique.length - 1] = point;
        } else {
            unique.push(point);
        }
    }
    return unique;
}

/**
 * Build a clamped scalar PCHIP interpolator from [[x, y], ...].
 * Returns null when no finite points are supplied.
 */
export function createPchipInterpolator(points) {
    const data = normalizePoints(points);
    const count = data.length;
    if (count === 0) return null;

    const xs = data.map(point => point[0]);
    const ys = data.map(point => point[1]);
    if (count === 1) {
        const constant = () => ys[0];
        constant.interp = TABULATED_INTERPOLATION;
        constant.knots = xs;
        return constant;
    }

    const widths = new Array(count - 1);
    const secants = new Array(count - 1);
    for (let i = 0; i < count - 1; i++) {
        widths[i] = xs[i + 1] - xs[i];
        secants[i] = (ys[i + 1] - ys[i]) / widths[i];
    }

    const slopes = new Array(count);
    if (count === 2) {
        slopes[0] = secants[0];
        slopes[1] = secants[0];
    } else {
        slopes[0] = endpointSlope(widths[0], widths[1], secants[0], secants[1]);
        for (let i = 1; i < count - 1; i++) {
            const left = secants[i - 1];
            const right = secants[i];
            if (!sameSign(left, right)) {
                slopes[i] = 0;
                continue;
            }
            const w1 = 2 * widths[i] + widths[i - 1];
            const w2 = widths[i] + 2 * widths[i - 1];
            slopes[i] = (w1 + w2) / (w1 / left + w2 / right);
        }
        slopes[count - 1] = endpointSlope(
            widths[count - 2], widths[count - 3],
            secants[count - 2], secants[count - 3]);
    }

    // Power-basis coefficients for each local coordinate dx = x - xs[i].
    const quadratic = new Array(count - 1);
    const cubic = new Array(count - 1);
    for (let i = 0; i < count - 1; i++) {
        const h = widths[i];
        const delta = secants[i];
        quadratic[i] = (3 * delta - 2 * slopes[i] - slopes[i + 1]) / h;
        cubic[i] = (slopes[i] + slopes[i + 1] - 2 * delta) / (h * h);
    }

    const interpolate = (x) => {
        if (!Number.isFinite(x)) return NaN;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[count - 1]) return ys[count - 1];

        let lo = 0;
        let hi = count - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid;
            else hi = mid;
        }
        const dx = x - xs[lo];
        return ys[lo] + dx * (slopes[lo] + dx * (quadratic[lo] + dx * cubic[lo]));
    };
    interpolate.interp = TABULATED_INTERPOLATION;
    interpolate.knots = xs;
    return interpolate;
}

/** Build getNK(lambda_nm) from [[lambda_nm, n, k], ...]. */
export function createTabulatedNKSampler(rows) {
    const data = (rows || [])
        .map(row => {
            const k = Number(row?.[2]);
            return [Number(row?.[0]), Number(row?.[1]), Number.isFinite(k) ? k : 0];
        })
        .filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]));
    if (data.length === 0) return null;

    const nAt = createPchipInterpolator(data.map(row => [row[0], row[1]]));
    const kAt = createPchipInterpolator(data.map(row => [row[0], row[2]]));
    const getNK = lambdaNm => [nAt(lambdaNm), kAt(lambdaNm)];
    getNK.interp = TABULATED_INTERPOLATION;
    getNK.rangeNm = [nAt.knots[0], nAt.knots[nAt.knots.length - 1]];
    getNK.tabData = data;
    return getNK;
}

/** Whether a serializable material record contains a tabulated component. */
export function hasTabulatedComponent(material) {
    return material?.formulaNum === -1
        || (Array.isArray(material?.kTable) && material.kTable.length > 0);
}

/**
 * Interpolation of tabulated optical constants between their sample points.
 *
 * Two rules, chosen per material through its `interp` field:
 *   'pchip'   shape-preserving piecewise cubic, the default for a new table.
 *             Slopes follow the local monotone construction of F. N. Fritsch
 *             and J. Butland, SIAM J. Sci. Stat. Comput. 5 (1984), 300-304.
 *   'linear'  straight lines between points, which is how Essential Macleod
 *             and TFCalc evaluate a table. A material imported from either
 *             carries this rule so it reproduces the numbers computed there.
 * Both hold the first and last sample outside the tabulated range, matching
 * the material-range policy used everywhere else.
 *
 * Every interpolator exposes `interp`, `knots` and `derivativesAt(x)`, the
 * last returning the value with its first three derivatives on the piece the
 * point belongs to. An interior knot belongs to the piece on its right, so the
 * one-sided convention for a derivative that jumps there is explicit rather
 * than left to floating-point jitter.
 */

export const TABULATED_INTERPOLATION = 'pchip';
export const LINEAR_INTERPOLATION = 'linear';
export const INTERPOLATION_RULES = [TABULATED_INTERPOLATION, LINEAR_INTERPOLATION];

/** The rule a record names, or the default for one that names none. */
export function interpolationRuleOf(material) {
    return material?.interp === LINEAR_INTERPOLATION ? LINEAR_INTERPOLATION : TABULATED_INTERPOLATION;
}

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
 * The shell both rules share: the sorted knots, the search for the piece a
 * point is on, the end values held outside the table, and the convention
 * that a knot belongs to the piece on its right. `build(xs, ys)` supplies
 * the rule itself as `piece(i, dx)`, the value on piece i at offset dx from
 * its left knot, and `pieceDerivatives(i, dx)`, the first three derivatives
 * there. A single point is a constant under either rule. Returns null when
 * no finite points are supplied.
 */
function piecewiseInterpolator(points, rule, build) {
    const data = normalizePoints(points);
    const count = data.length;
    if (count === 0) return null;

    const xs = data.map(point => point[0]);
    const ys = data.map(point => point[1]);
    const { piece, pieceDerivatives } = count === 1
        ? { piece: () => ys[0], pieceDerivatives: () => [0, 0, 0] }
        : build(xs, ys);

    const segmentAt = (x) => {
        let lo = 0;
        let hi = count - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid;
            else hi = mid;
        }
        return lo;
    };

    const interpolate = (x) => {
        if (!Number.isFinite(x)) return NaN;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[count - 1]) return ys[count - 1];
        const lo = segmentAt(x);
        return piece(lo, x - xs[lo]);
    };
    interpolate.interp = rule;
    interpolate.knots = xs;
    interpolate.derivativesAt = (x) => {
        if (!Number.isFinite(x)) {
            return { value: NaN, derivatives: [NaN, NaN, NaN], inRange: false, segment: -1 };
        }
        if (x < xs[0]) return { value: ys[0], derivatives: [0, 0, 0], inRange: false, segment: 0 };
        if (x > xs[count - 1]) {
            return { value: ys[count - 1], derivatives: [0, 0, 0], inRange: false, segment: Math.max(count - 2, 0) };
        }
        if (count === 1) return { value: ys[0], derivatives: [0, 0, 0], inRange: true, segment: 0 };
        const segment = x === xs[count - 1] ? count - 2 : segmentAt(x);
        const dx = x - xs[segment];
        return { value: piece(segment, dx), derivatives: pieceDerivatives(segment, dx), inRange: true, segment };
    };
    return interpolate;
}

/** Build a clamped scalar PCHIP interpolator from [[x, y], ...]. */
export function createPchipInterpolator(points) {
    return piecewiseInterpolator(points, TABULATED_INTERPOLATION, (xs, ys) => {
        const count = xs.length;
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

        return {
            piece: (i, dx) => ys[i] + dx * (slopes[i] + dx * (quadratic[i] + dx * cubic[i])),
            pieceDerivatives: (i, dx) => [
                slopes[i] + dx * (2 * quadratic[i] + 3 * dx * cubic[i]),
                2 * quadratic[i] + 6 * dx * cubic[i],
                6 * cubic[i],
            ],
        };
    });
}

/** Build a clamped linear interpolator from [[x, y], ...]. */
export function createLinearInterpolator(points) {
    return piecewiseInterpolator(points, LINEAR_INTERPOLATION, (xs, ys) => {
        const slopes = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
        return {
            piece: (i, dx) => ys[i] + dx * slopes[i],
            pieceDerivatives: i => [slopes[i], 0, 0],
        };
    });
}

/** Interpolator of the named rule over [[x, y], ...]. */
export function createInterpolator(points, interp) {
    return interp === LINEAR_INTERPOLATION
        ? createLinearInterpolator(points)
        : createPchipInterpolator(points);
}

/**
 * Build getNK(lambda_nm) from [[lambda_nm, n, k], ...] under the named rule,
 * PCHIP when none is given.
 */
export function createTabulatedNKSampler(rows, interp = TABULATED_INTERPOLATION) {
    const data = (rows || [])
        .map(row => {
            const k = Number(row?.[2]);
            return [Number(row?.[0]), Number(row?.[1]), Number.isFinite(k) ? k : 0];
        })
        .filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]));
    if (data.length === 0) return null;

    const rule = interpolationRuleOf({ interp });
    const nAt = createInterpolator(data.map(row => [row[0], row[1]]), rule);
    const kAt = createInterpolator(data.map(row => [row[0], row[2]]), rule);
    const getNK = lambdaNm => [nAt(lambdaNm), kAt(lambdaNm)];
    getNK.interp = rule;
    getNK.rangeNm = [nAt.knots[0], nAt.knots[nAt.knots.length - 1]];
    getNK.tabData = data;
    getNK.nInterpolator = nAt;
    getNK.kInterpolator = kAt;
    return getNK;
}

/** Whether a serializable material record contains a tabulated component. */
export function hasTabulatedComponent(material) {
    return material?.formulaNum === -1
        || (Array.isArray(material?.kTable) && material.kTable.length > 0);
}

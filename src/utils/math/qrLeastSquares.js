/**
 * Linear least squares by Householder QR of the column-scaled design matrix.
 *
 * Solves min ‖A x − b‖₂ for an m × p matrix A with m ≥ p. Forming AᵀA and
 * solving the normal equations squares the condition number of A, so a problem
 * whose columns are nearly dependent loses twice the digits it has to; an
 * orthogonal factorization works on A itself (G. H. Golub and C. F. Van Loan,
 * Matrix Computations, 3rd ed., Algorithm 5.2.1 for Householder QR, §5.3 for
 * the full-rank least-squares problem and the comparison with the normal
 * equations). The powers of λ⁻² in a Cauchy series over one octave are such
 * columns: at six terms over 400 to 800 nm, cond(AᵀA) is 9e11.
 *
 * Each column is divided by its Euclidean norm before the factorization. The
 * solution is scaled back afterwards and is unchanged by it, but parameters in
 * different units (a constant, then µm², then µm⁴) are put on one footing, which
 * lowers the condition number the factorization sees and makes the rank test
 * below compare like with like.
 */

/**
 * @param {number[][]} matrix  m rows of p entries
 * @param {number[]} rhs       m entries
 * @returns {null|{ solution:number[], covariance:number[][]|null,
 *                  residualSumOfSquares:number, degreesOfFreedom:number }}
 *   null when there are fewer rows than parameters, an entry is not finite, or
 *   the columns are dependent to within rounding. `covariance` is
 *   s²(AᵀA)⁻¹ with s² = SSR/(m − p), the usual estimate for independent errors
 *   of one variance, and null when m = p leaves nothing to estimate s² from.
 */
export function solveLeastSquaresQR(matrix, rhs) {
    const rows = rhs.length;
    const columns = matrix[0]?.length ?? 0;
    if (columns === 0 || rows < columns || matrix.length !== rows) return null;
    const scaled = scaledColumns(matrix, rows, columns);
    const b = Float64Array.from(rhs);
    if (!scaled || !b.every(Number.isFinite)) return null;
    const { columnsOf, norms } = scaled;
    const diagonal = triangularize(columnsOf, b, rows);
    if (!fullRank(diagonal, rows)) return null;

    const r = (i, j) => (i === j ? diagonal[i] : columnsOf[j][i]);
    const scaledSolution = backSubstitute(r, b, columns);
    let residualSumOfSquares = 0;
    for (let i = columns; i < rows; i++) residualSumOfSquares += b[i] * b[i];
    const degreesOfFreedom = rows - columns;
    return {
        solution: scaledSolution.map((value, j) => value / norms[j]),
        covariance: degreesOfFreedom > 0
            ? covarianceFromR(r, columns, norms, residualSumOfSquares / degreesOfFreedom)
            : null,
        residualSumOfSquares,
        degreesOfFreedom,
    };
}

function euclideanNorm(values, start = 0) {
    let sum = 0;
    for (let i = start; i < values.length; i++) sum += values[i] * values[i];
    return Math.sqrt(sum);
}

// The columns of the matrix as unit vectors, with the norms they were divided
// by, or null for a column that is zero or not finite.
function scaledColumns(matrix, rows, columns) {
    const columnsOf = [];
    const norms = [];
    for (let j = 0; j < columns; j++) {
        const column = new Float64Array(rows);
        for (let i = 0; i < rows; i++) column[i] = matrix[i][j];
        const norm = euclideanNorm(column);
        if (!(norm > 0) || !Number.isFinite(norm)) return null;
        for (let i = 0; i < rows; i++) column[i] /= norm;
        columnsOf.push(column);
        norms.push(norm);
    }
    return { columnsOf, norms };
}

/**
 * Householder triangularization in place. Column k is reflected onto a
 * multiple of the k-th unit vector, and the same reflection is applied to the
 * columns after it and to b, which ends as Qᵀb. Above the diagonal the columns
 * hold R; its diagonal is returned.
 *
 * The reflector is u = x − αe₁ with α = −sign(x₀)‖x‖, so u₀ = x₀ + sign(x₀)‖x‖
 * is formed without cancellation, and uᵀu = 2‖x‖(‖x‖ + |x₀|), which gives the
 * factor 2/uᵀu the reflection I − (2/uᵀu)uuᵀ needs.
 */
function triangularize(columnsOf, b, rows) {
    const diagonal = new Float64Array(columnsOf.length);
    for (let k = 0; k < columnsOf.length; k++) {
        const v = columnsOf[k];
        const length = euclideanNorm(v, k);
        const pivot = v[k];
        const alpha = pivot > 0 ? -length : length;
        diagonal[k] = alpha;
        if (length === 0) continue;
        v[k] = pivot - alpha;
        const beta = 1 / (length * (length + Math.abs(pivot)));
        const reflect = (target) => {
            let dot = 0;
            for (let i = k; i < rows; i++) dot += v[i] * target[i];
            const factor = dot * beta;
            for (let i = k; i < rows; i++) target[i] -= factor * v[i];
        };
        for (let j = k + 1; j < columnsOf.length; j++) reflect(columnsOf[j]);
        reflect(b);
    }
    return diagonal;
}

/**
 * Whether every column adds a direction the ones before it do not span.
 *
 * With unit columns |R_kk| is the distance of column k from the span of the
 * columns before it. Below the rounding the factorization itself commits,
 * about max(m, p)·ε for unit columns, that distance is not resolved and the
 * parameter is not determined by the data.
 */
function fullRank(diagonal, rows) {
    const tolerance = Math.max(rows, diagonal.length) * Number.EPSILON;
    return diagonal.every(value => Math.abs(value) > tolerance);
}

function backSubstitute(r, b, columns) {
    const solution = new Array(columns).fill(0);
    for (let i = columns - 1; i >= 0; i--) {
        let sum = b[i];
        for (let j = i + 1; j < columns; j++) sum -= r(i, j) * solution[j];
        solution[i] = sum / r(i, i);
    }
    return solution;
}

/**
 * s²(AᵀA)⁻¹ from R without forming AᵀA. With A = A_s·D, D the column norms,
 * AᵀA = D RᵀR D, so (AᵀA)⁻¹ = D⁻¹ R⁻¹ R⁻ᵀ D⁻¹. R⁻¹ is upper triangular and is
 * found one column at a time by back substitution.
 */
function covarianceFromR(r, columns, norms, variance) {
    const inverse = Array.from({ length: columns }, () => new Array(columns).fill(0));
    for (let column = 0; column < columns; column++) {
        for (let i = column; i >= 0; i--) {
            let sum = i === column ? 1 : 0;
            for (let j = i + 1; j <= column; j++) sum -= r(i, j) * inverse[j][column];
            inverse[i][column] = sum / r(i, i);
        }
    }
    return Array.from({ length: columns }, (_, i) => Array.from({ length: columns }, (_, j) => {
        let sum = 0;
        for (let k = Math.max(i, j); k < columns; k++) sum += inverse[i][k] * inverse[j][k];
        return variance * sum / (norms[i] * norms[j]);
    }));
}

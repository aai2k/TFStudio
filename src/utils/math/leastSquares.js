/**
 * Small dense least-squares numerics.
 *
 * These solve fits with a handful of parameters and a few hundred residuals:
 * dispersion models against a table, and film constants against a measured
 * spectrum. The design optimizers are a different problem and have their own
 * engine in utils/physics/optimizer/.
 *
 * The Levenberg-Marquardt step follows Marquardt, J. Soc. Indust. Appl. Math.
 * 11, 431 (1963); the damping scales each diagonal entry of JᵀJ rather than
 * adding a constant, so a parameter's step size follows its own curvature.
 */

/** Gauss-Jordan solve with partial pivoting. Returns null when singular. */
export function solveLinear(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        if (Math.abs(augmented[pivot][column]) < 1e-20) return null;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let item = column; item <= size; item++) augmented[column][item] /= divisor;
        for (let row = 0; row < size; row++) {
            if (row === column) continue;
            const factor = augmented[row][column];
            for (let item = column; item <= size; item++) {
                augmented[row][item] -= factor * augmented[column][item];
            }
        }
    }
    return augmented.map(row => row[size]);
}

export function sumSquares(values) {
    return values.reduce((sum, value) => sum + value * value, 0);
}

/** Solve `matrix · x = vector` for the columns of the identity, giving the inverse. */
function invertSymmetric(matrix) {
    const size = matrix.length;
    const columns = [];
    for (let index = 0; index < size; index++) {
        const unit = Array(size).fill(0);
        unit[index] = 1;
        const column = solveLinear(matrix, unit);
        if (!column) return null;
        columns.push(column);
    }
    return columns[0].map((_, row) => columns.map(column => column[row]));
}

/**
 * Forward-difference Jacobian of the residual vector.
 *
 * The step is relative to the parameter, floored at 1, so a parameter near zero
 * still gets a step the residual can resolve.
 */
export function residualJacobian(parameters, residualAt, residual = residualAt(parameters)) {
    const jacobian = residual.map(() => Array(parameters.length).fill(0));
    for (let parameter = 0; parameter < parameters.length; parameter++) {
        const delta = 1e-6 * Math.max(1, Math.abs(parameters[parameter]));
        const shifted = parameters.slice();
        shifted[parameter] += delta;
        const next = residualAt(shifted);
        for (let row = 0; row < residual.length; row++) {
            jacobian[row][parameter] = (next[row] - residual[row]) / delta;
        }
    }
    return jacobian;
}

function normalEquations(jacobian, residual, parameterCount) {
    const normal = Array.from({ length: parameterCount }, () => Array(parameterCount).fill(0));
    const rhs = Array(parameterCount).fill(0);
    for (let row = 0; row < residual.length; row++) {
        for (let i = 0; i < parameterCount; i++) {
            rhs[i] -= jacobian[row][i] * residual[row];
            for (let j = 0; j < parameterCount; j++) {
                normal[i][j] += jacobian[row][i] * jacobian[row][j];
            }
        }
    }
    return { normal, rhs };
}

// Largest damping a step is tried at. Beyond it the step is shorter than the
// residual can resolve, so a further increase buys nothing.
const MAX_DAMPING = 1e12;

export function levenbergMarquardt(initial, residualAt, iterations = 80) {
    let parameters = initial.slice();
    let residual = residualAt(parameters);
    let cost = sumSquares(residual);
    let damping = 1e-6;
    // A rejected step leaves the parameters where they were, so the Jacobian is
    // still exact there; only an accepted step invalidates it. Each residual
    // evaluation can be a full spectrum calculation, so rebuilding the Jacobian
    // only after a move saves parameterCount evaluations per rejected step.
    let jacobian = null;
    for (let iteration = 0; iteration < iterations; iteration++) {
        if (!jacobian) jacobian = residualJacobian(parameters, residualAt, residual);
        const { normal, rhs } = normalEquations(jacobian, residual, parameters.length);
        for (let index = 0; index < parameters.length; index++) {
            normal[index][index] += damping * Math.max(1e-12, normal[index][index]);
        }
        const step = solveLinear(normal, rhs);
        if (!step) break;
        const candidate = parameters.map((value, index) => value + step[index]);
        const candidateResidual = residualAt(candidate);
        const candidateCost = sumSquares(candidateResidual);
        if (candidateCost < cost) {
            parameters = candidate;
            residual = candidateResidual;
            jacobian = null;
            if (Math.abs(cost - candidateCost) <= 1e-14 * Math.max(1, cost)) break;
            cost = candidateCost;
            damping = Math.max(1e-12, damping / 3);
        } else {
            // A step rejected at the largest damping is a fixed point: the
            // parameters, the residual and the damping are all unchanged, so
            // every remaining iteration would take the same step and reject it
            // again. Stopping returns what running them would return, and a
            // converged film fit spends about half its iteration budget here
            // otherwise.
            if (damping >= MAX_DAMPING) break;
            damping = Math.min(MAX_DAMPING, damping * 10);
        }
    }
    return parameters;
}

/**
 * How well each parameter is determined, and which pairs are not separable.
 *
 * The covariance of a nonlinear least-squares solution is s²(JᵀJ)⁻¹ with
 * s² = SSR/(m − p), the standard linearisation about the solution (Bard,
 * Nonlinear Parameter Estimation, ch. 7). It is exact only for a locally linear
 * model and Gaussian errors, which is why it is reported as a spread rather
 * than a confidence interval.
 *
 * `maxCorrelation` is the point of it for a film fit. Thickness and refractive
 * index enter the spectrum almost entirely as the product n·d; when the
 * measurement holds too few fringes to separate them, both come back with a
 * small residual, a large spread, and a correlation close to 1.
 *
 * @returns {null|{ standardErrors:number[], correlation:number[][],
 *                  maxCorrelation:number, maxCorrelationPair:[number,number],
 *                  degreesOfFreedom:number }}
 *          null when the parameters are not identifiable at all (singular JᵀJ)
 *          or there are no more residuals than parameters.
 */
export function parameterSpread(parameters, residualAt) {
    const residual = residualAt(parameters);
    const degreesOfFreedom = residual.length - parameters.length;
    if (degreesOfFreedom <= 0) return null;
    const jacobian = residualJacobian(parameters, residualAt, residual);
    const { normal } = normalEquations(jacobian, residual, parameters.length);
    const inverse = invertSymmetric(normal);
    if (!inverse) return null;
    const variance = sumSquares(residual) / degreesOfFreedom;
    const standardErrors = inverse.map((row, index) => Math.sqrt(Math.max(0, variance * row[index])));
    let maxCorrelation = 0;
    let maxCorrelationPair = [0, 0];
    const correlation = inverse.map((row, i) => row.map((value, j) => {
        const scale = Math.sqrt(Math.max(0, inverse[i][i]) * Math.max(0, inverse[j][j]));
        const rho = scale > 0 ? value / scale : 0;
        if (i !== j && Math.abs(rho) > maxCorrelation) {
            maxCorrelation = Math.abs(rho);
            maxCorrelationPair = [i, j];
        }
        return rho;
    }));
    return {
        standardErrors, correlation, maxCorrelation, maxCorrelationPair, degreesOfFreedom,
    };
}

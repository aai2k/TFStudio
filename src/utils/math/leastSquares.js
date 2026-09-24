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
 *
 * Every linear solve here is the Householder QR of qrLeastSquares.js on the
 * column-scaled Jacobian, never the normal equations. The parameters of one
 * fit come in unrelated units (an index next to a thickness in nm, a Cauchy
 * term in nm⁴), so JᵀJ can hold entries apart by twenty orders of magnitude,
 * squares the condition number of J, and has no absolute pivot threshold that
 * suits every fit.
 */

import { solveLeastSquaresQR } from './qrLeastSquares.js';

export function sumSquares(values) {
    return values.reduce((sum, value) => sum + value * value, 0);
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

/**
 * The damped step Δ, the least-squares solution of [J; √λ·D] Δ ≈ [−r; 0] with
 * D = diag(‖J_i‖), whose normal equations are (JᵀJ + λ·diag(JᵀJ))Δ = −Jᵀr.
 * A parameter the residual does not depend on gets a unit damping row and so
 * no step. Null when the system cannot be solved.
 */
function dampedStep(jacobian, residual, damping) {
    const parameterCount = jacobian[0].length;
    const rows = jacobian.map(row => row.slice());
    const rhs = residual.map(value => -value);
    for (let i = 0; i < parameterCount; i++) {
        let norm2 = 0;
        for (const row of jacobian) norm2 += row[i] * row[i];
        const dampingRow = new Array(parameterCount).fill(0);
        dampingRow[i] = norm2 > 0 ? Math.sqrt(damping * norm2) : 1;
        rows.push(dampingRow);
        rhs.push(0);
    }
    return solveLeastSquaresQR(rows, rhs)?.solution ?? null;
}

// Largest damping a step is tried at. Beyond it the step is shorter than the
// residual can resolve, so a further increase buys nothing.
const MAX_DAMPING = 1e12;

/**
 * @param {number[]} initial
 * @param {(parameters:number[]) => number[]} residualAt
 * @param {number} iterations
 * @param {(parameters:number[], residualAt:Function, residual:number[]) => number[][]} jacobianAt
 *        the Jacobian at a point; forward differences of the residual unless
 *        the caller has a cheaper way to the same numbers
 */
export function levenbergMarquardt(initial, residualAt, iterations = 80, jacobianAt = residualJacobian) {
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
        if (!jacobian) jacobian = jacobianAt(parameters, residualAt, residual);
        const step = dampedStep(jacobian, residual, damping);
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
 * than a confidence interval. (JᵀJ)⁻¹ comes from R of the QR factorization of
 * the column-scaled J (qrLeastSquares.js), and SSR is that of the linearised
 * problem at the solution, the fit's own SSR once the fit has converged.
 *
 * `maxCorrelation` is the point of it for a film fit. Thickness and refractive
 * index enter the spectrum almost entirely as the product n·d; when the
 * measurement holds too few fringes to separate them, both come back with a
 * small residual, a large spread, and a correlation close to 1.
 *
 * @returns {null|{ standardErrors:number[], correlation:number[][],
 *                  maxCorrelation:number, maxCorrelationPair:[number,number],
 *                  degreesOfFreedom:number }}
 *          null when the parameters are not identifiable at all (the columns
 *          of J dependent to within rounding) or there are no more residuals
 *          than parameters.
 */
export function parameterSpread(parameters, residualAt) {
    const residual = residualAt(parameters);
    const degreesOfFreedom = residual.length - parameters.length;
    if (degreesOfFreedom <= 0) return null;
    const jacobian = residualJacobian(parameters, residualAt, residual);
    const covariance = solveLeastSquaresQR(jacobian, residual)?.covariance;
    if (!covariance) return null;
    const standardErrors = covariance.map((row, index) => Math.sqrt(Math.max(0, row[index])));
    let maxCorrelation = 0;
    let maxCorrelationPair = [0, 0];
    const correlation = covariance.map((row, i) => row.map((value, j) => {
        const scale = Math.sqrt(Math.max(0, covariance[i][i]) * Math.max(0, covariance[j][j]));
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

/**
 * Thickness bounds in the model-based refinement steps (DLS, Newton,
 * Newton-CG), and the start every engine is scored from (boxedStart).
 *
 * A layer that sits at a bound with the merit gradient pushing it out of the
 * box, at D_MIN with ∂MF/∂d > 0 or at D_MAX with ∂MF/∂d < 0, is held there for
 * the step: its column leaves the linear system and the step is solved on the
 * other layers, so no part of the step counts on a move the bound would
 * cancel. A layer at a bound with the gradient pointing into the box stays in
 * the step and can leave the bound. The trial point is the step projected onto
 * the box. This is the active-set rule of the projected Newton method
 * (D. P. Bertsekas, "Projected Newton methods for optimization problems with
 * simple constraints," SIAM J. Control Optim. 20, 221-246 (1982)); its
 * stationary points are the first-order (KKT) points of the bounded problem.
 *
 * `eng` is the engine: its current thicknesses and its D_MIN / D_MAX, nm.
 */

// The engine's start with every free layer moved onto [D_MIN, D_MAX]; locked
// layers keep their thickness. An engine scores this, not the design it was
// handed: scored outside the box, the merit of a design the engine can never
// return is what every projected trial has to beat, and when lifting a thin
// layer to D_MIN costs more than one step recovers, every trial is rejected
// and the engine reports convergence on the out-of-box start.
export function boxedStart(eng) {
    return eng.thicknesses.map((d, i) => (eng.lockedMask[i] ? d : Math.max(eng.D_MIN, Math.min(eng.D_MAX, d))));
}

// Positions a in freeIdx whose layer may move in this step. grad[a] is the
// merit gradient of variable freeIdx[a], or any positive multiple of it.
export function movablePositions(eng, freeIdx, grad) {
    const out = [];
    for (let a = 0; a < freeIdx.length; a++) {
        const d = eng.thicknesses[freeIdx[a]];
        const heldLow  = d <= eng.D_MIN && grad[a] > 0;
        const heldHigh = d >= eng.D_MAX && grad[a] < 0;
        if (!heldLow && !heldHigh) out.push(a);
    }
    return out;
}

// Jᵀr: the gradient of ½‖r‖², a positive multiple of ∇MF.
export function residualGradient(J, r) {
    const nCols = J.length ? J[0].length : 0;
    const g = new Array(nCols).fill(0);
    for (let ri = 0; ri < J.length; ri++) {
        const row = J[ri];
        for (let c = 0; c < nCols; c++) g[c] += row[c] * r[ri];
    }
    return g;
}

// The columns `cols` of J; J itself when cols keeps every column.
export function restrictColumns(J, cols) {
    if (!J.length || cols.length === J[0].length) return J;
    return J.map(row => cols.map(c => row[c]));
}

// The Newton system { H, Jtr } on the positions `cols`; the system itself
// when cols keeps every position.
export function restrictSystem(sys, cols) {
    if (cols.length === sys.Jtr.length) return sys;
    return {
        H:   cols.map(a => cols.map(b => sys.H[a][b])),
        Jtr: cols.map(a => sys.Jtr[a]),
    };
}

// Trial thicknesses: each variable in moveIdx takes its step, delta[c] for
// moveIdx[c], and every free variable is then projected onto [D_MIN, D_MAX].
export function projectedTrial(eng, freeIdx, moveIdx, delta) {
    const thk = eng.thicknesses;
    const project = d => Math.max(eng.D_MIN, Math.min(eng.D_MAX, d));
    const out = [...thk];
    for (const k of freeIdx) out[k] = project(thk[k]);
    for (let c = 0; c < moveIdx.length; c++) out[moveIdx[c]] = project(thk[moveIdx[c]] + delta[c]);
    return out;
}

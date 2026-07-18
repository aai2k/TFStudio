/**
 * Per-layer merit-function sensitivity ranking. See ../errorAnalysis.js for
 * the full statistical model and references.
 */

import { buildEvalContext, evaluateOperands, calcMF } from '../optimizer.js';

function buildSensitivityVariables(surfaceMode, front, back) {
    if (surfaceMode === 'both_independent') {
        return [
            ...front.map((layer, layerIndex) => ({ side: 'front', layerIndex, layer })),
            ...back.map((layer, layerIndex) => ({ side: 'back', layerIndex, layer })),
        ];
    }
    if (surfaceMode === 'back_only') {
        return back.map((layer, layerIndex) => ({ side: 'back', layerIndex, layer }));
    }
    return front.map((layer, layerIndex) => ({ side: 'front', layerIndex, layer }));
}

function evaluateSensitivityThickness({ design, operands, resolveMat, surfaceMode,
    side, layerIndex, thickness, mfOptions }) {
    const ctx = buildEvalContext(design, resolveMat);
    if (side === 'front') {
        ctx.frontThicks = [...ctx.frontThicks];
        ctx.frontThicks[layerIndex] = thickness;
        if (surfaceMode === 'symmetric') ctx.backThicks = [...ctx.frontThicks].reverse();
    } else {
        ctx.backThicks = [...ctx.backThicks];
        ctx.backThicks[layerIndex] = thickness;
    }

    if (surfaceMode === 'both_independent') {
        ctx.fullThicks = [...ctx.frontThicks, ...ctx.backThicks];
    } else if (surfaceMode === 'back_only') {
        ctx.fullThicks = ctx.backThicks;
    } else {
        ctx.fullThicks = ctx.frontThicks;
    }
    const comp = evaluateOperands(operands, ctx);
    return calcMF(operands, comp, mfOptions);
}

function makeSensitivityRow(variable, index, settings) {
    const { side, layerIndex, layer } = variable;
    const locked = !!layer.locked;
    if (locked && !settings.includeLocked) return null;

    const thickness = layer.thickness || 0;
    const delta = settings.mode === 'absolute'
        ? Math.max(1e-6, Math.abs(settings.absDeltaNm))
        : Math.max(1e-6, thickness * settings.relPct / 100);
    const plus = thickness + delta;
    const minus = Math.max(0, thickness - delta);
    const span = plus - minus;
    const mfPlus = evaluateSensitivityThickness({
        ...settings, side, layerIndex, thickness: plus,
    });
    const mfMinus = evaluateSensitivityThickness({
        ...settings, side, layerIndex, thickness: minus,
    });
    const deltaMF = span > 0 ? (mfPlus - mfMinus) / span * (2 * delta) : 0;

    return {
        index,
        side,
        layerIndex,
        materialId: layer.material,
        thickness,
        deltaNm: delta,
        deltaMFAbs: Math.abs(deltaMF),
        deltaMF,
        sensitivity: 0,
        locked,
    };
}

function scaleSensitivityRows(rows) {
    let maxAbs = 0;
    for (const row of rows) if (row.deltaMFAbs > maxAbs) maxAbs = row.deltaMFAbs;
    if (maxAbs > 0) {
        for (const row of rows) row.sensitivity = 100 * row.deltaMFAbs / maxAbs;
    }
}

/**
 * Per-layer merit-function sensitivity ranking.
 *
 * For each *unlocked* layer j (across front and, in symmetric / both_independent
 * / back_only modes, back too — whatever DLS sees as a free variable), compute
 *
 *     ΔMF_j = (MF(d_j + Δd) − MF(d_j − Δd)) / 2          [central difference]
 *
 * where Δd_j is either `absDeltaNm` or `relPct·d_j/100` depending on `mode`.
 * The "sensitivity %" is |ΔMF_j| scaled so that the max layer = 100.
 *
 * @param {object}  design       the design object (CLAUDE.md schema)
 * @param {Array}   operands     `design.meritOperands` (or any operand list)
 * @param {Function} resolveMat  id → material object (with `.getNK(λ)`)
 * @param {object}  [opts]
 *   - mode:          'absolute' | 'relative'      (default 'relative')
 *   - absDeltaNm:    Δd in nm when mode='absolute' (default 1)
 *   - relPct:        Δd / d × 100 when mode='relative' (default 1)
 *   - includeLocked: if true, locked layers also analysed (default false)
 *
 * @returns {{
 *   rows:   Array<{
 *     index:        number,   // 0-based index in the optimization vector
 *     side:         'front'|'back',
 *     layerIndex:   number,   // 0-based index within frontLayers/backLayers
 *     materialId:   string,
 *     thickness:    number,   // nm
 *     deltaNm:      number,   // Δd actually used (nm)
 *     deltaMFAbs:   number,   // |ΔMF_j|  (absolute)
 *     deltaMF:      number,   //  ΔMF_j   (signed central difference)
 *     sensitivity:  number,   // 0..100   (% of max layer)
 *     locked:       boolean,
 *   }>,
 *   mf0: number,              // MF at the unperturbed design
 *   surfaceMode: string,
 * }}
 */
export function computeLayerSensitivity(design, operands, resolveMat, opts = {}) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const front = design.frontLayers || [];
    const back  = surfaceMode === 'symmetric' ? [...front].reverse() : (design.backLayers || []);
    const variables = buildSensitivityVariables(surfaceMode, front, back);

    // Error analysis ranks layers by *optical* sensitivity. MNT/MXT thickness
    // constraints (one-sided quadratic penalties used during DLS refinement)
    // would dominate ΔMF for any layer whose thickness sits within Δd of a
    // bound — e.g. a 42 nm layer with MNT=40 nm trips a huge penalty under
    // a −5 nm perturbation, swamping the actual optical contribution. The
    // sensitivity ranking must reflect spectrum behaviour, not constraint
    // proximity, so we evaluate MF with constraints disabled — matching what
    // the needle / GE scans use as their optical merit.
    const MF_OPT = { skipConstraints: true };
    const ctx0 = buildEvalContext(design, resolveMat);
    const comp0 = evaluateOperands(operands, ctx0);
    const mf0   = calcMF(operands, comp0, MF_OPT);
    const rows = [];
    const settings = {
        design,
        operands,
        resolveMat,
        surfaceMode,
        mfOptions: MF_OPT,
        mode: opts.mode ?? 'relative',
        absDeltaNm: opts.absDeltaNm ?? 1.0,
        relPct: opts.relPct ?? 1.0,
        includeLocked: !!opts.includeLocked,
    };
    for (let i = 0; i < variables.length; i++) {
        const row = makeSensitivityRow(variables[i], i, settings);
        if (row) rows.push(row);
    }
    scaleSensitivityRows(rows);
    return { rows, mf0, surfaceMode };
}

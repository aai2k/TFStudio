/**
 * Per-layer merit-function sensitivity ranking. See ../errorAnalysis.js for
 * the full statistical model and references.
 */

import { buildEvalContext, evaluateOperands, calcMF, withFringeSampleCounts } from '../optimizer.js';
import {
    BASE_ENVIRONMENT, environmentById, hasEnvironments, oneEnvironmentDesign, valueFor,
} from '../../environments/environments.js';
import { meanSquareMerit, meritGroups, rowsScoredIn } from '../../environments/environmentMerit.js';

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
    const mfPlus = settings.meritAt(side, layerIndex, plus);
    const mfMinus = settings.meritAt(side, layerIndex, minus);

    // Mean magnitude of the merit change under a ±Δd thickness error.
    //
    // A central difference, (MF(d+Δ) − MF(d−Δ))/2Δ, cancels the quadratic term
    // exactly and keeps only the gradient. A refined design sits at a local
    // minimum, so ∂MF/∂d ≈ 0 for every free layer and that gradient is
    // optimizer convergence noise. Ranking on it puts the layers in an order
    // unrelated to how much a deposition error actually costs. Averaging the
    // two one-sided magnitudes keeps the curvature term, which is the term that
    // survives at the minimum, and still reduces to |∂MF/∂d|·Δd for a design
    // that has not been refined.
    const degradation = (Math.abs(mfPlus - settings.mf0) + Math.abs(mfMinus - settings.mf0)) / 2;

    // Which direction of error costs more. This is a hint for the reader, not
    // the ranking quantity, and near a minimum it carries little information.
    const direction = Math.sign(mfPlus - mfMinus) || 1;

    return {
        index,
        side,
        layerIndex,
        materialId: layer.material,
        thickness,
        deltaNm: delta,
        deltaMFAbs: degradation,
        deltaMF: degradation * direction,
        sensitivity: 0,
        locked,
    };
}

// The environments a probe of `env` scores on a design with environments: one
// by id (environment 1 without it), or with 'all' every environment that is
// on and holds an optical row, as the optical merit counts them.
function probedEnvironments(design, operands, env) {
    if (env !== 'all') return [env ?? BASE_ENVIRONMENT];
    return meritGroups(design, operands).filter(group => group.optical).map(group => group.id);
}

// The merit of a design with environments as a probe of `env` reads it, at the
// design as it is (`mf0`) and with one layer's recipe thickness changed
// (`meritAt`): in each environment probed its own rows on the design it sees,
// the layer f times the recipe thickness, combined as MF² = (1/N) Σ MF_k².
function environmentProbe(design, operands, env, probe) {
    const layersOf = { front: design.frontLayers || [], back: design.backLayers || [] };
    const groups = probedEnvironments(design, operands, env).map(id => {
        const seen = oneEnvironmentDesign(design, id);
        const factors = environmentById(design, id).thicknessFactors;
        return {
            design: seen,
            operands: rowsScoredIn(operands, id),
            factor: (side, layerIndex) => valueFor(factors, layersOf[side][layerIndex].material) ?? 1,
        };
    });
    return {
        mf0: meanSquareMerit(groups.map(group => calcMF(group.operands,
            evaluateOperands(group.operands, buildEvalContext(group.design, probe.resolveMat)), probe.mfOptions))),
        meritAt: (side, layerIndex, thickness) => meanSquareMerit(groups.map(group => evaluateSensitivityThickness({
            ...probe, design: group.design, operands: group.operands, side, layerIndex,
            thickness: group.factor(side, layerIndex) * thickness,
        }))),
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
 *     ΔMF_j = ( |MF(d_j + Δd) − MF₀| + |MF(d_j − Δd) − MF₀| ) / 2
 *
 * where Δd_j is either `absDeltaNm` or `relPct·d_j/100` depending on `mode`,
 * and MF₀ is the merit of the unperturbed design. This is the mean amount the
 * merit function moves when layer j is off by ±Δd, so it stays meaningful at a
 * refined design, where the first derivative of the merit is zero by
 * construction and a central difference would report convergence noise.
 *
 * The "sensitivity %" is ΔMF_j scaled so that the max layer = 100.
 *
 * @param {object}  design       the design object
 * @param {Array}   operands     `design.meritOperands` (or any operand list)
 * @param {Function} resolveMat  id → material object (with `.getNK(λ)`)
 * @param {object}  [opts]
 *   - mode:          'absolute' | 'relative'      (default 'relative')
 *   - absDeltaNm:    Δd in nm when mode='absolute' (default 1)
 *   - relPct:        Δd / d × 100 when mode='relative' (default 1)
 *   - includeLocked: if true, locked layers also analysed (default false)
 *   - env:           on a design with environments, the environment whose
 *                    merit is probed, by id: its own rows on the design it
 *                    sees (default environment 1); or 'all', the merit over
 *                    every environment that is on, MF² = (1/N) Σ MF_k², N
 *                    counting those that hold an optical row. Each step is
 *                    made on the recipe thickness and seen in an environment
 *                    as f·(d ± Δd), f the factor of the layer's material there.
 *
 * @returns {{
 *   rows:   Array<{
 *     index:        number,   // 0-based index in the optimization vector
 *     side:         'front'|'back',
 *     layerIndex:   number,   // 0-based index within frontLayers/backLayers
 *     materialId:   string,
 *     thickness:    number,   // nm
 *     deltaNm:      number,   // Δd actually used (nm)
 *     deltaMFAbs:   number,   // ΔMF_j, mean merit change under ±Δd
 *     deltaMF:      number,   // ΔMF_j signed by which direction costs more
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
    // Band rows on the unperturbed design's fringe grid, the grid the Merit
    // Function Editor shows them on, kept for every ±Δd evaluation so a merit
    // change comes from the thickness and not from a change of grid.
    const sampled = withFringeSampleCounts(operands, ctx0);
    const probe = { resolveMat, surfaceMode, mfOptions: MF_OPT };
    const { mf0, meritAt } = hasEnvironments(design)
        ? environmentProbe(design, sampled, opts.env, probe)
        : {
            mf0: calcMF(sampled, evaluateOperands(sampled, ctx0), MF_OPT),
            meritAt: (side, layerIndex, thickness) => evaluateSensitivityThickness({
                ...probe, design, operands: sampled, side, layerIndex, thickness,
            }),
        };
    const rows = [];
    const settings = {
        meritAt,
        mf0,
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

// What a Structural run checks and prepares before it builds its workers: the
// operand rows it refines and scores on, the thickness bounds the MNT and MXT
// rows set, the material pool and the worker material tables.

import { isConstraint } from '../physics/optimizer.js';
import { activeSide, densifyForRun, withoutPPEF } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { presampleAll } from './refine.js';

/**
 * Raise `cfg.dMin` to the strictest MNT row and set `cfg.dMax` from the
 * strictest MXT row of `enabled` (nm), so the run's layers keep the bounds the
 * merit function penalizes. dMax is at least 1 nm above dMin, and Infinity
 * without an MXT row.
 */
export function applyConstraintBounds(cfg, enabled) {
    const minimums = enabled.filter(op => op.type === 'MNT' && Number.isFinite(op.target));
    const maximums = enabled.filter(op => op.type === 'MXT' && Number.isFinite(op.target));
    const minNm = minimums.length ? Math.max(...minimums.map(op => op.target)) : 0;
    const maxNm = maximums.length ? Math.min(...maximums.map(op => op.target)) : Infinity;
    cfg.dMin = Math.max(cfg.dMin, minNm);
    cfg.dMax = Math.max(cfg.dMin + 1, maxNm);
    if (minNm > 0 || Number.isFinite(maxNm)) {
        console.log(`[Structural] constraint-bound synthesis: dMin=${cfg.dMin} dMax=${cfg.dMax} (MNT=${minNm || 'none'}, MXT=${Number.isFinite(maxNm) ? maxNm : 'none'})`);
    }
}

// Whether the run has a proposal to make without the pool: growth (add and
// split) needs pool materials, the other kinds do not.
function poolMissing(kinds, pool) {
    const needsPool = kinds.has('add') || kinds.has('split');
    const hasNonPool = kinds.has('remove') || kinds.has('merge') || kinds.has('perturb');
    return needsPool && !pool.length && !hasNonPool;
}

/**
 * The run's operands and tables for `design` and `operands` (merit rows;
 * disabled and PPEF rows are left out). Refines use the rows without MNT and
 * MXT, densified for the design's features; results are scored on every row.
 * Returns { failed } with 'noOperands', 'noMaterials' or 'presampleFailed'
 * when the run cannot start.
 */
export function prepare(design, operands, plan) {
    const enabled = withoutPPEF(operands.filter(op => op.enabled));
    const refined = densifyForRun(enabled.filter(op => !isConstraint(op.type)), design);
    if (!refined.length) return { failed: 'noOperands' };
    const bounds = { dMin: plan.dMin };
    applyConstraintBounds(bounds, enabled);
    if (poolMissing(plan.kinds, plan.pool)) return { failed: 'noMaterials' };
    let materials;
    try {
        materials = presampleAll(design, refined, plan.pool);
    } catch (err) {
        console.error('[Structural] pre-sampling failed:', err);
        return { failed: 'presampleFailed' };
    }
    const side = activeSide(design);
    const layerKey = side === 'back' ? 'backLayers' : 'frontLayers';
    return {
        enabled, operands: refined, materials, side, layerKey,
        otherKey: layerKey === 'frontLayers' ? 'backLayers' : 'frontLayers',
        dMin: bounds.dMin, dMax: bounds.dMax,
    };
}

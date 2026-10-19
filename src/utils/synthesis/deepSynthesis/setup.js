// What a Deep Synthesis run on a design checks and prepares: why it cannot
// start, the operands it designs for, the floor and the upper bound the MNT
// and MXT rows set, the material tables and the evaluator's spec.

import { isConstraint } from '../../physics/optimizer.js';
import { embedDesignMaterials, isBuiltinId } from '../../materials/designMaterials.js';
import { stripGetNK } from '../../materials/catalogManager/persistence.js';
import { applyConstraintBounds } from '../../structural/setup.js';
import {
    activeSide, densifyForRun, serializableMedia, withoutPPEF,
} from '../../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { presampleSynthesisMaterials } from '../../../components/windows/optimization/synthesisShared/runGrid.js';
import { makeEvaluator, DEFAULT_ENGINE } from './evaluator.js';
import { DEFAULT_TARGET_MF } from './trace.js';
import { blockedReason, deepSynthesisParts } from './capabilities.js';

const toLayers = layers => (layers || []).map(({ material, thickness }) => ({ material, thickness }));
const layerKeyOf = side => (side === 'back' ? 'backLayers' : 'frontLayers');

function otherLayersOf(design, side) {
    if (design.surfaceMode === 'symmetric') return [];
    return toLayers(design[side === 'back' ? 'frontLayers' : 'backLayers']);
}

function buildSpec({ bounds, design, operands, pool, method, maxLayers }) {
    const side = activeSide(design);
    return {
        operands, base: serializableMedia(design), referenceWavelength: design.referenceWavelength,
        side, otherLayers: otherLayersOf(design, side),
        pool: pool.map(material => material.id),
        dMin: bounds.dMin, dMax: bounds.dMax, maxLayers,
        engine: DEFAULT_ENGINE, refine: method.refine, targetMf: DEFAULT_TARGET_MF,
    };
}

// What a run worker samples materials from when the run regrids (regrid.js):
// the design with its non-built-in materials embedded, and the pool's
// non-built-in materials as records (the form a .tfs file carries them in).
// Built-in materials resolve by id.
function materialSource(design, pool) {
    const records = pool.filter(material => !isBuiltinId(material.id))
        .map(material => [material.id, stripGetNK(material.mat)]);
    return { design: embedDesignMaterials(design), pool: Object.fromEntries(records) };
}

/**
 * The run's evaluator and what goes with it, for `design` and `operands`
 * (merit rows; disabled and PPEF rows are left out, MNT and MXT rows become
 * the floor and the upper bound in nm). Returns { failed } with 'locked' (a
 * locked layer on the side the run works on), 'noPool', 'noOperands' (nothing
 * optical to design for) or 'presampleFailed' when the run cannot start;
 * otherwise { ev, materials, start, side, layerKey, surfaceMode, source,
 * parts, dMin, dMax }, `start` being the active side's layers.
 */
export function prepareRun(design, operands, plan) {
    const enabled = withoutPPEF(operands.filter(op => op.enabled));
    const reason = blockedReason(design, {
        pool: plan.pool.map(material => material.id),
        operands: enabled.filter(op => !isConstraint(op.type)),
    });
    if (reason) return { failed: reason };
    const refined = densifyForRun(enabled.filter(op => !isConstraint(op.type)), design);
    const bounds = { dMin: plan.dMin };
    applyConstraintBounds(bounds, enabled);
    let materials, ev;
    try {
        materials = presampleSynthesisMaterials(design, refined, plan.pool);
        ev = makeEvaluator(buildSpec({
            bounds, design, operands: refined, pool: plan.pool, method: plan.method, maxLayers: plan.maxLayers,
        }), { materials });
    } catch (err) {
        console.error('[DeepSynthesis] pre-sampling failed:', err);
        return { failed: 'presampleFailed' };
    }
    const side = activeSide(design);
    const layerKey = layerKeyOf(side);
    return {
        ev, materials, side, layerKey, surfaceMode: design.surfaceMode || 'front_only',
        start: toLayers(design[layerKey]), source: materialSource(design, plan.pool),
        parts: deepSynthesisParts(ev), dMin: bounds.dMin, dMax: bounds.dMax,
    };
}

// What a refinement run hands its optimizer workers: the operands on the run's
// sampling grid, every material pre-sampled on that grid, and the design as plain
// data. Workers have no catalog access, so all three are built on the calling
// thread.

import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    requiredLambdas, collectDesignMaterialIds,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS, withDesignSampleCounts,
    buildPresampledTable, isPhaseDispersion,
} from '../physics/optimizer.js';

// Run sampling grid: at launch, band averages, integrals and range targets get
// the sample count the design's fringe spacing needs, then the band-sampled
// operands whose bands hide a sub-grid spectral feature are densified so the
// merit isn't blind to narrow resonances. Every run does this. The result
// feeds BOTH presampleMaterials (requiredLambdas) and the worker job, so the
// workers evaluate on exactly the λ grid the materials were sampled on.
export function densifyForRun(ops, design) {
    const lookup = designMaterialLookup(design);
    return densifyOperandsForFeatures(withDesignSampleCounts(ops, design, lookup), design, lookup, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
        console.log(`[Adaptive] densified ${bumped} operand(s) for narrow features`
            + (capped ? ` (${capped} capped at ${ADAPTIVE_SAMPLING_DEFAULTS.maxPoints} pts; feature finer than the cap can resolve)` : '')));
}

// Every material the design references, sampled on the EXACT union of operand
// wavelengths. Design-scoped material lookup runs here on the calling thread
// (catalog access is absent in the worker); the worker rebuilds a table-lookup
// getNK from these arrays and the floats match bit-for-bit because both sides
// derive λ from the same `operandSampleLambdas` helper.
export function presampleMaterials(design, ops) {
    const resolveMaterial = designMaterialLookup(design);
    const lambdas = requiredLambdas(ops);
    const ids     = collectDesignMaterialIds(design);
    const pairs = ids.map(id => ({ id, mat: resolveMaterial(id) }));
    return buildPresampledTable(lambdas, pairs, {
        includeOmegaResponses: ops.some(op => op.enabled && isPhaseDispersion(op.type)),
    });
}

// Serializable design payload for the worker engines.
export function buildPayload(curDes) {
    const mk = (arr) => (arr || []).map(l => ({ id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    return {
        surfaceMode: curDes.surfaceMode || 'front_only',
        mfEvalMode:  curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: { material: curDes.substrate?.material ?? 'BK7', thickness: curDes.substrate?.thickness ?? 1.0 },
        frontLayers: mk(curDes.frontLayers),
        backLayers:  mk(curDes.backLayers),
        // Cone-angle averaging for the worker engines.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
        // Stress run temperatures, so a worker scores an STR row with the same
        // thermal terms the main thread shows.
        ...(curDes.stress ? { stress: curDes.stress } : {}),
    };
}

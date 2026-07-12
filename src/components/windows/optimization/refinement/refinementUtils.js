// Pure helpers shared by the Refinement window and its optimizer-driver runners.
// No React, no component state — everything here is a plain function of its
// arguments, so it is safe to import from both the UI and the runner modules.

import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    requiredLambdas, collectDesignMaterialIds, mirrorLayers,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
    buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../../../../utils/physics/optimizer.js';

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

// Adaptive merit sampling: at run launch, densify the band-sampled
// operands whose bands hide a sub-grid spectral feature so the merit isn't blind
// to narrow resonances. Always on — it's a no-op on smooth designs (no feature →
// operands returned unchanged → bit-identical), so there's nothing to toggle. The
// densified operands feed BOTH presampleMaterials (requiredLambdas) and the
// worker job, so the byte-identical λ-grid contract is preserved.
export function densifyForRun(ops, design) {
    return densifyOperandsForFeatures(ops, design, resolveMat, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
        console.log(`[Adaptive] densified ${bumped} operand(s) for narrow features`
            + (capped ? ` (${capped} capped at ${ADAPTIVE_SAMPLING_DEFAULTS.maxPoints} pts — feature finer than the cap can resolve)` : '')));
}

// Approach A pre-sampling: sample every material the design
// references on the EXACT union of operand wavelengths. catalogManager /
// resolveMat work here on the UI thread (they need window.electronAPI, absent
// in the worker); the worker rebuilds a table-lookup getNK from these arrays
// and the floats match bit-for-bit because both sides derive λ from the same
// `operandSampleLambdas` helper.
export function presampleMaterials(design, ops) {
    const lambdas = requiredLambdas(ops);
    const ids     = collectDesignMaterialIds(design);
    const materials = {};
    for (const id of ids) {
        const mat = resolveMat(id);
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0]; k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
}

// Serializable design payload for the worker engines (cg / sa / de / all path).
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
        // Cone-angle averaging for the cg/sa/de worker engines.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
}

// Randomly perturb one layer array's unlocked thicknesses by ±(pct%), clamped
// to the optimizer's absolute thickness bounds.
function jitterLayers(arr, f) {
    const D_MIN = 1.0, D_MAX = 2000.0;
    return (arr || []).map(l => {
        if (l.locked) return { ...l };
        let tt = (l.thickness || 0) * (1 + f * (Math.random() * 2 - 1));
        if (tt < D_MIN) tt = D_MIN; if (tt > D_MAX) tt = D_MAX;
        return { ...l, thickness: tt };
    });
}

// Perturb a payload's optimization-variable thicknesses (surface-mode aware),
// for multi-start restarts. restart 0 = unperturbed.
export function perturbPayload(payload, pct, restart) {
    if (restart === 0) return payload;
    const f = Math.max(0, pct) / 100;
    const sm = payload.surfaceMode;
    if (sm === 'both_independent') return { ...payload, frontLayers: jitterLayers(payload.frontLayers, f), backLayers: jitterLayers(payload.backLayers, f) };
    if (sm === 'back_only')        return { ...payload, backLayers: jitterLayers(payload.backLayers, f) };
    if (sm === 'symmetric')        { const fr = jitterLayers(payload.frontLayers, f); return { ...payload, frontLayers: fr, backLayers: mirrorLayers(fr) }; }
    return { ...payload, frontLayers: jitterLayers(payload.frontLayers, f) };
}

// Merit-table display evaluation (used only when NOT optimizing). Returns
// { computed, mf, omf }, or null if evaluation throws (leaves prior display
// untouched). Empty/absent design → cleared display.
export function computeOperandDisplay(design, operands) {
    if (!design || operands.length === 0) return { computed: [], mf: null, omf: null };
    try {
        const ctx  = buildEvalContext(design, resolveMat);
        const comp = evaluateOperands(operands, ctx);
        return { computed: comp, mf: calcMF(operands, comp), omf: calcOMF(operands, comp) };
    } catch (_) {
        return null;
    }
}

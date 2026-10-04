import {
    resolveScanSide, isPPEF, removeOperandsAndDependents,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS, withDesignSampleCounts,
} from '../../../../utils/physics/optimizer.js';
import { generateARSeeds } from '../../../../utils/synthesis/seedGenerator.js';
import { getThreadCount } from '../../../../utils/synthesis/synthesisConfig.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

// ── Surface-mode-aware active synthesis side ────────────────────────────────────
// For both_independent the UI selector (when added) drives this; default 'front'.
export const sideKeyFor = (d) =>
    resolveScanSide(d?.surfaceMode || 'front_only', 'front') === 'back'
        ? 'backLayers' : 'frontLayers';
export const activeSide = (d) => resolveScanSide(d?.surfaceMode || 'front_only', 'front');

/**
 * Everything but the layer stacks, as a structured-clonable object a synthesis
 * worker can rebuild an evaluation context from.
 *
 * The cone spec and the stress run temperatures are included only when the
 * design carries them, so a worker that has neither stays on the single-angle,
 * intrinsic-stress-only path the main thread takes for the same design. A key
 * missing here is a merit function the worker scores differently from the
 * window that launched it, which is the one thing this object exists to
 * prevent.
 */
export function serializableMedia(design) {
    return {
        surfaceMode:    design.surfaceMode || 'front_only',
        mfEvalMode:     design.mfEvalMode ?? 'side',
        incidentMedium: design.incidentMedium ?? 'Air',
        exitMedium:     design.exitMedium ?? 'Air',
        substrate: {
            material:  design.substrate?.material ?? 'BK7',
            thickness: design.substrate?.thickness ?? 1.0,
        },
        ...(design.cone ? { cone: design.cone } : {}),
        ...(design.stress ? { stress: design.stress } : {}),
    };
}

// ── Rows a synthesis run leaves out ─────────────────────────────────────────────
// A peak-to-peak (PPEF) row scores the highest less the lowest error over its
// curve block, so its gradient sits on the two worst wavelengths alone. The
// needle function is the derivative of a smooth least-squares merit, and with
// such a row in it the search stalls. Every synthesis run therefore takes the
// PPEF rows out, with any math row that reads one, since that row has no value
// without it. The curve block stays, so the search fits the curve; Refinement
// keeps the PPEF rows.
//
// The block then carries the weight its peak-to-peak requirement had: the PPEF
// row's own and that of any row reading it, never less than the block's own.
// A Specification writes the block at weight 0 and puts the requirement on the
// PPEF row or on a ceiling over it, so without this the run would have nothing
// left to fit.
export function withoutPPEF(operands) {
    const ppefRows = operands.filter(op => isPPEF(op.type));
    if (!ppefRows.length) return operands;
    const carried = new Map();
    for (const row of ppefRows) {
        const kept = new Set(removeOperandsAndDependents(operands, [row.id]));
        const weight = operands.filter(op => !kept.has(op)).reduce((sum, op) => sum + (Number(op.weight) || 0), 0);
        carried.set(row.refId, Math.max(carried.get(row.refId) ?? 0, weight));
    }
    return removeOperandsAndDependents(operands, ppefRows.map(op => op.id)).map(op => {
        const weight = carried.get(op.id);
        return weight > (Number(op.weight) || 0) ? { ...op, weight } : op;
    });
}

// ── Run sampling grid ───────────────────────────────────────────────────────────
// At launch, band averages, integrals and range targets get the sample count the
// design's fringe spacing needs, then band-sampled operands whose bands hide a
// sub-grid spectral feature are densified so the synthesis merit isn't blind to
// narrow resonances. The result feeds BOTH requiredLambdas and the worker
// scan/refine jobs → byte-identical λ-grid contract preserved.
export function densifyForRun(ops, design) {
    const lookup = designMaterialLookup(design);
    return densifyOperandsForFeatures(withDesignSampleCounts(ops, design, lookup), design, lookup, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
        console.log(`[Adaptive] densified ${bumped} operand(s) for narrow features`
            + (capped ? ` (${capped} capped at ${ADAPTIVE_SAMPLING_DEFAULTS.maxPoints} pts)` : '')));
}

// Smallest OMF (optical merit, display only) across synthesis generations;
// null when no generation carries one. Used to show "best OMF" alongside the
// best MF in the synthesis control bars (the best ROW is still chosen by MF).
export function minOmfOf(gens) {
    let m = Infinity;
    for (const g of (gens || [])) if (g && g.omf != null && g.omf < m) m = g.omf;
    return Number.isFinite(m) ? m : null;
}

// Split an array into `k` ~equal contiguous chunks (drops empties).
export function chunkArray(arr, k) {
    const out = [];
    const n = Math.max(1, Math.ceil(arr.length / k));
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out.length ? out : [[]];
}

// Worker-pool size = the user's global Threads setting (detected-core default
// that leaves the main thread + headroom free; see getThreadCount). Was a fixed
// clamp(hw-1, 2, 8); now user-controllable and unshy on many-core CPUs.
export function poolSize() {
    return getThreadCount();
}

// ── Smart-seed generation (canonical QW/HW AR starting designs) ──────────────────
// Macleod ("Automatic Design"): synthesis works best from "a very good starting
// design", and needle/GE struggle to discover compact classics like the 3-layer
// quarter–half–quarter AR (its half-wave layer is absentee at λ0 → ~zero needle
// sensitivity). This builds the canonical QW/HW AR templates from the pool; the
// caller refines them OFF-THREAD on its worker pool and starts from the best.
//
// Candidate STARTING-design stacks for the in-run "smart seed" step.
// Returns the canonical QW/HW AR seeds AND the current design (placed
// FIRST so it is always in the running) as plain {name, frontLayers, backLayers}
// entries — NO refinement here. The caller refines every candidate OFF-THREAD on
// its existing worker pool and starts synthesis from the best, so the seed step
// never blocks the UI and can only match or improve the current starting point.
export function buildARSeedCandidates({ design, pool, maxLayers = Infinity }) {
    const lambda0 = design?.referenceWavelength || 550;
    const seeds = generateARSeeds({ pool, lambda0, baseDesign: design, maxLayers });
    const out = [{
        name: 'current',
        frontLayers: (design?.frontLayers || []).map(l => ({ ...l })),
        backLayers:  (design?.backLayers  || []).map(l => ({ ...l })),
    }];
    for (const s of seeds) {
        out.push({ name: s.name, frontLayers: s.frontLayers, backLayers: s.design.backLayers || [] });
    }
    return out;
}

// ── Pareto front over synthesis generations ─────────────────────────────────────
// Designs not dominated in (layerCount, mf): a design survives unless another is no
// worse on both axes and strictly better on at least one. Sorted by layer count.
export function computePareto(gens) {
    return gens.filter(a =>
        !gens.some(b =>
            b !== a &&
            b.layerCount <= a.layerCount && b.mf <= a.mf &&
            (b.layerCount < a.layerCount || b.mf < a.mf)
        )
    ).sort((a, b) => a.layerCount - b.layerCount);
}

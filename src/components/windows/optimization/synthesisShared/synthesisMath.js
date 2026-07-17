import {
    resolveScanSide,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../../../../utils/physics/optimizer.js';
import { generateARSeeds } from '../../../../utils/synthesis/seedGenerator.js';
import { getThreadCount } from '../../../../utils/synthesis/synthesisConfig.js';
import { resolveMat } from './materialNames.js';

// ── Surface-mode-aware active synthesis side ────────────────────────────────────
// For both_independent the UI selector (when added) drives this; default 'front'.
export const sideKeyFor = (d) =>
    resolveScanSide(d?.surfaceMode || 'front_only', 'front') === 'back'
        ? 'backLayers' : 'frontLayers';
export const activeSide = (d) => resolveScanSide(d?.surfaceMode || 'front_only', 'front');

// ── Adaptive merit sampling ─────────────────────────────────────────────────────
// Densify band-sampled operands whose bands hide a sub-grid spectral feature at
// launch so the synthesis merit isn't blind to narrow resonances. Densified
// operands feed BOTH requiredLambdas and the worker scan/refine jobs →
// byte-identical λ-grid contract preserved.
export function densifyForRun(ops, design) {
    return densifyOperandsForFeatures(ops, design, resolveMat, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
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

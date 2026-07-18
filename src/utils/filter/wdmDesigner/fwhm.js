/**
 * FWHM estimation, mirror-strength constraints, cavity-count suggestion, and
 * the prototype candidate table. See ../wdmDesigner.js for the full geometry
 * model and references.
 */

import { nReal } from './materials.js';
import { mirrorPairs_to_notationM } from './notation.js';
import { wdmLayerCount } from './stack.js';

// ── Multi-cavity FWHM narrowing factor ────────────────────────────────────────
//
// For an N-cavity all-dielectric filter the passband shape changes from
// triangular (N=1) to nearly rectangular (N=3+); the FWHM only narrows
// slightly — the dominant effect is steeper skirts, not a narrower passband.
// Calibrated against Macleod Ch.8 Fig.8.16–8.18 (DHW/THW examples).
//   N=1: 1.00    N=2: 0.85    N=3: 0.78    N=4: 0.72    N=5: 0.67
//   N=6: 0.63    N=7: 0.60    N=8: 0.58
// Used purely for displaying an "expected multi-cavity FWHM" hint; NOT used
// to invert the formula for k — the inverse solve uses single-cavity FWHM
// so the chosen mirror pair count is in the physically-meaningful range
// (R_mirror ≥ 99% requires k_mirror ≥ ~4).
const MULTICAVITY_FWHM_FACTOR = [null, 1.00, 0.85, 0.78, 0.72, 0.67, 0.63, 0.60, 0.58];
export function multicavityFwhmFactor(N) {
    if (N < 1) return 1.0;
    if (N >= MULTICAVITY_FWHM_FACTOR.length) {
        return MULTICAVITY_FWHM_FACTOR[MULTICAVITY_FWHM_FACTOR.length - 1];
    }
    return MULTICAVITY_FWHM_FACTOR[N];
}

// ── Mirror-strength constraints ───────────────────────────────────────────────
//
// A Fabry-Perot needs strong mirrors to be a filter at all. The reflectance
// of a k-pair (HL)^k mirror on substrate-side is approximately
//   R ≈ 1 − 4·(n_L/n_H)^(2k)·n_sub/n_H²
// We require R_mirror ≥ 99%; that translates to a minimum k roughly:
//   k_min ≈ ⌈ ln(4·n_sub·0.01⁻¹/n_H²) / (2·ln(n_H/n_L)) ⌉
// For Nb₂O₅/SiO₂/BK7 (n_H=2.26, n_L=1.44, n_sub=1.5) this is k_min ≈ 5;
// for Ta₂O₅/SiO₂ similar; for Al₂O₃/SiO₂ (lower contrast) up to k_min ≈ 12.
// We use [4, 18] as the practical band that covers all realistic combinations.
export const WDM_K_MIRROR_MIN = 4;
export const WDM_K_MIRROR_MAX = 18;
// Canonical spacer order range. m=1 (half-wave cavity) gives a single
// resonance per free spectral range — the only kind of design that yields a
// clean isolated bandpass. m=2,3 are occasionally used (Macleod §8.3 "higher
// orders") for narrower bands but introduce extra resonances inside the FSR
// that show as ghost peaks in the stopband. m≥4 is unusable for a clean
// bandpass — it generates a comb of m peaks across the visible.
export const WDM_M_SPACER_MIN = 1;
export const WDM_M_SPACER_MAX = 3;

// ── Analytic estimate (for preview/UI hint, NOT used for synthesis) ───────────

/**
 * Rough analytic FWHM estimate for a single-half-wave (SHW) Fabry-Perot
 * with H-spacer or L-spacer.  Macleod 5th ed. Eq. (7.27).
 *
 *   For an H-spacer:   Δλ_FWHM / λ₀ ≈ (4·n_L^(2k-1) · n_sub) / (π·m·n_H^(2k+1))
 *   For an L-spacer:   Δλ_FWHM / λ₀ ≈ (4·n_L^(2k+1)) / (π·m·n_H^(2k) · n_sub)
 *
 * For multi-cavity filters this is a coarse upper bound on each cavity's
 * intrinsic passband — the combined response is sharper. Treat as orientation,
 * not specification.
 */
export function estimateFWHM_nm({
    matH, matL, substrateMaterial = 'BK7',
    lambda0_nm, mirrorPairs, spacerOrder, spacerKind,
}) {
    const nH = nReal(matH, lambda0_nm);
    const nL = nReal(matL, lambda0_nm);
    const nS = nReal(substrateMaterial, lambda0_nm);
    if (!(nH > 0 && nL > 0 && nS > 0)) return null;
    const k = Math.max(1, Math.round(mirrorPairs));
    const m = Math.max(1, Math.round(spacerOrder));

    let ratio;
    if (spacerKind === 'H') {
        ratio = (4 * Math.pow(nL, 2 * k - 1) * nS) / (Math.PI * m * Math.pow(nH, 2 * k + 1));
    } else {
        ratio = (4 * Math.pow(nL, 2 * k + 1)) / (Math.PI * m * Math.pow(nH, 2 * k) * nS);
    }
    return Math.max(0, ratio * lambda0_nm);
}

// ── Inverse Macleod Eq. 7.27 — solve for k (QW pairs) from target FWHM ────────

/**
 * Given a desired SINGLE-CAVITY FWHM, solve Macleod Eq. 7.27 for the number
 * of QW pairs `k` in each mirror (returned as a real number; round to int
 * for the actual design).
 *
 * **Single-cavity formula, NO multi-cavity factor applied.** Each cavity in
 * an N-cavity filter has approximately the single-cavity FWHM and N copies
 * arranged in series shape the response (flatter top, steeper skirts) with
 * only modest additional narrowing — the multi-cavity behaviour is
 * predominantly a SHAPE change, not a width change.
 *
 * Returns null if materials are degenerate (n_H ≤ n_L) or target is
 * unreachable.
 */
export function solveMirrorPairsFromFWHM({
    matH, matL, substrateMaterial = 'BK7',
    lambda0_nm, targetFWHM_nm,
    spacerOrder = 1, spacerKind = 'L',
}) {
    const nH = nReal(matH, lambda0_nm);
    const nL = nReal(matL, lambda0_nm);
    const nS = nReal(substrateMaterial, lambda0_nm);
    if (!(nH > nL && nH > 0 && nL > 0 && nS > 0)) return null;

    const m = Math.max(1, spacerOrder);
    // From the L-spacer form of Eq. 7.27:
    //   Δλ/λ₀ = (4·n_L^(2k+1)) / (π·m·n_H^(2k)·n_sub)
    //         = (4·n_L / (π·m·n_sub)) · (n_L/n_H)^(2k)
    // So: (n_L/n_H)^(2k) = (Δλ·π·m·n_sub) / (4·λ₀·n_L)
    // 2k·ln(n_L/n_H) = ln((Δλ·π·m·n_sub) / (4·λ₀·n_L))
    // For H-spacer the constant prefactor differs but the (n_L/n_H)^(2k) tail
    // dominates; close enough for a UI suggestion.
    const ratio = nL / nH;             // < 1
    let rhs;
    if (spacerKind === 'H') {
        // From estimateFWHM_nm H-spacer formula: FWHM = 4·nL^(2k−1)·nS / (π·m·nH^(2k+1)) · λ₀
        // → (nL/nH)^(2k) = FWHM·π·m·nL·nH / (4·λ₀·nS)
        rhs = (targetFWHM_nm * Math.PI * m * nL * nH) / (4 * lambda0_nm * nS);
    } else {
        rhs = (targetFWHM_nm * Math.PI * m * nS) / (4 * lambda0_nm * nL);
    }
    if (!(rhs > 0)) return null;
    const k = Math.log(rhs) / (2 * Math.log(ratio));
    return Math.max(1, k);
}

/**
 * Recommend the minimum integer number of cavities q from the shape factor
 * SF = Δλ_r / Δλ_p, using **Chebyshev filter theory** (Tikhonravov &
 * Trubetskov, *Appl. Opt.* **41**(16), 3176-3182 (2002), §3).
 *
 * The transmittance of a q-cavity Chebyshev filter satisfies
 *   |T_q(x)| · ε ≈ √(1/T_stop − 1)
 * where T_q is the Chebyshev polynomial of order q, x is normalized
 * detuning, and ε ≈ 0.1 corresponds to the passband edge level (0.5 dB).
 * For the standard rejection level of 30 dB (T_stop = 0.001) this reduces
 * to `T_q(SF) ≈ 100`. Inverting the closed-form for |x| ≥ 1:
 *   T_q(x) = cosh(q · acosh(x))
 *   ⇒ q ≈ acosh(100) / acosh(SF) ≈ ln(200) / ln(SF + √(SF²−1))
 *
 * Cross-check vs Tikhonravov example: SF = 0.6/0.35 = 1.714 → q ≈ 4.7
 * → q = 5 (matches paper's "five or more").
 *
 * Replaces the previous lookup table that was far too aggressive
 * (e.g. it returned 5 cavities for SF=5 where Chebyshev says q=3 suffices).
 */
export function suggestCavities(shapeFactor) {
    if (!(shapeFactor > 1) || !isFinite(shapeFactor)) return 1;
    // ε comes from the passband edge spec (0.5 dB → T=0.8913 → ε²=0.258).
    // Stopband at 30 dB (T=0.001) requires ε²·T_q(SF)² = 999, so
    // T_q(SF) ≈ √(999/0.258) ≈ 62 → acosh(62) = ln(62 + √(62²−1)) ≈ ln(124).
    const acoshSF = Math.log(shapeFactor + Math.sqrt(shapeFactor * shapeFactor - 1));
    const acoshTarget = Math.log(124);
    const q = acoshTarget / acoshSF;
    return Math.max(1, Math.min(8, Math.ceil(q)));
}

// Approximate mirror reflectance using the high-Q QW-stack limit:
//   R ≈ 1 − 4·(n_L/n_H)^(2k)·n_sub / n_H²   (substrate-side mirror)
function mirrorReflectance(nH, nL, nS, k) {
    return Math.max(0, 1 - 4 * Math.pow(nL / nH, 2 * k) * nS / (nH * nH));
}

// Enumerate mirror-pair counts k ∈ [kLo, kHi] for one spacer order m, seeded
// around the analytic inverse-FWHM solve, and score each against the target.
function buildCandidateRowsForSpacerOrder(m, params, indices) {
    const { matH, matL, substrateMaterial, lambda0_nm, targetFWHM_nm, spacerKind } = params;
    const { nH, nL, nS, N, factor } = indices;
    const kSeed = solveMirrorPairsFromFWHM({
        matH, matL, substrateMaterial, lambda0_nm,
        targetFWHM_nm, spacerOrder: m, spacerKind,
    });
    const kCenter = kSeed == null ? 8 : Math.round(kSeed);
    const kLo = Math.max(WDM_K_MIRROR_MIN, kCenter - 2);
    const kHi = Math.min(WDM_K_MIRROR_MAX, Math.max(kCenter + 2, kLo + 4));

    const rows = [];
    for (let k = kLo; k <= kHi; k++) {
        const est = estimateFWHM_nm({
            matH, matL, substrateMaterial,
            lambda0_nm, mirrorPairs: k, spacerOrder: m, spacerKind,
        });
        rows.push({
            notationM: mirrorPairs_to_notationM(k),
            notationK: m,
            mirrorPairs: k,
            spacerOrder: m,
            estimatedFWHM_nm: est == null ? null : est,
            multiCavityFWHM_nm: est == null ? null : est * factor,
            totalLayers: wdmLayerCount(N, k),
            mirrorReflectance: mirrorReflectance(nH, nL, nS, k),
        });
    }
    return rows;
}

/**
 * Build a candidate prototype table for step 3.
 *
 * For each spacer order m ∈ [WDM_M_SPACER_MIN, WDM_M_SPACER_MAX] AND for a
 * range of mirror-pair counts k ∈ [WDM_K_MIRROR_MIN, WDM_K_MIRROR_MAX], we
 * compute the resulting estimated single-cavity FWHM. The rows are sorted
 * by `|estimatedFWHM − target|` so the closest match comes first.
 *
 * Anchoring point: the "solve for k from target FWHM" approach is used as
 * a SEED for the table — we include k values within ±2 of the analytic
 * inverse, but we never go below k=4 or above k=18, and we never use
 * spacer order ≥ 4 (which creates ghost peaks in the stopband). This makes
 * it physically impossible for the wizard to suggest a degenerate prototype
 * like (k=1, m=7) that the previous version did.
 *
 *   row = {
 *     notationM, notationK,         // (m, k) notation for display
 *     mirrorPairs, spacerOrder,       // canonical internal naming
 *     estimatedFWHM_nm,               // single-cavity Macleod estimate
 *     multiCavityFWHM_nm,             // est × multicavityFwhmFactor(N)
 *     totalLayers,                    // N · (4·k + 1)
 *     mirrorReflectance,              // approximate R_mirror (informational)
 *   }
 */
export function buildPrototypeCandidates(params) {
    const {
        matH, matL, substrateMaterial = 'BK7',
        lambda0_nm, targetFWHM_nm,
        spacerKind = 'L', cavities = 1,
    } = params;

    const nH = nReal(matH, lambda0_nm);
    const nL = nReal(matL, lambda0_nm);
    const nS = nReal(substrateMaterial, lambda0_nm);
    if (!(nH > nL)) return [];

    const N = Math.max(1, Math.round(cavities));
    const factor = multicavityFwhmFactor(N);
    const fullParams = { matH, matL, substrateMaterial, lambda0_nm, targetFWHM_nm, spacerKind };

    const rows = [];
    for (let m = WDM_M_SPACER_MIN; m <= WDM_M_SPACER_MAX; m++) {
        rows.push(...buildCandidateRowsForSpacerOrder(m, fullParams, { nH, nL, nS, N, factor }));
    }

    // Sort by closeness to target single-cavity FWHM, then by lower spacer
    // order (m=1 preferred), then by lower mirror count.
    rows.sort((a, b) => {
        const da = a.estimatedFWHM_nm == null ? Infinity : Math.abs(a.estimatedFWHM_nm - targetFWHM_nm);
        const db = b.estimatedFWHM_nm == null ? Infinity : Math.abs(b.estimatedFWHM_nm - targetFWHM_nm);
        if (da !== db) return da - db;
        if (a.spacerOrder !== b.spacerOrder) return a.spacerOrder - b.spacerOrder;
        return a.mirrorPairs - b.mirrorPairs;
    });
    return rows;
}

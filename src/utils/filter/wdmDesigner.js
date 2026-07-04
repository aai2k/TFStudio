/**
 * WDM Filter Design — multi-cavity Fabry-Perot prototype generator.
 *
 * References:
 *   - H. A. Macleod, *Thin-Film Optical Filters* 5th ed., Ch. 7-8
 *     "Multiple-cavity Narrow Band-pass Filters", esp. §8.2
 *   - Tikhonravov & Trubetskov, *Appl. Opt.* **41**, 3176 (2002), §3
 *
 * Canonical topology (q cavities, k QW pairs per mirror, spacer order m):
 *
 *   Substrate | M_1  S_1  M_2  S_2  …  M_q  S_q  M_{q+1} | optional AR | Air
 *
 * Where (using L-spacer as the example — H-spacer mirrors all materials):
 *   - S_i  = one physical layer of L (or H), thickness 2m·d_L
 *            (m half-waves at λ₀; m=1 ⇒ half-wave, m=2 ⇒ full-wave, …)
 *   - M_1  = (LH)^k        — 2k layers, starts L (substrate), ends H (spacer-facing)
 *   - M_2…M_q = H(LH)^k    — 2k+1 layers, starts H, ends H (both faces = spacer-side)
 *   - M_{q+1} = (HL)^k     — 2k layers, starts H (spacer-facing), ends L (air-side)
 *
 * For dispersive materials we sample n(λ₀) once; the TMM evaluator handles
 * full dispersion at run time.
 *
 * Multi-peak preview: the SYMMETRIC prototype has q sub-peaks across the
 * passband (textbook Chebyshev ripple, Macleod Fig 8.16) that merge into a
 * flat-top after Global Integer Search / Refinement / Needle. Users seeing
 * "N peaks for an N-cavity filter" are looking at the unoptimized starting
 * prototype — that's expected, not a bug.
 *
 * Total layer count: 2k·(q+1) + 2q − 1   (+1 for optional AR top L)
 */

import { getMaterialById } from '../materials/catalogManager.js';
import { makeOperand, makeConstraintOperand, makeDmfsOperand } from '../physics/optimizer.js';

// Minimal default-design factory — kept local so `wdmDesigner.js` can be
// imported under Node (DesignContext.js touches the React global). Mirrors
// the shape produced by `makeDefaultDesign` in DesignContext.js.
function _uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function _makeBaseDesign(name) {
    const ts = _uid();
    return {
        id: `design-${ts}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        frontLayers: [],
        backLayers: [],
        referenceWavelength: 550,
        notes: '',
    };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function nReal(materialId, lambda0_nm) {
    const mat = getMaterialById(materialId);
    if (!mat || !mat.getNK) return 1.0;
    const [n] = mat.getNK(lambda0_nm);
    return n;
}

function kImag(materialId, lambda0_nm) {
    const mat = getMaterialById(materialId);
    if (!mat || !mat.getNK) return 0;
    const [, k] = mat.getNK(lambda0_nm);
    return k;
}

/**
 * The WDM wizard requires lossless materials (only materials
 * without absorption can be used in this procedure). For a Fabry-Perot
 * with mirror reflectance R, the field enhancement inside the cavity scales
 * as 1/(1−R)² → even tiny k accumulates into large absorption (Ta₂O₅ at
 * 1550 nm has k≈3e-3 in the refractiveindex.info data; peak T drops to ~6%
 * for a 3-cavity DWDM design). Threshold 1e-5 covers all practical
 * high-Q DWDM filter applications.
 */
export const WDM_LOSSY_THRESHOLD = 1e-5;
export function isMaterialLosslessForWDM(materialId, lambda0_nm) {
    return kImag(materialId, lambda0_nm) <= WDM_LOSSY_THRESHOLD;
}

/** Quarter-wave physical thickness (nm) at λ₀ for the given material. */
function qwThickness(materialId, lambda0_nm) {
    const n = nReal(materialId, lambda0_nm);
    if (!(n > 0)) return 0;
    return lambda0_nm / (4 * n);
}

function newLayerId(seed, idx) {
    return `l-${seed}-${idx}`;
}

// ── Stack builder ─────────────────────────────────────────────────────────────

/**
 * Build the layer sequence (no merit operands yet).
 *
 * params:
 *   matH, matL          — material IDs (e.g. 'builtin:Ta2O5')
 *   lambda0_nm          — center wavelength (nm)
 *   cavities            — N (integer, ≥1)
 *   mirrorPairs         — k QW pairs in each (HL) sequence (integer, ≥1)
 *   spacerOrder         — m (integer, ≥1)  — half-waves in each spacer
 *   spacerKind          — 'H' or 'L'      — which material is the spacer
 *   includeAR           — bool: prepend a single QW L matching layer (cheap default)
 *
 * Returns:
 *   { layers: [{id, material, thickness, locked}], H_QW, L_QW, totalNm }
 */
export function buildWDMStack(params) {
    const {
        matH, matL,
        lambda0_nm,
        cavities = 1,
        mirrorPairs = 5,
        spacerOrder = 1,
        spacerKind = 'L',
        includeAR = false,
    } = params;

    const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const layers = [];

    const dH = qwThickness(matH, lambda0_nm);
    const dL = qwThickness(matL, lambda0_nm);
    if (!(dH > 0 && dL > 0)) {
        throw new Error('WDM: material refractive index lookup failed at λ₀');
    }

    const N = Math.max(1, Math.round(cavities));
    const k = Math.max(1, Math.round(mirrorPairs));
    const m = Math.max(1, Math.round(spacerOrder));

    const dSpacer = (spacerKind === 'H' ? dH : dL) * 2 * m;
    const spacerMat = spacerKind === 'H' ? matH : matL;

    let layerIdx = 0;
    const push = (mat, d) => layers.push({
        id: newLayerId(seed, layerIdx++),
        material: mat,
        thickness: d,
        locked: false,
    });

    // Canonical multi-cavity layout (Tikhonravov & Trubetskov 2002 §3;
    // Macleod 5th ed. §8.2): for q cavities the stack is
    //   M_1  S_1  M_2  S_2  …  M_q  S_q  M_{q+1}
    // q+1 mirrors interleaved with q spacers. Each spacer must be sandwiched
    // between layers of the OPPOSITE material so the explicit spacer doesn't
    // blend with the adjacent mirror layer (otherwise "half-wave" becomes
    // full-wave and the cavity supports multiple modes per FSR → ghost peaks).
    //
    // For an L spacer (the canonical choice for visible / NIR designs):
    //   M_1 (substrate side, outermost left):   (LH)^k        — starts L (matches
    //                                                            BK7), ends H facing spacer.
    //   M_2 … M_q (inner mirrors, both faces touch spacers):  H(LH)^k = 2k+1 layers
    //                                                          starts H, ends H.
    //   M_{q+1} (air side, outermost right):    (HL)^k        — starts H facing
    //                                                            spacer, ends L (toward air).
    //
    // For H spacer everything mirrors: M_1=(HL)^k, inner=L(HL)^k, M_{q+1}=(LH)^k.
    //
    // The previous concatenation `(HL)^k S (LH)^k (HL)^k S (LH)^k …` instead
    // created adjacent same-material QW layers at every cavity boundary, which
    // act as half-wave absentee layers and break the QW-stack mirror behaviour.
    // That's the topology bug behind the "5 ghost peaks for a 3-cavity filter"
    // case the user reported.
    const isLSpacer = (spacerKind !== 'H');
    const pushOuterLeft  = () => {
        if (isLSpacer)
            for (let i = 0; i < k; i++) { push(matL, dL); push(matH, dH); }
        else
            for (let i = 0; i < k; i++) { push(matH, dH); push(matL, dL); }
    };
    const pushInnerMirror = () => {
        // 2k+1 layers, starts and ends with the spacer-facing material.
        if (isLSpacer) {
            push(matH, dH);
            for (let i = 0; i < k; i++) { push(matL, dL); push(matH, dH); }
        } else {
            push(matL, dL);
            for (let i = 0; i < k; i++) { push(matH, dH); push(matL, dL); }
        }
    };
    const pushOuterRight = () => {
        if (isLSpacer)
            for (let i = 0; i < k; i++) { push(matH, dH); push(matL, dL); }
        else
            for (let i = 0; i < k; i++) { push(matL, dL); push(matH, dH); }
    };

    pushOuterLeft();
    for (let cav = 0; cav < N; cav++) {
        push(spacerMat, dSpacer);
        if (cav < N - 1) pushInnerMirror();
    }
    pushOuterRight();

    if (includeAR) {
        // Single QW of L on top — partially matches H-terminated stack to air.
        // Crude but a useful seed; user can run Refinement / Needle afterwards.
        push(matL, dL);
    }

    const totalNm = layers.reduce((s, l) => s + l.thickness, 0);
    return { layers, H_QW: dH, L_QW: dL, totalNm, spacerNm: dSpacer, m, k, N };
}

/**
 * Layer count for the canonical N-cavity q+1-mirror layout produced by
 * `buildWDMStack`:
 *   2 outer mirrors @ 2k layers each
 * + (N−1) inner mirrors @ 2k+1 layers each
 * + N spacers @ 1 layer each
 * = 4k + (N−1)·(2k+1) + N
 * = 2k·(N+1) + 2N − 1                (for N ≥ 1)
 * Independent of spacer kind. AR layer adds +1 if includeAR.
 */
export function wdmLayerCount(N, k) {
    if (N < 1 || k < 1) return 0;
    return 2 * k * (N + 1) + 2 * N - 1;
}

// ── Merit operand defaults ────────────────────────────────────────────────────

/**
 * Generate a sensible default merit-function operand set for a bandpass:
 *   - DMFS comment summarizing the filter
 *   - TAV target=1.0 over the passband
 *   - RAV target=1.0 over a low stopband and a high stopband (each separated
 *     from the passband by `transitionNm` gap)
 *   - MNT / MXT thickness constraints (15 / 1000 nm) covering the whole stack
 *
 * params:
 *   lambda0_nm
 *   passbandFWHM_nm      — full width (we treat as half-width either side: ±FWHM/2)
 *   stopbandWidth_nm     — half-width of each rejection band
 *   transitionNm         — gap between pass edge and stop edge (nm)
 *   aoi
 *   pol                  — 'avg' | 's' | 'p'
 *   minThicknessNm       — MNT target (default 15)
 *   maxThicknessNm       — MXT target (default 1000)
 *   filterLabel          — string for the DMFS comment
 */
export function buildWDMOperands(params) {
    const {
        lambda0_nm,
        passbandFWHM_nm = 10,
        stopbandWidth_nm = 50,
        transitionNm = 5,
        aoi = 0,
        pol = 'avg',
        minThicknessNm = 15,
        maxThicknessNm = 1000,
        filterLabel = 'WDM bandpass',
    } = params;

    const halfPass = passbandFWHM_nm / 2;
    const passStart = lambda0_nm - halfPass;
    const passEnd   = lambda0_nm + halfPass;
    const lowStopEnd   = passStart - transitionNm;
    const lowStopStart = Math.max(50, lowStopEnd - stopbandWidth_nm);
    const highStopStart = passEnd + transitionNm;
    const highStopEnd   = highStopStart + stopbandWidth_nm;

    const polCode = pol === 's' ? 'S' : pol === 'p' ? 'P' : 'AV';
    const TAV = 'T' + polCode;
    const RAV = 'R' + polCode;

    const ops = [];
    ops.push(makeDmfsOperand(
        `${filterLabel}  λ₀=${lambda0_nm.toFixed(1)} nm  FWHM≈${passbandFWHM_nm.toFixed(1)} nm  ` +
        `AOI=${aoi}°  pol=${pol}`
    ));
    // Passband T → 1
    ops.push(makeOperand({
        type: TAV, lambdaStart: passStart, lambdaEnd: passEnd,
        aoi, pol, target: 1.0, weight: 2.0,
    }));
    // Low stop R → 1
    if (lowStopEnd > lowStopStart) {
        ops.push(makeOperand({
            type: RAV, lambdaStart: lowStopStart, lambdaEnd: lowStopEnd,
            aoi, pol, target: 1.0, weight: 1.0,
        }));
    }
    // High stop R → 1
    ops.push(makeOperand({
        type: RAV, lambdaStart: highStopStart, lambdaEnd: highStopEnd,
        aoi, pol, target: 1.0, weight: 1.0,
    }));
    // MNT / MXT thickness constraints across the full stack (lambdaEnd=9999
    // sentinel so they cover layers later added by GE/Needle, matching the
    // FILTER_TYPES wizard convention).
    ops.push(makeConstraintOperand({
        type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: minThicknessNm,
    }));
    ops.push(makeConstraintOperand({
        type: 'MXT', lambdaStart: 1, lambdaEnd: 9999, target: maxThicknessNm,
    }));

    return ops;
}

// ── Full design assembly ──────────────────────────────────────────────────────

/**
 * Build a complete TFStudio Design object from WDM wizard parameters.
 *
 * Combines `buildWDMStack` + `buildWDMOperands` and packages them in a fresh
 * design with sensible substrate / media defaults. Returns a design object
 * that can be handed straight to the project explorer's `addItem`-style flow.
 */
export function buildWDMDesign(params) {
    const {
        name = 'WDM Filter',
        matH, matL,
        substrateMaterial = 'BK7',
        substrateThicknessMm = 1.0,
        incidentMedium = 'Air',
        exitMedium = 'Air',
        lambda0_nm,
        cavities, mirrorPairs, spacerOrder, spacerKind, includeAR,
        passbandFWHM_nm, stopbandWidth_nm, transitionNm,
        aoi = 0, pol = 'avg',
        minThicknessNm, maxThicknessNm,
    } = params;

    const stack = buildWDMStack({
        matH, matL, lambda0_nm,
        cavities, mirrorPairs, spacerOrder, spacerKind, includeAR,
    });
    const operands = buildWDMOperands({
        lambda0_nm, passbandFWHM_nm, stopbandWidth_nm, transitionNm,
        aoi, pol, minThicknessNm, maxThicknessNm,
        filterLabel: `WDM ${cavities}-cavity (k=${mirrorPairs}, m=${spacerOrder})`,
    });

    const base = _makeBaseDesign(name);
    return {
        ...base,
        name,
        referenceWavelength: lambda0_nm,
        incidentMedium,
        substrate: { material: substrateMaterial, thickness: substrateThicknessMm },
        exitMedium,
        surfaceMode: 'front_only',
        frontLayers: stack.layers,
        backLayers: [],
        meritOperands: operands,
        notes: `Generated by WDM wizard\n` +
               `λ₀ = ${lambda0_nm} nm,  H = ${matH},  L = ${matL}\n` +
               `${stack.N}-cavity, k=${stack.k} QW pairs per mirror, ` +
               `spacer order m=${stack.m} (${spacerKind})\n` +
               `Total physical thickness ≈ ${stack.totalNm.toFixed(1)} nm,  ` +
               `${stack.layers.length} layers`,
        // Carry the wizard recipe so a future "edit wizard params" command can
        // re-open it preloaded; not used by anything else right now.
        wdmRecipe: {
            lambda0_nm, cavities, mirrorPairs, spacerOrder, spacerKind, includeAR,
            matH, matL, substrateMaterial, incidentMedium, exitMedium,
            passbandFWHM_nm, stopbandWidth_nm, transitionNm, aoi, pol,
            minThicknessNm, maxThicknessNm,
        },
        _wdmStackInfo: stack,
    };
}

// ── (m, k) parameter translation ──────────────────────────────────────────────
//
// The standard WDM (m, k) notation uses:
//   m = number of external mirror LAYERS (counting H and L)
//   k = order of prototype spacer (half-waves)
//
// Internal code uses `mirrorPairs` (= H+L QW pairs) and `spacerOrder`.
// Mapping:
//   m  =  2 · mirrorPairs    (each "pair" is 2 layers)
//   k  =  spacerOrder
//
// Conversion helpers so UI / candidate tables can speak (m, k) notation.

export function notationM_to_mirrorPairs(m) { return Math.max(1, Math.round(m / 2)); }
export function mirrorPairs_to_notationM(p) { return 2 * Math.max(1, Math.round(p)); }

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
export function buildPrototypeCandidates({
    matH, matL, substrateMaterial = 'BK7',
    lambda0_nm, targetFWHM_nm,
    spacerKind = 'L', cavities = 1,
}) {
    const nH = nReal(matH, lambda0_nm);
    const nL = nReal(matL, lambda0_nm);
    const nS = nReal(substrateMaterial, lambda0_nm);
    if (!(nH > nL)) return [];

    const N = Math.max(1, Math.round(cavities));
    const factor = multicavityFwhmFactor(N);
    const rows = [];

    for (let m = WDM_M_SPACER_MIN; m <= WDM_M_SPACER_MAX; m++) {
        // Use the analytic inverse as a seed, then enumerate ±2 around it.
        const kSeed = solveMirrorPairsFromFWHM({
            matH, matL, substrateMaterial, lambda0_nm,
            targetFWHM_nm, spacerOrder: m, spacerKind,
        });
        const kCenter = kSeed == null ? 8 : Math.round(kSeed);
        const kLo = Math.max(WDM_K_MIRROR_MIN, kCenter - 2);
        const kHi = Math.min(WDM_K_MIRROR_MAX, Math.max(kCenter + 2, kLo + 4));

        for (let k = kLo; k <= kHi; k++) {
            const est = estimateFWHM_nm({
                matH, matL, substrateMaterial,
                lambda0_nm, mirrorPairs: k, spacerOrder: m, spacerKind,
            });
            // Approximate mirror reflectance using the high-Q QW-stack limit:
            //   R ≈ 1 − 4·(n_L/n_H)^(2k)·n_sub / n_H²   (substrate-side mirror)
            const Rmirror = Math.max(0, 1 - 4 * Math.pow(nL / nH, 2 * k) * nS / (nH * nH));
            rows.push({
                notationM: mirrorPairs_to_notationM(k),
                notationK: m,
                mirrorPairs: k,
                spacerOrder: m,
                estimatedFWHM_nm: est == null ? null : est,
                multiCavityFWHM_nm: est == null ? null : est * factor,
                totalLayers: wdmLayerCount(N, k),
                mirrorReflectance: Rmirror,
            });
        }
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

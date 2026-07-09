/**
 * Interface Roughness / Scattering — Total Integrated Scatter (TIS) and
 * effective specular reflectance for a multilayer coating with random
 * rms surface roughness at each interface.
 *
 * Model: scalar uncorrelated roughness, Macleod Eq. 16.30 generalized to
 * oblique incidence and to multiple interfaces via the standard "effective
 * roughness" sum (Bousquet & Elson 1981; Macleod 5th ed. §16 "Scattering",
 * Eq. 16.30):
 *
 *     TIS(λ) = R(λ) · (4π · σ_eff · cosθ / λ)²
 *     σ_eff² = Σ σ_i²                                 (uncorrelated case)
 *
 * The per-interface σ_i is an rms surface roughness in nm. Each interface
 * scatters independently (uncorrelated roughness assumption) so the σ_i²
 * add. TIS is the fraction of the *reflected* light that is scattered out
 * of the specular direction — multiplying by R(λ) gives the fraction of
 * *incident* light scattered (the more commonly-plotted quantity for
 * coating engineers comparing specular performance to scattering loss).
 *

// ── Effective roughness ──────────────────────────────────────────────────────

/**
 * Effective rms roughness for uncorrelated interfaces.
 *
 *   σ_eff = sqrt(Σ σ_i²)
 *
 * Non-finite or non-positive σ entries are skipped (they are treated as
 * "smooth" interfaces — no scattering contribution).
 *
 * @param {number[]} sigmas  array of per-interface rms roughness in nm
 * @returns {number} σ_eff in nm
 */
export function effectiveRoughness(sigmas) {
    if (!Array.isArray(sigmas)) return 0;
    let s2 = 0;
    for (const s of sigmas) {
        if (Number.isFinite(s) && s > 0) s2 += s * s;
    }
    return Math.sqrt(s2);
}

// ── TIS at a single λ ────────────────────────────────────────────────────────

/**
 * Total Integrated Scatter at a single wavelength.
 *
 * @param {number} lambda_nm   wavelength in nm
 * @param {number} sigmaEff_nm effective rms roughness in nm
 * @param {number} theta_deg   angle of incidence in degrees (0 = normal)
 * @param {number} [R=1.0]     reflectance of the smooth-surface mirror
 *                             (use 1.0 for the bare-surface convention
 *                             matching Macleod 16.30; pass R(λ) from the
 *                             design to get the fraction of incident light
 *                             that is scattered out of specular)
 * @returns {number} TIS as a fractional intensity (0..1; will exceed 1 only
 *                   if σ is unphysical — the formula is a small-σ approx).
 */
export function tisAtLambda(lambda_nm, sigmaEff_nm, theta_deg, R = 1.0) {
    if (!(lambda_nm > 0) || !(sigmaEff_nm > 0)) return 0;
    const cosTheta = Math.cos(theta_deg * Math.PI / 180);
    const phase = 4 * Math.PI * sigmaEff_nm * cosTheta / lambda_nm;
    return Math.max(0, R) * phase * phase;
}

// ── TIS spectrum ─────────────────────────────────────────────────────────────

/**
 * TIS spectrum on a wavelength array. Per-element computation; pass R[λ] to
 * get TIS_inc(λ) (scattering loss as a fraction of incident light); pass
 * `null` for R to get TIS_surf(λ) (the bare surface property, normalized to
 * a smooth mirror).
 *
 * @param {number[]} lambda_nm
 * @param {number}   sigmaEff_nm
 * @param {number}   theta_deg
 * @param {number[]|null} Rspectrum
 * @returns {number[]} TIS(λ) (same length as lambda_nm)
 */
export function tisSpectrum(lambda_nm, sigmaEff_nm, theta_deg, Rspectrum = null) {
    if (!Array.isArray(lambda_nm)) return [];
    const cosTheta = Math.cos(theta_deg * Math.PI / 180);
    const out = new Array(lambda_nm.length);
    for (let i = 0; i < lambda_nm.length; i++) {
        const lam = lambda_nm[i];
        if (!(lam > 0) || !(sigmaEff_nm > 0)) { out[i] = 0; continue; }
        const phase = 4 * Math.PI * sigmaEff_nm * cosTheta / lam;
        const R = Rspectrum ? (Rspectrum[i] ?? 1.0) : 1.0;
        out[i] = Math.max(0, R) * phase * phase;
    }
    return out;
}

// ── Effective specular R, T after scattering loss ────────────────────────────

/**
 * Apply scattering loss to a baseline (R, T) spectrum. The scattering loss
 * removes flux from BOTH the specularly-reflected beam AND the
 * specularly-transmitted beam (light scattered into other hemispheres or
 * absorbed at the rough interface no longer contributes to specular).
 *
 * The standard "small-roughness" approximation applies the same TIS factor
 * to R and T equally:
 *
 *   R_spec = R · (1 - TIS_per_R)
 *   T_spec = T · (1 - TIS_per_T)
 *
 * For the v1 uniform-σ model we use TIS_per_R = TIS_per_T = (4πσcosθ/λ)²
 * (the small-angle small-σ limit; Macleod 16.30 says "we can represent the
 * loss as an extinction coefficient", which for the bidirectional case gives
 * the same fractional reduction on both sides).
 *
 * @param {number[]} lambda_nm
 * @param {number[]} R           baseline reflectance spectrum
 * @param {number[]} T           baseline transmittance spectrum
 * @param {number}   sigmaEff_nm
 * @param {number}   theta_deg
 * @returns {{R_spec:number[], T_spec:number[], TIS_per_R:number[]}} where
 *          TIS_per_R[i] is the per-λ scatter fraction as in Macleod 16.30
 *          (i.e. NOT yet multiplied by R; that's the surface property).
 */
export function applyScatteringLoss(lambda_nm, R, T, sigmaEff_nm, theta_deg) {
    if (!Array.isArray(lambda_nm) || !Array.isArray(R) || !Array.isArray(T)) {
        return { R_spec: R || [], T_spec: T || [], TIS_per_R: [] };
    }
    const cosTheta = Math.cos(theta_deg * Math.PI / 180);
    const n = lambda_nm.length;
    const R_spec = new Array(n);
    const T_spec = new Array(n);
    const TIS_per_R = new Array(n);
    for (let i = 0; i < n; i++) {
        const lam = lambda_nm[i];
        let tis_pr = 0;
        if (lam > 0 && sigmaEff_nm > 0) {
            const phase = 4 * Math.PI * sigmaEff_nm * cosTheta / lam;
            tis_pr = phase * phase;
        }
        TIS_per_R[i] = tis_pr;
        // Clamp loss factor to [0, 1] — large σ would otherwise push it
        // negative; that's outside the validity of the small-roughness
        // approximation but we cap to keep curves physical.
        const loss = Math.min(1, tis_pr);
        R_spec[i] = R[i] * (1 - loss);
        T_spec[i] = T[i] * (1 - loss);
    }
    return { R_spec, T_spec, TIS_per_R };
}

// ── Roughness spec & interface enumeration ───────────────────────────────────

/**
 * A roughness spec is one of:
 *   - { mode: 'uniform', sigma: number }                    one value for all interfaces
 *   - { mode: 'perInterface', sigmas: number[] }            explicit array
 *
 * `enumerateInterfaces` returns the indexable interface labels. Length =
 * frontLayers.length + 1 (between every adjacent pair, plus the medium and
 * substrate boundaries — same convention as `inhomogeneity.enumerateInterfaces`).
 */
export function emptyRoughness() {
    return { mode: 'uniform', sigma: 1.0, sigmas: [], backSigmas: [] };
}

export function cloneRoughness(r) {
    if (!r) return emptyRoughness();
    return {
        mode:       r.mode || 'uniform',
        sigma:      Number.isFinite(r.sigma) ? r.sigma : 1.0,
        sigmas:     Array.isArray(r.sigmas)     ? r.sigmas.slice()     : [],
        // Per-interface roughness for the BACK stack (used in back/total modes).
        // Uniform mode shares the single `sigma` across both stacks.
        backSigmas: Array.isArray(r.backSigmas) ? r.backSigmas.slice() : [],
    };
}

/**
 * Resolve the spec to an array of σ_i for use by `effectiveRoughness`.
 *
 * @param {object} spec
 * @param {number} nInterfaces  number of interfaces in the stack
 * @returns {number[]} array of length nInterfaces
 */
export function resolveSigmas(spec, nInterfaces) {
    const N = Math.max(0, nInterfaces || 0);
    if (!spec || spec.mode === 'uniform') {
        const s = Number.isFinite(spec?.sigma) ? spec.sigma : 0;
        return new Array(N).fill(s);
    }
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
        const s = spec.sigmas?.[i];
        out[i] = Number.isFinite(s) ? s : 0;
    }
    return out;
}

/**
 * Number of interfaces in a front stack: N layers ⇒ N+1 interfaces
 * (medium→L1, L1→L2, …, L_{N-1}→L_N, L_N→substrate). If the stack is empty,
 * there are no coating interfaces and the substrate has the medium→substrate
 * interface only (returns 1).
 */
export function countInterfaces(nLayers) {
    return Math.max(1, (nLayers || 0) + 1);
}

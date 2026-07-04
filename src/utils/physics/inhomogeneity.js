/**
 * Inhomogeneities & Interlayers — model graded-index regions in a thin-film
 * stack by SLICING them into N homogeneous sub-layers (Macleod 5th ed.
 * "Inhomogeneous Layers", chunk 137; also chunk 513 — Marseille method
 * "uses a model for the layer consisting of at least 10 homogeneous
 * sublayers with linearly varying values of n").
 *
 * Two grading mechanisms are supported:
 *
 *   1. INTERLAYERS — a graded transition layer INSERTED at the interface
 *      between two adjacent layers (or between the incident medium and the
 *      first layer / between the last layer and the substrate). Its material
 *      varies smoothly from layer-A material to layer-B material across its
 *      thickness, using a chosen profile.
 *
 *   2. BODY GRADING — a single layer whose own n,k varies through its
 *      thickness. v1 supports this only by expressing it as an "interlayer
 *      from material to itself" with a chosen Δn — the same machinery covers
 *      it. A future version may add a first-class `layer.inhomogeneity` field
 *      with start/end indices independent of the bordering layers.
 *
 * The mixing rule between two materials at fraction f ∈ [0,1] is LINEAR
 * (n_eff = (1-f)·n_A + f·n_B). This matches the Macleod-Marseille
 * "linearly varying n" convention. More sophisticated effective-medium
 * approximations (Bruggeman, Maxwell-Garnett, Lorentz-Lorenz) are deferred to a
 * future version — the linear rule is the canonical
 * starting point in the reference literature and is the one the standard
 * "10 sub-layers" guidance assumes.
 */

// ── Profile functions: t ∈ [0,1] → f ∈ [0,1] (B-fraction) ────────────────────

export const PROFILES = {
    /** Pure linear ramp — matches Macleod-Marseille. */
    linear:      (t) => t,
    /** Parabolic (concave): more A at start, ramp accelerates. */
    parabolic:   (t) => t * t,
    /** Inverse parabolic (convex): ramps fast then plateaus. */
    invParabolic:(t) => 1 - (1 - t) * (1 - t),
    /** Gentle exponential (e^3 scale, normalized to [0,1] at endpoints). */
    exponential: (t) => (Math.exp(t * 3) - 1) / (Math.exp(3) - 1),
    /** Sigmoid (logistic, slope 12 at midpoint, normalized to [0,1]). */
    sigmoid:     (t) => {
        const s = 1 / (1 + Math.exp(-12 * (t - 0.5)));
        const s0 = 1 / (1 + Math.exp( 6));       // value at t=0
        const s1 = 1 / (1 + Math.exp(-6));       // value at t=1
        return (s - s0) / (s1 - s0);
    },
};

export const PROFILE_IDS = Object.keys(PROFILES);

/**
 * Apply the named profile, falling back to linear if the id is unknown.
 */
export function applyProfile(profileId, t) {
    const f = PROFILES[profileId] || PROFILES.linear;
    // Clamp to [0,1] defensively — profiles SHOULD already do this but we
    // want a hard guarantee for downstream mixMaterials.
    const v = f(Math.max(0, Math.min(1, t)));
    return Math.max(0, Math.min(1, v));
}

// ── Material mixing (linear effective medium) ────────────────────────────────

/**
 * Linear two-material mix at fraction f ∈ [0,1] (0 → pure A, 1 → pure B).
 * k is mixed the same way and clamped to ≥ 0 (absorption can't go negative;
 * Macleod §2.2).
 */
export function mixMaterials(matA, matB, f) {
    if (!matA?.getNK || !matB?.getNK) {
        throw new Error('mixMaterials: both materials must expose getNK()');
    }
    const frac = Math.max(0, Math.min(1, f));
    const idA = matA.id || 'A';
    const idB = matB.id || 'B';
    return {
        id:    `${idA}+${idB}@${frac.toFixed(3)}`,
        name:  `${idA}/${idB} mix (${(frac * 100).toFixed(1)}%)`,
        color: matA.color || matB.color,
        getNK: (lam) => {
            const [na, ka] = matA.getNK(lam);
            const [nb, kb] = matB.getNK(lam);
            const n = (1 - frac) * na + frac * nb;
            const k = Math.max(0, (1 - frac) * ka + frac * kb);
            return [n, k];
        },
    };
}

// ── Build a graded slice stack ───────────────────────────────────────────────

/**
 * Slice a graded transition between matA and matB into N homogeneous sub-
 * layers. Each sub-layer is sampled at its MIDPOINT (t = (i+0.5)/N) so the
 * piecewise-constant approximation has O(1/N²) error vs the true continuous
 * profile, instead of O(1/N) for left-edge sampling.
 *
 * @param {Object}  matA      "before" material (f → 0)
 * @param {Object}  matB      "after" material  (f → 1)
 * @param {number}  thickness total interlayer thickness (nm); must be > 0
 * @param {string}  profile   one of PROFILE_IDS; default 'linear'
 * @param {number}  slices    sub-layer count; clamped to ≥ 2
 * @returns {{material:Object, thickness:number}[]}
 */
export function buildGradedSlices(matA, matB, thickness, profile = 'linear', slices = 10) {
    if (!(thickness > 0)) return [];
    const N = Math.max(2, Math.floor(slices));
    const dz = thickness / N;
    const out = [];
    for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N;
        const f = applyProfile(profile, t);
        out.push({
            material:  mixMaterials(matA, matB, f),
            thickness: dz,
        });
    }
    return out;
}

// ── Interlayer expansion ─────────────────────────────────────────────────────

/**
 * Inhomogeneity spec — what gets stored in `design.inhomogeneity` or kept
 * locally in the window's state. Each interlayer entry:
 *   {
 *     afterIndex: -1 | 0 | 1 | ... | N-1
 *                       // -1     → between incident medium and layer 0
 *                       //  0..N-1 → between layer i and layer i+1 (or substrate at N-1)
 *     thickness:  nm
 *     profile:    'linear' | 'parabolic' | 'invParabolic' | 'exponential' | 'sigmoid'
 *     slices:     integer ≥ 2 (default 10)
 *     enabled:    bool (default true)
 *   }
 */

export function emptyInhomogeneity() {
    return { interlayers: [], backInterlayers: [] };
}

export function cloneInhomogeneity(inh) {
    if (!inh) return emptyInhomogeneity();
    return {
        interlayers:     (inh.interlayers     || []).map(il => ({ ...il })),
        backInterlayers: (inh.backInterlayers || []).map(il => ({ ...il })),
    };
}

/**
 * Take a resolved layer list (already materials, not ids) and expand it by
 * inserting graded sub-layer stacks for each enabled interlayer entry.
 *
 * IMPORTANT: interlayer thickness is ADDED at the interface — it does NOT
 * subtract from the host layers' thicknesses. This follows the standard
 * "interlayer" semantics (a real physical extra layer between two
 * pure-material layers, e.g. from inter-material diffusion during deposition).
 *
 * @param {{material:Object, thickness:number}[]} layers  resolved (material objects)
 * @param {Object}   mediumIn   incident medium material (for afterIndex = -1)
 * @param {Object}   mediumOut  exit-side medium (substrate for front stack) —
 *                              used when interlayer is placed after the LAST
 *                              layer (afterIndex = N-1 with the next material
 *                              being the substrate).
 * @param {object[]} interlayers  list of interlayer specs
 * @returns {{material:Object, thickness:number}[]}
 */
export function expandLayersWithInterlayers(layers, mediumIn, mediumOut, interlayers) {
    if (!Array.isArray(layers) || layers.length === 0) return layers || [];
    if (!Array.isArray(interlayers) || interlayers.length === 0) return layers;

    // Index by afterIndex for O(1) lookup. Later entries with the same index
    // win — UI should not allow duplicates but we tolerate them.
    const byIndex = new Map();
    for (const il of interlayers) {
        if (il.enabled === false) continue;
        if (!Number.isFinite(il.thickness) || il.thickness <= 0) continue;
        byIndex.set(il.afterIndex, il);
    }
    if (byIndex.size === 0) return layers;

    const out = [];

    // Pre-stack interlayer (afterIndex = -1): mediumIn → layers[0].material
    if (byIndex.has(-1)) {
        const il = byIndex.get(-1);
        out.push(...buildGradedSlices(mediumIn, layers[0].material, il.thickness, il.profile, il.slices));
    }

    for (let i = 0; i < layers.length; i++) {
        out.push(layers[i]);
        if (byIndex.has(i)) {
            const il = byIndex.get(i);
            const nextMat = (i + 1 < layers.length) ? layers[i + 1].material : mediumOut;
            out.push(...buildGradedSlices(layers[i].material, nextMat, il.thickness, il.profile, il.slices));
        }
    }

    return out;
}

/**
 * Enumerate the (label, afterIndex) pairs that the UI should show as available
 * interface rows. The result is a stable list of N+1 entries (between every
 * adjacent pair, including media boundaries).
 *
 *   afterIndex = -1            → label "Inc → L1"
 *   afterIndex in [0..N-2]     → label "L<i+1> → L<i+2>"
 *   afterIndex = N-1           → label "L<N> → Sub"
 */
export function enumerateInterfaces(layers, mediumInName = 'Inc', mediumOutName = 'Sub') {
    const out = [];
    const N = layers?.length || 0;
    if (N === 0) return out;
    out.push({ afterIndex: -1, label: `${mediumInName} → L1` });
    for (let i = 0; i < N - 1; i++) {
        out.push({ afterIndex: i, label: `L${i + 1} → L${i + 2}` });
    }
    out.push({ afterIndex: N - 1, label: `L${N} → ${mediumOutName}` });
    return out;
}

/**
 * Total added thickness across all enabled interlayers — useful for the UI
 * status bar and for warnings when the user is about to insert an
 * unreasonable amount of extra physical thickness.
 */
export function totalInterlayerThickness(inh) {
    if (!inh) return 0;
    let sum = 0;
    for (const il of [...(inh.interlayers || []), ...(inh.backInterlayers || [])]) {
        if (il.enabled === false) continue;
        if (Number.isFinite(il.thickness) && il.thickness > 0) sum += il.thickness;
    }
    return sum;
}

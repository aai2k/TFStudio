/**
 * What the optical models read and combine, shared by one ray at a time
 * (tmmEval.js) and a cone's rays computed together (coneRays.js): a stack's
 * indices at one λ, which model a context selects, and the full system's
 * substrate geometry, bulk pass and combination of its three coherent passes.
 * Reference: Macleod, Thin-Film Optical Filters 5e §2.6.4.
 */

// ñ of material `mat` at λ, kept on the context for one evaluateOperands call.
export function nkOf(ctx, mat, lam) {
    const c = ctx && ctx._nkCache;
    if (!c) return mat.getNK(lam);
    let m = c.get(mat);
    if (!m) { m = new Map(); c.set(mat, m); }
    let v = m.get(lam);
    if (v === undefined) { v = mat.getNK(lam); m.set(lam, v); }
    return v;
}

// The distinct materials of a stack and, per layer, its position among them,
// so the stack's indices at one λ take one lookup per material rather than one
// per layer (an H/L stack has two materials however many layers it has).
export function distinctMaterials(mats) {
    const materials = [];
    const index = new Array(mats.length);
    const at = new Map();
    for (let i = 0; i < mats.length; i++) {
        let k = at.get(mats[i]);
        if (k === undefined) { k = materials.length; materials.push(mats[i]); at.set(mats[i], k); }
        index[i] = k;
    }
    return { materials, index };
}

// Layers {n, d} of one stack at λ. The stack is fixed for one evaluateOperands
// call, so its distinct-material index is built once per call.
export function layersAt(ctx, mats, thicknesses, lam) {
    const c = ctx && ctx._stackIndex;
    let di = c && c.get(mats);
    if (!di) {
        di = distinctMaterials(mats);
        if (c) c.set(mats, di);
    }
    const nks = di.materials.map(m => nkOf(ctx, m, lam));
    const layers = new Array(mats.length);
    for (let i = 0; i < mats.length; i++) layers[i] = { n: nks[di.index[i]], d: thicknesses[i] };
    return layers;
}

// Select the R/T/A component named by `char` ('T'|'R' → T/R, else A) from a
// {T,R,A} result object.
export const _rtaChar = (r, char) => (char === 'T' ? r.T : char === 'R' ? r.R : r.A);

// The optical model the context's surface mode and eval mode select:
//   'full'   front coating, incoherent substrate bulk and back coating
//   'back'   the back coating alone, lit from the exit medium
//   'front'  the front coating alone
export function surfaceModel(ctx) {
    const sm = ctx.surfaceMode || 'front_only';
    if (ctx.evalFullSystem || sm === 'symmetric' || sm === 'both_independent') return 'full';
    return sm === 'back_only' ? 'back' : 'front';
}

// Angle inside the substrate for incidence `aoi` (degrees) by real-part
// Snell's law: { aoiSub } in degrees and its cosine { cosTs }.
export function substrateAngle(aoi, n0, ns) {
    const sinT0  = Math.sin(aoi * Math.PI / 180);
    const sinTs  = (ns[0] > 0) ? Math.min(1, n0[0] * sinT0 / ns[0]) : 0;
    const cosTs  = Math.sqrt(1 - sinTs * sinTs);
    return { aoiSub: Math.asin(sinTs) * 180 / Math.PI, cosTs };
}

// Substrate bulk transmittance per pass at the angle θ_sub inside the
// substrate: P = exp(−4π k d / (λ cosθ_sub)), d the substrate thickness.
export function bulkTransmittance(ctx, lam, ns, cosTs) {
    const k_sub    = ns[1];
    const d_sub_nm = (ctx.substrateThicknessMm || 1.0) * 1e6;
    return (k_sub > 0 && cosTs > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosTs))
        : 1.0;
}

// Full-system R/T/A of one polarization from its three coherent passes,
// joined by an incoherent (intensity-summed) substrate bulk pass P:
//   fwd  incident → front → substrate
//   rev  substrate → front reversed → incident   (R_f', T_f')
//   bck  substrate → back → exit
export function combineFullSystem(fwd, rev, bck, P) {
    const P2 = P * P;
    const denom = 1 - rev.R * bck.R * P2;
    const T = denom > 0 ? (fwd.T * P * bck.T) / denom : 0;
    const R = denom > 0 ? fwd.R + (fwd.T * rev.T * P2 * bck.R) / denom : 1;
    const A = Math.max(0, 1 - R - T);
    return { R, T, A };
}

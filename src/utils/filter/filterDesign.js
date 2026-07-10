/**
 * Filter Design engine (narrow band-pass / WDM wizard).
 *
 * Reworked from the old `wdmDesigner.js` to follow a "Filter Design" six-step
 * procedure, whose key property is that it produces
 * **near-final designs immediately**. Three ideas, all absent in
 * the v1 generator, make that happen:
 *
 *   1. EMBEDDED DESIGN.  Steps 1–5 design the filter as if the incident medium
 *      had the SAME refractive index as the substrate ("Match medium = n_sub").
 *      This removes the air/first-layer Fresnel mismatch entirely, so the
 *      multi-cavity Fabry–Pérot prototype is already a clean ~100 % flat-top.
 *      (Global Integer Search: optimized assuming the
 *      refractive index of the incidence medium is equal to that of the
 *      substrate.)  Verified: the embedded LEC25D9 N=4 prototype has peak
 *      T = 1.0000 vs 0.9574 in air — the latter is what the old generator showed.
 *
 *   2. GLOBAL INTEGER SEARCH (step 5).  A discrete optimizer over per-mirror QW
 *      layer counts and per-spacer orders, minimizing the embedded merit
 *      function.  This is what turns the raw prototype into the MF≈0.1 designs
 *      listed in the step-5 candidate table.
 *
 *   3. AR / V-COAT LAST (step 6).  Only at the end is the real incident medium
 *      (air) introduced, matched with a No-AR / 1-layer / 2-layer "V" coating.
 *
 * Structure (substrate → incident, embedded):
 *
 *     sub | M_1  S_1  M_2  S_2  …  S_N  M_{N+1} | inc
 *
 *   N cavities  ⇒  N spacers  +  (N+1) mirrors.
 *   Mirror M_i  = QW stack presenting the spacer-facing material on its faces.
 *                 For an L-spacer the faces are H; mirrors are both-ends-H,
 *                 i.e. odd layer count  H(LH)^a  (a = (g−1)/2).  The
 *                 step-5 example shows odd mirror counts (7, 15, 15).
 *   Spacer S_j  = one layer of the spacer material, order s = s half-waves
 *                 = thickness 2·s·QW.
 *
 * References:
 *   - Worked example LEC25D9-1 (narrow band-pass, λ₀=600 nm, n_H=2.35, n_L=1.46,
 *     n_sub=1.52).
 *   - A. Thelen, "Design of multilayer interference filters," in *Physics of
 *     Thin Films* (1966); equivalent (m,k) prototype family.
 *   - H. A. Macleod, *Thin-Film Optical Filters* 5th ed., §8.2 "Multiple-cavity
 *     narrowband filters."
 *   - Tikhonravov & Trubetskov, *Appl. Opt.* 41, 3176 (2002), §3.
 *
 * This module is pure / Node-safe (no React, no DOM). The UI wrapper resolves
 * catalog materials into index functions and packages results into a Design.
 */

import { tmm } from '../physics/thinFilmMath.js';

// ── Index providers ──────────────────────────────────────────────────────────
// An "index function" maps λ(nm) → [n, k] (real, imag parts of refractive index).

/** Constant (non-dispersive) index. */
export function constIndex(n, k = 0) {
    return () => [n, k];
}

/**
 * Index function backed by a catalog material id (e.g. 'user:n2_35').
 * Imported lazily so the engine stays Node-safe when catalogs aren't loaded.
 */
export function materialIndexFn(materialId, getMaterialById) {
    const mat = getMaterialById ? getMaterialById(materialId) : null;
    if (!mat || !mat.getNK) return () => [1, 0];
    return (lam) => mat.getNK(lam);
}

function nReal(fn, lam) { const v = fn(lam); return Array.isArray(v) ? v[0] : v; }

/** Quarter-wave physical thickness (nm) at λ₀ for the given index function. */
export function qwThickness(idxFn, lambda0_nm) {
    const n = nReal(idxFn, lambda0_nm);
    return n > 0 ? lambda0_nm / (4 * n) : 0;
}

// ── Prototype layer builder ───────────────────────────────────────────────────

/**
 * Build the embedded prototype layer list.
 *
 * @param {object} p
 * @param {function} p.nH       index fn for the high-index material
 * @param {function} p.nL       index fn for the low-index material
 * @param {number}   p.lambda0_nm
 * @param {number[]} p.mirrors  per-mirror QW layer counts [g_1 … g_{N+1}] (odd)
 * @param {number[]} p.spacers  per-spacer orders [s_1 … s_N]  (≥1)
 * @param {'H'|'L'}  p.spacerKind  spacer material (uniform); default 'L'
 * @returns {{tag,nk,n0,d,material}[]}  engine layers (incident→substrate order, air-side first)
 *   tag ∈ {'H','L','spacer'}; nk = index fn; n0 = real n at λ₀; d = thickness nm.
 */
export function buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors, spacers, spacerKind = 'L' }) {
    const dH = qwThickness(nH, lambda0_nm);
    const dL = qwThickness(nL, lambda0_nm);
    if (!(dH > 0 && dL > 0)) throw new Error('filterDesign: index lookup failed at λ₀');

    const spacerIsL = spacerKind !== 'H';
    // spacer-facing material X = opposite of the spacer
    const faceTag = spacerIsL ? 'H' : 'L';
    const otherTag = spacerIsL ? 'L' : 'H';
    const fnOf = (tag) => (tag === 'H' ? nH : nL);
    const dOf = (tag) => (tag === 'H' ? dH : dL);

    const layers = [];
    const pushLayer = (tag, d) => layers.push({ tag, nk: fnOf(tag), n0: nReal(fnOf(tag), lambda0_nm), d });

    // Mirror of g QW layers that ALWAYS presents the spacer-facing material
    // (faceTag) on its spacer side (the LAST layer). Built from the spacer end:
    //   odd  g → H(LH)^a, both ends faceTag
    //   even g → (otherTag·faceTag)^(g/2), outer end otherTag, spacer end faceTag
    // (For odd g this is identical to the previous alternation, so the integer
    //  search — which uses odd g only — is byte-unchanged.)
    const pushMirror = (g) => {
        for (let i = 0; i < g; i++) {
            const fromEnd = g - 1 - i;           // 0 = spacer-facing (last) layer
            const tag = (fromEnd % 2 === 0) ? faceTag : otherTag;
            pushLayer(tag, dOf(tag));
        }
    };
    const pushSpacer = (order) => {
        const tag = spacerIsL ? 'L' : 'H';
        layers.push({
            tag: 'spacer', nk: fnOf(tag), n0: nReal(fnOf(tag), lambda0_nm),
            d: 2 * Math.max(1, order) * dOf(tag), spacerKind: tag, order,
        });
    };

    const N = spacers.length;
    if (mirrors.length !== N + 1) {
        throw new Error(`filterDesign: need N+1 mirrors for N spacers (got ${mirrors.length} mirrors, ${N} spacers)`);
    }
    for (let i = 0; i <= N; i++) {
        pushMirror(mirrors[i]);
        if (i < N) pushSpacer(spacers[i]);
    }
    return layers;
}

/** Convert engine layers to {n:[re,im], d} at one λ for the TMM kernel. */
export function toNDLayers(layers, lam) {
    const out = [];
    for (const L of layers) {
        if (!(L.d > 0)) continue;
        const v = L.nk(lam);
        out.push({ n: Array.isArray(v) ? v : [v, 0], d: L.d });
    }
    return out;
}

// ── Embedded evaluation ───────────────────────────────────────────────────────

/**
 * Transmittance at one λ in the EMBEDDED case (incident index = substrate index).
 * @param {Array} layers engine layers
 * @param {number} lam
 * @param {function} nSub substrate index fn (used for BOTH incident and exit)
 */
export function embeddedT(layers, lam, nSub) {
    const v = nSub(lam);
    const ns = Array.isArray(v) ? v : [v, 0];
    const { T } = tmm(lam, 0, 's', ns, ns, toNDLayers(layers, lam));
    return T;
}

/** T at one λ for an arbitrary incident/substrate pair (used for step-6 / air). */
export function spectrumT(layers, lam, nInc, nSub) {
    const a = nInc(lam), b = nSub(lam);
    const n0 = Array.isArray(a) ? a : [a, 0];
    const ns = Array.isArray(b) ? b : [b, 0];
    const { T } = tmm(lam, 0, 's', n0, ns, toNDLayers(layers, lam));
    return T;
}

/** Sample T(λ) over a grid. Returns {lambda:[], T:[]}. */
export function sampleSpectrum(layers, lamLo, lamHi, step, nInc, nSub) {
    const lambda = [], T = [];
    for (let lam = lamLo; lam <= lamHi + 1e-9; lam += step) {
        const x = Math.round(lam * 1000) / 1000;
        lambda.push(x);
        T.push(spectrumT(layers, x, nInc, nSub));
    }
    return { lambda, T };
}

// ── Bandwidth measurement ─────────────────────────────────────────────────────

/**
 * Full width (nm) of the central peak at an absolute T level, embedded case.
 * Returns 0 if the peak never reaches the level.
 */
export function measureWidth(layers, lambda0_nm, level, nSub, { span = 80, step = 0.02 } = {}) {
    const lo = lambda0_nm - span, hi = lambda0_nm + span;
    const xs = [], ts = [];
    for (let lam = lo; lam <= hi + 1e-9; lam += step) { xs.push(lam); ts.push(embeddedT(layers, lam, nSub)); }
    // central peak: index of max T nearest λ₀
    let ci = -1, best = Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (ts[i] >= level) { const d = Math.abs(xs[i] - lambda0_nm); if (d < best) { best = d; ci = i; } }
    }
    if (ci < 0) return 0;
    let li = ci, ri = ci;
    while (li > 0 && ts[li] >= level) li--;
    while (ri < xs.length - 1 && ts[ri] >= level) ri++;
    const cross = (i0, i1) => { const t0 = ts[i0], t1 = ts[i1]; return t1 === t0 ? xs[i0] : xs[i0] + (level - t0) * (xs[i1] - xs[i0]) / (t1 - t0); };
    return Math.abs(cross(ri, ri - 1) - cross(li, li + 1));
}

// ── Number-of-cavities recommendation ─────────────────────────────────────────

/**
 * Chebyshev estimate of the required number of cavities from the shape factor.
 *
 *   q = acosh( √((1/T_s − 1)/(1/T_p − 1)) ) / acosh(SF)
 *
 * with T_p the passband-edge transmittance (default 0.8913 = 0.5 dB) and T_s the
 * stopband transmittance (default 0.001 = 30 dB).
 *
 * METHOD (Tikhonravov & Trubetskov 2002, §3 + Appendix A): the minimum number
 * of cavities q is the smallest order for which the Chebyshev polynomial
 * T_q(S) exceeds the threshold  √((1/T_s − 1)/ρ),  ρ = 1/T_p − 1  (Eq. 6/9),
 * computed via the recurrence T_0=1, T_1=S, T_j = 2·S·T_{j−1} − T_{j−2} (Eq. A2).
 * The "more than q" rule defaults to q+1, so `recommended = q+1`.
 *   - S = 1.714 → q = 5 (paper's worked example, "five or more").
 *   - S = 3     → q = 3, recommended 4 (LEC25D9, ">3" → 4).
 *
 * @returns {{ q:number, recommended:number, threshold:number }}  q = Chebyshev minimum
 */
export function recommendCavities({ shapeFactor, Tpass = 0.8913, Tstop = 0.001 }) {
    const S = shapeFactor;
    if (!(S > 1) || !isFinite(S)) return { q: 0, recommended: 1, threshold: 0 };
    const rho = 1 / Tpass - 1;                       // Eq. 5
    const threshold = Math.sqrt((1 / Tstop - 1) / rho);   // Eq. 6/9 (≈100 for −0.5/−30 dB)
    let Tprev = 1, Tcur = S, q = 1;                  // T_0, T_1
    if (Tcur > threshold) return { q: 1, recommended: 2, threshold };
    for (q = 2; q <= 60; q++) {
        const Tnext = 2 * S * Tcur - Tprev;          // Eq. A2
        if (Tnext > threshold) break;
        Tprev = Tcur; Tcur = Tnext;
    }
    return { q, recommended: q + 1, threshold };
}

// ── Ideal filter target curve (step-2 schematic) ──────────────────────────────

/**
 * Analytic "schematic" target curve for the step-2 preview — a smooth
 * (Butterworth / maximally-flat) band-pass bell that passes EXACTLY through the
 * two spec points: T = passLevel at ±halfPass and T = stopLevel at ±halfStop.
 * This is the step-2 "schematic of the filter to be designed" — an
 * idealized target, NOT a real multilayer response (which is why the old
 * embedded-TMM preview showed a comb of split peaks).
 *
 *   T(x) = 1 / (1 + ε²·x^(2p)),   x = |λ−λ₀|/halfPass
 *   ε² = 1/passLevel − 1                       (so T(1) = passLevel)
 *   p  = ln((1/stopLevel−1)/ε²) / (2·ln SF)    (so T(SF) = stopLevel)
 *
 * @returns {(lam:number)=>number}  T in [0,1]
 */
export function idealFilterCurve({ lambda0_nm, halfPass, halfStop, passLevel = 0.8913, stopLevel = 0.001 }) {
    const eps2 = Math.max(1e-9, 1 / passLevel - 1);
    const SF = halfStop / halfPass;
    let p = 4;
    if (SF > 1 && stopLevel > 0 && stopLevel < passLevel) {
        const rhs = (1 / stopLevel - 1) / eps2;
        p = Math.log(rhs) / (2 * Math.log(SF));
    }
    return (lam) => {
        const x = Math.abs(lam - lambda0_nm) / halfPass;
        return 1 / (1 + eps2 * Math.pow(x, 2 * p));
    };
}

// ── Coupled-cavity prototype helpers ──────────────────────────────────────────

/**
 * Round a mirror layer count UP to odd. At λ₀ a half-wave spacer is an absentee
 * layer, so only ODD (both-ends-H) mirrors give a resonant cavity; even-layer
 * mirrors are anti-resonant (flat / valley-at-centre).
 */
export function oddUp(m) { const v = Math.max(1, Math.round(m)); return v % 2 === 1 ? v : v + 1; }

/**
 * Thelen coupling order δ from Eq. 10 (N₁² = nₛ·N₂).
 *
 * A both-ends-H quarter-wave mirror of 2x+1 layers presents equivalent index
 * N = nH^(x+1)/nL^x to the cavity. Writing the outer mirror as N₁ (x₁ pairs) and
 * the inner coupling mirror as N₂ (x₂ pairs), the Thelen matching condition
 * N₁² = nₛ·N₂ reduces to  nH·(nL/nH)^δ = nₛ  with δ = x₂ − 2·x₁, i.e.
 *
 *   δ = round( ln(nₛ/nH) / ln(nL/nH) )
 *
 * so the inner mirror has m_inner = 2·m_outer + 2δ − 1 layers. Verified against
 * Tikhonravov 2002 Table 1 (nH=2.1, nL=1.45, nₛ=1.52 → δ=1, outer 17 → inner 35).
 */
export function couplingOrder(nHv, nLv, nSv) {
    if (!(nHv > nLv && nLv > 0 && nSv > 0)) return 1;
    const d = Math.round(Math.log(nSv / nHv) / Math.log(nLv / nHv));
    return Math.max(0, d);
}

/**
 * Coupled-cavity prototype mirror vector for N cavities: outer mirrors `go`,
 * inner (coupling) mirrors `gi` (both odd). The doubled inner mirrors give the
 * flat-top response — this IS Thelen's equivalent-layer prototype (the inner
 * "Equivalent layer 2" repeated q−1 times, Tikhonravov 2002 §3).
 *
 *   go = oddUp(m)
 *   gi = 2·go + 2δ − 1   for ODD m   (Thelen Eq. 10 inner mirror)
 *   gi = 2·go + 2δ − 3   for EVEN m  (one fewer inner pair)
 *
 * The parity step keeps consecutive m rows DISTINCT (m and m−1 round to the same
 * odd `go`). δ = `couplingOrder(...)` (1 for typical materials).
 */
export function coupledMirrors(N, m, d = 1) {
    const go = oddUp(m);
    const giBase = 2 * go + 2 * d - 1;
    const gi = (Math.round(m) % 2 === 1) ? giBase : Math.max(3, giBase - 2);
    const arr = [];
    for (let i = 0; i <= N; i++) arr.push((i === 0 || i === N) ? go : gi);
    return arr;
}

// ── (m,k) equivalent prototype family (step 4 table) ──────────────────────────

/**
 * Build the step-4 equivalent-prototype table: a set of (ext. mirror
 * layers m, spacer order k) pairs whose COUPLED N-cavity prototype all have
 * approximately the TARGET passband width. There are two ways to hit a given
 * width — stronger mirrors + low spacer order, or weaker mirrors + high spacer
 * order — so the table trades m against k at constant width.
 *
 * Adapts to the target: the Thelen row (k=1) is the strongest mirror m whose
 * k=1 prototype is still ≥ the target width; weaker mirrors below it use higher
 * k. A narrow filter yields large m (many rows); a wide filter yields small m
 * (few rows). Validated against LEC25D9 (target ~3 nm → m up to 8, k 1/5/16/…).
 *
 * @param {number} p.targetFWHM   desired passband full width (nm) ≈ 2·halfPass
 * @returns {{notationM, spacerOrder, width, mirrorLayers}[]}  strongest→weakest
 */
export function buildPrototypeFamily({
    nH, nL, nSub, lambda0_nm, spacerKind = 'L', cavities = 4,
    targetFWHM = 3, level = 0.5, mCap = 14, maxOrder = 400, maxRows = 9,
}) {
    const N = Math.max(1, Math.round(cavities));
    const span = Math.max(targetFWHM * 2, 5);
    const step = Math.max(targetFWHM / 60, 0.03);
    const d = couplingOrder(nReal(nH, lambda0_nm), nReal(nL, lambda0_nm), nReal(nSub, lambda0_nm));
    const cache = new Map();
    // Width (at `level`) of the coupled N-cavity prototype for (m, k).
    const widthOf = (m, k) => {
        const key = m * 100000 + k;
        if (cache.has(key)) return cache.get(key);
        const lay = buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors: coupledMirrors(N, m, d), spacers: new Array(N).fill(k), spacerKind });
        const pk = embeddedT(lay, lambda0_nm, nSub);
        const w = measureWidth(lay, lambda0_nm, level * Math.max(pk, 1e-6), nSub, { span, step });
        cache.set(key, w);
        return w;
    };
    // Bisect for integer k whose width ≈ targetFWHM (width decreasing in k).
    const bisectK = (m) => {
        if (!(widthOf(m, 1) > targetFWHM)) return 1;     // even k=1 already ≤ target
        let lo = 1, hi = 2;
        while (hi < maxOrder && widthOf(m, hi) > targetFWHM) { lo = hi; hi *= 2; }
        hi = Math.min(hi, maxOrder);
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (widthOf(m, mid) > targetFWHM) lo = mid; else hi = mid;
        }
        return Math.abs(widthOf(m, lo) - targetFWHM) <= Math.abs(widthOf(m, hi) - targetFWHM) ? lo : hi;
    };

    // Thelen row: the largest m whose k=1 prototype is still ≥ target width.
    // width(m,1) decreases with m, so scan up until it drops below target.
    let mThelen = 1;
    for (let m = 1; m <= mCap; m++) {
        if (widthOf(m, 1) >= targetFWHM) mThelen = m; else break;
    }
    // Rows: m from mThelen down to 1 (each bisects k for the target width).
    const rows = [];
    const lo = Math.max(1, mThelen - maxRows + 1);
    for (let m = mThelen; m >= lo; m--) {
        const k = bisectK(m);
        rows.push({ notationM: m, mirrorLayers: oddUp(m), spacerOrder: k, width: widthOf(m, k) });
    }
    return rows;
}

// ── Filter target + merit function (embedded) ─────────────────────────────────

/**
 * Build a filter target sampler. T should be 1 across the passband and 0 in the
 * rejection band; the transition between Δλp and Δλr is "don't care" (weight 0),
 * matching the pass/stop spec drawn at the 89.13 % and 0.1 % levels.
 *
 * @param {object} p
 * @param {number} p.lambda0_nm
 * @param {number} p.halfPass   half-width of the transmission band (nm)  [Δλ@89.13%]
 * @param {number} p.halfStop   half-width where rejection must hold (nm) [Δλ@0.1%]
 * @param {number} [p.stopSpan] how far beyond halfStop the stopband extends (nm)
 * @param {number} [p.passStep] passband sample spacing (nm)
 * @param {number} [p.stopStep] stopband sample spacing (nm)
 * @param {number} [p.edgeBoost] extra weight on the near-edge skirt (default 6)
 * @returns {{ lambda:number[], target:number[], weight:number[] }}
 *
 * The defining spec is the TWO half-widths: T≥89.13 % out to ±halfPass and
 * T≤0.1 % by ±halfStop. The skirt in between (halfPass→halfStop) is sampled too
 * — its target follows the passband on the inner part and the stopband on the
 * outer part — and the near-edge stopband ([halfStop, halfStop+skirt]) carries
 * `edgeBoost` extra weight so the integer search is rewarded for placing the
 * 0.1 % level exactly at ±halfStop instead of letting the skirt run wide.
 */
export function buildFilterTarget({
    lambda0_nm, halfPass, halfStop, stopSpan = null,
    passStep = null, stopStep = null, edgeBoost = 6,
}) {
    const skirt = Math.max(halfStop - halfPass, halfStop * 0.1);
    const ps = passStep || Math.max(halfPass / 8, 0.02);
    const ss = stopStep || Math.max(skirt / 12, 0.03);
    const span = stopSpan || Math.max(halfStop * 3, halfStop + 5 * halfPass);

    const acc = { lambda: [], target: [], weight: [] };
    addPassbandSamples(acc, lambda0_nm, halfPass, ps);
    addStopbandSamples(acc, { lambda0_nm, halfStop, skirt, span, ss, edgeBoost });
    bandBalanceWeights(acc.target, acc.weight);
    return acc;
}

/** Append passband samples (T=1, unit weight) across [λ₀−halfPass, λ₀+halfPass]. */
function addPassbandSamples(acc, lambda0_nm, halfPass, ps) {
    for (let x = lambda0_nm - halfPass; x <= lambda0_nm + halfPass + 1e-9; x += ps) {
        acc.lambda.push(x); acc.target.push(1); acc.weight.push(1);
    }
}

/**
 * Append stopband samples (T=0) on both sides from halfStop outward. Samples in
 * the near-edge skirt zone [halfStop, halfStop+skirt] carry `edgeBoost` extra
 * weight so the 0.1 % level pins to ±halfStop instead of letting the skirt run wide.
 */
function addStopbandSamples(acc, { lambda0_nm, halfStop, skirt, span, ss, edgeBoost }) {
    const edgeHi = halfStop + skirt;
    for (let side = -1; side <= 1; side += 2) {
        for (let off = halfStop; off <= span + 1e-9; off += ss) {
            const w = (off <= edgeHi) ? edgeBoost : 1;
            acc.lambda.push(lambda0_nm + side * off); acc.target.push(0); acc.weight.push(w);
        }
    }
}

/**
 * Band-balance the weights so the passband and stopband each carry equal TOTAL
 * weight (per-sample edgeBoost ratios inside the stopband are preserved).
 *
 * The stopband has ~10× more samples than the passband (it spans a much wider λ
 * range). With raw per-sample weights the merit function is dominated by the
 * stopband, so a discrete optimizer can lower the MF by COLLAPSING the passband
 * (a near-empty filter satisfies hundreds of stop samples while sacrificing only
 * a few pass samples). Balancing makes a true flat-top the merit minimum and
 * removes the "kill the passband" pathology.
 */
function bandBalanceWeights(target, weight) {
    let wp = 0, ws = 0;
    for (let i = 0; i < target.length; i++) (target[i] === 1 ? (wp += weight[i]) : (ws += weight[i]));
    for (let i = 0; i < weight.length; i++) {
        const denom = target[i] === 1 ? wp : ws;
        if (denom > 0) weight[i] /= denom;
    }
}

/**
 * Embedded merit function: RMS weighted deviation of T(λ) from the target.
 * Lower is better. The target weights are BAND-BALANCED by `buildFilterTarget`
 * (passband and stopband carry equal total weight) — without that, the stopband's
 * far larger sample count dominates and the integer search minimizes the MF by
 * COLLAPSING the passband (a near-empty filter "wins" on the many stop samples).
 * With balancing, a true flat-top is the merit minimum.
 */
export function meritFunctionEmbedded(layers, target, nSub) {
    let sw = 0, ss = 0;
    for (let i = 0; i < target.lambda.length; i++) {
        const w = target.weight[i];
        if (w <= 0) continue;
        const T = embeddedT(layers, target.lambda[i], nSub);
        const d = T - target.target[i];
        ss += w * d * d;
        sw += w;
    }
    return sw > 0 ? Math.sqrt(ss / sw) : 0;
}

// ── Global Integer Search (step 5) ────────────────────────────────────────────

/** Count physical layers of a structure (mirrors + spacers). */
function structureLayerCount(mirrors, spacers) {
    return mirrors.reduce((a, g) => a + g, 0) + spacers.length;
}

/** Total physical thickness (nm) of a structure at λ₀ (QW-based). */
function structureThickness(mirrors, spacers, dH, dL, spacerIsL) {
    let th = 0;
    // mirror layers alternate face(H for L-spacer); their QW thicknesses:
    const faceD = spacerIsL ? dH : dL, otherD = spacerIsL ? dL : dH;
    for (const g of mirrors) for (let i = 0; i < g; i++) th += (i % 2 === 0) ? faceD : otherD;
    const spD = spacerIsL ? dL : dH;
    for (const s of spacers) th += 2 * s * spD;
    return th;
}

/** Apply symmetry constraints to a structure (returns NEW arrays). */
function applySymmetry(mirrors, spacers, { symMirrors, symCavities }) {
    let m = mirrors.slice(), s = spacers.slice();
    if (symMirrors) {
        const N1 = m.length;
        for (let i = 0; i < Math.floor(N1 / 2); i++) m[N1 - 1 - i] = m[i];
    }
    if (symCavities) {
        const Ns = s.length;
        for (let i = 0; i < Math.floor(Ns / 2); i++) s[Ns - 1 - i] = s[i];
    }
    return { mirrors: m, spacers: s };
}

/**
 * Global Integer Search: discrete minimization of the embedded MF over per-mirror
 * QW layer counts (odd) and per-spacer orders (integer), seeded from a prototype.
 *
 * Coordinate descent with neighbourhood ±step on each variable, plus multi-start
 * perturbations to surface several near-optimal candidates (the
 * step-5 list). Mirror counts stay odd (±2 moves); spacer orders ≥1.
 *
 * @param {object} p
 * @param {function} p.nH @param {function} p.nL @param {function} p.nSub
 * @param {number}   p.lambda0_nm
 * @param {object}   p.target               from buildFilterTarget
 * @param {number}   p.cavities             N
 * @param {number}   p.seedMirror           initial mirror layer count (odd)
 * @param {number}   p.seedSpacer           initial spacer order
 * @param {'H'|'L'}  [p.spacerKind='L']
 * @param {boolean}  [p.symMirrors=false]
 * @param {boolean}  [p.symCavities=false]
 * @param {number}   [p.minMirror=1] @param {number} [p.maxMirror=41]
 * @param {number}   [p.minOrder=1]  @param {number} [p.maxOrder=8]
 * @param {number}   [p.restarts=12]
 * @param {function} [p.rng=Math.random]
 * @param {function} [p.onProgress]         (best, candidates) callback
 * @returns {{ candidates: Array, best: object }}  candidates sorted by MF asc
 *   each candidate = { mirrors, spacers, mf, layers:N, thicknessNm }
 */
export function globalIntegerSearch(p) {
    const {
        nH, nL, nSub, lambda0_nm, target, cavities,
        seedMirror, seedSpacer, seedMirrors = null, spacerKind = 'L',
        symMirrors = false, symCavities = false,
        minMirror = 1, maxMirror = 41, minOrder = 1, maxOrder = 200,
        restarts = 12, rng = Math.random, onProgress = null,
    } = p;

    const spacerIsL = spacerKind !== 'H';
    const dH = qwThickness(nH, lambda0_nm), dL = qwThickness(nL, lambda0_nm);

    const clampMirror = (g) => {
        let v = Math.round(g);
        if (v % 2 === 0) v += 1;             // keep odd
        return Math.max(minMirror, Math.min(maxMirror, v));
    };
    const clampOrder = (s) => Math.max(minOrder, Math.min(maxOrder, Math.round(s)));

    const mfOf = (mirrors, spacers) => {
        const { mirrors: m, spacers: s } = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
        const layers = buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors: m, spacers: s, spacerKind });
        return meritFunctionEmbedded(layers, target, nSub);
    };

    // Coordinate descent from a starting vector → local minimum.
    const descend = (mirrors0, spacers0) => {
        let mirrors = mirrors0.map(clampMirror);
        let spacers = spacers0.map(clampOrder);
        let mf = mfOf(mirrors, spacers);
        let improved = true, guard = 0;
        while (improved && guard++ < 200) {
            improved = false;
            // mirrors: try ±2 (stay odd)
            for (let i = 0; i < mirrors.length; i++) {
                if (symMirrors && i > Math.floor(mirrors.length / 2)) continue; // mirrored half follows
                for (const delta of [2, -2, 4, -4]) {
                    const cand = mirrors.slice(); cand[i] = clampMirror(cand[i] + delta);
                    if (cand[i] === mirrors[i]) continue;
                    const m2 = mfOf(cand, spacers);
                    if (m2 < mf - 1e-12) { mirrors = cand; mf = m2; improved = true; }
                }
            }
            // spacers: try ±1
            for (let i = 0; i < spacers.length; i++) {
                if (symCavities && i > Math.floor(spacers.length / 2)) continue;
                for (const delta of [1, -1, 2, -2]) {
                    const cand = spacers.slice(); cand[i] = clampOrder(cand[i] + delta);
                    if (cand[i] === spacers[i]) continue;
                    const m2 = mfOf(mirrors, cand);
                    if (m2 < mf - 1e-12) { spacers = cand; mf = m2; improved = true; }
                }
            }
        }
        const sym = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
        return {
            mirrors: sym.mirrors, spacers: sym.spacers, mf,
            layers: structureLayerCount(sym.mirrors, sym.spacers),
            thicknessNm: structureThickness(sym.mirrors, sym.spacers, dH, dL, spacerIsL),
        };
    };

    const N = cavities;
    const candidates = [];
    const seen = new Set();
    const record = (c) => {
        const key = c.mirrors.join(',') + '|' + c.spacers.join(',');
        if (seen.has(key)) return;
        seen.add(key); candidates.push(c);
        candidates.sort((a, b) => a.mf - b.mf);
        if (onProgress) onProgress(candidates[0], candidates);
    };

    // Build a candidate record from a structure WITHOUT descending.
    const makeCandidate = (mirrors, spacers, extra = {}) => {
        const sym = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
        return {
            mirrors: sym.mirrors, spacers: sym.spacers, mf: mfOf(mirrors, spacers),
            layers: structureLayerCount(sym.mirrors, sym.spacers),
            thicknessNm: structureThickness(sym.mirrors, sym.spacers, dH, dL, spacerIsL),
            ...extra,
        };
    };

    // Seed: a per-mirror vector (e.g. the coupled-cavity prototype with inner
    // mirrors ~2× the outer) if supplied, else a uniform prototype.
    const seedMir = (Array.isArray(seedMirrors) && seedMirrors.length === N + 1)
        ? seedMirrors.map(clampMirror)
        : new Array(N + 1).fill(clampMirror(seedMirror));
    const seedSpa = new Array(N).fill(clampOrder(seedSpacer));
    // ALWAYS keep the raw step-4 prototype the user approved as a candidate, so
    // the list can never contain only lower-MF-but-uglier designs. On hard (wide)
    // targets a design that fills the band can have a lower MF yet visible ripple;
    // keeping the seed lets the user pick the clean prototype regardless.
    record(makeCandidate(seedMir, seedSpa, { isSeed: true }));
    record(descend(seedMir, seedSpa));

    // Multi-start: perturb the seed (and tapered seeds — outer mirrors weaker)
    for (let r = 0; r < restarts; r++) {
        const mir = seedMir.map((g, i) => {
            // bias: outer mirrors smaller, inner larger (Chebyshev taper) + noise
            const taper = (i === 0 || i === N) ? -2 : 0;
            const noise = Math.round((rng() - 0.5) * 6);
            return clampMirror(g + taper + noise);
        });
        const spa = seedSpa.map((s) => clampOrder(s + Math.round((rng() - 0.5) * 2)));
        record(descend(mir, spa));
    }

    return { candidates, best: candidates[0] };
}

// ── Adjust to incident medium (step 6): AR / V-coat ──────────────────────────

/** Mean transmittance over the passband for a layer list in a given medium. */
function passbandMeanT(layers, target, nInc, nSub) {
    let s = 0, n = 0;
    for (let i = 0; i < target.lambda.length; i++) {
        if (target.target[i] !== 1) continue;     // passband samples only
        s += spectrumT(layers, target.lambda[i], nInc, nSub); n++;
    }
    return n > 0 ? s / n : 0;
}

/**
 * Transition an embedded filter design to the real incident medium (air) by
 * adding an antireflection coating on the incident side. (Step 6.)
 *
 * The integer search produced an embedded design (incident index = substrate).
 * In air the front surface reflects, depressing passband T. A No-AR / 1-layer /
 * 2-layer "V" coating restores it. The filter layers are taken in
 * incident→substrate order; AR layers are PREPENDED (air-adjacent).
 *
 * @param {object} p
 * @param {Array}  p.filterLayers   engine layers (incident→substrate), embedded design
 * @param {function} p.nH @param {function} p.nL @param {function} p.nInc @param {function} p.nSub
 * @param {number} p.lambda0_nm
 * @param {object} p.target          filter target (passband samples drive the AR)
 * @param {'none'|'1layer'|'vcoat'} p.mode
 * @param {number} [p.grid=48]       thickness grid resolution per layer
 * @returns {{ layers:Array, mode, meanT:number, peakT:number, arLayers:Array }}
 */
export function adjustToIncidentMedium({
    filterLayers, nH, nL, nInc, nSub, lambda0_nm, target, mode = 'vcoat', grid = 48,
}) {
    const peakOf = (layers) => {
        let pk = 0;
        for (let lam = lambda0_nm - 3; lam <= lambda0_nm + 3; lam += 0.02) pk = Math.max(pk, spectrumT(layers, lam, nInc, nSub));
        return pk;
    };

    if (mode === 'none') {
        return { layers: filterLayers, mode, arLayers: [], meanT: passbandMeanT(filterLayers, target, nInc, nSub), peakT: peakOf(filterLayers) };
    }

    const dHmax = lambda0_nm / (2 * nReal(nH, lambda0_nm));   // up to a half-wave
    const dLmax = lambda0_nm / (2 * nReal(nL, lambda0_nm));
    const mkLayer = (tag, d) => ({ tag: 'ar', nk: tag === 'H' ? nH : nL, n0: nReal(tag === 'H' ? nH : nL, lambda0_nm), d, arMat: tag });

    let best = null;

    if (mode === '1layer') {
        // single AR layer; try L (typical) and H, optimize thickness
        for (const tag of ['L', 'H']) {
            const dmax = tag === 'H' ? dHmax : dLmax;
            for (let gi = 1; gi <= grid; gi++) {
                const d = (gi / grid) * dmax;
                const layers = [mkLayer(tag, d), ...filterLayers];
                const meanT = passbandMeanT(layers, target, nInc, nSub);
                if (!best || meanT > best.meanT) best = { layers, arLayers: [mkLayer(tag, d)], meanT };
            }
        }
    } else { // vcoat: 2 layers, optimize both thicknesses; try material orderings
        for (const [t1, t2] of [['H', 'L'], ['L', 'H']]) {
            const d1max = t1 === 'H' ? dHmax : dLmax;
            const d2max = t2 === 'H' ? dHmax : dLmax;
            for (let i = 1; i <= grid; i++) {
                const d1 = (i / grid) * d1max;
                for (let j = 1; j <= grid; j++) {
                    const d2 = (j / grid) * d2max;
                    // air-adjacent first: [t1(outer), t2(inner), ...filter]
                    const ar = [mkLayer(t1, d1), mkLayer(t2, d2)];
                    const layers = [...ar, ...filterLayers];
                    const meanT = passbandMeanT(layers, target, nInc, nSub);
                    if (!best || meanT > best.meanT) best = { layers, arLayers: ar, meanT };
                }
            }
        }
    }
    return { ...best, mode, peakT: peakOf(best.layers) };
}

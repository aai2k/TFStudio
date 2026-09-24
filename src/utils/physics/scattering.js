/**
 * Interface roughness as a transition layer at each interface.
 *
 * Macleod, Thin-Film Optical Filters, 5th ed., §16, p. 626 (refs [18], [19]):
 * roughness whose correlation length is short against the wavelength acts as an
 * inhomogeneous transition layer between the two materials, 2σ thick with σ the
 * rms roughness. It changes R and T through the graded index and loses no
 * light. Roughness with a long correlation length is the same layer carrying an
 * extinction coefficient that stands for the light scattered out of the
 * specular beam: scatter goes with the square of the field, as absorption does,
 * so for the specular beams an absorbing layer is the right representation.
 *
 * Short range: a graded layer whose n and k vary linearly with depth from one
 * material to the other, sliced into homogeneous sub-layers.
 *
 * Long range: the single homogeneous layer of C. K. Carniglia and D. G. Jensen,
 * "Single-layer model for surface roughness", Appl. Opt. 41, 3167 (2002):
 *
 *     d  = 2σ                                        (Eq. 42)
 *     n² = (n_a² + n_s²) / 2                         (Eq. 16, Drude equal mix)
 *     k  = π (n_a - n_s)² (n_a + n_s) d / (4 n λ)    (Eq. 43)
 *
 * Macleod gives the same layer as Eq. 16.32 (p. 628), written there with the
 * rms roughness δ = d/2 in place of d.
 *
 * With it one surface reproduces the scalar-scattering change in specular
 * reflectance and transmittance, ΔR = -R0 (4π n_a σ / λ)² and
 * ΔT = -T0 [2π (n_a - n_s) σ / λ]² (Eqs. 4 and 6), to terms in (σ/λ)², for
 * light arriving from either side. The derivation assumes normal incidence,
 * real indices on both sides, one surface and a correlation length long
 * against λ. At an absorbing neighbour the real part of its index is used.
 * Guo et al., Opt. Lett. 38, 40 (2013), Eq. 1, apply the same layer to an
 * air/film surface.
 *
 * Both layers take their thickness out of the layer beneath the interface (the
 * one deposited first), as the Essential Macleod manual describes for its
 * Scatter(s) and Scatter(l) layers, so adding roughness leaves the rest of the
 * design where it was. The substrate is not thinned.
 *
 * Units: σ, thicknesses and λ in nm.
 */

import { buildGradedSlices } from './inhomogeneity.js';

// ── Roughness spec ───────────────────────────────────────────────────────────

/**
 * The two kinds of interface roughness: 'short' (correlation length short
 * against λ, graded layer, no loss) and 'long' (correlation length long against
 * λ, Carniglia-Jensen absorbing layer).
 */
export const ROUGHNESS_RANGES = ['short', 'long'];
const DEFAULT_RANGE = 'long';

const validRange = (range, fallback = DEFAULT_RANGE) =>
    (ROUGHNESS_RANGES.includes(range) ? range : fallback);

/**
 * A roughness spec:
 *   { mode: 'uniform',      sigma, range }                one σ and kind for every interface
 *   { mode: 'perInterface', sigma, range,
 *     sigmas, ranges, backSigmas, backRanges }            a value per interface; an interface
 *                                                         without its own entry takes sigma/range
 */
export function emptyRoughness() {
    return {
        mode: 'uniform', sigma: 1.0, range: DEFAULT_RANGE,
        sigmas: [], backSigmas: [], ranges: [], backRanges: [],
    };
}

export function cloneRoughness(r) {
    if (!r) return emptyRoughness();
    const list = value => (Array.isArray(value) ? value.slice() : []);
    return {
        mode:       r.mode || 'uniform',
        sigma:      Number.isFinite(r.sigma) ? r.sigma : 1.0,
        range:      validRange(r.range),
        sigmas:     list(r.sigmas),
        backSigmas: list(r.backSigmas),
        ranges:     list(r.ranges),
        backRanges: list(r.backRanges),
    };
}

/**
 * σ for each of `nInterfaces` interfaces, in nm. In per-interface mode an
 * interface with no finite entry of its own takes the spec's uniform σ, the
 * same value the editor shows for it.
 *
 * @param {object} spec  { mode, sigma, sigmas } (the side's array as `sigmas`)
 * @param {number} nInterfaces
 * @returns {number[]}
 */
export function resolveSigmas(spec, nInterfaces) {
    const N = Math.max(0, nInterfaces || 0);
    const uniform = Number.isFinite(spec?.sigma) ? spec.sigma : 0;
    if (!spec || spec.mode === 'uniform') return new Array(N).fill(uniform);
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
        const s = spec.sigmas?.[i];
        out[i] = Number.isFinite(s) ? s : uniform;
    }
    return out;
}

/**
 * Roughness kind for each of `nInterfaces` interfaces, following the same
 * fallback rule as `resolveSigmas`.
 *
 * @param {object} spec  { mode, range, ranges } (the side's array as `ranges`)
 * @param {number} nInterfaces
 * @returns {string[]} 'short' | 'long' per interface
 */
export function resolveRanges(spec, nInterfaces) {
    const N = Math.max(0, nInterfaces || 0);
    const uniform = validRange(spec?.range);
    if (!spec || spec.mode === 'uniform') return new Array(N).fill(uniform);
    const out = new Array(N);
    for (let i = 0; i < N; i++) out[i] = validRange(spec.ranges?.[i], uniform);
    return out;
}

/**
 * Number of interfaces in a stack: N layers make N+1 (medium to L1, L1 to L2,
 * ..., L_N to substrate). A bare substrate still has its one surface.
 */
export function countInterfaces(nLayers) {
    return Math.max(1, (nLayers || 0) + 1);
}

// ── The two transition layers ────────────────────────────────────────────────

/**
 * n and k of the Carniglia-Jensen layer for a surface between real indices
 * nA and nB with rms roughness sigma_nm, at lambda_nm (Eqs. 16, 42, 43). k is
 * the same whichever side the light comes from and falls as 1/λ.
 *
 * @returns {[number, number]} [n, k]
 */
export function carnigliaJensenNK(nA, nB, sigma_nm, lambda_nm) {
    const n = Math.sqrt((nA * nA + nB * nB) / 2);
    const d = 2 * sigma_nm;
    const k = Math.PI * (nA - nB) ** 2 * (nA + nB) * d / (4 * n * lambda_nm);
    return [n, k];
}

/**
 * The long-range layer between two materials as a material object. Its index
 * follows the neighbours' dispersion wavelength by wavelength, using the real
 * part of each neighbour's index.
 */
export function longRangeMaterial(matA, matB, sigma_nm) {
    const idA = matA.id || 'A';
    const idB = matB.id || 'B';
    return {
        id:    `${idA}|${idB}@scatter(l)${sigma_nm}`,
        name:  `${idA}/${idB} scatter layer`,
        color: matA.color || matB.color,
        getNK: (lam) => carnigliaJensenNK(matA.getNK(lam)[0], matB.getNK(lam)[0], sigma_nm, lam),
    };
}

/**
 * The layers that stand for one rough interface, listed from matBelow (the
 * substrate side) to matAbove. Short range gives `slices` graded sub-layers
 * with a linear n, k profile; long range gives the single absorbing layer.
 * Both are 2σ thick in total.
 *
 * @returns {{material:Object, thickness:number}[]}
 */
export function transitionLayers(matBelow, matAbove, sigma_nm, range, slices) {
    if (!(sigma_nm > 0)) return [];
    const thickness = 2 * sigma_nm;
    if (range === 'short') return buildGradedSlices(matBelow, matAbove, thickness, 'linear', slices);
    return [{ material: longRangeMaterial(matBelow, matAbove, sigma_nm), thickness }];
}

// ── Rough stacks ─────────────────────────────────────────────────────────────

/**
 * A material whose getNK remembers each wavelength it was asked for. Every
 * graded slice of an interface evaluates both neighbours at every wavelength,
 * so the neighbours' dispersion is computed once per wavelength instead of once
 * per slice.
 */
function memoizedMaterial(material) {
    const cache = new Map();
    return {
        ...material,
        getNK: (lam) => {
            let nk = cache.get(lam);
            if (!nk) {
                nk = material.getNK(lam);
                cache.set(lam, nk);
            }
            return nk;
        },
    };
}

/** One memoized copy per material, shared by every interface it borders. */
function materialCache() {
    const memo = new Map();
    return (material) => {
        if (!memo.has(material)) memo.set(material, memoizedMaterial(material));
        return memo.get(material);
    };
}

const present = layer => layer.thickness > 0;

/**
 * The material interface k meets above it: the first of layers[k..] that has a
 * thickness, or `outer` past the last layer.
 */
function materialAbove(layers, k, outer) {
    let above = k;
    while (above < layers.length && !present(layers[above])) above++;
    return above === layers.length ? outer : layers[above].material;
}

/**
 * Take a transition layer 2σ thick out of `host`. Returns false when the host
 * was thinner than that and is left at zero thickness.
 */
function thinHost(host, sigma) {
    const left = host.thickness - 2 * sigma;
    host.thickness = Math.max(0, left);
    return left >= 0;
}

/**
 * Insert the transition layers into a stack held in deposition order.
 *
 * `layers[0]` sits on the substrate. Interface k (0..N) is the top of
 * k === 0 ? substrate : layers[k-1] and meets the next layer above it, or
 * `outer` past the last one. Each transition layer's thickness comes out of
 * layers[k-1]; a layer thinner than that is set to zero and its index is
 * reported in `thinned`. A layer of zero thickness is not in the coating, as
 * in the TMM: it has no top interface of its own, and the layer beneath it
 * meets the next layer that is there.
 *
 * @param {{material:Object, thickness:number}[]} layers  deposition order
 * @param {{substrate:Object, outer:Object}} media  outer: the medium beyond the last layer
 * @param {{sigmas:number[], ranges:string[]}} roughness  σ (nm) and 'short' | 'long'
 *                                                        per interface, index k as above
 * @param {number} slices  graded sub-layers per short-range interface
 * @returns {{layers:{material:Object, thickness:number}[], thinned:number[]}}
 */
function roughenDeposited(layers, { substrate, outer }, { sigmas, ranges }, slices) {
    const cached = materialCache();
    const N = layers.length;
    const hosts = layers.map(layer => ({ ...layer }));
    const transitions = [];
    const thinned = [];
    for (let k = 0; k <= N; k++) {
        const sigma = sigmas[k];
        const base = k === 0 ? null : layers[k - 1];
        if (!(sigma > 0) || (base && !present(base))) { transitions.push([]); continue; }
        transitions.push(transitionLayers(cached(base ? base.material : substrate),
            cached(materialAbove(layers, k, outer)), sigma, ranges[k], slices));
        if (base && !thinHost(hosts[k - 1], sigma)) thinned.push(k - 1);
    }
    const out = [...transitions[0]];
    for (let k = 1; k <= N; k++) out.push(hosts[k - 1], ...transitions[k]);
    return { layers: out, thinned };
}

/**
 * Front coating with roughness. `layers` is air-first (layers[0] touches the
 * incident medium), and interface i counts from the incident medium the way the
 * roughness editor lists them: 0 is medium to layers[0], N is layers[N-1] to
 * substrate. `thinned` holds air-first layer indices.
 *
 * @param {{material:Object, thickness:number}[]} layers  air-first
 * @param {{incident:Object, substrate:Object}} media
 * @param {{sigmas:number[], ranges:string[]}} roughness  per interface, editor order
 * @param {number} slices  graded sub-layers per short-range interface
 */
export function roughenFrontStack(layers, { incident, substrate }, { sigmas, ranges }, slices) {
    const N = layers.length;
    const byDeposition = (list) => Array.from({ length: N + 1 }, (_, k) => list[N - k]);
    const { layers: deposited, thinned } = roughenDeposited(
        layers.slice().reverse(), { substrate, outer: incident },
        { sigmas: byDeposition(sigmas), ranges: byDeposition(ranges) }, slices);
    return { layers: deposited.reverse(), thinned: thinned.map(k => N - 1 - k) };
}

/**
 * Back coating with roughness. `layers` is stored substrate-first, as
 * design.backLayers is, and interface i counts from the substrate: 0 is
 * substrate to layers[0], N is layers[N-1] to the exit medium. The result keeps
 * that order.
 *
 * @param {{material:Object, thickness:number}[]} layers  substrate-first
 * @param {{substrate:Object, exit:Object}} media
 * @param {{sigmas:number[], ranges:string[]}} roughness  per interface, editor order
 * @param {number} slices  graded sub-layers per short-range interface
 */
export function roughenBackStack(layers, { substrate, exit }, roughness, slices) {
    return roughenDeposited(layers, { substrate, outer: exit }, roughness, slices);
}

// ── Slicing ──────────────────────────────────────────────────────────────────

/**
 * Graded sub-layers per short-range interface for the coarse evaluation; the
 * fine one uses twice as many.
 *
 * Slicing a linear profile into N homogeneous layers sampled at their
 * midpoints leaves an error that falls as 1/N². On a 31-layer TiO2/SiO2
 * quarter-wave stack with σ = 5 nm at every interface it is 2.8e-3 in R and T
 * at the steepest band edge with 16 slices. Combining 16 and 32 slices as in
 * `extrapolateSlicing` brings it to 5e-6 for less work than 100 plain slices.
 */
export const GRADED_SLICES = 16;

const SPECTRUM_KEYS = ['R', 'T', 'A', 'Rs', 'Ts', 'As', 'Rp', 'Tp', 'Ap'];

/**
 * Richardson extrapolation of two spectra of the same design computed with N
 * and 2N graded slices: (4 S(2N) - S(N)) / 3 cancels the 1/N² term of the
 * midpoint slicing error. Layers that do not depend on N, including every
 * long-range layer, pass through unchanged, and since the weights sum to one
 * R + T + A is kept.
 */
export function extrapolateSlicing(coarse, fine) {
    const out = { ...fine };
    for (const key of SPECTRUM_KEYS) {
        const a = coarse[key];
        const b = fine[key];
        if (!Array.isArray(a) || !Array.isArray(b)) continue;
        out[key] = b.map((value, i) => (4 * value - a[i]) / 3);
    }
    return out;
}

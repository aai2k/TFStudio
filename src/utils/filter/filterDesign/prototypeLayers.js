import { nReal } from './nReal.js';
import { qwThickness } from './indexProviders.js';

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

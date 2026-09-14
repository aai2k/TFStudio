import { nReal } from './nReal.js';
import { qwThickness } from './indexProviders.js';

/**
 * Walk the prototype's layer positions from the substrate outward.
 *
 * The prototype is one strictly alternating quarter-wave stack: counting from
 * the substrate, odd positions are H and even positions are L, and nothing else
 * sets a layer's material. Every position carries a single quarter-wave except
 * the spacer positions, which carry 2k of them. Mirrors and spacers are only
 * where the counts fall, so a mirror of even layer count ends on the other
 * material from where it started and the spacers on its two sides are then
 * different materials.
 *
 * `mirrors` and `spacers` are indexed FROM THE SUBSTRATE.
 *
 * @yields {{tag:'H'|'L', role:'mirror'|'spacer', order:number, qw:number}}
 */
export function* prototypePositions(mirrors, spacers) {
    let pos = 0;
    for (let i = 0; i < mirrors.length; i++) {
        for (let j = 0; j < mirrors[i]; j++) {
            pos += 1;
            yield { tag: pos % 2 ? 'H' : 'L', role: 'mirror', order: 0, qw: 1 };
        }
        if (i < spacers.length) {
            pos += 1;
            const order = Math.max(1, Math.round(spacers[i]));
            yield { tag: pos % 2 ? 'H' : 'L', role: 'spacer', order, qw: 2 * order };
        }
    }
}

/**
 * Build the embedded prototype layer list.
 *
 * Returns layers in incident→substrate order (air-side first), which is the
 * order the rest of TFStudio stores a design in, while `mirrors` and `spacers`
 * are given substrate-first as `prototypePositions` expects.
 *
 * @param {object} p
 * @param {function} p.nH       index fn for the high-index material
 * @param {function} p.nL       index fn for the low-index material
 * @param {number}   p.lambda0_nm
 * @param {number[]} p.mirrors  per-mirror QW layer counts [g_1 … g_{N+1}], substrate first
 * @param {number[]} p.spacers  per-spacer orders [s_1 … s_N] (≥1), substrate first
 * @returns {{tag,role,order,nk,n0,d}[]}  tag ∈ {'H','L'} is the material;
 *   nk = index fn; n0 = real n at λ₀; d = thickness nm.
 */
export function buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors, spacers }) {
    const dH = qwThickness(nH, lambda0_nm);
    const dL = qwThickness(nL, lambda0_nm);
    if (!(dH > 0 && dL > 0)) throw new Error('filterDesign: index lookup failed at λ₀');
    if (mirrors.length !== spacers.length + 1) {
        throw new Error(`filterDesign: need N+1 mirrors for N spacers (got ${mirrors.length} mirrors, ${spacers.length} spacers)`);
    }
    const n0H = nReal(nH, lambda0_nm), n0L = nReal(nL, lambda0_nm);

    const layers = [];
    for (const { tag, role, order, qw } of prototypePositions(mirrors, spacers)) {
        const isH = tag === 'H';
        layers.push({ tag, role, order, nk: isH ? nH : nL, n0: isH ? n0H : n0L, d: qw * (isH ? dH : dL) });
    }
    layers.reverse();
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

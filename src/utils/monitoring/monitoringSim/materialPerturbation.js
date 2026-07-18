/**
 * Per-run material perturbation: the "truth" (actual chamber) materials seen
 * by a Monte-Carlo trial, as a deviation from the nominal materials the
 * monitor's model uses. Same proxy model as errorAnalysis.js.
 */

import { gauss } from './rng.js';

export function makeShiftedMaterial(baseMat, dn, dk) {
    if (!dn && !dk) return baseMat;
    return {
        ...baseMat,
        getNK: (lam) => {
            const [n, k] = baseMat.getNK(lam);
            // k ≥ 0 — a non-absorbing material can't become "negatively absorbing"
            const kOut = Math.max(0, k + dk);
            return [n + dn, kOut];
        },
    };
}

/**
 * Draw one material's Δn, Δk for this run. Per-material refractive-index
 * deviation specs. When `matDev` has an entry for `id`, the material gets a
 * SYSTEMATIC offset (reNSyst, deterministic) plus a RANDOM draw
 * N(0, reNRand²); `systInh` (%) is the systematic inhomogeneity, recorded for
 * reporting. Falls back to the global sigmaReN/sigmaImN model when `matDev`
 * is absent (keeps MC bit-identical).
 * @returns {{dn: number, dk: number, inh: number}}
 */
export function drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng) {
    if (matDev && matDev.has(id)) {
        const dv = matDev.get(id);
        const dn = (dv.reNSyst || 0) + (dv.reNRand > 0 ? gauss(rng) * dv.reNRand : 0);
        const dk = (dv.imNSyst || 0) + (dv.imNRand > 0 ? gauss(rng) * dv.imNRand : 0);
        return { dn, dk, inh: dv.systInh || 0 };
    }
    const dn = sigmaReN > 0 ? gauss(rng) * sigmaReN : 0;
    const dk = sigmaImN > 0 ? gauss(rng) * sigmaImN : 0;
    return { dn, dk, inh: 0 };
}

/**
 * Draw per-material Δn/Δk for every front layer and build the truth (shifted)
 * and model (nominal) material arrays for the run. `perMaterial` (default
 * true) shares one Δn/Δk draw across all layers of the same material id.
 * @returns {{ modelMats: object[], truthMats: object[], layerDeltas: {dn:number,dk:number,inh:number}[] }}
 */
export function drawFrontMaterialDeltas({ front, resolveMat, perMaterial, matDev, sigmaReN, sigmaImN, rng }) {
    const matIds = new Set();
    for (const l of front) matIds.add(l.material);

    const matDraws = new Map();    // id → { dn, dk, inh }
    if (perMaterial) {
        for (const id of matIds) matDraws.set(id, drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng));
    }

    const modelMats = front.map(l => resolveMat(l.material));
    const layerDeltas = new Array(front.length);
    const truthMats = front.map((l, i) => {
        const d = perMaterial ? matDraws.get(l.material) : drawMatDelta(l.material, matDev, sigmaReN, sigmaImN, rng);
        const dn = d?.dn ?? 0, dk = d?.dk ?? 0, inh = d?.inh ?? 0;
        layerDeltas[i] = { dn, dk, inh };
        return makeShiftedMaterial(modelMats[i], dn, dk);
    });

    return { modelMats, truthMats, layerDeltas };
}

/**
 * Per-run material Δn/Δk draws for every front layer, building the truth
 * (shifted) and model (nominal) material arrays used by the layer loop.
 */

import { makeShiftedMaterial } from '../monitoringSim.js';
import { _drawMatDelta } from './layerDeposition.js';

/**
 * @returns {{ modelMats: object[], truthMats: object[], layerDeltas: {dn:number,dk:number,inh:number}[] }}
 */
export function drawFrontMaterialDeltas({ front, resolveMat, perMaterial, matDev, sigmaReN, sigmaImN, rng }) {
    const matIds = new Set();
    for (const l of front) matIds.add(l.material);

    const matDraws = new Map();
    if (perMaterial) {
        for (const id of matIds) matDraws.set(id, _drawMatDelta(id, matDev, sigmaReN, sigmaImN, rng));
    }

    const modelMats = front.map(l => resolveMat(l.material));
    const layerDeltas = new Array(front.length);
    const truthMats = front.map((l, i) => {
        const d = perMaterial ? matDraws.get(l.material) : _drawMatDelta(l.material, matDev, sigmaReN, sigmaImN, rng);
        const dn = d?.dn ?? 0, dk = d?.dk ?? 0, inh = d?.inh ?? 0;
        layerDeltas[i] = { dn, dk, inh };
        return makeShiftedMaterial(modelMats[i], dn, dk);
    });

    return { modelMats, truthMats, layerDeltas };
}

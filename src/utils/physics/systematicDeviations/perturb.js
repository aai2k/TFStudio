/**
 * Apply a deviation spec to layers/media, producing perturbed copies suitable
 * for the TMM spectrum evaluators or the qualifier-spec pipeline.
 */

import { wrapMaterial } from '../../misc/variator.js';
import { emptyDeviation, needsRefIndex } from './deviationSpec.js';
import { effectiveForMaterial, effectiveForMedium, effectiveOffsetNm } from './materials.js';

/**
 * Return a perturbed copy of a layer list, suitable for handing to
 * evaluateSpectrum… The output uses resolved material *objects* (the
 * spectrum API expects them).
 *
 * @param {{material:string, thickness:number, locked?:boolean}[]} layers
 * @param {object} dev
 * @param {(id:string)=>object} resolveMat
 * @param {number} [lamRef=550]  reference λ₀ (nm) for optical-unit (ot/qw/fw) offsets
 * @returns {{material:object, thickness:number, locked:boolean}[]}
 */
export function perturbLayers(layers, dev, resolveMat, lamRef = 550) {
    if (!Array.isArray(layers)) return [];
    // Only look up n(λ₀) when an optical-unit offset is actually present — keeps
    // the scale-only / identity paths bit-identical (no extra getNK calls).
    const wantRefIndex = needsRefIndex(dev);
    return layers.map(l => {
        const matId   = (typeof l.material === 'string') ? l.material : l.material?.id;
        const baseMat = (typeof l.material === 'string') ? resolveMat(l.material) : l.material;
        const { dn, dk, dScale } = effectiveForMaterial(dev, matId);
        let offsetNm = 0;
        const hasOffset = (dev?.globalThicknessOffset || 0) ||
            (matId && dev?.perMaterial?.[matId]?.dOffset);
        if (hasOffset) {
            let nRef = 0;
            if (wantRefIndex) {
                const nk = baseMat?.getNK ? baseMat.getNK(lamRef) : null;
                nRef = Array.isArray(nk) ? nk[0] : 0;
            }
            offsetNm = effectiveOffsetNm(dev, matId, nRef, lamRef);
        }
        return {
            material:  wrapMaterial(baseMat, dn, dk),
            thickness: Math.max(0, (l.thickness || 0) * dScale + offsetNm),
            locked:    !!l.locked,
        };
    });
}

/**
 * Perturb a named medium (incident / substrate / exit). Only a per-material
 * Δn/Δk set on that material applies; the global Δn/Δk are a coating-process
 * offset and leave the media alone. The substrate thickness is not scaled (it
 * is not a coating layer).
 */
export function perturbMedium(matId, dev, resolveMat) {
    const baseMat = resolveMat(matId);
    const { dn, dk } = effectiveForMedium(dev, matId);
    return wrapMaterial(baseMat, dn, dk);
}

/**
 * Build a (design, resolveMat) pair that represents the design *with the
 * deviation applied*, suitable for `evaluateQualifiers`. Layers take the same
 * thicknesses and materials as `perturbLayers`; media take `perturbMedium`.
 *
 * A layer and a medium can share a material id (an SiO2 film on an SiO2
 * substrate) yet need different shifts, so each layer is relabelled with a
 * local id that resolves to its own perturbed material, and every other id
 * resolves as a medium.
 *
 * @returns {{ design: object, resolve: (id:string)=>object }}
 */
export function deviatedDesignForSpec(design, dev, resolveMat) {
    const d = dev || emptyDeviation();
    const lamRef = design?.referenceWavelength || 550;
    const layerMats = new Map();
    const relabel = (layers, side) => {
        const perturbed = perturbLayers(layers, d, resolveMat, lamRef);
        return perturbed.map((p, i) => {
            const id = `__sdLayer:${side}:${i}`;
            layerMats.set(id, p.material);
            return { ...layers[i], material: id, thickness: p.thickness };
        });
    };
    const devDesign = {
        ...design,
        frontLayers: relabel(design?.frontLayers, 'front'),
        backLayers:  relabel(design?.backLayers, 'back'),
    };
    const resolve = (id) => layerMats.get(id) || perturbMedium(id, d, resolveMat);
    return { design: devDesign, resolve };
}

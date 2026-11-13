/**
 * Apply a deviation spec to layers/media, producing perturbed copies suitable
 * for the TMM spectrum evaluators or the qualifier-spec pipeline.
 */

import { MaterialHasNoIndexError } from '../../materials/materialIndexAt.js';
import { wrapMaterial } from '../../misc/variator.js';
import { BASE_ENVIRONMENT, environmentDesign } from '../../environments/environments.js';
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
 * @throws {MaterialHasNoIndexError} when a layer carries an optical-unit offset
 *         and its material has no index at λ₀, so the offset has no thickness
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
            if (Number.isNaN(offsetNm)) throw new MaterialHasNoIndexError(matId, lamRef);
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
 * In environment `envId` of a design with environments the deviation is made
 * on the recipe and seen in that environment: each layer f·(d·s + o) thick, f
 * the factor of its material there, made of the environment's material for it
 * moved by the Δn and Δk of the recipe's material, between the environment's
 * media.
 *
 * @returns {{ design: object, resolve: (id:string)=>object }}
 */
export function deviatedDesignForSpec(design, dev, resolveMat, envId = BASE_ENVIRONMENT) {
    const d = dev || emptyDeviation();
    const lamRef = design?.referenceWavelength || 550;
    const layerMats = new Map();
    const deviated = {
        front: perturbLayers(design?.frontLayers, d, resolveMat, lamRef),
        back: perturbLayers(design?.backLayers, d, resolveMat, lamRef),
    };
    const recipe = (layers, side) => (layers || []).map((layer, i) => ({ ...layer, thickness: deviated[side][i].thickness }));
    const seen = environmentDesign({ ...design, frontLayers: recipe(design?.frontLayers, 'front'), backLayers: recipe(design?.backLayers, 'back') }, envId);
    const relabel = (layers, side) => (layers || []).map((layer, i) => {
        const id = `__sdLayer:${side}:${i}`;
        const shown = seen[`${side}Layers`][i];
        const { dn, dk } = effectiveForMaterial(d, layer.material);
        layerMats.set(id, shown.material === layer.material ? deviated[side][i].material : wrapMaterial(resolveMat(shown.material), dn, dk));
        return { ...layer, material: id, thickness: shown.thickness };
    });
    const devDesign = {
        ...seen,
        frontLayers: relabel(design?.frontLayers, 'front'),
        backLayers:  relabel(design?.backLayers, 'back'),
    };
    const resolve = (id) => layerMats.get(id) || perturbMedium(id, d, resolveMat);
    return { design: devDesign, resolve };
}

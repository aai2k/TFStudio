/**
 * Apply a deviation spec to layers/media, producing perturbed copies suitable
 * for the TMM spectrum evaluators or the qualifier-spec pipeline.
 */

import { wrapMaterial } from '../../misc/variator.js';
import { emptyDeviation, needsRefIndex } from './deviationSpec.js';
import { effectiveForMaterial, effectiveOffsetNm } from './materials.js';

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
 * Perturb a named medium (incident / substrate / exit). Δn,Δk applied;
 * physical substrate thickness is NOT scaled (it is not a coating layer).
 */
export function perturbMedium(matId, dev, resolveMat) {
    const baseMat = resolveMat(matId);
    const { dn, dk } = effectiveForMaterial(dev, matId);
    return wrapMaterial(baseMat, dn, dk);
}

/**
 * Build a (design, resolveMat) pair that represents the design *with the
 * deviation applied*, suitable for `evaluateQualifiers`. Layer thicknesses are
 * scaled (global × per-material d-scale, keeping material id strings so the
 * qualifier pipeline still resolves them), and Δn/Δk are applied by wrapping the
 * resolver per material id (deviations are per-material, so this is exact).
 *
 * @returns {{ design: object, resolve: (id:string)=>object }}
 */
export function deviatedDesignForSpec(design, dev, resolveMat) {
    const d = dev || emptyDeviation();
    const lamRef = design?.referenceWavelength || 550;
    const wantRefIndex = needsRefIndex(d);
    const scaleLayers = (layers) => (layers || []).map(l => {
        const matId = (typeof l.material === 'string') ? l.material : l.material?.id;
        const { dScale } = effectiveForMaterial(d, matId);
        let offsetNm = 0;
        const hasOffset = (d.globalThicknessOffset || 0) ||
            (matId && d.perMaterial?.[matId]?.dOffset);
        if (hasOffset) {
            let nRef = 0;
            if (wantRefIndex) {
                const nk = resolveMat(matId)?.getNK ? resolveMat(matId).getNK(lamRef) : null;
                nRef = Array.isArray(nk) ? nk[0] : 0;
            }
            offsetNm = effectiveOffsetNm(d, matId, nRef, lamRef);
        }
        return { ...l, thickness: Math.max(0, (l.thickness || 0) * dScale + offsetNm) };
    });
    const devDesign = {
        ...design,
        frontLayers: scaleLayers(design?.frontLayers),
        backLayers:  scaleLayers(design?.backLayers),
    };
    const resolve = (id) => {
        const { dn, dk } = effectiveForMaterial(d, id);
        return wrapMaterial(resolveMat(id), dn, dk);
    };
    return { design: devDesign, resolve };
}

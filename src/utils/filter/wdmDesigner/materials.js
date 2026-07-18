/**
 * Material lookups + the WDM lossless-material gate. See ../wdmDesigner.js
 * for the full geometry model and references.
 */

import { getMaterialById } from '../../materials/catalogManager.js';

export function nReal(materialId, lambda0_nm) {
    const mat = getMaterialById(materialId);
    if (!mat || !mat.getNK) return 1.0;
    const [n] = mat.getNK(lambda0_nm);
    return n;
}

export function kImag(materialId, lambda0_nm) {
    const mat = getMaterialById(materialId);
    if (!mat || !mat.getNK) return 0;
    const [, k] = mat.getNK(lambda0_nm);
    return k;
}

/**
 * The WDM wizard requires lossless materials (only materials
 * without absorption can be used in this procedure). For a Fabry-Perot
 * with mirror reflectance R, the field enhancement inside the cavity scales
 * as 1/(1−R)² → even tiny k accumulates into large absorption (Ta₂O₅ at
 * 1550 nm has k≈3e-3 in the refractiveindex.info data; peak T drops to ~6%
 * for a 3-cavity DWDM design). Threshold 1e-5 covers all practical
 * high-Q DWDM filter applications.
 */
export const WDM_LOSSY_THRESHOLD = 1e-5;
export function isMaterialLosslessForWDM(materialId, lambda0_nm) {
    return kImag(materialId, lambda0_nm) <= WDM_LOSSY_THRESHOLD;
}

/** Quarter-wave physical thickness (nm) at λ₀ for the given material. */
export function qwThickness(materialId, lambda0_nm) {
    const n = nReal(materialId, lambda0_nm);
    if (!(n > 0)) return 0;
    return lambda0_nm / (4 * n);
}

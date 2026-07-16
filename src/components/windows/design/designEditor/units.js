import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { getMaterialById, normalizeId } from '../../../../utils/materials/catalogManager.js';

// Resolve a material by legacy or compound ID, returning a material object with getNK.
export function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Returns true if the material has no extinction-coefficient data (k = 0 at all
// sampled wavelengths). Sellmeier-only materials like BK7 always return k = 0,
// which means substrate absorption is silently omitted from total-T calculations.
export function materialHasNoK(materialId) {
    const mat = resolveMaterial(materialId);
    if (!mat) return false;
    const testLambdas = [350, 400, 500, 600, 700, 800];
    return testLambdas.every(lam => mat.getNK(lam)[1] === 0);
}

// ── Thickness unit conversions ────────────────────────────────────────────────
//
// Units:
//   'nm'   — physical thickness in nm                           d
//   'OT'   — optical thickness in nm                           n·d
//   'QWOT' — quarter-wave optical thickness (dimensionless)    4·n·d / λ₀
//   'FWOT' — full-wave optical thickness (dimensionless)       n·d / λ₀
//
// References:
//   Macleod, Thin-Film Optical Filters (2010), §3.1
//   Field Guide to Optical Thin Films (2006), Glossary p.xi, §Fundamentals p.5
//   QWOT = λ₀/4 = n·d  (one quarter-wave layer at λ₀)

export function nmToUnit(d_nm, materialId, refLambda, unit) {
    if (unit === 'nm') return d_nm;
    const mat = resolveMaterial(materialId);
    const n = mat ? mat.getNK(refLambda)[0] : 1.0;
    if (unit === 'OT')   return n * d_nm;
    if (unit === 'QWOT') return (4 * n * d_nm) / refLambda;
    if (unit === 'FWOT') return (n * d_nm) / refLambda;
    return d_nm;
}

// Physical thickness (nm) for a value expressed in the given optical-thickness
// unit at the material's reference wavelength. 'nm' and any unknown unit pass
// through unchanged, as does a non-physical index (n ≤ 0).
const UNIT_TO_NM = {
    OT:   (value, n, refLambda) => value / n,
    QWOT: (value, n, refLambda) => (value * refLambda) / (4 * n),
    FWOT: (value, n, refLambda) => (value * refLambda) / n,
};

export function unitToNm(value, materialId, refLambda, unit) {
    const conv = UNIT_TO_NM[unit];
    if (!conv) return value;
    const mat = resolveMaterial(materialId);
    const n = mat ? mat.getNK(refLambda)[0] : 1.0;
    return n > 0 ? conv(value, n, refLambda) : value;
}

// Rescale every layer's physical thickness so its QWOT (4·n·d/λ₀) is
// invariant under a change of reference wavelength λ₀. Designs are specified
// in quarter-waves, so a QW layer must stay a QW layer when λ₀ moves; only
// the physical thickness d (and hence OT/FW) changes.
//
//   QWOT = 4·n(λ₀)·d / λ₀   (held constant)
//   ⇒  d_new = QWOT · λ_new / (4·n(λ_new))
//            = d_old · [n(λ_old)/n(λ_new)] · [λ_new/λ_old]
//
// n is dispersive, so it is re-evaluated at each λ₀ (not just a λ ratio).
export function rescaleLayersPreserveQWOT(layers, oldLambda, newLambda) {
    if (!layers || !(oldLambda > 0) || !(newLambda > 0)) return layers || [];
    return layers.map(l => {
        const mat   = resolveMaterial(l.material);
        const nOld  = mat ? mat.getNK(oldLambda)[0] : 1.0;
        const nNew  = mat ? mat.getNK(newLambda)[0] : 1.0;
        if (!(nOld > 0) || !(nNew > 0)) return l;
        const qwot  = (4 * nOld * (l.thickness || 0)) / oldLambda;
        const dNew  = (qwot * newLambda) / (4 * nNew);
        return { ...l, thickness: dNew };
    });
}

export const THICKNESS_UNITS = [
    { value: 'nm',   label: 'nm',   title: 'Physical thickness (nm)' },
    { value: 'OT',   label: 'OT',   title: 'Optical thickness n·d (nm)' },
    { value: 'QWOT', label: 'QW',   title: 'Quarter-wave optical thickness  4·n·d/λ₀' },
    { value: 'FWOT', label: 'FW',   title: 'Full-wave optical thickness  n·d/λ₀' },
];

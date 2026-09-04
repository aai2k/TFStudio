import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';

// Material an id stands for in the Design Editor, resolved the way the
// design is computed: the design's own `materials` block first (definitions
// that travel inside the design, such as those of an imported or received
// file), then the catalogs. `designMaterials` is that block; callers with no
// design at hand pass nothing and get the catalogs alone. Null for an id that
// resolves nowhere, so a missing material is reported rather than shown as
// air; an empty id is air.
export function resolveMaterial(id, designMaterials) {
    const { material, status } = resolveDesignMaterial({ materials: designMaterials }, id);
    return status === 'missing' ? null : material;
}

// Index at the reference wavelength, NaN when the material resolves nowhere.
function indexAt(materialId, refLambda, designMaterials) {
    const mat = resolveMaterial(materialId, designMaterials);
    return mat ? mat.getNK(refLambda)[0] : NaN;
}

// Returns true if the material has no extinction-coefficient data (k = 0 at all
// sampled wavelengths). Sellmeier-only materials like BK7 always return k = 0,
// which means substrate absorption is silently omitted from total-T calculations.
export function materialHasNoK(materialId, designMaterials) {
    const mat = resolveMaterial(materialId, designMaterials);
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
//
// An optical unit of a material that resolves nowhere is NaN: there is no
// index to convert with, and a value computed as air would read as a result.

export function nmToUnit(d_nm, materialId, refLambda, unit, designMaterials) {
    if (unit === 'nm') return d_nm;
    const n = indexAt(materialId, refLambda, designMaterials);
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

export function unitToNm(value, materialId, refLambda, unit, designMaterials) {
    const conv = UNIT_TO_NM[unit];
    if (!conv) return value;
    const n = indexAt(materialId, refLambda, designMaterials);
    if (Number.isNaN(n)) return NaN;
    return n > 0 ? conv(value, n, refLambda) : value;
}

// Upper clamp on a single layer's physical thickness. 1 mm (1e6 nm) is far
// beyond any real thin-film layer (thick spacers top out at tens of microns) —
// it exists purely to stop a stray entry like 9999999999 nm from corrupting the
// merit/TMM and blowing out the table layout. Not a physics bound; a UI guard.
export const MAX_THICKNESS_NM = 1e6;

/**
 * Physical thickness (nm) for what was typed into a thickness cell, or null if
 * the text is not a usable thickness, or the cell's unit is optical and the
 * layer's material resolves nowhere.
 *
 * `raw` is text in `unit`; the result is always physical nm, clamped to
 * MAX_THICKNESS_NM. It is read with parseNumberStrict, so `94,2` is 94.2 on a
 * keyboard whose decimal key is a comma, and a half-number such as `94abc` is
 * rejected rather than quietly committing the 94.
 */
export function thicknessEntryToNm(raw, materialId, refLambda, unit, designMaterials) {
    const value = parseNumberStrict(raw);
    if (isNaN(value) || value < 0) return null;
    const nm = unitToNm(value, materialId, refLambda, unit, designMaterials);
    if (!Number.isFinite(nm) || nm < 0) return null;
    return Math.min(nm, MAX_THICKNESS_NM);
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
// n is dispersive, so it is re-evaluated at each λ₀ (not just a λ ratio). A
// layer whose material resolves nowhere keeps its thickness: there is no
// index to hold the quarter waves with.
export function rescaleLayersPreserveQWOT(layers, oldLambda, newLambda, designMaterials) {
    if (!layers || !(oldLambda > 0) || !(newLambda > 0)) return layers || [];
    return layers.map(l => {
        const mat   = resolveMaterial(l.material, designMaterials);
        if (!mat) return l;
        const nOld  = mat.getNK(oldLambda)[0];
        const nNew  = mat.getNK(newLambda)[0];
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

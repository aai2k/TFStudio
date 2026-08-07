/**
 * Validity range of a material's optical constants, and which materials in a
 * design fail to cover an evaluated wavelength range.
 *
 * Why this exists: outside its tabulated range `makeGetNK` holds the end value
 * flat (catalogManager/dispersion.js), and an analytic Sellmeier fit is
 * extrapolated past its validity range with no check at all. Both return a
 * plausible number, so nothing on screen distinguishes measured data from an
 * extrapolation of it.
 *
 * Only a *declared* range raises a warning. The AGF and OptiLayer readers fall
 * back to a hardcoded 0.3–2.5 µm span when the file states no range, and
 * warning on that would fire for materials whose real range nobody knows,
 * which teaches the user to ignore the warning. The cost is that this
 * under-reports: the absence of a warning is not a guarantee of coverage.
 *
 * Ranges are stored on materials in µm; everything here returns nm, the unit
 * the evaluation code and the UI both work in.
 */
import { designMaterialIds, resolveDesignMaterial } from './designMaterials.js';

const UM_TO_NM = 1000;

// Half a picometre — far below any wavelength step the UI accepts, so a range
// that touches a material limit exactly is not reported as exceeding it.
const EDGE_TOLERANCE_NM = 5e-4;

// A tabulated material's range is its data extent, which is a declaration by
// construction: there is no data beyond the last row to extrapolate from.
function hasTabulatedData(material) {
    return Array.isArray(material?.tabData) && material.tabData.length > 0;
}

/**
 * Declared validity range of one material.
 *
 * @param   {object} material
 * @returns {[number, number]|null} `[minNm, maxNm]`, or null when the material
 *          declares no range and one must not be invented for it.
 */
export function materialRangeNm(material) {
    if (!material) return null;
    if (material.rangeDeclared !== true && !hasTabulatedData(material)) return null;

    const min = Number(material.lambdaMin) * UM_TO_NM;
    const max = Number(material.lambdaMax) * UM_TO_NM;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return [min, max];
}

/** True when `[from, to]` reaches outside `range`, edges excluded. */
export function rangeExceeds(range, [from, to]) {
    return from < range[0] - EDGE_TOLERANCE_NM || to > range[1] + EDGE_TOLERANCE_NM;
}

function normalizedRange(evaluated) {
    if (!Array.isArray(evaluated) || evaluated.length < 2) return null;
    const from = Number(evaluated[0]);
    const to = Number(evaluated[1]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return [Math.min(from, to), Math.max(from, to)];
}

/**
 * Which of a design's materials do not cover an evaluated wavelength range.
 *
 * Materials are resolved through the design's own embedded definitions first,
 * the same precedence evaluation uses, so a travelling design is checked
 * against the data it actually computes with. Unresolved materials are skipped
 * — a missing material is already reported, and blocks calculation anyway.
 *
 * @param   {object} design
 * @param   {[number, number]} evaluated `[fromNm, toNm]`, either order
 * @returns {{ offenders: {id: string, name: string, rangeNm: [number, number]}[],
 *             covered: [number, number]|null }}
 *          `covered` is the span every declared material covers — the range
 *          over which no value is clamped or extrapolated.
 */
export function designRangeCoverage(design, evaluated) {
    const span = normalizedRange(evaluated);
    if (!span) return { offenders: [], covered: null };

    const offenders = [];
    let low = -Infinity;
    let high = Infinity;

    for (const id of designMaterialIds(design)) {
        const { material, status } = resolveDesignMaterial(design, id);
        if (status === 'missing' || status === 'unset') continue;

        const rangeNm = materialRangeNm(material);
        if (!rangeNm) continue;

        low = Math.max(low, rangeNm[0]);
        high = Math.min(high, rangeNm[1]);
        if (rangeExceeds(rangeNm, span)) {
            offenders.push({ id, name: material.name || id, rangeNm });
        }
    }

    const covered = Number.isFinite(low) && Number.isFinite(high) && high > low ? [low, high] : null;
    return { offenders, covered };
}

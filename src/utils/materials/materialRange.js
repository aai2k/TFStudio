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
    const materials = [];
    for (const id of designMaterialIds(design)) {
        const { material, status } = resolveDesignMaterial(design, id);
        if (status !== 'missing' && status !== 'unset') materials.push({ id, material });
    }
    return materialsRangeCoverage(materials, evaluated);
}

/**
 * The same check over an explicit set of materials, for a window that computes
 * with a stack other than the design's own. The Process Exporter reads the part
 * or a witness chip in air, so the design's media are not evaluated there and
 * the chip glass, which the design does not list, is.
 *
 * @param   {{ id: string, material: object }[]} materials  a material listed
 *          twice is checked once; an entry without an id has nothing to check
 * @param   {[number, number]} evaluated `[fromNm, toNm]`, either order
 * @returns {{ offenders: {id: string, name: string, rangeNm: [number, number]}[],
 *             covered: [number, number]|null }}
 */
export function materialsRangeCoverage(materials, evaluated) {
    const span = normalizedRange(evaluated);
    if (!span) return { offenders: [], covered: null };

    const offenders = [];
    const seen = new Set();
    let low = -Infinity;
    let high = Infinity;

    for (const { id, material } of materials) {
        if (!id || seen.has(id)) continue;
        seen.add(id);

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

/**
 * The largest evaluated range free of clamped or extrapolated values: the
 * evaluated span clipped to the `covered` span from `designRangeCoverage`, or
 * `covered` itself when the two do not overlap. Bounds are rounded inward onto
 * 0.1 nm, so applying the result never re-raises the warning it fixes. Null
 * when no such range exists.
 *
 * @param   {[number, number]} covered
 * @param   {[number, number]} evaluated `[fromNm, toNm]`, either order
 * @returns {[number, number]|null}
 */
export function clampToCovered(covered, evaluated) {
    const span = normalizedRange(evaluated);
    if (!span || !covered) return null;
    let low = Math.max(span[0], covered[0]);
    let high = Math.min(span[1], covered[1]);
    if (!(high > low)) [low, high] = covered;
    low = Math.ceil(low * 10 - 1e-6) / 10;
    high = Math.floor(high * 10 + 1e-6) / 10;
    return high > low ? [low, high] : null;
}

/**
 * The nearest wavelength to `lambdaNm` that every material has data for.
 *
 * The single-wavelength counterpart of `clampToCovered`: a window evaluating at
 * one wavelength has no range to narrow, so the fix is to move the wavelength
 * itself. Rounded inward onto 0.1 nm for the same reason, so applying the
 * result never re-raises the warning it clears. Null when there is nothing to
 * clamp to, or when the wavelength is already covered.
 *
 * @param   {[number, number]|null} covered from `designRangeCoverage`
 * @param   {number} lambdaNm
 * @returns {number|null}
 */
export function clampLambdaToCovered(covered, lambdaNm) {
    if (!covered || !Number.isFinite(lambdaNm)) return null;
    const low = Math.ceil(covered[0] * 10 - 1e-6) / 10;
    const high = Math.floor(covered[1] * 10 + 1e-6) / 10;
    if (!(high >= low)) return null;
    const clamped = Math.min(Math.max(lambdaNm, low), high);
    return clamped === lambdaNm ? null : clamped;
}

/**
 * Contiguous parts of an evaluated wavelength range that at least one material
 * does not cover, in a shape spectral plots can draw as bands.
 *
 * Follows the same rule as `designRangeCoverage`: only declared ranges count,
 * so a band is never drawn from a reader's placeholder span. Parts contributed
 * by different materials are merged where they overlap or touch, one region per
 * contiguous span, carrying the names of every material short there.
 *
 * @param   {object} design
 * @param   {[number, number]} evaluated `[fromNm, toNm]`, either order
 * @returns {{ x0: number, x1: number, materials: string[] }[]} ascending, in nm
 */
export function uncoveredRegions(design, evaluated) {
    const span = normalizedRange(evaluated);
    if (!span) return [];

    const parts = [];
    for (const { name, rangeNm } of designRangeCoverage(design, evaluated).offenders) {
        if (span[0] < rangeNm[0] - EDGE_TOLERANCE_NM) {
            parts.push({ x0: span[0], x1: Math.min(rangeNm[0], span[1]), name });
        }
        if (span[1] > rangeNm[1] + EDGE_TOLERANCE_NM) {
            parts.push({ x0: Math.max(rangeNm[1], span[0]), x1: span[1], name });
        }
    }
    parts.sort((a, b) => a.x0 - b.x0);

    const regions = [];
    for (const part of parts) {
        const last = regions[regions.length - 1];
        if (last && part.x0 <= last.x1 + EDGE_TOLERANCE_NM) {
            last.x1 = Math.max(last.x1, part.x1);
            if (!last.materials.includes(part.name)) last.materials.push(part.name);
        } else {
            regions.push({ x0: part.x0, x1: part.x1, materials: [part.name] });
        }
    }
    return regions;
}

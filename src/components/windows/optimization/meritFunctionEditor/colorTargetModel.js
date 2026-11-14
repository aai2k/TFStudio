/**
 * The colour targets of the merit wizard's Color preset, and the rows they
 * write.
 *
 * A target is `{ id, name, aoi, pol, space, values }`: its angle of incidence
 * (degrees) and polarization, and its colour as three values in one of
 * COLOR_TARGET_SPACES (filterCatalog.js): x, y, Y; L*, a*, b*; or u′, v′, Y,
 * with Y in %. Generate writes one colour row per value, so a target keeps the
 * space it was given in. The target editor draws a target on the diagram of
 * its space and as a patch, and moves it between spaces, through the
 * illuminant's white (CIE 15:2004 colour spaces, colorimetry/colorSpaces.js).
 */
import { COLOR_TARGET_SPACES, generateFilterOperands } from '../../../../utils/physics/optimizer.js';
import {
    COLOR_RANGE_NM, chromaticityXy, lab, labToXyz, uvPrime, whitePoint, xyzToSRGB,
} from '../../../../utils/physics/colorimetry.js';

export { COLOR_TARGET_SPACES };

// The places a coordinate of each space is shown and picked to: a click on the
// editor's diagram lands within about 0.003 of x and y, which three places
// hold, and ΔE*ab of 0.01 is far under a noticeable step.
export const TARGET_PLACES = { xyY: [3, 3, 2], Lab: [2, 2, 2], uvY: [3, 3, 2] };

const whites = new Map();
/**
 * The white of `illuminant` under `observer` (2 or 10), Y 100, integrated on
 * a 1 nm grid over the band the observer tables cover.
 */
export function targetWhite(illuminant, observer) {
    const key = `${illuminant}|${observer}`;
    if (!whites.has(key)) {
        const [from, to] = COLOR_RANGE_NM;
        const grid = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        whites.set(key, whitePoint(grid, String(observer), illuminant));
    }
    return whites.get(key);
}

// x, y of a CIE 1976 u′, v′: u′ = 4x / (−2x + 12y + 3) and v′ = 9y / (−2x +
// 12y + 3) solved for x and y.
function xyOfUv(u, v) {
    const d = 6 * u - 16 * v + 12;
    return [9 * u / d, 4 * v / d];
}

const xyzOfChromaticity = (x, y, Y) => (y > 0 ? { X: x / y * Y, Y, Z: (1 - x - y) / y * Y } : { X: 0, Y: 0, Z: 0 });

/** The tristimulus values of `target` against `white`. */
export function targetXyz({ space, values }, white) {
    if (space === 'Lab') return labToXyz({ L: values[0], a: values[1], b: values[2] }, white);
    const [x, y] = space === 'uvY' ? xyOfUv(values[0], values[1]) : values;
    return xyzOfChromaticity(x, y, values[2]);
}

// The three values of the colour `XYZ` in `space`.
function valuesIn(space, XYZ, white) {
    if (space === 'Lab') {
        const { L, a, b } = lab(XYZ, white);
        return [L, a, b];
    }
    if (space === 'uvY') {
        const { up, vp } = uvPrime(XYZ);
        return [up, vp, XYZ.Y];
    }
    const { x, y } = chromaticityXy(XYZ);
    return [x, y, XYZ.Y];
}

const roundedIn = (space, values) => values.map((value, k) => Number(value.toFixed(TARGET_PLACES[space][k])));

/** `target` given in `space` instead, the same colour. */
export function targetInSpace(target, space, white) {
    return { ...target, space, values: valuesIn(space, targetXyz(target, white), white) };
}

/**
 * The diagram each space is picked on, one of Color Evaluation's DIAGRAM_IDS:
 * the x, y and u′, v′ chromaticity diagrams, and the a*, b* plane at the
 * target's L*.
 */
export const TARGET_DIAGRAMS = { xyY: 'xy', Lab: 'ab', uvY: 'uv' };

// Which two of a space's three values are the diagram's axes: x and y, a* and
// b*, u′ and v′. The third, Y or L*, is typed.
const PLANE_VALUES = { xyY: [0, 1], Lab: [1, 2], uvY: [0, 1] };

/** Where `target` sits on the diagram of its space. */
export function targetOnPlane({ space, values }) {
    return PLANE_VALUES[space].map(k => values[k]);
}

/**
 * `target` moved to the point picked on the diagram of its space, its typed
 * value kept, the two picked rounded to the places they are picked to.
 */
export function targetAtPlanePoint(target, point) {
    const values = [...target.values];
    PLANE_VALUES[target.space].forEach((k, i) => { values[k] = point[i]; });
    return { ...target, values: roundedIn(target.space, values) };
}

/** The patch of `target` as Color Evaluation draws a colour at Fit: 'rgb(r, g, b)'. */
export function targetPatch(target, white) {
    return xyzToSRGB(targetXyz(target, white), white, { fit: true });
}

/**
 * A new target named `name`, at 0° and the polarization average, at the
 * colour `XYZ` given in x, y, Y: the coating's at that angle, so a target
 * starts on the colour it pulls from.
 */
export function newColorTarget(name, XYZ, white) {
    return {
        id: Math.random().toString(36).slice(2, 10),
        name, aoi: 0, pol: 'avg', space: 'xyY',
        values: roundedIn('xyY', valuesIn('xyY', XYZ, white)),
    };
}

/**
 * The rows the Color preset writes, `{ rows, curves, heading }`, as
 * buildWizardResult takes a type's own rows (meritOperandModel.js): a colour
 * row per coordinate of each target, under the wizard's illuminant and
 * observer, which the heading names with the count of targets.
 */
export function colorWizardRows({ typeId, session, tw }) {
    const { colorTargets, colorIlluminant: illuminant, colorObserver: observer } = session;
    return {
        rows: generateFilterOperands(typeId, {}, { colorTargets, illuminant, observer }),
        curves: [],
        heading: `${illuminant} · ${observer}°, ${tw.header.colorTargets(colorTargets.length)}`,
    };
}

/**
 * The colour quantities `block` writes, in the order it first writes each, as
 * Color list ids.
 */
export function blockColorQuantities(block) {
    return [...new Set(block.filter(op => op.color != null).map(op => op.color))];
}

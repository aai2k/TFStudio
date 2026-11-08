/**
 * The planes the Color Evaluation window plots a colour on, and the lines it
 * draws there. See ../colorimetry.js for the provenance of the colour spaces.
 *
 * A plane takes a chromaticity x, y to its two plot coordinates (`toPlane`) and
 * back (`fromPlane`), and places a computed colour at its own coordinates
 * (`ofReport`). CIE 1931 x, y and CIE 1976 u′, v′ are chromaticity diagrams.
 * The CIELAB a*, b* and CIELUV u*, v* planes hold the chromaticities at one
 * lightness L*: each chromaticity is taken at the Y that L* gives, so the
 * spectral locus is drawn at that lightness, while a computed colour sits at
 * its own a*, b* or u*, v* whatever its lightness. The two hue and chroma
 * planes are the CIELUV and CIELAB planes with a polar grid: C* is the distance
 * from the white and h the angle from the positive first axis.
 */

import { chromaticityXy, lab, labToXyz, lightnessToY, luv, luvToXyz, uvPrime } from './colorSpaces.js';
import { planckianXyz, spectralLocusXy } from './locus.js';
import { SRGB_PRIMARIES } from './srgb.js';

/** The diagrams in the order the window's tabs show them. */
export const DIAGRAM_IDS = ['xy', 'uv', 'ab', 'chUv', 'chAb'];

/** Diagrams drawn at one lightness, which the window takes from the colour it shows. */
export const LIGHTNESS_DIAGRAMS = ['ab', 'chUv', 'chAb'];

// Unit Y; the chromaticity alone is what the two diagrams use.
const xyzOfChromaticity = (x, y, Y = 1) => ({ X: x / y * Y, Y, Z: (1 - x - y) / y * Y });

// A chromaticity, or null for XYZ no real colour has.
const realChromaticity = XYZ => (XYZ.X >= 0 && XYZ.Y > 0 && XYZ.Z >= 0 ? chromaticityXy(XYZ) : null);

const chromaticityPlanes = {
    xy: {
        axes: ['x', 'y'],
        toPlane: (x, y) => [x, y],
        fromPlane: (x, y) => (y > 0 ? { x, y } : null),
        ofReport: report => [report.xy.x, report.xy.y],
    },
    uv: {
        axes: ['u′', 'v′'],
        toPlane: (x, y) => {
            const { up, vp } = uvPrime(xyzOfChromaticity(x, y));
            return [up, vp];
        },
        // u′ = 4X / (X + 15Y + 3Z) and v′ = 9Y / (X + 15Y + 3Z) solved for X
        // and Z at Y = 1.
        fromPlane: (u, v) => (v > 0
            ? realChromaticity({ X: 9 * u / (4 * v), Y: 1, Z: (12 - 3 * u - 20 * v) / (4 * v) })
            : null),
        ofReport: report => [report.uvP.up, report.uvP.vp],
    },
};

// `white` is the illuminant's XYZ with Y 100, `L` the plane's lightness.
function lightnessPlane(space, white, L) {
    const Y = white.Y * lightnessToY(L);
    const atLightness = (x, y) => xyzOfChromaticity(x, y, Y);
    if (space === 'lab') {
        return {
            axes: ['a*', 'b*'],
            toPlane: (x, y) => {
                const { a, b } = lab(atLightness(x, y), white);
                return [a, b];
            },
            fromPlane: (a, b) => realChromaticity(labToXyz({ L, a, b }, white)),
            ofReport: report => [report.Lab.a, report.Lab.b],
        };
    }
    return {
        axes: ['u*', 'v*'],
        toPlane: (x, y) => {
            const { u, v } = luv(atLightness(x, y), white);
            return [u, v];
        },
        fromPlane: (u, v) => realChromaticity(luvToXyz({ L, u, v }, white)),
        ofReport: report => [report.Luv.u, report.Luv.v],
    };
}

/**
 * One of `DIAGRAM_IDS` as a plane.
 *
 * @param {string} id
 * @param {object} options
 * @param {{X:number, Y:number, Z:number}} options.white  the illuminant's
 *        white, Y 100, as the colour report carries it
 * @param {number} options.lightness  L*, above 0 and up to 100; read by the
 *        CIELAB and CIELUV planes only
 * @returns {{ id, axes, polar, toPlane, fromPlane, ofReport, white }}
 *          `white` is where the white sits on the plane.
 */
export function diagramPlane(id, { white, lightness }) {
    const base = chromaticityPlanes[id]
        || lightnessPlane(id === 'chUv' ? 'luv' : 'lab', white, lightness);
    const w = chromaticityXy(white);
    return { id, polar: id === 'chUv' || id === 'chAb', ...base, white: base.toPlane(w.x, w.y) };
}

// Points `count` steps apart from a to b, b left out.
function stepsBetween(a, b, count) {
    return Array.from({ length: count }, (_, i) => {
        const t = i / count;
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    });
}

// A straight line on the chromaticity diagram is curved on the CIELAB plane, so
// every line drawn is cut finely enough to follow the curve there.
const LOCUS_STEPS = 4;
const LINE_STEPS = 48;

/**
 * The spectral locus closed by the purple line, on `plane`, as [p, q] pairs.
 * The purple line is the chord between the ends of the locus, the mixtures of
 * its shortest and longest wavelengths.
 */
export function locusOutline(plane, observer) {
    const locus = spectralLocusXy(observer);
    const points = [];
    for (let i = 0; i < locus.length - 1; i++) points.push(...stepsBetween(locus[i], locus[i + 1], LOCUS_STEPS));
    points.push(...stepsBetween(locus.at(-1), locus[0], LINE_STEPS));
    return points.map(p => plane.toPlane(p.x, p.y));
}

/** The locus at each wavelength of `wavelengths`, nm, as { lam, at: [p, q] }. */
export function locusMarks(plane, observer, wavelengths) {
    const locus = spectralLocusXy(observer);
    return wavelengths
        .map(lam => locus.find(point => point.lam === lam))
        .filter(Boolean)
        .map(point => ({ lam: point.lam, at: plane.toPlane(point.x, point.y) }));
}

/**
 * The Planckian locus on `plane` at each temperature of `temperatures`, K, as
 * { T, at: [p, q] }.
 */
export function planckianLocus(plane, observer, temperatures) {
    return temperatures.map(T => {
        const c = chromaticityXy(planckianXyz(T, observer));
        return { T, at: plane.toPlane(c.x, c.y) };
    });
}

/** The triangle of the sRGB primaries on `plane`, closed, as [p, q] pairs. */
export function srgbTriangle(plane) {
    const { red, green, blue } = SRGB_PRIMARIES;
    const corners = [red, green, blue, red];
    const points = [];
    for (let i = 0; i < 3; i++) points.push(...stepsBetween(corners[i], corners[i + 1], LINE_STEPS));
    points.push(red);
    return points.map(p => plane.toPlane(p.x, p.y));
}

// Tools for a design's spectrum with graded interlayers at its interfaces,
// as the Inhomogeneities window computes it.

import { object, num, int, list, oneOf, bool, DESIGN_ID } from './schemaParts.js';

const VIEW_SIDE = oneOf(['front', 'back', 'total'], "'front' or 'back', that side's layers, or 'total', both sides of the part. Default: what the design is scored on");
const ANGLE = num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90; the cone axis under a cone. Default 0');
const ROW_SIDE = oneOf(['front', 'back'], 'The side the interface is on. Default: the side computed; on the whole part of a design coated on both sides it is given on each row');
const INTERFACE = int("The interface, numbered from the substrate: 0 is the substrate's surface, k the top of layer k (Design Editor numbers), and the side's layer count the surface that meets the medium");
const INTERFACE_TEXT = "Interface k of a side is the top of its layer k, the layers numbered from the substrate as the Design Editor numbers them, so 0 is the substrate's surface and N, on a side of N layers, the surface that meets the medium; a side with no layers has no interface. A layer of 0 nm keeps its number and its interfaces.";

// The mean, lowest and highest finite value of a curve, null where none is finite.
function stats(values) {
    let sum = 0, count = 0, min = Infinity, max = -Infinity;
    for (const v of values) {
        if (!Number.isFinite(v)) continue;
        sum += v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return count ? { mean: sum / count, min, max } : { mean: null, min: null, max: null };
}

// The largest change from `before` to `after`, signed, and the wavelength of
// it, the first where two are equal; null where no change is finite.
function largestChange(wavelength, before, after) {
    let at = -1;
    for (let i = 0; i < before.length; i++) {
        const change = after[i] - before[i];
        if (Number.isFinite(change) && (at < 0 || Math.abs(change) > Math.abs(after[at] - before[at]))) at = i;
    }
    return at < 0 ? { change: null, at: null } : { change: after[at] - before[at], at: wavelength[at] };
}

const UNPOLARIZED = ['T', 'R', 'A'];
const statsOf = curves => Object.fromEntries(UNPOLARIZED.map(key => [key, stats(curves[key])]));

export function toleranceTools({ api, store }) {
    return [
        {
            name: 'inhomogeneities', title: 'Interlayers',
            description: `The spectrum of a design with graded interlayers at its interfaces, against the design as it stands, as the Inhomogeneities window computes it: each interlayer is put in between the two materials that meet at its interface, adding its thickness to the coating, and is cut into slices of one index each, the share of the second material rising along its profile, n and k mixed in proportion. ${INTERFACE_TEXT} On the front the grading runs from the material farther from the substrate to the nearer one, on the back from the nearer to the farther, as the window grades them. Without side, computed on what the design is scored on, as spectrum is; a design under a cone of incidence is averaged over its cone. When the design has a specification, the verdict is the Specification window's for the design with its interlayers in. Answers with mode (front, back or total), angle, from, to, pointCount, interlayers (the rows with their defaults filled in, each { side, interface, thickness, profile, slices, materials }, materials the two that meet there by id in the order the interlayer grades), addedThickness (nm), specification (as checkSpecification answers, for the design with its interlayers in; null without a specification), outOfRange (the materials whose data stop inside the range), homogeneous and graded, each { T, R, A } with the mean, min and max of each as fractions of 1, and largestChange { T, R, A }, each { change, at }: the largest change from homogeneous to graded, signed, and its wavelength in nm; with values true, wavelength (nm) and homogeneous and graded with R, T, A, Rs, Rp, Ts, Tp, As and Ap at every wavelength instead.`,
            inputSchema: object({
                designId: DESIGN_ID,
                interlayers: list(object({
                    side: ROW_SIDE, interface: INTERFACE,
                    thickness: num('Thickness in nm, 0 or more. Default 5'),
                    profile: oneOf(['linear', 'parabolic', 'invParabolic', 'exponential', 'sigmoid'], "The profile the share of the second material follows. Default 'linear'"),
                    slices: int('Slices of one index each, 2 or more. Default 10'),
                }, ['interface']), 'One row per interlayer, one row to an interface. Default: none'),
                start: num('First wavelength in nm. Default 400'), end: num('Last wavelength in nm. Default 800'),
                step: num('Wavelength step in nm. Default 0.5'),
                angle: ANGLE, side: VIEW_SIDE,
                values: bool('Also answer with every curve at every wavelength. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { wavelength, homogeneous, graded, ...result } = api.inhomogeneities(store.get(designId), options);
                const range = { from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length };
                if (values) return { designId, ...result, ...range, wavelength, homogeneous, graded };
                return {
                    designId, ...result, ...range, homogeneous: statsOf(homogeneous), graded: statsOf(graded),
                    largestChange: Object.fromEntries(UNPOLARIZED.map(key => [key, largestChange(wavelength, homogeneous[key], graded[key])])),
                };
            },
        },
    ];
}

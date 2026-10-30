// Tools for a design's spectrum with graded interlayers or rough interfaces,
// and for its film stress, as the Inhomogeneities, Roughness / Scattering and
// Stress windows compute them.

import { object, num, int, list, oneOf, bool, DESIGN_ID } from './schemaParts.js';

const VIEW_SIDE = oneOf(['front', 'back', 'total'], "'front' or 'back', that side's layers, or 'total', both sides of the part. Default: what the design is scored on");
const ANGLE = num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90; the cone axis under a cone. Default 0');
const ROW_SIDE = oneOf(['front', 'back'], 'The side the interface is on. Default: the side computed, or on the whole part the side with layers; on the whole part of a design coated on both sides it is given on each row');
const INTERFACE = int("The interface, numbered from the substrate: 0 is the substrate's surface, k the top of layer k (Design Editor numbers), and the side's layer count the surface that meets the medium");
const INTERFACE_NUMBERS = "Interface k of a side is the top of its layer k, the layers numbered from the substrate as the Design Editor numbers them, so 0 is the substrate's surface and N, on a side of N layers, the surface that meets the medium";
const WAVELENGTHS = {
    start: num('First wavelength in nm. Default 400'), end: num('Last wavelength in nm. Default 800'),
    step: num('Wavelength step in nm. Default 0.5'),
};
const ROUGHNESS_KIND = "'short', fine against the wavelength, a graded layer that loses no light, or 'long', bumps wide against the wavelength, a layer that scatters light out of the specular beams";

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
const meansOf = curves => ({ T: stats(curves.T).mean, R: stats(curves.R).mean });

// The mean and the largest value of the loss, and the wavelength of the
// largest, the first where two are equal.
function lossSummary(wavelength, loss) {
    const { mean, max } = stats(loss);
    return { mean, max, at: max === null ? null : wavelength[loss.indexOf(max)] };
}

export function toleranceTools({ api, store }) {
    return [
        {
            name: 'inhomogeneities', title: 'Interlayers',
            description: `The spectrum of a design with graded interlayers at its interfaces, against the design as it stands, as the Inhomogeneities window computes it: each interlayer is put in between the two materials that meet at its interface, adding its thickness to the coating, and is cut into slices of one index each, the share of the second material rising along its profile, n and k mixed in proportion. ${INTERFACE_NUMBERS}; a side with no layers has no interface. A layer of 0 nm keeps its number and its interfaces. On the front the grading runs from the material farther from the substrate to the nearer one, on the back from the nearer to the farther, as the window grades them. Without side, computed on what the design is scored on, as spectrum is; a design under a cone of incidence is averaged over its cone. When the design has a specification, the verdict is the Specification window's for the design with its interlayers in. Answers with mode (front, back or total), angle, from, to, pointCount, interlayers (the rows with their defaults filled in, each { side, interface, thickness, profile, slices, materials }, materials the two that meet there by id in the order the interlayer grades), addedThickness (nm), specification (as checkSpecification answers, for the design with its interlayers in; null without a specification), outOfRange (the materials whose data stop inside the range), homogeneous and graded, each { T, R, A } with the mean, min and max of each as fractions of 1, and largestChange { T, R, A }, each { change, at }: the largest change from homogeneous to graded, signed, and its wavelength in nm; with values true, wavelength (nm) and homogeneous and graded with R, T, A, Rs, Rp, Ts, Tp, As and Ap at every wavelength instead.`,
            inputSchema: object({
                designId: DESIGN_ID,
                interlayers: list(object({
                    side: ROW_SIDE, interface: INTERFACE,
                    thickness: num('Thickness in nm, 0 or more. Default 5'),
                    profile: oneOf(['linear', 'parabolic', 'invParabolic', 'exponential', 'sigmoid'], "The profile the share of the second material follows. Default 'linear'"),
                    slices: int('Slices of one index each, 2 or more. Default 10'),
                }, ['interface']), 'One row per interlayer, one row to an interface. Default: none'),
                ...WAVELENGTHS,
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
        {
            name: 'roughness', title: 'Interface roughness',
            description: `The specular R and T of a design with rough interfaces, against the smooth design, as the Roughness / Scattering window computes them: each rough interface becomes a transition layer 2σ thick, σ the rms roughness, taken out of the layer beneath it; the substrate is not thinned, and a layer thinner than 2σ is set to 0 nm. Short range is a graded layer whose n and k run in a straight line from one material to the other and loses no light; long range is one layer whose extinction coefficient stands for the light scattered out of the specular beams, derived for one surface at normal incidence, so at an angle, under a cone or in a multilayer it is an estimate. sigma and range set every interface and interfaces the ones that differ; one rough interface alone is sigma 0 with that interface listed. ${INTERFACE_NUMBERS}; the front keeps interface 0 with no layers, and a back with no layers has none. A layer of 0 nm is not in the coating: the sigma set on its top is not used. Without side, computed on what the design is scored on, as spectrum is; a design under a cone of incidence is averaged over its cone. Answers with mode (front, back or total), angle, from, to, pointCount, thinned (the layers set to 0 nm, each { side, number }, numbered as the Design Editor numbers them), longRange (true when a long-range interface with a sigma above 0 is in), outOfRange (the materials whose data stop inside the range), smooth and rough, each { T, R } with the mean of each as a fraction of 1, and loss { mean, max, at }: smooth R + T minus rough R + T as a fraction of 1, its mean, its largest value and the wavelength of that in nm; with values true, wavelength (nm), smooth and rough with R, T, Rs, Rp, Ts and Tp, and loss at every wavelength instead.`,
            inputSchema: object({
                designId: DESIGN_ID,
                sigma: num('RMS roughness of every interface in nm, 0 or more. Default 1'),
                range: oneOf(['short', 'long'], `The kind of roughness of every interface: ${ROUGHNESS_KIND}. Default 'long'`),
                interfaces: list(object({
                    side: ROW_SIDE, interface: INTERFACE,
                    sigma: num("RMS roughness in nm, 0 or more. Default: the call's sigma"),
                    range: oneOf(['short', 'long'], "The kind of roughness. Default: the call's range"),
                }, ['interface']), 'The interfaces that differ from sigma and range, one row to an interface. Default: none'),
                ...WAVELENGTHS,
                angle: ANGLE, side: VIEW_SIDE,
                values: bool('Also answer with every curve at every wavelength. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { wavelength, smooth, rough, loss, ...result } = api.roughness(store.get(designId), options);
                const range = { from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length };
                if (values) return { designId, ...result, ...range, wavelength, smooth, rough, loss };
                return { designId, ...result, ...range, smooth: meansOf(smooth), rough: meansOf(rough), loss: lossSummary(wavelength, loss) };
            },
        },
        {
            name: 'stress', title: 'Film stress',
            description: "The stress each film carries and what the coating does to the part, as the Stress window computes them from the constants on the materials' Mechanical tab and the design's two temperatures, substrate thickness and diameter, which setDesignSetup sets. A film's stress is σ_ref plus the thermal terms, tensile positive; the force is Σ σ·d, the quantity the STR merit row reads. The coatings counted follow what the design is scored on. With coatings on both faces the force is F_front − F_back; a coating on one face alone reads the same on the back as on the front. A film whose material states no intrinsic stress has a stress of null and counts as carrying none, as in the STR row, so it adds nothing to the force or the strain energy. Nothing else is substituted: any other constant a material does not state leaves the quantities that need it null. Built-in materials state no constants, so a design of them reads a force of 0. Answers with mode (front, back or total), run ({ temperature, depositionTemperature } in °C, null when the design sets neither and each film carries its intrinsic stress alone), substrate ({ material, thickness, diameter }, mm, the diameter null when unset), whole ({ force N/m, radius m, deflection µm, strainEnergy J/m², cracking }; radius and deflection positive for the convex face a compressive coating leaves, radius null at no force, deflection null without a diameter), films (front first, each { side, number from 1 at the substrate, material id, name, thickness nm, stress MPa, strainEnergy J/m², delamination, shear MPa }) and missing (each { material, name, fields }, the constants a material lacks, the substrate's included, each material once: one that is the substrate and a film, or that two ids name, is one entry under the id the films name it by first).",
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => ({ designId, ...api.stress(store.get(designId)) }),
        },
    ];
}

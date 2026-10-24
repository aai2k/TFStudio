// Tools that compute on a design: its spectrum, a band's peak, edge and width
// and how an edge moves with angle, a measured spectrum file and the design's
// difference from a curve in one, its index profile and layer
// thicknesses, what its stack adds up to, a side's admittance locus and
// electric field, its colour and integral values, a side's Psi and Delta, its
// phase and group delay, its merit, its verdict against its specification,
// and how much each layer moves the merit; and the dispersion of a slab of
// one material. Monte Carlo runs as a job (runTools.js).

import { isAbsolute } from 'node:path';
import { object, num, int, str, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

const VIEW_SIDE = oneOf(['front', 'back', 'total'], "'front' or 'back', that side's layers, or 'total', both sides of the part. Default: what the design is scored on");

// A result as JSON carries it: typed arrays become plain lists.
function plain(value) {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    return value;
}

const BAND = object({ from: num('Start of the band in nm'), to: num('End of the band in nm') }, ['from', 'to']);

// What the bandFeature and edgeShift tools share.
const FEATURE_SETTINGS = {
    quantity: oneOf(['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'], "The quantity read. Default 'T'"),
    direction: oneOf(['max', 'min'], "'max', a peak, or 'min', a dip. Default 'max'"),
    step: num('Step in nm the peak is searched at: 1, 0.1, 0.01 or 0.001; the crossings are bracketed on a scan of the band no coarser than it, of 301 samples at the least. The peak of R and the dip of T or A are found without a step, so a peak feature of those takes 1. Default 1'),
};
const FEATURE_LEVEL = num('For edge and fwhm, the level crossed, a fraction of the peak from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999. Default 0.5');
const FEATURE_EDGE_SIDE = oneOf(['left', 'right'], "For edge, 'right' for the crossing above the peak. Default: the one below it, or the one above where there is none below");

// The import panel's settings, which the readSpectrumFile and measuredDifference tools share.
const READ_SETTINGS = {
    angle: num('Angle of incidence in degrees for the curves whose file states none, 0 <= angle < 90. Default 0'),
    pol: oneOf(['avg', 's', 'p'], "Polarization for the curves whose file states none; a column headed with its polarization, such as Rs, keeps it, and an A column headed with none is avg. Default 'avg'"),
    quantity: oneOf(['T', 'R', 'A'], 'For a table, the quantity of every column. Default: what each column heading says, T where it says none'),
    scale: oneOf(['fraction', 'percent', 'absorbance'], "For a table, how every column's values are written. Default: what the import makes of each column"),
    xUnit: oneOf(['nm', 'um', 'cm-1', 'eV'], 'For a table, the unit of its wavelength column. Default: what the import makes of it, nm where it cannot tell'),
};

// A spectrum file path the tools take, absolute for the reason designTools.js gives.
function spectrumPath(path) {
    if (!isAbsolute(path)) throw new Error(`path is an absolute path, not '${path}'`);
    return path;
}

// A curve as the readSpectrumFile tool answers without values: its conditions, how many points and their span.
const curveSummary = ({ wavelength, values: _values, ...curve }) => ({
    ...curve, points: wavelength.length, from: wavelength[0], to: wavelength[wavelength.length - 1],
});

const ONE_SIDE = oneOf(['front', 'back'], "The coated side. Default: the back of a back_only design and the front of any other, the side the PR, GD, PSI and EFMX merit rows score");
const ANGLE = num('Angle of incidence in degrees in the medium light comes from, 0 <= angle < 90. Default 0');

// Where a locus ends, at the coating's outer surface: Y, Γ and |Γ|², the
// reflectance of the side.
function locusEnd(locus) {
    const { Y, gamma } = locus.boundaries[locus.boundaries.length - 1];
    return { eta0: locus.eta0, etaSubstrate: locus.etaSubstrate, Y, gamma, R: gamma.re ** 2 + gamma.im ** 2 };
}

// The peak of one polarization's |E|², with where it sits: the depth in nm and
// in the field's depth unit, and the layer, by Design Editor number, that holds
// it, the first light meets for a peak on a boundary.
function fieldPeak(field, pol) {
    const { e2, amplitude } = field[pol];
    let at = 0;
    for (let i = 1; i < e2.length; i++) if (e2[i] > e2[at]) at = i;
    const z = field.z[at];
    const layer = field.layers.find(l => z <= l.end) ?? field.layers[field.layers.length - 1];
    return { e2: e2[at], amplitude: amplitude[at], z, depth: field.depth[at], layer: layer.number, material: layer.material };
}

// What both ellipsometry tools say of the side, the cone and the convention.
const ONE_SURFACE = "Computed on the front, or the back of a back_only design, the side the PSI and DEL merit rows score; side total is refused, since Psi and Delta are measured on one surface; a side with no layers gives its bare surface. The design's cone of incidence is not used. deltaConvention 'azzam' is the Azzam-Bashara sign an ellipsometer writes, 'reversed' is 360 degrees minus it; Psi is the same in both.";
const DELTA_CONVENTION = oneOf(['azzam', 'reversed'], "The sign of Delta: 'azzam', the Azzam-Bashara sign an ellipsometer writes, or 'reversed', 360 degrees minus it. Default 'azzam'");

// The lowest and highest finite values of `values` with the x, `xs`, of each,
// the first where two are equal; NaN, a wavelength with no value, is passed
// over. All null when no value is finite.
function extremes(xs, values) {
    let lo = -1, hi = -1;
    for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i])) continue;
        if (lo < 0 || values[i] < values[lo]) lo = i;
        if (hi < 0 || values[i] > values[hi]) hi = i;
    }
    if (lo < 0) return { min: null, minAt: null, max: null, maxAt: null };
    return { min: values[lo], minAt: xs[lo], max: values[hi], maxAt: xs[hi] };
}

export function analysisTools({ api, store }) {
    return [
        {
            name: 'spectrum', title: 'Spectrum',
            description: "R, T and A of a design, for unpolarized light and for s and p (Rs, Rp, Ts, Tp, As, Ap), from `from` to `to` nm, as the Optical Evaluation window computes them, scored the way the design's surface mode says (front side, back side or the whole part). Answers with the mean, lowest and highest value of each over the whole range and over each band given, as fractions of 1 with the wavelength of each extreme; with values true, also every wavelength's values. outOfRange lists the materials whose data stop inside the range, where the window shows its material range notice.",
            inputSchema: object({
                designId: DESIGN_ID,
                from: num('First wavelength in nm'), to: num('Last wavelength in nm'), step: num('Wavelength step in nm. Default 1'),
                angles: list({ type: 'number' }, 'Angles of incidence in degrees in the incident medium. Default [0]'),
                bands: list(BAND, 'Bands to summarize besides the whole range'),
                values: bool('Also answer with the value at every wavelength. Default false'),
            }, ['designId', 'from', 'to']),
            run: ({ designId, bands = [], values = false, ...range }) => {
                const result = api.spectrum(store.get(designId), range);
                return {
                    designId, evalMode: result.evalMode, outOfRange: result.outOfRange, summary: api.summarize(result, { bands }),
                    ...(values ? { lambda: result.lambda, angles: result.angles } : {}),
                };
            },
        },
        {
            name: 'bandFeature', title: 'Band peak, edge or width',
            description: "The peak of a band of a design's spectrum, where the spectrum crosses a level beside it, or the width between the crossings below and above it, as the Specification window's CENTRAL_LAMBDA, EDGE_LAMBDA and FWHM checks find them: the peak searched at step, each crossing exact, bracketed on a scan of the band no coarser than step and of 301 samples at the least, then bisected. The level is a fraction of the peak: with direction max, level times the band's highest value; with min, that fraction of the way from its lowest value up to 1. Scored the way the design's surface mode says, as spectrum is, and averaged over the design's cone of incidence when it has one. Answers with feature, mode (front, back or total), quantity, angle, direction, step, peak (nm) and peakValue; for edge and fwhm also level (the fraction used, 0.001 to 0.999) and levelValue (the quantity at the crossings) and reason (null, or edgeNotCrossed or fwhmNotBracketed when a crossing is not inside the band); for edge, edge (nm or null); for fwhm, left, right, width (the FWHM check's value) and centre (their midpoint), in nm or null.",
            inputSchema: object({
                designId: DESIGN_ID,
                feature: oneOf(['peak', 'edge', 'fwhm'], "'peak', the wavelength of the band's highest value (lowest with direction min); 'edge', where the spectrum crosses the level; 'fwhm', the width between the crossings below and above the peak"),
                from: num('First wavelength of the band in nm'), to: num('Last wavelength of the band in nm'),
                ...FEATURE_SETTINGS,
                angle: num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90. Default 0'),
                level: FEATURE_LEVEL,
                edgeSide: FEATURE_EDGE_SIDE,
            }, ['designId', 'feature', 'from', 'to']),
            run: ({ designId, ...options }) => ({ designId, ...api.bandFeature(store.get(designId), options) }),
        },
        {
            name: 'edgeShift', title: 'Edge against angle',
            description: "Where a design's spectrum crosses a level beside the peak of a band at each of several angles of incidence, and how far that edge has moved from where it is at the first angle, each found as bandFeature with feature edge finds it, as an EDGE_LAMBDA check does. Scored the way the design's surface mode says, as spectrum is, and averaged over the design's cone of incidence when it has one. Answers with mode (front, back or total), quantity, direction, step, level (the fraction used), angleCount, notCrossedCount (angles where the spectrum does not cross the level inside the band), and edge and shift (edge less the edge at the first angle), each { min, minAt, max, maxAt } in nm with the angles in degrees; with values true, also angles and, one per angle, edge, shift, peak and peakValue, levelValue and reason (null or edgeNotCrossed), edge and shift null where there is no crossing.",
            inputSchema: object({
                designId: DESIGN_ID,
                from: num('First wavelength of the band in nm'), to: num('Last wavelength of the band in nm'),
                angles: list({ type: 'number' }, 'Angles of incidence in degrees in the incident medium, each 0 <= angle < 90'),
                ...FEATURE_SETTINGS,
                level: FEATURE_LEVEL,
                edgeSide: FEATURE_EDGE_SIDE,
                values: bool('Also answer with the values at every angle. Default false'),
            }, ['designId', 'from', 'to', 'angles']),
            run: ({ designId, values = false, ...options }) => {
                const { angles, edge, shift, peak, peakValue, levelValue, reason, ...settings } = api.edgeShift(store.get(designId), options);
                return {
                    designId, ...settings, angleCount: angles.length, notCrossedCount: edge.filter(e => e === null).length,
                    ...(values ? { angles, edge, shift, peak, peakValue, levelValue, reason } : { edge: extremes(angles, edge), shift: extremes(angles, shift) }),
                };
            },
        },
        {
            name: 'readSpectrumFile', title: 'Read a spectrum file',
            description: "Reads a measured spectrum file as the Measured Spectra window's import reads it: a CSV or text table, one curve per column after the wavelength column, or a JCAMP-DX file, one curve per spectrum, each what the window would add to a design, wavelengths in nm rising and R, T and A as fractions of 1. The settings take the place of the import panel's, which asks only what the file leaves unsaid: an angle or a polarization the file states, in its header lines or a column's heading, is kept. A JCAMP-DX file takes only angle and pol. Answers with format (table or jcamp), fileName, xUnit (the unit a table's wavelengths were read in, or null), skippedRows (lines of a table that held no row) and curves, each { name, quantity (T, R, A, or PSI or DEL for Psi or Delta), angle, pol, points, from, to } in nm; with values true each curve also has wavelength and values.",
            inputSchema: object({
                path: str('Absolute path of the spectrum file'),
                ...READ_SETTINGS,
                values: bool('Also answer with every curve\'s wavelengths and values. Default false'),
            }, ['path']),
            run: ({ path, values = false, ...options }) => {
                const read = api.readSpectrumFile(spectrumPath(path), options);
                return { ...read, curves: read.curves.map(curve => (values ? curve : curveSummary(curve))) };
            },
        },
        {
            name: 'measuredDifference', title: 'Difference from a measured curve',
            description: "How a design's spectrum differs from a measured curve in a spectrum file, as the MCURVE merit row the Measured Spectra window's Fit dialog writes scores it: the curve read as readSpectrumFile reads it, sampled on the dialog's grid and kept to the span every material of the design has data for, and the design read at each point at the curve's angle and polarization, the way the design's surface mode says, as the merit function scores it, averaged over the design's cone of incidence when it has one. Only a T, R or A curve is compared. Answers with mode (front, back or total), name, quantity, angle, pol, grid, db, levelFree, clipped (true when fewer wavelengths were compared than asked for), rms (the MCURVE row's value, a fraction of 1 or dB with db), ppef (a PPEF row's value, the spread of measured less design in dB), level (the mean difference taken off with levelFree, else null), points, from and to (nm) and deviation { min, minAt, max, maxAt }, design less measured; with values true, also wavelength, measured, design and deviation at every point.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the spectrum file'),
                curve: { type: ['string', 'integer'], description: 'For a file of several curves, the one compared, by its name or its number from 0' },
                ...READ_SETTINGS,
                grid: oneOf(['measured', 'thinned', 'uniform'], "'measured', the curve's own points; 'thinned', every thinEvery-th of them and the last; 'uniform', every step nm, the curve read between its points with PCHIP. Default 'measured'"),
                step: num("With grid 'uniform', the step in nm. Default: the curve's median spacing"),
                thinEvery: int("With grid 'thinned', which points are kept. Default 2"),
                from: num("First wavelength compared, nm. Default: the curve's first"),
                to: num("Last wavelength compared, nm. Default: the curve's last"),
                db: bool('For a T curve, compare in dB, as the dialog\'s dB scale does; points at or below 0 are left out. Default false'),
                levelFree: bool('Take off the mean difference before the RMS, as an MCURVE row with its level free scores. Default false'),
                values: bool('Also answer with the values at every point. Default false'),
            }, ['designId', 'path']),
            run: ({ designId, path, values = false, ...options }) => {
                const found = api.measuredDifference(store.get(designId), spectrumPath(path), options);
                const { wavelength, measured, design, deviation, ...settings } = found;
                return {
                    designId, ...settings, points: wavelength.length, from: wavelength[0], to: wavelength[wavelength.length - 1],
                    ...(values ? { wavelength, measured, design, deviation } : { deviation: extremes(wavelength, deviation) }),
                };
            },
        },
        {
            name: 'indexProfile', title: 'Index profile',
            description: "n and k of a design's layers at one wavelength, laid out by depth, as the Refractive Index Profile window shows them. Without side, laid out on what the design is scored on, as spectrum is: one side's layers in the order light meets them from that side's medium (the incident medium on the front, the exit medium on the back), or with mode total the front, the substrate and the back, as the window's Total view lays them. A layer with no thickness is left out. Answers with mode (front, back or total), wavelength, incident { material, n, k } (null on total), substrate { material, n, k } (on total also thickness in mm), thickness and opticalThickness (sum of n times thickness) of the layers in nm, layerCount, and outOfRange, the materials whose data do not reach the wavelength; with values true, also layers, each { number, material, n, k, thickness, start, end } in nm, number counting a side's layers from 1 next to the substrate as the Design Editor does, start and end the depth from the side's outer surface (on total also side, the back's layers from the substrate out). A side with no layer thicker than 0 nm is refused.",
            inputSchema: object({
                designId: DESIGN_ID,
                wavelength: num("Wavelength in nm. Default: the design's reference wavelength"),
                side: VIEW_SIDE,
                values: bool('Also answer with every layer. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { layers, ...profile } = api.indexProfile(store.get(designId), options);
                return { designId, ...profile, layerCount: layers.length, ...(values ? { layers } : {}) };
            },
        },
        {
            name: 'layerThicknesses', title: 'Layer thicknesses',
            description: "Each layer's physical and optical thickness, as the Layer Thicknesses window lists them, the optical ones at one wavelength λ0. Without side, listed on what the design is scored on, as spectrum is; with mode total, the front's layers, then the back's. Answers with mode (front, back or total), wavelength, rowCount and outOfRange, the materials whose data do not reach the wavelength; with values true, also rows, one per layer from layer 1 next to the substrate outward, each { number, material, thickness, opticalThickness, qwot, fwot }: thickness and opticalThickness (n times thickness) in nm, qwot 4nd/λ0 and fwot nd/λ0, the optical ones null for a layer with no material; on total each also has side. designFacts gives the total thickness. A side with no layers is refused.",
            inputSchema: object({
                designId: DESIGN_ID,
                wavelength: num("Wavelength λ0 in nm. Default: the design's reference wavelength"),
                side: VIEW_SIDE,
                values: bool('Also answer with every row. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { rows, ...listed } = api.layerThicknesses(store.get(designId), options);
                return { designId, ...listed, rowCount: rows.length, ...(values ? { rows } : {}) };
            },
        },
        {
            name: 'designFacts', title: 'Design facts',
            description: "What a design's stack adds up to. Without side, on the sides a TT merit row sums: the front of a front_only or symmetric design, the back of a back_only one, both of a both_independent one, so a symmetric design counts its front once and a back a front_only design holds counts not at all; side total counts both sides as evaluated, a symmetric design's mirrored back too. Answers with mode (front, back or total), wavelength (the reference wavelength, nm), thickness (nm, as the TT row reads it), opticalThickness (sum of n times thickness at the reference wavelength, nm; null when a material resolves to nothing) and layerCounts, the layers of each material by id; with values true, also qwot { front, back }, each layer's quarter-wave optical thickness 4nd/λ0 as the Design Editor's QW column shows it, listed by layer number from 1 next to the substrate, null for a material that resolves to nothing or has n of 0 or less. setLayer takes qwot to set a layer's thickness in quarter waves.",
            inputSchema: object({
                designId: DESIGN_ID,
                side: oneOf(['front', 'back', 'total'], "The sides counted: 'front', 'back' or 'total', both. Default: the coated sides"),
                values: bool("Also answer with each layer's QWOT. Default false"),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { qwot, ...facts } = api.designFacts(store.get(designId), options);
                return { designId, ...facts, ...(values ? { qwot } : {}) };
            },
        },
        {
            name: 'admittance', title: 'Admittance diagram',
            description: "The admittance locus of one coated side at one wavelength, for s and p, as the Admittance Diagram window draws and tables it, from the substrate's admittance through the admittance at the outer surface of each layer to the coating's outer surface. The design's cone of incidence is not used. Complex values are { re, im } in Macleod's sign (absorbing index n - ik, so an absorbing admittance has a negative imaginary part), admittances in free-space units, tilted for each polarization; the reflection coefficient is gamma = (eta0 - Y) / (eta0 + Y). Answers with mode (the side computed), wavelength, angle, plane, incident and substrate { material, name }, layerCount, outOfRange (the side's materials whose data do not reach the wavelength), and for s and p { eta0, etaSubstrate, Y, gamma, R }: Y and gamma at the outer surface and R = |gamma|², the side's reflectance; with values true, also s and p in full, each { eta0, etaSubstrate, boundaries, arcs }: boundaries one { layer, material, name, Y, gamma } per boundary from the substrate out, layer 0 the bare substrate and then each layer by its Design Editor number, 1 next to the substrate; arcs one { layer, material, re, im } per layer, the points the window draws in the chosen plane. A layer with no thickness has neither. side total is not taken; a side with no layers is refused.",
            inputSchema: object({
                designId: DESIGN_ID,
                wavelength: num("Wavelength in nm. Default: the design's reference wavelength"),
                angle: ANGLE, side: ONE_SIDE,
                plane: oneOf(['admittance', 'reflection'], "What the arcs are drawn in: 'admittance', the Y plane, or 'reflection', the plane of gamma. Default 'admittance'"),
                values: bool('Also answer with every boundary and arc. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { s, p, ...loci } = api.admittance(store.get(designId), options);
                return { designId, ...loci, layerCount: s.arcs.length, ...(values ? { s, p } : { s: locusEnd(s), p: locusEnd(p) }) };
            },
        },
        {
            name: 'electricField', title: 'Electric field',
            description: "The electric field through one coated side at one wavelength, for s, p and avg (unpolarized, the mean of the s and p fields), as the Electric Field window computes it, from the medium light comes from to the substrate. The design's cone of incidence is not used. |E|² is a fraction of the incident |E|² (the whole field, the squared semi-major axis of the field's ellipse, as the EFMX merit row reads it); amplitude is in V/m for 1 W/m² incident. Answers with mode (the side computed), wavelength, angle, reference (the λ0 optical depth is read at), depthUnit, pointsPerLayer, incidentAmplitude (V/m for 1 W/m²), layerCount, sampleCount, outOfRange (the side's materials whose data do not reach the wavelength), and peak { s, p, avg }, each { e2, amplitude, z, depth, layer, material }: the highest |E|², its amplitude, its depth in nm and in depthUnit, and the layer holding it by its Design Editor number; with values true, also z (nm) and depth for every sample, layers, each { number, material, start, end, depthStart, depthEnd } in the order light meets them, and s, p and avg, each { e2, e2Tangential, e2Normal, amplitude } per sample. Values on a coating of many layers run to megabytes. side total is not taken; a side with no layer thicker than 0 nm is refused.",
            inputSchema: object({
                designId: DESIGN_ID,
                wavelength: num("Wavelength in nm. Default: the design's reference wavelength"),
                angle: ANGLE, side: ONE_SIDE,
                pointsPerLayer: int('Samples across each layer, 2 or more. Default 60, as the window takes'),
                depthUnit: oneOf(['nm', 'OT', 'QWOT', 'FWOT'], "What depth is in: 'nm', physical; 'OT', the running sum of n times thickness in nm; 'QWOT' or 'FWOT', quarter or full waves of reference. Default 'nm'"),
                reference: num("The λ0 in nm the optical depth units read n at. Default: the design's reference wavelength"),
                values: bool('Also answer with every sample. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const field = api.electricField(store.get(designId), options);
                const { z, depth, layers, s, p, avg, ...facts } = field;
                const peak = { s: fieldPeak(field, 's'), p: fieldPeak(field, 'p'), avg: fieldPeak(field, 'avg') };
                return { designId, ...facts, layerCount: layers.length, sampleCount: z.length, peak, ...(values ? { z, depth, layers, s, p, avg } : {}) };
            },
        },
        {
            name: 'color', title: 'Colour',
            description: "The CIE colour of a design's reflectance or transmittance, as the Color Evaluation window computes it: the tristimulus values of R or T on 380-780 nm under one illuminant, integrated on a grid of step nm. Without side, computed on what the design is scored on, as spectrum is; a design under a cone of incidence is averaged over its cone; a side with no layers gives its bare surface. Answers with mode (front, back or total), quantity, angle, pol, observer, illuminant, step, X, Y, Z (the white's Y 100, so Y is the luminous R or T in %, and Y / 100 for T under D65 and the 2 degree observer is the integrals tool's Tvis when its grid has this one's wavelengths on 380-780 nm, as the two defaults do), x and y, lab { L, a, b, C, h }, dominant { wavelength, complementary, purity } (the dominant wavelength in nm, or null and the complementary one for a purple; purity a fraction of 1), cct (K) and duv (CCT and Duv from the 2 degree chromaticity, null where McCamy's formula has no value), srgb { r, g, b } 0 to 255, the window's swatch, and outOfRange (the materials whose data stop inside 380-780 nm); with values true, also white { X, Y, Z }, whiteXy { x, y }, luv { L, u, v, C, h, s }, uv1976 { u, v } (u' and v'), uv1960 { u, v } and hunterLab { L, a, b }.",
            inputSchema: object({
                designId: DESIGN_ID,
                quantity: oneOf(['R', 'T'], "What is coloured. Default 'R'"),
                angle: num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90; the cone axis under a cone. Default 0'),
                pol: oneOf(['avg', 's', 'p'], "Polarization. Default 'avg'"),
                observer: { type: 'number', enum: [2, 10], description: 'CIE standard observer by its field in degrees: 2 (CIE 1931) or 10 (CIE 1964). Default 2' },
                illuminant: oneOf(['D65', 'D50', 'A', 'E'], "CIE illuminant. Default 'D65'"),
                step: num('Wavelength step of the spectrum the colour is integrated on, nm. Default 0.5'),
                side: VIEW_SIDE,
                values: bool('Also answer with the white and every other colour space. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { white, whiteXy, luv, uv1976, uv1960, hunterLab, ...colour } = api.color(store.get(designId), options);
                return { designId, ...colour, ...(values ? { white, whiteXy, luv, uv1976, uv1960, hunterLab } : {}) };
            },
        },
        {
            name: 'integrals', title: 'Integral values',
            description: "Weighted averages of a design's T, R and A, as the Integral Values window computes them: each is the integral of C(λ) w(λ) over its weighting's band divided by that of w(λ), by the trapezoidal rule on the spectrum from start to end every step nm. The built-in rows: Tvis, Rvis, Avis (D65 times the CIE photopic V(λ), 380-780 nm), Tsol, Rsol, Asol (ASTM G173-03 AM1.5G, 300-2500 nm), TUV, RUV (flat, 300-380 nm), TNIR, RNIR (flat, 780-2500 nm); custom adds rows of your own. Without side, computed on what the design is scored on, as spectrum is; a design under a cone of incidence is averaged over its cone; a side with no layers gives its bare surface. Answers with mode (front, back or total), start, end, step, angle, pol, outOfRange (the materials whose data stop inside the range) and rows, one per integral in the window's order, each { key, quantity, value, covered }: value a fraction of 1, null with covered false when the spectrum does not span the row's band, and null with covered true when the row's weighting is 0 over the whole band; with values true, each row also has min and max (fractions of 1) with minAt and maxAt (nm), band [start, end] (nm) and spectrumSpan [first, last] (nm).",
            inputSchema: object({
                designId: DESIGN_ID,
                start: num('First wavelength of the spectrum, nm. Default 300'), end: num('Last wavelength, nm. Default 2500'),
                step: num('Wavelength step, nm. Default 0.5'),
                angle: num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90; the cone axis under a cone. Default 0'),
                pol: oneOf(['avg', 's', 'p'], "Polarization. Default 'avg'"),
                custom: list(object({
                    key: str('The row\'s name, which no other row has'),
                    quantity: oneOf(['T', 'R', 'A'], "Default 'T'"),
                    source: { type: 'object', description: "{ id }: id 'D65', 'D50', 'A', 'AM1.5G', 'E', 'blackbody' with T, its temperature in K (default 5778), or 'custom' with table, its [nm, value] rows, at least two at different wavelengths. Default { id: 'D65' }" },
                    detector: { type: 'object', description: "{ id }: id 'photopic', 'flat', or 'custom' with table, its [nm, value] rows, at least two at different wavelengths. Default { id: 'photopic' }" },
                    band: list({ type: 'number' }, '[start, end] in nm, start < end, which the weighting\'s own range narrows. Default [380, 780]'),
                }, ['key']), 'Rows of your own, after the built-in ones'),
                side: VIEW_SIDE,
                values: bool('Also answer with each row\'s extremes, band and the span of the spectrum. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { rows, ...table } = api.integrals(store.get(designId), options);
                return { designId, ...table, rows: values ? rows : rows.map(({ key, quantity, value, covered }) => ({ key, quantity, value, covered })) };
            },
        },
        {
            name: 'ellipsometry', title: 'Ellipsometry',
            description: `Psi and Delta of one coated side against wavelength, at one angle of incidence or several, as the Ellipsometry window's spectral sweep computes them from rho = r_p / r_s = tan(Psi) exp(i Delta). ${ONE_SURFACE} Answers with mode (the side computed), deltaConvention, from, to, pointCount, outOfRange (the side's materials whose data stop inside the range) and angles, one per angle asked, each { angle, psi, delta }, psi and delta each { min, minAt, max, maxAt } in degrees with the wavelengths in nm; with values true, also wavelength (nm) and in each angle psi and delta at every wavelength, degrees.`,
            inputSchema: object({
                designId: DESIGN_ID,
                from: num('First wavelength in nm. Default 400'), to: num('Last wavelength in nm. Default 800'), step: num('Wavelength step in nm. Default 0.5'),
                angles: list({ type: 'number' }, 'Angles of incidence in degrees in the medium light comes from, each 0 <= angle < 90. Default [65]'),
                side: ONE_SIDE, deltaConvention: DELTA_CONVENTION,
                values: bool('Also answer with Psi and Delta at every wavelength. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { wavelength, angles, ...sweep } = api.ellipsometry(store.get(designId), options);
                const summary = angles.map(({ angle, psi, delta }) => ({ angle, psi: extremes(wavelength, psi), delta: extremes(wavelength, delta) }));
                return {
                    designId, ...sweep, from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length,
                    ...(values ? { wavelength, angles } : { angles: summary }),
                };
            },
        },
        {
            name: 'ellipsometryVsAngle', title: 'Ellipsometry against angle',
            description: `Psi and Delta of one coated side against angle of incidence at one wavelength, as the Ellipsometry window's angular sweep computes them, the angles from angleStart by angleStep, each rounded to 0.001 degree, to angleEnd. An end above 89.5 degrees, a start not below the end, or a step below 0.05 degrees or above the span is refused, where the window would sweep other angles in its place. ${ONE_SURFACE} Answers with mode (the side computed), wavelength (nm), deltaConvention, pointCount, outOfRange (the side's materials whose data do not reach the wavelength), and psi and delta, each { min, minAt, max, maxAt } in degrees with the angles of incidence in degrees; with values true, also angle, psi and delta at every angle, degrees.`,
            inputSchema: object({
                designId: DESIGN_ID,
                wavelength: num("Wavelength in nm. Default: the design's reference wavelength"),
                angleStart: num('First angle of incidence in degrees, 0 or more. Default 45'),
                angleEnd: num('Last angle of incidence in degrees, above angleStart and at most 89.5. Default 80'),
                angleStep: num('Angle step in degrees, from 0.05 up to angleEnd - angleStart. Default 0.5'),
                side: ONE_SIDE, deltaConvention: DELTA_CONVENTION,
                values: bool('Also answer with Psi and Delta at every angle. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { angle, psi, delta, ...sweep } = api.ellipsometryVsAngle(store.get(designId), options);
                return {
                    designId, ...sweep, pointCount: angle.length,
                    ...(values ? { angle, psi, delta } : { psi: extremes(angle, psi), delta: extremes(angle, delta) }),
                };
            },
        },
        {
            name: 'groupDelay', title: 'Group delay',
            description: "Phase, group delay, GDD, TOD and CDC of a design's reflected or transmitted light against wavelength, as the Group Delay / GDD window computes them: GD = -dphi/domega in fs, GDD = -d2phi/domega2 in fs², TOD in fs³ and CDC = GDD * 2 pi c/lambda² in fs/nm, the chromatic dispersion as Essential Macleod reports it, with the sign of GDD (the slope dGD/dlambda is its negative), each an analytic value at its wavelength that does not depend on the grid; the phase in degrees is unwrapped along the grid, so on a uniform grid it can land 360 degrees off across a resonance narrower than the step; on the whole part the substrate's own phase, -2 pi n d cos(theta)/lambda, is added as it is, so only the coatings' phase is unwrapped. Computed on the front, or the back of a back_only design, the side the PR, GD and GDD merit rows score; side total, with response T alone, is the whole part as Pulse Analysis computes it: the front coating, one pass through the substrate at the design's thickness and the back coating. A side with no layers gives its bare surface. The design's cone of incidence is not used. step 'auto' gives the window's own grid, which adds points at reflection minima and table knots, so a mean over it leans toward the spikes. Answers with mode (front, back or total), response, angle, pol, step, reference, from, to, pointCount, knotCount, invalid (each { wavelength, reason } with no value), models, outOfRange (the materials of the sides computed whose data stop inside the range), and phase, gd, gdd, tod and cdc, each { min, minAt, max, maxAt } with the wavelengths in nm; with values true, also wavelength (nm), phase, gd, gdd, tod and cdc at every wavelength, outside (per wavelength the material its value was taken outside the data of, or null) and knots (each { wavelength, gd, gdd, tod, cdc }, each quantity a pair [left, right] of its values on the two sides of a table knot). Values at a million wavelengths run to about a hundred megabytes.",
            inputSchema: object({
                designId: DESIGN_ID,
                from: num('First wavelength in nm. Default 400'), to: num('Last wavelength in nm. Default 800'),
                step: { type: ['number', 'string'], description: "Wavelength step in nm, or 'auto' for the window's own grid. Default 0.5" },
                angle: ANGLE,
                pol: oneOf(['avg', 's', 'p'], "Polarization. Default 'avg'"),
                response: oneOf(['R', 'T'], "The light whose phase is taken: 'R', reflected, or 'T', transmitted. Default 'R'"),
                side: oneOf(['front', 'back', 'total'], "'front' or 'back', one coated side, or with response 'T' 'total', the whole part. Default: the back of a back_only design and the front of any other"),
                reference: num('Wavelength in nm the phase is shifted to 0 at, at the sample nearest it, as the window plots it; when that sample has no value the phase stays absolute and the reference answered is null. Default: none, the phase is absolute'),
                values: bool('Also answer with every value. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { wavelength, phase, gd, gdd, tod, cdc, outside, knots, ...curves } = api.groupDelay(store.get(designId), options);
                const all = { phase, gd, gdd, tod, cdc };
                const summary = Object.fromEntries(Object.entries(all).map(([key, series]) => [key, extremes(wavelength, series)]));
                return {
                    designId, ...curves, from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length, knotCount: knots.length,
                    ...(values ? { wavelength, ...all, outside, knots } : summary),
                };
            },
        },
        {
            name: 'materialDispersion', title: 'Material dispersion',
            description: "Phase, group delay, GDD, CDC and TOD of light through a slab of one material, and its group index, against wavelength, as the Material Dispersion window computes them: phi = -(d/c) omega n of the slab of thickness d in degrees, GD = -dphi/domega in fs, GDD = -d2phi/domega2 in fs², TOD in fs³, CDC = GDD * 2 pi c/lambda² in fs/nm with the sign of GDD (the slope dGD/dlambda is its negative), and the group index n - lambda dn/dlambda, each analytic at its wavelength from the material's formula or table. The wavelengths are the window's: 2000 steps over the range, never finer than 0.2 nm, with a sample on each table knot in range. Light the slab absorbs to an optical depth above 50 has no value. Answers with id, name, thickness (mm), model, from, to, pointCount, knotCount, outsideCount (wavelengths whose value was taken outside the material's data), maskedCount (wavelengths with no value), maskedReasons (why, each once), maskedThicknessLimit (the thinnest slab in mm that a masked wavelength would have a value up to, or null), and phase, gd, gdd, cdc, tod and groupIndex, each { min, minAt, max, maxAt } with the wavelengths in nm; with values true, also wavelength (nm), phase, gd, gdd, cdc, tod and groupIndex at every wavelength, outside (per wavelength the material's name where its value was taken outside its data, or null), knots (each { wavelength, gd, gdd, tod, cdc }, each quantity a pair [left, right] of its values on the two sides of a table knot) and masked (each { wavelength, reason, maximumThickness } with no value, maximumThickness in mm or null). With designId, a material the design carries resolves as it does in that design.",
            inputSchema: object({
                material: str('Material id'),
                from: num('First wavelength in nm. Default 400'), to: num('Last wavelength in nm. Default 1100'),
                thickness: num('Slab thickness in mm, 1e-9 to 100000. Default 1'),
                designId: DESIGN_ID,
                values: bool('Also answer with every value. Default false'),
            }, ['material']),
            run: ({ material, designId, values = false, ...options }) => {
                const { wavelength, phase, gd, gdd, cdc, tod, groupIndex, outside, knots, masked, ...rest } = api.materialDispersion(material, options, designId ? store.get(designId) : null);
                const all = { phase, gd, gdd, cdc, tod, groupIndex };
                const summary = Object.fromEntries(Object.entries(all).map(([key, series]) => [key, extremes(wavelength, series)]));
                const limits = masked.map(m => m.maximumThickness).filter(limit => limit !== null);
                return {
                    ...rest, from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length, knotCount: knots.length,
                    outsideCount: outside.filter(Boolean).length, maskedCount: masked.length, maskedReasons: [...new Set(masked.map(m => m.reason))],
                    maskedThicknessLimit: limits.length ? Math.min(...limits) : null,
                    ...(values ? { wavelength, ...all, outside, knots, masked } : summary),
                };
            },
        },
        {
            name: 'merit', title: 'Merit',
            description: "A design's merit as the Merit Function Editor shows it: the total, the optical merit without the manufacturing rows (MNT, MXT, TT, STR), and each row's value with what it scores: lambdaStart, lambdaEnd for a band, aoi and pol for an optical row (no pol for one scored on both polarizations, such as PSI or DPR), the layer range lambdaStart to lambdaEnd for MNT and MXT, cmp for TT and STR. A row that cannot be evaluated says why, and the totals are then null.",
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => ({ designId, ...plain(api.merit(store.get(designId))) }),
        },
        {
            name: 'checkSpecification', title: 'Check the specification',
            description: "A design judged against its specification as the Specification window judges it, each check at its own Step and averaged over the design's cone of incidence when it has one: passed (true when every enabled check passes and there is one), passing and total (the enabled checks), mode (front, back or total, how the design was scored) and a row per check in order with its index, kind, label, enabled, value, unit ('fraction' for T, R and A, 'nm', 'dB', or '' for a layer count and a disabled check), passed (null for a disabled check), margin (how far the value is from the nearest bound in its unit, positive inside, negative outside, so passed is true exactly when it is 0 or more), threshold { cmp, target, tol, lo, hi } and reason, null or why there is no value: disabled, notComputable, noCurve, fwhmNotBracketed, edgeNotCrossed or unknownKind. A design with no specification is refused; setSpecification sets one.",
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => ({ designId, ...api.checkSpecification(store.get(designId)) }),
        },
        {
            name: 'layerSensitivity', title: 'Layer sensitivity',
            description: "How much each layer's thickness moves the merit, as the Layer Sensitivity window ranks the layers: each layer is changed by plus and minus deltaNm (or relPct % with mode 'relative'), and its score, sensitivity, is the mean size of the two merit changes, scaled so the most sensitive layer scores 100. deltaMF carries the sign of the costlier direction, positive when a thicker layer costs more. mf0 and the changes are the optical merit, without MNT, MXT, TT and STR, on the default band grid, so mf0 can differ from the optical value merit gives: slightly in general, and several times on a band average or range target (TGT, RGT, AGT) over a narrow feature.",
            inputSchema: object({
                designId: DESIGN_ID, mode: oneOf(['absolute', 'relative'], 'Default absolute'),
                deltaNm: num('Thickness change in nm. Default 1'), relPct: num('Thickness change in % with mode relative. Default 1'),
                includeLocked: bool('Rank locked layers too. Default false'),
            }, ['designId']),
            run: ({ designId, ...options }) => ({ designId, ...plain(api.layerSensitivity(store.get(designId), options)) }),
        },
    ];
}

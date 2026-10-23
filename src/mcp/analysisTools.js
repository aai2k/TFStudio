// Tools that compute on a design: its spectrum, its index profile and layer
// thicknesses, what its stack adds up to, its merit, its verdict against its
// specification, and how much each layer moves the merit. Monte Carlo runs as
// a job (runTools.js).

import { object, num, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

const VIEW_SIDE = oneOf(['front', 'back', 'total'], "'front' or 'back', that side's layers, or 'total', both sides of the part. Default: what the design is scored on");

// A result as JSON carries it: typed arrays become plain lists.
function plain(value) {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    return value;
}

const BAND = object({ from: num('Start of the band in nm'), to: num('End of the band in nm') }, ['from', 'to']);

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

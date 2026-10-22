// Tools that compute on a design: its spectrum, its merit, and how much each
// layer moves it. Monte Carlo runs as a job (runTools.js).

import { object, num, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

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
            name: 'merit', title: 'Merit',
            description: "A design's merit as the Merit Function Editor shows it: the total, the optical merit without the manufacturing rows (MNT, MXT, TT, STR), and each row's value with what it scores: lambdaStart, lambdaEnd for a band, aoi and pol for an optical row (no pol for one scored on both polarizations, such as PSI or DPR), the layer range lambdaStart to lambdaEnd for MNT and MXT, cmp for TT and STR. A row that cannot be evaluated says why, and the totals are then null.",
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => ({ designId, ...plain(api.merit(store.get(designId))) }),
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

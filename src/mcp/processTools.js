// Tools for a deposition run as the Process Exporter models it: the spectrum
// a monitor in the chamber reads after each layer, and the files its Save
// writes.

import { isAbsolute } from 'node:path';
import { object, num, int, str, bool, oneOf, DESIGN_ID } from './schemaParts.js';

// The run the processSteps and exportProcess tools share, the Process Exporter's settings.
const RUN = {
    side: oneOf(['front', 'back'], 'The side deposited. Default: the front, or the back of a back_only design'),
    otherSide: oneOf(['bare', 'coated'], "The other side of the part, without or with its coating, for the whole run. Not used on chips. Default 'bare'"),
    quantity: oneOf(['T', 'R', 'A'], "Default 'T'"),
    angle: num('Angle of incidence in degrees in air, 0 <= angle < 90. Default 0'),
    pol: oneOf(['avg', 's', 'p'], "Polarization. Default 'avg'"),
    from: num('First wavelength in nm. Default 400'), to: num('Last wavelength in nm. Default 1100'),
    step: num('Wavelength step in nm. Default 0.5'),
    chips: object({
        layersPerChip: int('Layers to a chip, in place of a plan. Default 3'),
        plan: { type: 'array', items: { type: 'integer' }, description: "A chip number for each layer of the side from the substrate out, empty layers included" },
        glass: str("The chip glass, by material id. Default: the design's substrate"),
        witnessRatio: num('Witness thickness over the part thickness, 0.05 to 10. Default 1'),
    }),
};
const RUN_TEXT = "The layers are deposited from the substrate out, an empty layer left out, and the piece is read in air whatever media the design is in. On the part the other side stays bare or carries its whole coating for the run. With chips, each chip is a run of its own from bare chip glass, back face bare, each layer witnessRatio times its thickness on the part, as the Monitor Worksheet plans them. The design's cone of incidence is not used.";

// The mean, lowest and highest finite value of a spectrum, null where none is finite.
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

export function processTools({ api, store }) {
    return [
        {
            name: 'processSteps', title: 'Deposition run',
            description: `The spectrum a monitor in the chamber reads after each layer of one side, as the Process Exporter window computes its finished-layer curves. ${RUN_TEXT} Answers with mode (the side deposited), quantity, from, to, pointCount, bare (the spectrum before the first layer) and steps, one per layer deposited in order, each { step (from 1), layer (its Design Editor number from 1 next to the substrate, empty layers counted), material, thickness (nm on the piece read, the witness's on a chip), chip (null on the part) }, the spectra as fractions of 1; bare and each step with the mean, min and max of its spectrum; with values true, wavelength (nm), bare and each step's values instead.`,
            inputSchema: object({ designId: DESIGN_ID, ...RUN, values: bool('Answer with every value. Default false') }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { wavelength, bare, steps, ...run } = api.processSteps(store.get(designId), options);
                const range = { from: wavelength[0], to: wavelength[wavelength.length - 1], pointCount: wavelength.length };
                if (values) return { designId, ...run, ...range, wavelength, bare, steps };
                return { designId, ...run, ...range, bare: stats(bare), steps: steps.map(({ values: spectrum, ...step }) => ({ ...step, ...stats(spectrum) })) };
            },
        },
        {
            name: 'exportProcess', title: 'Write process files',
            description: `Writes the files the Process Exporter window's Save writes for a deposition run into a folder: one .res file a step (01.res, 02.res, ...), or CSV or text files, one a step or one table a run. ${RUN_TEXT} With chips each chip's files go in a folder of its own inside it. A file of the same name already in the folder is replaced, as Save replaces it. Answers with the paths written, in run order. A side with no layers to deposit is refused.`,
            inputSchema: object({
                designId: DESIGN_ID, folder: str('Absolute path of the folder the files go in, which must be there'), ...RUN,
                format: oneOf(['res', 'csv', 'txt'], "'res', or CSV under a .csv or .txt name; a .res file has one layout, which the options below do not change. Default 'res'"),
                files: oneOf(['step', 'table'], "'step', one file a step, or 'table', one file a run with a column a step. Default 'step'"),
                header: oneOf(['layers', 'conditions', 'none'], "'layers', the .res header with its layer table; 'conditions', the lines Measured Spectra's import reads back; or 'none'. Default 'layers'"),
                delimiter: oneOf([',', ';', '\t', ' '], "Default ','"),
                scale: oneOf(['percent', 'fraction'], "Default 'percent'"),
                decimals: int('Decimals of each value, a whole number from 0 to 12. Default 5'),
                decimalMark: oneOf(['.', ','], "'.' or ','; a comma takes a delimiter other than a comma. Default '.'"),
            }, ['designId', 'folder']),
            run: ({ designId, folder, ...options }) => {
                if (!isAbsolute(folder)) throw new Error(`folder is an absolute path, not '${folder}'`);
                return { designId, paths: api.exportProcess(store.get(designId), folder, options) };
            },
        },
    ];
}

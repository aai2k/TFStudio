// Tools for the measured curves a design holds: an ellipsometer file read as
// Measured Ellipsometry reads it, a file's curves added to a design, the merit
// rows the Fit dialogs add for one, and the files the Export tabs write.

import { designView } from './designStore.js';
import { curveSummary, READ_SETTINGS, spectrumPath } from './analysisTools.js';
import { object, num, int, str, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

// The import panel's settings of Measured Ellipsometry.
const ELLIPSOMETRY_SETTINGS = {
    angle: num('Angle of incidence in degrees for the columns whose file states none, 0 <= angle < 90. Default 70'),
    side: oneOf(['front', 'back'], "The side measured. Default: the side the file's header states, or 'front'"),
    deltaConvention: oneOf(['azzam', 'reversed'], "The sign the file writes Delta in: 'azzam', the Azzam-Bashara sign most ellipsometers write, or 'reversed', 360 degrees less it. Default 'azzam'"),
    xUnit: oneOf(['nm', 'um', 'cm-1', 'eV'], 'The unit of the wavelength column. Default: what the import makes of it, nm where it cannot tell'),
    quantities: list({ type: ['string', 'null'], enum: ['PSI', 'DEL', null] }, "Each column's type in the file's order: PSI, DEL, or null for the type the import gives it; a column with no type is left out. Default: the import's types"),
};

// The names of the curves a design holds, R, T and A apart from Psi and Delta.
const heldNames = design => ({
    measuredCurves: (design.measuredCurves || []).map(curve => curve.name),
    ellipsometryCurves: (design.measuredEllipsometry || []).map(curve => curve.name),
});

// The curves of `read` that `picks` names, by name or number from 0; all of them without picks.
function pickedCurves(read, picks) {
    if (!picks) return read.curves;
    return picks.map((pick) => {
        const found = Number.isInteger(pick) ? read.curves[pick] : read.curves.find(curve => curve.name === pick);
        if (!found) throw new Error(`curves names the file's curves by name or number from 0: ${read.curves.map(curve => curve.name).join(', ')}; not ${JSON.stringify(pick)}`);
        return found;
    });
}

export function measuredTools({ api, store }) {
    return [
        {
            name: 'readEllipsometryFile', title: 'Read an ellipsometer file',
            description: "Reads an ellipsometer file as the Measured Ellipsometry window's import reads it: a CSV or text table of a wavelength column and columns of Psi and Delta in degrees, each column typed as the window types it (a column that names itself is taken at its word; of two others, the one that leaves 0 to 90 degrees is Delta, otherwise the first is Psi), the curves the window's Add all adds, wavelengths in nm rising. An angle the file states, in its header lines or a column's heading, is kept, as in the window, and the side its header states fills the import panel, which side replaces; TFStudio's own Psi/Delta exports state both. Answers with fileName, xUnit, skippedRows (lines inside the block of numbers that held no row) and curves, each { name, quantity (PSI or DEL), angle, side, deltaConvention (null for Psi), cosDelta (true for a Delta that never leaves -1 to 1 and goes below 0, cos Delta under a Delta heading), points, from, to }; with values true each curve also has wavelength and values.",
            inputSchema: object({
                path: str('Absolute path of the ellipsometer file'),
                ...ELLIPSOMETRY_SETTINGS,
                values: bool('Also answer with every curve\'s wavelengths and values. Default false'),
            }, ['path']),
            run: ({ path, values = false, ...options }) => {
                const read = api.readEllipsometryFile(spectrumPath(path), options);
                return { ...read, curves: read.curves.map(curve => (values ? curve : curveSummary(curve))) };
            },
        },
        {
            name: 'addMeasuredCurves', title: 'Add measured curves to a design',
            description: "Adds the curves of a measured file to a design as the import of Measured Spectra or Measured Ellipsometry adds them: the file read as readSpectrumFile reads it, or with ellipsometry true as readEllipsometryFile reads it, with the settings each takes; R, T and A go to the design's measured spectra and Psi and Delta to its ellipsometry, after the curves it holds, and the design saves them. Answers with the design, added (the names of the curves added), and measuredCurves and ellipsometryCurves, the names of the curves the design now holds, which fitMeasured and exportMeasuredCurves take.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the file'),
                ellipsometry: bool("Read the file as Measured Ellipsometry's import reads it, with angle, side, deltaConvention, xUnit and quantities. Default false: as Measured Spectra's import reads it, with angle, pol, quantity, scale and xUnit"),
                curves: list({ type: ['string', 'integer'] }, "The file's curves added, by name or number from 0. Default: all of them"),
                ...READ_SETTINGS,
                ...ELLIPSOMETRY_SETTINGS,
                angle: num('Angle of incidence in degrees for the curves whose file states none, 0 <= angle < 90. Default: as each import takes it'),
                xUnit: oneOf(['nm', 'um', 'cm-1', 'eV'], 'The unit of the wavelength column. Default: what the import makes of it, nm where it cannot tell'),
            }, ['designId', 'path']),
            run: ({ designId, path, ellipsometry = false, curves, ...options }) => {
                const read = ellipsometry ? api.readEllipsometryFile(spectrumPath(path), options) : api.readSpectrumFile(spectrumPath(path), options);
                const picked = pickedCurves(read, curves);
                store.set(designId, api.addMeasuredCurves(store.get(designId), picked));
                return { ...designView(designId, store.get(designId)), added: picked.map(curve => curve.name), ...heldNames(store.get(designId)) };
            },
        },
        {
            name: 'fitMeasured', title: 'Add fit rows for a measured curve',
            description: "Adds the merit rows the Fit dialog adds for a measured curve the design holds, by its name: Measured Spectra's for R, T and A, Measured Ellipsometry's for Psi and Delta. The MCURVE block holds the curve sampled on the dialog's grid and kept to the span every material of the design has data for; a Psi or Delta block is scored on the front side alone, at an angle above 0. With constraints, an MNT and an MXT row over every layer follow it. measuredDifference on the same curve with the same settings gives the block's value; refine then fits the design. Answers with the design and the block's points, from and to (nm).",
            inputSchema: object({
                designId: DESIGN_ID,
                curve: str('The name of a curve the design holds, as addMeasuredCurves lists them'),
                grid: oneOf(['measured', 'thinned', 'uniform'], "'measured', the curve's own points; 'thinned', every thinEvery-th of them and the last; 'uniform', every step nm, the curve read between its points with PCHIP, Delta the short way round the circle. Default 'measured'"),
                step: num("With grid 'uniform', the step in nm. Default: the curve's median spacing"),
                thinEvery: int("With grid 'thinned', which points are kept. Default 2"),
                from: num("First wavelength kept, nm. Default: the curve's first"),
                to: num("Last wavelength kept, nm. Default: the curve's last"),
                db: bool('For a T curve, fit in dB, as the dialog\'s dB scale does; points at or below 0 are left out. Default false'),
                weight: num('The block\'s weight, 0 or more. Default 1'),
                output: oneOf(['append', 'replace'], "'append' adds the rows after the design's merit rows; 'replace' puts them in place of all of them. Default 'append'"),
                constraints: object({
                    min: num('Least layer thickness, nm, above 0. Default 10'),
                    max: num('Greatest layer thickness, nm, min or more. Default 1000'),
                    weight: num('Weight of the two rows, 0 or more. Default 1'),
                }),
            }, ['designId', 'curve']),
            run: ({ designId, curve, ...options }) => {
                const before = new Set((store.get(designId).meritOperands || []).map(row => row.id));
                store.set(designId, api.fitMeasured(store.get(designId), curve, options));
                const block = store.get(designId).meritOperands.find(row => row.type === 'MCURVE' && !before.has(row.id));
                const lambdas = block.sampleLambdas;
                return { ...designView(designId, store.get(designId)), points: lambdas.length, from: lambdas[0], to: lambdas[lambdas.length - 1] };
            },
        },
        {
            name: 'exportMeasuredCurves', title: 'Write measured curves to a file',
            description: "Writes measured curves a design holds to a file as the Export tab writes them: Measured Spectra's for R, T and A, as CSV with its condition lines (the design's name, the angle and the polarization the curves share) above the columns, or as JCAMP-DX; Measured Ellipsometry's for Psi and Delta, as CSV in degrees. Without settings, the window's factory format: CSV, nm, R, T and A in percent. A file that is there is refused unless overwrite is true. Answers with path and the count of curves written.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the file to write'),
                curves: list({ type: 'string' }, 'The names of the curves written, all R, T and A or all Psi and Delta. Default: every R, T and A curve the design holds, or its Psi and Delta when it holds none'),
                format: oneOf(['csv', 'jcamp'], "'csv', or 'jcamp' for JCAMP-DX, which R, T and A take. Default 'csv'"),
                xUnit: oneOf(['nm', 'um', 'cm-1', 'eV'], "The unit of the wavelength column: nm, um or cm-1 for R, T and A, nm, um or eV for Psi and Delta, as each window's Export tab offers. Default 'nm'"),
                scale: oneOf(['percent', 'fraction'], "For R, T and A, the values in percent or as fractions of 1. Default 'percent'"),
                overwrite: bool('Write over a file that is already there. Default false'),
            }, ['designId', 'path']),
            run: ({ designId, path, ...options }) => {
                const design = store.get(designId);
                api.exportMeasuredCurves(design, spectrumPath(path), options);
                const written = options.curves?.length ?? ((design.measuredCurves || []).length || (design.measuredEllipsometry || []).length);
                return { designId, path, curves: written };
            },
        },
    ];
}

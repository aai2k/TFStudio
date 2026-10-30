// Tools for a pulse's passage through a design, as the Pulse Analysis window
// computes it, and the spectrum the window keeps on the design.

import { spectrumPath } from './analysisTools.js';
import { designView } from './designStore.js';
import { object, num, int, list, oneOf, bool, str, DESIGN_ID } from './schemaParts.js';

// How many samples each curve holds, for the answer without values.
const counts = curves => Object.fromEntries(Object.entries(curves).filter(([, curve]) => curve && !Array.isArray(curve))
    .map(([name, curve]) => [name, (curve.t ?? curve.wavelength).length]));

export function pulseTools({ api, store }) {
    return [
        {
            name: 'pulseAnalysis', title: 'Pulse analysis',
            description: "A pulse's passage through a design, in time and in its spectrum, as the Pulse Analysis window computes it: reflected off or transmitted through one coated side, or with response 'T' and side 'total' through the whole part (front coating, one pass through the substrate, back coating, the first pulse out), passes bounces in a row. The spectrum is a Gaussian or sech2 pulse of duration, or a super-Gaussian of bandwidth and order, about the centre wavelength, or with source 'design' the spectrum the design holds (setPulseSpectrum), with the input's own gdd and tod on top. The design's cone of incidence is not used. Without options, the window's opening settings: a 10 fs Gaussian at 800 nm reflected once at 0 degrees, s and p averaged. Answers with mode (the sides computed), response, pol, angle, passes, source, centre (nm), converged (false when the output did not fit the largest time window, so its numbers are not reliable), chirped, metrics (the window's Results table: flpFwhm, inputFwhm, outputFwhm, outputRms and delay in fs; peakVsFlp, transformLimitedRatio and energyRatio as fractions of 1; residualGdd fs2, residualTod fs3; inputBandwidth and outputBandwidth nm; timeBandwidth), band (nm, the band the spectrum curves cover), echoDelay (fs, to the first echo inside the substrate, on the whole part; null on one side), outOfRange (materials whose data stop inside the band) and how many samples each curve holds; with values true, time ({ flp, input, output }, each { t fs, intensity, the Fourier-limited peak 1 }, the output at its absolute delay) and spectrum ({ input, output, coatingGdd, compensatingGdd }, each { wavelength nm rising, values }, the intensities with the input's peak 1, the GDD in fs2). The time curves run from the first to the last sample above 1e-4 of the Fourier-limited peak; past 4000 samples a curve keeps the lowest and highest of each run of its own values, so read each curve against its own t or wavelength.",
            inputSchema: object({
                designId: DESIGN_ID,
                source: oneOf(['model', 'design'], "'model', the spectrum of shape, or 'design', the spectrum the design holds. Default 'model'"),
                shape: oneOf(['gaussian', 'sech2', 'superGaussian'], "'gaussian' or 'sech2', a pulse of duration, or 'superGaussian', a spectrum of bandwidth and order. Default 'gaussian'"),
                centre: num("Centre wavelength in nm. Default 800; with source 'design', the spectrum's centroid"),
                duration: num('Intensity FWHM of the transform-limited pulse in fs, for gaussian and sech2. Default 10'),
                bandwidth: num('Intensity FWHM of the spectrum in nm, for superGaussian. Default 100'),
                order: num('Super-Gaussian order above 0; 2 is a Gaussian. Default 2'),
                gdd: num("The input's own GDD in fs2 about the centre wavelength. Default 0"),
                tod: num("The input's own TOD in fs3 about the centre wavelength. Default 0"),
                side: oneOf(['front', 'back', 'total'], "'front' or 'back', one coated side, or with response 'T' 'total', the whole part. Default: the back of a back_only design and the front of any other"),
                response: oneOf(['R', 'T'], "'R', the reflected pulse, or 'T', the transmitted one. Default 'R'"),
                pol: oneOf(['avg', 's', 'p'], "Polarization. Default 'avg'"),
                angle: num('Angle of incidence in degrees in the medium light comes from, 0 <= angle < 90. Default 0'),
                passes: int('Bounces off the coating or passes through it, 1 or more. Default 1'),
                values: bool('Also answer with every curve. Default false'),
            }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { time, spectrum, ...pulse } = api.pulseAnalysis(store.get(designId), options);
                const { band, ...curves } = spectrum;
                return {
                    designId, ...pulse, band,
                    ...(values ? { time, spectrum: curves } : { samples: { time: counts(time), spectrum: counts(curves) } }),
                };
            },
        },
        {
            name: 'setPulseSpectrum', title: 'Set the pulse spectrum',
            description: "Sets the spectrum a design holds for Pulse Analysis, as the window's Load file and Apply set it: a text table read as the curve editor reads it, its wavelength column in the unit its heading names, or rows given, each [wavelength nm, intensity] or [wavelength nm, intensity, phase rad]. Against wavelength the intensity is read as per unit wavelength. The design saves the rows; pulseAnalysis with source 'design' reads them, its centre their centroid. Give path or rows, not both. Answers with the design and the rows it holds.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of a text table: wavelength, intensity, and the spectral phase in rad when there is a third column'),
                rows: list({ type: 'array', items: { type: 'number' } }, 'Rows [wavelength nm, intensity] or [wavelength nm, intensity, phase rad]'),
            }, ['designId']),
            run: ({ designId, path, rows }) => {
                if ((path === undefined) === (rows === undefined)) throw new Error('give either path or rows');
                const bad = rows?.findIndex(row => row.length < 2 || row.length > 3) ?? -1;
                if (bad >= 0) throw new Error(`rows[${bad}] is [wavelength nm, intensity] or [wavelength nm, intensity, phase rad], not ${JSON.stringify(rows[bad])}`);
                store.set(designId, api.setPulseSpectrum(store.get(designId), path === undefined ? rows : spectrumPath(path)));
                return { ...designView(designId, store.get(designId)), rows: store.get(designId).pulseSpectrum.rows.length };
            },
        },
    ];
}

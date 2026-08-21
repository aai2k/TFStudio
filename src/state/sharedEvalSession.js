import { createWindowSession } from '../components/windows/windowSession.js';

/**
 * The spectral range, step, angle list and display unit every evaluation window
 * follows.
 *
 * These belong to no single window: they are edited in Optical Evaluation's
 * settings panel and in Settings → Analysis → All windows, and read by the
 * Spectrum Exchange window as well. Holding them in one session store gives
 * them the same lifetime as a window's own controls and lets Optical Evaluation
 * save them as defaults, rather than leaving the range the user retypes every
 * session as the one setting its Save button could not reach.
 *
 * The three wavelength fields and the unit are declared in the analysis
 * registry, so saving them writes to the `analysis` block and Settings shows
 * the same values. The angle list has no registry entry and is saved as it is.
 */
export const sharedEvalSession = createWindowSession({
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 2,
    thetas: [0],
    spectralUnit: 'nm',
}, {
    id: 'shared',
    savable: ['lambdaStart', 'lambdaEnd', 'lambdaStep', 'thetas', 'spectralUnit'],
});

import {
    EVAL_PARAM_KEYS, pickDefaults, registryKeys,
} from '../constants/analysisDefaults.js';
import { createWindowSession } from '../components/windows/windowSession.js';

/**
 * Optical Evaluation's spectral range, step, display unit and angle list.
 *
 * They belong to that window and are declared with the rest of its settings in
 * the analysis registry, so Settings → Analysis → Optical Evaluation and the
 * window's own panel edit one set of values.
 *
 * They live here rather than in the window because the Spectrum Exchange window
 * seeds its export grid from them, the Material Editor takes its working range
 * from them and the Coating Library offers them as the band a coating is saved
 * over. Reaching into a window that may not be open is worse than keeping them
 * at App level.
 *
 * Being at App level, they are also the one part of Optical Evaluation that two
 * open copies of it share: a second copy shows the same band at the same step
 * and angles, and differs in what it draws over them.
 */
export const evalParamsSession = createWindowSession(
    pickDefaults('opticalEvaluation', EVAL_PARAM_KEYS),
    {
        id: 'opticalEvaluation',
        copies: 'shared',
        savable: registryKeys('opticalEvaluation', EVAL_PARAM_KEYS),
    },
);

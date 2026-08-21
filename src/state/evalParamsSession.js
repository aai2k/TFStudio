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
 * seeds its export grid from them, and reaching into a window that may not be
 * open is worse than keeping them at App level.
 */
export const evalParamsSession = createWindowSession(
    pickDefaults('opticalEvaluation', EVAL_PARAM_KEYS),
    {
        id: 'opticalEvaluation',
        savable: registryKeys('opticalEvaluation', EVAL_PARAM_KEYS),
    },
);

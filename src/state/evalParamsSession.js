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
 * They live here rather than in the window because three other windows read
 * them: the Spectrum Exchange window seeds its export grid, the Material Editor
 * takes its working range and the Coating Library offers them as the band a
 * coating is saved over. All three read without writing, and each does so
 * through `peek`, which shows the copy the user changed last and falls back to
 * the values the window would open with when none of it is open.
 *
 * Per copy, like every other window's controls: comparing two angles is a
 * reason to open Optical Evaluation twice, and a second copy sharing the first
 * one's band and angles could not do it.
 */
export const evalParamsSession = createWindowSession(
    pickDefaults('opticalEvaluation', EVAL_PARAM_KEYS),
    {
        id: 'opticalEvaluation',
        savable: registryKeys('opticalEvaluation', EVAL_PARAM_KEYS),
    },
);

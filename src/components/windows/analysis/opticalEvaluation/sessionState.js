import {
    EVAL_PARAM_KEYS, pickDefaults, registryKeys,
} from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// The spectral range, step, angle list and display unit are this window's too,
// but they live in state/evalParamsSession.js because Spectrum Exchange seeds
// its export grid from them. Both stores register under this window's id, so
// Save and Restore cover the two together.
//
// Everything here comes from the analysis registry, so Settings edits the same
// values the window opens with.
export const opticalEvaluationSession = createWindowSession({
    ...pickDefaults('opticalEvaluation', EVAL_PARAM_KEYS, { invert: true }),
    // A curve map is not a scalar, so the registry cannot hold it; the plot
    // colours for each of these curves are declared there instead.
    showCurves: { T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false },
}, {
    id: 'opticalEvaluation',
    // Which curves are drawn is what you are looking at, not what the window
    // should open with, so it is not a configured default.
    savable: registryKeys('opticalEvaluation')
        .filter(key => !EVAL_PARAM_KEYS.includes(key)),
});

// Target drawing: which curve a drawn target lands on and how it snaps. These
// describe how the user works rather than the coating, so they carry across a
// design change.
export const opticalTargetSession = createWindowSession({
    editMode: false,
    editTool: 'draw',
    editCurve: 'R',
    editPol: 'avg',
    editKind: 'average',
    snapOn: true,
    snapNm: 10,
    snapPct: 5,
    // The level grid on a logarithmic axis, in decades below full
    // transmittance: half a decade is 5 dB or OD 0.5.
    snapDecades: 0.5,
});

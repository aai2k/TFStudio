import { createWindowSession } from '../../windowSession.js';

// The spectral range, step, angle list and display unit are not here: they are
// shared with the other evaluation windows and live in state/sharedEvalSession.js.
// Optical Evaluation's Save covers them too — see ALSO_EDITS in
// utils/windowDefaults.js.
//
// `defaultsApplied` records that the configured display defaults have been read
// into this session. Until they have, a window mounting before the preferences
// file has finished loading takes them as they arrive. Afterwards the values
// belong to the session, so a later edit in Settings applies to the next app run
// rather than overwriting controls the user has set here.
export const opticalEvaluationSession = createWindowSession({
    showCurves: { T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false },
    showTable: false,
    showTargets: true,
    yAuto: true,
    yMin: null,
    yMax: null,
    defaultsApplied: false,
}, {
    id: 'opticalEvaluation',
    savable: ['showCurves', 'showTable', 'showTargets', 'yAuto', 'yMin', 'yMax'],
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
});

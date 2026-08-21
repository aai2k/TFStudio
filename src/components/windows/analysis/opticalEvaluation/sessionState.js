import { createWindowSession } from '../../windowSession.js';

// The spectral parameters are not here: they live in DesignContext, shared with
// the other evaluation windows, and already outlive a remount.
//
// `defaultsApplied` records that the configured display defaults have been read
// into this session. Until they have, a window mounting before settings.json has
// finished loading takes them as they arrive. Afterwards the values belong to the
// session, so a later edit in Settings applies to the next app run rather than
// overwriting controls the user has set here.
// The spectral unit is not savable here: it belongs to the shared spectral
// range in Settings → Analysis, which every evaluation window follows.
export const opticalEvaluationSession = createWindowSession({
    showCurves: { T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false },
    showTable: false,
    showTargets: true,
    yAuto: true,
    yMin: null,
    yMax: null,
    spectralUnit: null,
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

import { createWindowSession } from '../../windowSession.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

// An imported file and the column mapping chosen for it belong to the file, not
// to any design, so one slot serves every design and an import in progress is
// not lost by docking the window before it is applied.
export const measuredEllipsometrySession = createWindowSession({
    parsed: null,
    fileName: '',
    colIdx: 0,
    selectedCurveId: null,
    tab: 'import',
    xUnit: X_UNITS.NM,
    // An ellipsometer is a fixed-angle instrument far more often than not, and
    // 70 deg is where most of them sit: near the principal angle of silicon,
    // which is what nearly every witness sample is.
    aoi: 70,
    side: 'front',
    deltaConvention: 'azzam',
    expSource: 'measured',
    expXUnit: X_UNITS.NM,
    expSelected: {},
    expStart: 300,
    expEnd: 900,
    expStep: 5,
    expAoi: 70,
    // Per-column name and quantity overrides, keyed by column index.
    ov: {},
});

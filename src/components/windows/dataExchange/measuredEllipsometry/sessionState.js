import { createWindowSession } from '../../windowSession.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

// An opened file and the column mapping chosen for it belong to the design
// they are being imported into: a file opened for one design is not offered
// to another. The slot lives at module scope, so an import in progress is not
// lost by docking the window before it is applied.
export const measuredEllipsometrySession = createWindowSession({
    parsed: null,
    fileName: '',
    colIdx: 0,
    selectedCurveId: null,
    xUnit: X_UNITS.NM,
    // An ellipsometer is a fixed-angle instrument far more often than not, and
    // 70 deg is where most of them sit: near the principal angle of silicon,
    // which is what nearly every witness sample is.
    aoi: 70,
    side: 'front',
    // The sign the file being read was written in.
    deltaConvention: 'azzam',
    // Which of the design's curves the export writes, keyed by curve id.
    expSelected: {},
    // Per-column name and quantity overrides, keyed by column index.
    ov: {},
    // Fit dialog settings per curve, keyed by curve id.
    fitOptions: {},
}, { scope: 'design' });

// How the window is arranged rather than what it holds. None of it means
// anything about a particular design, so it is kept in one slot for all of
// them: selecting another design must not put the divider, the tab and the
// export grid back where they started.
export const measuredEllipsometryView = createWindowSession({
    tab: 'import',
    // The width of the import tab's panel in pixels, or null while the layout's
    // own default stands. The plot takes the rest.
    panelWidth: null,
    expSource: 'measured',
    expXUnit: X_UNITS.NM,
    expStart: 300,
    expEnd: 900,
    expStep: 5,
    expAoi: 70,
    // The sign the calculated export writes Δ in: the one the instrument's
    // software reads, which is a separate choice from the sign an opened file
    // was written in.
    expDeltaConvention: 'azzam',
});

import { createWindowSession } from '../../windowSession.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

// An opened file and the column mapping chosen for it belong to the design
// they are being imported into: a file opened for one design is not offered
// to another. The slot lives at module scope, so an import in progress is not
// lost by docking the window before it is applied.
export const spectrumExchangeSession = createWindowSession({
    parsed: null,
    fileName: '',
    colIdx: 0,
    selectedCurveId: null,
    // Which of the design's curves the export writes, keyed by curve id.
    expSelected: {},
    xUnit: X_UNITS.NM,
    aoi: 0,
    pol: 'avg',
    // Per-curve measured-target generation controls, keyed by curve id.
    fitOptions: {},
    // Per-column name, quantity and scale overrides, keyed by column index.
    ov: {},
}, { scope: 'design' });

// How the window is arranged rather than what it holds. None of it means
// anything about a particular design, so it is kept in one slot for all of
// them: selecting another design must not put the tab and the export format
// back where they started.
export const spectrumExchangeView = createWindowSession({
    tab: 'import',
    expSource: 'design',
    expFormat: 'csv',
    expXUnit: X_UNITS.NM,
    expYScale: 'percent',
});

import { createWindowSession } from '../../windowSession.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

// An imported file and the column mapping chosen for it belong to the file, not
// to any design, so one slot serves every design and an import in progress is
// not lost by docking the window before it is applied.
export const spectrumExchangeSession = createWindowSession({
    parsed: null,
    fileName: '',
    colIdx: 0,
    selectedCurveId: null,
    tab: 'import',
    expSource: 'design',
    expFormat: 'csv',
    expSelected: {},
    expXUnit: X_UNITS.NM,
    expYScale: 'percent',
    xUnit: X_UNITS.NM,
    aoi: 0,
    pol: 'avg',
    side: 'front',
    // Per-curve measured-target generation controls, keyed by curve id.
    fitOptions: {},
    // Per-column name, quantity and scale overrides, keyed by column index.
    ov: {},
});

import { createWindowSession } from '../../windowSession.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

// An imported file and the column mapping chosen for it belong to the file, not
// to any design, so one slot serves every design and an import in progress is
// not lost by docking the window before it is applied.
export const spectrumExchangeSession = createWindowSession({
    parsed: null,
    fileName: '',
    colIdx: 0,
    name: '',
    tab: 'import',
    expSource: 'design',
    expFormat: 'csv',
    xUnit: X_UNITS.NM,
    // Per-column quantity and scale overrides, keyed by column index.
    ov: {},
});

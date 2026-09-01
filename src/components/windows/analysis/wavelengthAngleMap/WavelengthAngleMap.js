/**
 * T, R or A over wavelength and angle of incidence at once.
 *
 * Angle behaviour is the question a coating gets asked after its normal-
 * incidence spectrum, and reading it one angle at a time hides where a passband
 * edge actually walks off. The map answers it in one picture, and it recomputes
 * as the design changes rather than waiting to be run.
 */

import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { hasLayersForMode } from '../layersForMode.js';
import { SurfaceChart } from '../plotEngine/charts.js';
import { surfaceColumns, surfaceRows } from '../plotEngine/resultTable.js';
import { MapControls } from './MapControls.js';
import { useWavelengthAngleMap } from './useWavelengthAngleMap.js';

const { createElement: h, useCallback } = React;

// The surface's own columns, with both axes named. Only the names differ: an
// exported angle map is read away from the window that produced it, where a
// generic x and y say nothing about which is the wavelength.
function mapColumns(t, result) {
    const wam = t.wavelengthAngleMap;
    const [x, y, z] = surfaceColumns(t, result);
    return [{ ...x, label: wam.colLambda }, { ...y, label: wam.colAngle }, z];
}

export function WavelengthAngleMap({ c, t }) {
    const state = useWavelengthAngleMap();
    const { design } = state;
    const wam = t.wavelengthAngleMap;
    const dt = t.dataTable;
    const columns = mapColumns(t, state.result);
    const rows = surfaceRows(state.result);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_angle_map.csv`,
    );
    // Outside a material's measured range the index is extrapolated or held
    // flat, and a map covers a whole band at once, so the warning carries the
    // range that clears it.
    const setRange = state.patch;
    const fixRange = useCallback(
        ([from, to]) => setRange({ lambdaStart: from, lambdaEnd: to }),
        [setRange]);
    const rangeNotice = useMaterialRangeNotice(
        design, state.lambdaStart, state.lambdaEnd, t, fixRange);

    if (!design) return h(CenteredMessage, { c, message: wam.noDesign });
    if (!hasLayersForMode(design, state.evalMode)) {
        return h(CenteredMessage, { c, message: wam.noLayers });
    }

    return h(AnalysisWindow, { c },
        h(MapControls, { c, t, wam, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null,
            h(SurfaceChart, {
                result: state.result, spec: state.spec, design, c, t,
                prompt: wam.computingFirst,
            }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: value => state.set('showTable', value),
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                h(ExportMenu, {
                    c, enabled: rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}

/**
 * Reflection ellipsometry, rho = r_p / r_s = tan(Psi) exp(i Delta).
 * Macleod, Thin-Film Optical Filters, 5th ed., p. 553 and Eq. (16.2).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage } from '../chrome/layout.js';
import { EllipsometryControls } from './EllipsometryControls.js';
import { buildEllipsometryTable, EllipsometryResults } from './EllipsometryResults.js';
import { measuredEllipsometryOverlays, sideSummary } from './model.js';
import { useEllipsometryEvaluation } from './useEllipsometryEvaluation.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h } = React;

export function EllipsometryEvaluation({ c, theme, t }) {
    const text = t.ellipsometry;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useEllipsometryEvaluation(design);
    const curveColors = useAnalysisColors('ellipsometryEvaluation');
    const table = buildEllipsometryTable(state.mode, state.data);
    // The angular sweep holds λ fixed, so it is checked at that one wavelength.
    const [fromNm, toNm] = state.mode === 'spectral'
        ? [state.lambdaStart, state.lambdaEnd]
        : [state.lambdaNm, state.lambdaNm];
    const rangeNotice = useMaterialRangeNotice(design, fromNm, toNm, t);
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_ellipsometry.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: text.noDesign });

    const summary = sideSummary(design, state.side);
    const hasData = !!(summary.validLayers.length && state.data && state.data.x.length);
    return h(AnalysisWindow, { c },
        h(EllipsometryControls, {
            c, t, text, state, curveColors, notices: [rangeNotice].filter(Boolean),
        }),
        h(EllipsometryResults, {
            c, t, text, state, table, hasData,
            overlays: measuredEllipsometryOverlays(design, {
                mode: state.mode, side: state.side,
                showPsi: state.showPsi, showDelta: state.showDelta,
                deltaConvention: state.deltaConvention,
            }),
            exportMenu: h(ExportMenu, {
                c, enabled: table.rows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }),
    );
}

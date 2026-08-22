/**
 * Group delay and dispersion evaluation. Macleod, Thin-Film Optical Filters,
 * 5th ed., Eq. (11.17): GD = -dφ/dω and GDD = -d²φ/dω².
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { csvFromRows } from '../../../ui/ResultsSection.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { AnalysisWindow, CenteredMessage } from '../chrome/layout.js';
import { GDControls } from './GDControls.js';
import { GDResults } from './GDResults.js';
import { buildGdGddView } from './viewModel.js';
import { useGDGDDState } from './useGDGDDState.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useMemo } = React;

const QUANTITY_ORDER = { phase: 0, gd: 1, gdd: 2, tod: 3 };

/**
 * What the curve needs qualifying with: an optical constant taken from outside
 * a material's data range, a derivative taken across a knot in tabulated data,
 * samples the automatic vertical range left off the plot.
 */
function buildNotices({ raw, quantity, autoRange, rangeNotice, text }) {
    const notices = [rangeNotice];
    const order = QUANTITY_ORDER[quantity] ?? 1;
    if (order > (raw?.phaseContinuousOrder ?? 3) && raw?.discontinuityModels?.length) {
        notices.push({
            label: text.piecewiseShort,
            detail: `${text.tableKnotWarning} (${raw.discontinuityModels.join('; ')})`,
        });
    }
    if (autoRange?.outside > 0) {
        notices.push({ label: text.offScale(autoRange.outside), detail: text.offScaleHint });
    }
    return notices.filter(Boolean);
}

export function GDGDDEvaluation({ c, theme, t }) {
    const text = t.gdgdd;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useGDGDDState(design);
    const curve = useAnalysisColors('gdGddEvaluation');
    const rangeNotice = useMaterialRangeNotice(design, state.lamStart, state.lamEnd, t);

    // The view holds the chart series and axis range. Rebuilding it on every
    // render hands the chart new objects each time and forces a full re-plot of a
    // multi-thousand-point trace, so it is tied to the values it is built from.
    const view = useMemo(() => buildGdGddView(state.raw, {
        quantity: state.quantity,
        referenceLambda: state.refLam,
        showReference: state.showRef,
    }, text, curve), [state.raw, state.quantity, state.refLam, state.showRef, text, curve]);
    const csv = useCsvExport(
        () => csvFromRows(view.tableColumns, view.tableRows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_dispersion.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: text.noDesign });

    const notices = buildNotices({
        raw: state.raw, quantity: state.quantity,
        autoRange: state.yAuto ? view.autoRange : null,
        rangeNotice, text,
    });
    const exportMenu = h(ExportMenu, {
        c, enabled: view.tableRows.length > 0, ...csv,
        labels: {
            export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
            copied: dt.csvCopied, saved: dt.csvSaved,
        },
    });

    return h(AnalysisWindow, { c },
        h(GDControls, {
            c, t, text, state, raw: state.raw,
            autoRange: view.autoRange, notices,
        }),
        h(GDResults, { c, t, text, state, view, exportMenu }),
    );
}

/**
 * Group delay and dispersion evaluation. Macleod, Thin-Film Optical Filters,
 * 5th ed., Eq. (11.17): GD = -dφ/dω and GDD = -d²φ/dω².
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { MaterialRangeWarning } from '../../../materials/MaterialRangeNotice.js';
import { csvFromRows } from '../../../ui/ResultsSection.js';
import { useCsvExport } from '../../../ui/ExportMenu.js';
import { GDControls, GDFooter } from './GDControls.js';
import { GDResults, CenteredMessage } from './GDResults.js';
import { buildGdGddView, buildLayerSummary } from './viewModel.js';
import { useGDGDDState } from './useGDGDDState.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useMemo } = React;

export function GDGDDEvaluation({ c, theme, t }) {
    const text = t.gdgdd;
    const { design } = useDesign();
    const state = useGDGDDState(design);
    const curve = useAnalysisColors('gdGddEvaluation');

    // The view holds the chart's traces and axis range. Rebuilding it on every
    // render hands Plotly new objects each time and forces a full re-plot of a
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

    // Built from the same sampled design as the curve, so the caption and the
    // plot describe one state instead of disagreeing during a run.
    const summary = buildLayerSummary(state.liveDesign, state.side);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
        h(GDControls, { c, t, text, state }),
        h(MaterialRangeWarning, { design, fromNm: state.lamStart, toNm: state.lamEnd, c, t }),
        h(GDResults, { c, t, text, state, view }),
        h(GDFooter, {
            c, text, dataTable: t.dataTable, design, side: state.side, summary,
            raw: state.raw, quantity: state.quantity,
            csv: { ...csv, enabled: view.tableRows.length > 0 },
        }),
    );
}

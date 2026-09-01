/**
 * Configures graded transition layers at coating interfaces and compares their
 * spectrum with the homogeneous design. Macleod, Thin-Film Optical Filters,
 * 5th ed., "Inhomogeneous Layers" describes the homogeneous-sublayer model.
 */

import { totalInterlayerThickness } from '../../../../utils/physics/inhomogeneity.js';
import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { SpecVerdict } from '../../../SpecVerdict.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import {
    InhomogeneityControls, InhomogeneityEditor, InhomogeneityEditorActions,
} from './InhomogeneityControls.js';
import { OverlayChart } from './OverlayChart.js';
import { hasLayersForMode } from '../layersForMode.js';
import { overlayColumns, overlayRows } from './tableModel.js';
import { useInhomogeneities } from './useInhomogeneities.js';

const { createElement: h } = React;

function activeInterlayerCount(inh) {
    return [...(inh.interlayers || []), ...(inh.backInterlayers || [])]
        .filter(interlayer => interlayer.enabled !== false).length;
}

function buildNotices({ state, ih, rangeNotice }) {
    const notices = [];
    if (state.error) notices.push({ label: state.error, tone: 'error' });
    if (state.activeSides.includes('back') && !state.hasBack) {
        notices.push({ label: ih.noBackLayers });
    }
    if (rangeNotice) notices.push(rangeNotice);
    return notices;
}

export function Inhomogeneities({ c, theme, t }) {
    const state = useInhomogeneities();
    const { design, evalMode, inh } = state;
    const ih = t.inhomogeneities;
    const dt = t.dataTable;
    const columns = overlayColumns(t, state.showCurves);
    const rows = overlayRows(state.baseline, state.perturbed, state.showCurves);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_interlayers.csv`,
    );
    const { setLambdaStart, setLambdaEnd } = state;
    const fixRange = ([from, to]) => {
        setLambdaStart(from);
        setLambdaEnd(to);
    };
    const rangeNotice = useMaterialRangeNotice(
        design, state.lambdaStart, state.lambdaEnd, t, fixRange);

    if (!design) return h(CenteredMessage, { c, message: ih.noDesign });
    if (!hasLayersForMode(design, evalMode)) {
        return h(CenteredMessage, { c, message: ih.noLayers });
    }

    return h(AnalysisWindow, { c },
        h(InhomogeneityControls, { c, t, ih, state, notices: buildNotices({ state, ih, rangeNotice }) }),
        h(PlotArea, null,
            h(OverlayChart, {
                baseline: state.baseline, perturbed: state.perturbed,
                showCurves: state.showCurves, c, t,
            }),
        ),
        h(ResultsSection, {
            c, label: ih.editorTitle,
            summary: `${activeInterlayerCount(inh)} ${ih.activeInterlayers} · Σ ${totalInterlayerThickness(inh).toFixed(2)} nm`,
            open: state.showEditor, setOpen: state.setShowEditor,
            actions: h(InhomogeneityEditorActions, { c, ih, state }),
        }, h(InhomogeneityEditor, { c, ih, state })),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                (design?.qualifiers?.length > 0 && state.specInputs) && h(SpecVerdict, {
                    design: state.specInputs.specDesign, resolveMat: state.specInputs.resolve, c, t,
                    label: t.specification.specLabel,
                }),
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

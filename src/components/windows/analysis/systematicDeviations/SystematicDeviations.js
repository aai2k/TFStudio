/**
 * Simulates uniform thickness and refractive-index deviations, either as one
 * perturbed spectrum or as a parameter sweep corridor.
 */

import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { SpecVerdict } from '../../../SpecVerdict.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { SpectrumPlot } from './SpectrumPlot.js';
import { SweepHeatmap } from './SweepHeatmap.js';
import { SystematicControls } from './SystematicControls.js';
import {
    deviationColumns, deviationRows, sweepColumns, sweepRows,
} from './tableModel.js';
import { useSystematicDeviations } from './useSystematicDeviations.js';

const { createElement: h } = React;

function resultTable(state, t) {
    if (state.mode === 'single') {
        return {
            columns: deviationColumns(t, state.channel),
            rows: deviationRows(state.baseline, state.deviated, state.channel),
        };
    }
    return {
        columns: sweepColumns(t, state.sweepChannel),
        rows: sweepRows(state.sweepResult, state.sweepChannel),
    };
}

function plotBody({ state, sd, c }) {
    if (state.mode === 'single') {
        return h(SpectrumPlot, {
            baseline: state.baseline, deviated: state.deviated,
            channel: state.channel, showBaseline: state.showBaseline, c,
        });
    }
    if (state.sweepResult) {
        return h(SweepHeatmap, {
            sweepData: state.sweepResult, channel: state.sweepChannel, c,
        });
    }
    return h(CenteredMessage, {
        c, message: state.sweepRunning ? sd.runningMsg : sd.sweepHint,
    });
}

export function SystematicDeviations({ c, theme, t }) {
    const state = useSystematicDeviations();
    const { design } = state;
    const sd = t.systematicDeviations;
    const dt = t.dataTable;
    const error = state.computeError || state.error;
    const { columns, rows } = resultTable(state, t);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_deviations.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: sd.noDesign });
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        return h(CenteredMessage, { c, message: sd.noLayers });
    }

    return h(AnalysisWindow, { c },
        h(SystematicControls, {
            c, t, sd, state,
            notices: error ? [{ label: error, tone: 'error' }] : [],
        }),
        h(PlotArea, null, plotBody({ state, sd, c })),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                (state.mode === 'single' && design?.qualifiers?.length > 0) && h(SpecVerdict, {
                    design: state.specDev.design, resolveMat: state.specDev.resolve, c, t,
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

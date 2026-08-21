/**
 * Monte-Carlo manufacturing-error analysis.
 *
 * Macleod, Thin-Film Optical Filters, 5th ed., section 13.7 describes
 * Monte-Carlo analysis as an established tolerance and yield method.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { ActionButton } from '../chrome/controls.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { ErrorChart } from './ErrorChart.js';
import { ErrorControls } from './ErrorControls.js';
import { statisticsColumns, statisticsRows } from './resultTable.js';
import { TrialsModal } from './TrialsModal.js';
import { hasPerturbableLayers } from './trialModel.js';
import { chip } from './ui.js';
import { useErrorAnalysis } from './useErrorAnalysis.js';

const { createElement: h } = React;

// A run takes seconds to minutes, so its progress gets a hairline under the
// control row while it is going and nothing at all once it is done.
function ProgressBar({ progress, c }) {
    return h('div', { style: { height: 3, background: c.border, flexShrink: 0 } },
        h('div', {
            style: {
                height: '100%', background: c.accent,
                width: progress.total ? `${100 * progress.i / progress.total}%` : '0%',
                transition: 'width 100ms linear',
            },
        }),
    );
}

/** How many trials met the design's spec, and which qualifier failed the most. */
function SpecStatus({ spec, c, ea }) {
    const yieldValue = spec.yield;
    const color = yieldValue == null
        ? c.textDim
        : yieldValue >= 0.95 ? c.success : yieldValue >= 0.8 ? c.warning : c.error;
    const failures = (spec.perQualifier || [])
        .filter(qualifier => qualifier.failRate > 0)
        .sort((a, b) => b.failRate - a.failRate);
    return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    },
        h('span', { style: { color, fontWeight: 600, fontSize: 11 } },
            `${ea.specYield}: ${yieldValue == null ? '—' : `${(yieldValue * 100).toFixed(0)}%`}`),
        ...failures.map((failure, index) => chip(
            `✗ ${failure.label} ${(failure.failRate * 100).toFixed(0)}%`, '#ef5350',
            `${failure.label}: ${(failure.failRate * 100).toFixed(0)}%`, index)),
        failures.length === 0 && chip(ea.specAllPass, c.success, null, 'allpass'),
    );
}

function runControls({ state, ea, c }) {
    const buttons = [];
    if (state.result?.trials?.length && !state.running) {
        buttons.push(h(ActionButton, {
            key: 'trials', c, label: ea.viewTrials, title: ea.viewTrialsTip,
            onClick: () => state.setShowTrials(true),
        }));
    }
    buttons.push(state.running
        ? h(ActionButton, { key: 'run', c, label: ea.stop, onClick: state.stop })
        : h(ActionButton, { key: 'run', c, label: ea.run, onClick: state.handleRun }));
    return buttons;
}

export function ErrorAnalysis({ c, t }) {
    const ea = t.errorAnalysis;
    const dt = t.dataTable;
    const { design, evalMode, updateDesign, checkpoint } = useDesign();
    const state = useErrorAnalysis({ design, evalMode });
    const { result, error, running, corridorSigma, showEnvelope } = state;
    const columns = statisticsColumns(t, state.char, corridorSigma);
    const rows = statisticsRows(result, corridorSigma);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_montecarlo.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: ea.noDesign });
    if (!hasPerturbableLayers(design, evalMode)) {
        return h(CenteredMessage, { c, message: ea.noLayers });
    }

    return h(AnalysisWindow, { c },
        h(ErrorControls, {
            c, t, ea, state,
            trailing: runControls({ state, ea, c }),
            notices: error ? [{ label: error, tone: 'error' }] : [],
        }),
        running && h(ProgressBar, { progress: state.progress, c }),
        h(PlotArea, null,
            result
                ? h(ErrorChart, { result, char: state.char, c, corridorSigma, showEnvelope })
                : h(CenteredMessage, {
                    c,
                    message: running
                        ? `${ea.running}: ${state.progress.i}/${state.progress.total}`
                        : ea.clickRun,
                }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                result?.spec && !running && h(SpecStatus, { spec: result.spec, c, ea }),
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
        state.showTrials && result?.trials && h(TrialsModal, {
            result, design, c, t, corridorSigma, updateDesign, checkpoint,
            onClose: () => state.setShowTrials(false),
        }),
    );
}

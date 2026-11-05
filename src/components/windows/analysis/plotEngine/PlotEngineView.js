import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ActionButton, ChoiceGroup } from '../chrome/controls.js';
import { AnalysisWindow, ControlRow, PlotArea, ProgressHairline } from '../chrome/layout.js';
import { NoticeBadge, PopoverButton, SettingsMenu } from '../chrome/popover.js';
import { CurveRow } from './CurveRow.js';
import { SurfacePanel } from './SurfacePanel.js';
import { MultiCurveChart, SurfaceChart } from './charts.js';
import { curveColumns, curveRows, surfaceColumns, surfaceRows } from './resultTable.js';

const { createElement: h, useMemo } = React;

/** The curves drawn in 2D, each with what it sweeps and the quantities it plots. */
function CurveList({ curvePlot, design, c, t, pe }) {
    const { curves, results, addCurve, updateCurve, deleteCurve } = curvePlot;
    return h(PopoverButton, { c, label: `${pe.curves} (${curves.length})`, width: 400 },
        h('div', {
            style: {
                display: 'flex', justifyContent: 'flex-end',
                paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
            },
        },
            h(ActionButton, { c, label: pe.addCurve, onClick: addCurve }, tablerIcon('plus', 13)),
        ),
        curves.map(curve => h(CurveRow, {
            key: curve.id,
            curve,
            design,
            errorKey: results[curve.id]?.errorKey,
            onUpdate: patch => updateCurve(curve.id, patch),
            onDelete: () => deleteCurve(curve.id),
            c, t,
        })),
    );
}

/** What the heatmap and the 3D surface sweep: their two axes and their quantity. */
function SurfaceSettings({ surfacePlot, design, c, t }) {
    return h(SettingsMenu, {
        c, t, label: t.analysisChrome.settings, title: t.analysisChrome.settingsTip, width: 400,
    },
        h(SurfacePanel, {
            spec: surfacePlot.surfaceSpec,
            onUpdate: surfacePlot.updateSurface,
            design,
            result: surfacePlot.surfaceResult,
            c, t,
        }),
    );
}

/** Stop while a computation runs; otherwise Compute, where there is one to start. */
function RunButton({ running, canRun, onRun, onStop, stopTip, c, pe }) {
    if (running) {
        return h(ActionButton, { c, label: pe.stop, title: stopTip, onClick: onStop },
            tablerIcon('player-stop', 13));
    }
    if (!canRun) return null;
    return h(ActionButton, { c, label: pe.compute, onClick: onRun }, tablerIcon('player-play', 13));
}

/**
 * What the run button does in a mode. The curves compute themselves when
 * anything changes, so 2D offers Compute only to start again what Stop ended,
 * and a change starts them too. A map is computed on demand: a change only
 * clears it.
 */
export function runControl(is2D, curvePlot, surfacePlot, pe) {
    return is2D
        ? {
            running: curvePlot.busy, canRun: curvePlot.stopped,
            onRun: curvePlot.resume, onStop: curvePlot.stop, stopTip: pe.stopTip,
        }
        : {
            running: surfacePlot.computing, canRun: true,
            onRun: surfacePlot.computeSurfaceNow, onStop: surfacePlot.stop, stopTip: pe.stopMapTip,
        };
}

/** What the plot stands in with while a surface is being computed. */
function computingPrompt(progress, pe) {
    return progress?.total ? `${pe.computing} ${progress.done}/${progress.total}` : pe.computing;
}

function PlotModeChoice({ surfacePlot, c, pe }) {
    return h(ChoiceGroup, {
        ariaLabel: pe.plotType, activeId: surfacePlot.plotMode, c,
        onSelect: surfacePlot.setPlotMode,
        items: [
            { id: '2d', label: pe.mode2D },
            { id: 'heatmap', label: pe.modeHeatmap },
            { id: '3d', label: pe.mode3D },
        ],
    });
}

function ResultsTable({ rows, columns, design, surfacePlot, c, t }) {
    const dt = t.dataTable;
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_plot.csv`,
    );
    return h(ResultsSection, {
        c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
        open: surfacePlot.showTable, setOpen: surfacePlot.setShowTable,
        actions: h(ExportMenu, {
            c, enabled: rows.length > 0, ...csv,
            labels: {
                export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                copied: dt.csvCopied, saved: dt.csvSaved,
            },
        }),
    }, h(ResultsGrid, { columns, rows, c }));
}

export function PlotEngineView({ curvePlot, surfacePlot, design, c, t, pe, notices }) {
    const { plotMode, surfaceSpec, surfaceResult, computing, progress } = surfacePlot;
    const is2D = plotMode === '2d';
    const { curves, results } = curvePlot;
    // The surface is drawn as the mode says, whatever its settings were saved with.
    const drawnSpec = useMemo(
        () => ({ ...surfaceSpec, render: plotMode === 'heatmap' ? 'heatmap' : 'surface' }),
        [surfaceSpec, plotMode]);
    // A range and step set no bound on the points, so the rows are built once
    // per result rather than on every render.
    const rows = useMemo(
        () => (is2D ? curveRows(curves, results) : surfaceRows(surfaceResult)),
        [is2D, curves, results, surfaceResult]);
    const columns = is2D ? curveColumns(t) : surfaceColumns(t, surfaceResult);

    return h(AnalysisWindow, { c },
        h(ControlRow, {
            c,
            trailing: [
                h(RunButton, { key: 'run', ...runControl(is2D, curvePlot, surfacePlot, pe), c, pe }),
                h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
                is2D
                    ? h(CurveList, { key: 'curves', curvePlot, design, c, t, pe })
                    : h(SurfaceSettings, { key: 'surface', surfacePlot, design, c, t }),
            ],
        }, h(PlotModeChoice, { surfacePlot, c, pe })),
        !is2D && computing && progress && h(ProgressHairline, {
            c, progress: { i: progress.done, total: progress.total },
        }),
        h(PlotArea, null,
            is2D
                ? h(MultiCurveChart, { curves, results, design, c, t })
                : h(SurfaceChart, {
                    result: surfaceResult, spec: drawnSpec, design, c, t,
                    prompt: computing ? computingPrompt(progress, pe) : undefined,
                }),
        ),
        h(ResultsTable, { rows, columns, design, surfacePlot, c, t }),
    );
}

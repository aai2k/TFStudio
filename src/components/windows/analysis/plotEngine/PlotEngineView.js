import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { ActionButton, ChoiceGroup } from '../chrome/controls.js';
import { AnalysisWindow, ControlRow, PlotArea } from '../chrome/layout.js';
import { PopoverButton } from '../chrome/popover.js';
import { CurveRow } from './CurveRow.js';
import { SurfacePanel } from './SurfacePanel.js';
import { MultiCurveChart, SurfaceChart } from './charts.js';
import { curveColumns, curveRows, surfaceColumns, surfaceRows } from './resultTable.js';

const { createElement: h } = React;

/** The curves drawn in 2D mode, each with the quantity and axis it plots. */
function CurveList({ curvePlot, c, t, pe }) {
    const { curves, addCurve, updateCurve, deleteCurve } = curvePlot;
    return h(PopoverButton, { c, label: `${pe.curves} (${curves.length})`, width: 400 },
        h('div', {
            style: {
                display: 'flex', justifyContent: 'flex-end',
                paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
            },
        },
            h(ActionButton, { c, label: pe.addCurve, onClick: addCurve }),
        ),
        curves.map(curve => h(CurveRow, {
            key: curve.id,
            curve,
            onUpdate: patch => updateCurve(curve.id, patch),
            onDelete: () => deleteCurve(curve.id),
            c, t,
        })),
    );
}

/** The parameter sweep drawn in 3D mode: its two axes, its quantity, and the run. */
function SurfaceSettings({ surfacePlot, design, c, t, pe }) {
    return h(PopoverButton, { c, label: pe.mode3D, width: 400 },
        h(SurfacePanel, {
            spec: surfacePlot.surfaceSpec,
            onUpdate: surfacePlot.updateSurface,
            onCompute: surfacePlot.computeSurfaceNow,
            computing: surfacePlot.computing,
            progress: surfacePlot.progress,
            design,
            result: surfacePlot.surfaceResult,
            c, t,
        }),
    );
}

function resultTable({ is2D, curvePlot, surfacePlot, t }) {
    if (is2D) {
        return {
            columns: curveColumns(t),
            rows: curveRows(curvePlot.curves, curvePlot.results),
        };
    }
    return {
        columns: surfaceColumns(t, surfacePlot.surfaceResult),
        rows: surfaceRows(surfacePlot.surfaceResult),
    };
}

export function PlotEngineView({ curvePlot, surfacePlot, design, c, t, pe }) {
    const dt = t.dataTable;
    const is2D = surfacePlot.plotMode === '2d';
    const { columns, rows } = resultTable({ is2D, curvePlot, surfacePlot, t });
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_plot.csv`,
    );

    return h(AnalysisWindow, { c },
        h(ControlRow, {
            c,
            trailing: is2D
                ? h(CurveList, { curvePlot, c, t, pe })
                : h(SurfaceSettings, { surfacePlot, design, c, t, pe }),
        },
            h(ChoiceGroup, {
                ariaLabel: pe.mode2D, activeId: surfacePlot.plotMode, c,
                onSelect: surfacePlot.setPlotMode,
                items: [
                    { id: '2d', label: pe.mode2D },
                    { id: '3d', label: pe.mode3D },
                ],
            }),
        ),
        h(PlotArea, null,
            is2D
                ? h(MultiCurveChart, { curves: curvePlot.curves, results: curvePlot.results, c })
                : h(SurfaceChart, {
                    result: surfacePlot.surfaceResult, spec: surfacePlot.surfaceSpec,
                    design, c, t,
                }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: surfacePlot.showTable, setOpen: surfacePlot.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: rows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}

/**
 * Bar diagram of the layer thicknesses of one coating, a bar per layer in its
 * material's color, readable in nm, OT, QWOT or FWOT.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { ThicknessChart } from './ThicknessChart.js';
import { ThicknessControls } from './ThicknessControls.js';
import { useThicknessState } from './useThicknessState.js';

const { createElement: h } = React;

const AXIS_BY_UNIT = {
    nm:   { title: lt => lt.yPhysical, suffix: ' nm' },
    OT:   { title: lt => lt.yOptical,  suffix: ' nm' },
    QWOT: { title: lt => lt.yQwot,     suffix: '' },
    FWOT: { title: lt => lt.yFwot,     suffix: '' },
};

function tableColumns(lt) {
    const num = digits => value => (value == null ? '' : value.toFixed(digits));
    return [
        { key: 'layerNumber', label: lt.colLayer },
        { key: 'materialName', label: lt.colMaterial, align: 'left' },
        { key: 'd', label: lt.colPhysical, fmt: num(2) },
        { key: 'ot', label: lt.colOptical, fmt: num(2) },
        { key: 'qwot', label: 'QWOT', fmt: num(4) },
        { key: 'fwot', label: 'FWOT', fmt: num(4) },
    ];
}

export function LayerThicknesses({ c, theme, t }) {
    const lt = t.layerThicknesses;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useThicknessState(design);
    const rangeNotice = useMaterialRangeNotice(design, state.lambda, state.lambda, t);
    const columns = tableColumns(lt);
    const csv = useCsvExport(
        () => csvFromRows(columns, state.rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_layer_thicknesses.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: lt.noDesign });

    const axis = AXIS_BY_UNIT[state.units] || AXIS_BY_UNIT.nm;
    return h(AnalysisWindow, { c },
        h(ThicknessControls, { c, t, lt, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null,
            state.rows.length
                ? h(ThicknessChart, {
                    rows: state.rows, unit: state.units, matColorMap: state.matColorMap,
                    c, xTitle: lt.axisLayer, yTitle: axis.title(lt), valueSuffix: axis.suffix,
                })
                : h(CenteredMessage, { c, message: lt.noLayers }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: state.rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: state.rows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns, rows: state.rows, c })),
    );
}

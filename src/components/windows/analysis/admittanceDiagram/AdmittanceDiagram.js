import { useDesign } from '../../../../state/DesignContext.js';
import { DataTablePanel } from '../../../ui/DataTablePanel.js';
import { AdmittanceChart } from './AdmittanceChart.js';
import { AdmittanceControls } from './AdmittanceControls.js';
import { tableColumns } from './tableModel.js';
import { useAdmittanceDiagram } from './useAdmittanceDiagram.js';

const { createElement: h } = React;

export function AdmittanceDiagram({ c, theme, t }) {
    const { design } = useDesign();
    const state = useAdmittanceDiagram(design);
    const frontLbl = (t && t.admittance && t.admittance.front) || 'Front';
    const backLbl = (t && t.admittance && t.admittance.back) || 'Back';

    return h('div', { style: { display: 'flex', height: '100%', overflow: 'hidden', backgroundColor: c.bg } },
        h(AdmittanceControls, { ...state, c, frontLbl, backLbl }),
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            h('div', { style: { flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 } },
                state.error
                    ? h('div', {
                        style: {
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%', color: c.textDim, padding: 20, textAlign: 'center', fontSize: 13,
                        },
                    }, `Calculation error: ${state.error}`)
                    : !state.hasData
                        ? h('div', {
                            style: {
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                height: '100%', color: c.textDim, fontSize: 13,
                            },
                        }, state.side === 'back'
                            ? ((t && t.admittance && t.admittance.noBackLayers) || 'No back-side layers in active design')
                            : ((t && t.admittance && t.admittance.noLayers) || 'No layers in active design'))
                        : h(AdmittanceChart, { series: state.series, matColorMap: state.matColorMap, c, theme, t })),
            state.tableRows.length > 0 && h(DataTablePanel, { columns: tableColumns, rows: state.tableRows, c, t })),
    );
}

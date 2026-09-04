import { buildTableColumns } from './model.js';
import { formatYCell } from './yScale.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h } = React;

export function DataTable({ data, showCurves, yScale, c, oe }) {
    const curveColors = useAnalysisColors('opticalEvaluation');
    const columns = buildTableColumns(data, showCurves, curveColors, yScale);
    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        userSelect: 'none', whiteSpace: 'nowrap'
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
    };
    return h('div', {
        style: {
            height: 185, overflowY: 'auto', overflowX: 'auto',
            backgroundColor: c.bg,
            flexShrink: 0
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' } },
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left', color: c.textDim } }, oe.wavelength),
                    ...columns.map((column, index) =>
                        h('th', { key: index, style: { ...thBase, textAlign: 'right', color: column.cv.color } }, column.label)
                    )
                )
            ),
            h('tbody', null,
                data.lambda.map((lambda, index) =>
                    h('tr', {
                        key: index,
                        style: { backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' }
                    },
                        h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } }, lambda.toFixed(1)),
                        ...columns.map((column, columnIndex) =>
                            h('td', { key: columnIndex, style: { ...tdBase, textAlign: 'right', color: c.text } },
                                formatYCell(yScale, column.ys[index])
                            )
                        )
                    )
                )
            )
        )
    );
}

import { buildTableColumns } from './model.js';
import { formatYCell } from './yScale.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { RESULT_ROW_HEIGHT } from '../../../ui/ResultsSection.js';
import { useSteadyColumns, useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';

const { createElement: h } = React;

// Wavelengths to the decimals the grid's start and step are written with, and
// at least one, so a table at 0.01 or 0.25 nm does not print 400.0 twice. The
// grid rounds wavelengths to 1e-9 nm, so nine decimals is the most that differ.
function wavelengthDecimals(lambda) {
    if (!lambda.length) return 1;
    const step = lambda.length > 1 ? lambda[1] - lambda[0] : 0;
    const whole = value => Math.abs(value - Math.round(value)) < 1e-6;
    let decimals = 1;
    while (decimals < 9 && !(whole(lambda[0] * 10 ** decimals) && whole(step * 10 ** decimals))) decimals++;
    return decimals;
}

// One row per wavelength, drawn only while in view: nothing limits how many
// wavelengths a range and step ask for.
export function DataTable({ data, showCurves, yScale, c, oe }) {
    const curveColors = useAnalysisColors('opticalEvaluation');
    const columns = buildTableColumns(data, showCurves, curveColors, yScale, oe.curveLabels);
    const view = useVirtualRows(data.lambda.length, RESULT_ROW_HEIGHT);
    const widths = useSteadyColumns([oe.wavelength, ...columns.map(column => column.label)]);
    const decimals = wavelengthDecimals(data.lambda);
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
    const body = virtualBody(data.lambda, view, RESULT_ROW_HEIGHT, columns.length + 1, (lambda, index) =>
        h('tr', {
            key: index,
            style: { height: RESULT_ROW_HEIGHT, backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' }
        },
            h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } }, widths.fit(0, lambda.toFixed(decimals))),
            ...columns.map((column, columnIndex) =>
                h('td', { key: columnIndex, style: { ...tdBase, textAlign: 'right', color: c.text } },
                    widths.fit(columnIndex + 1, formatYCell(yScale, column.ys[index]))
                )
            )
        )
    );
    return h('div', {
        ref: view.paneRef, onScroll: view.onScroll,
        style: {
            height: 185, overflowY: 'auto', overflowX: 'auto',
            backgroundColor: c.bg,
            flexShrink: 0
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', fontSize: 11 } },
            widths.colgroup(),
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left', color: c.textDim } }, oe.wavelength),
                    ...columns.map((column, index) =>
                        h('th', { key: index, style: { ...thBase, textAlign: 'right', color: column.cv.color } }, column.label)
                    )
                )
            ),
            h('tbody', null, body)
        )
    );
}
